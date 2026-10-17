// ── Parti panosu: yapay zekâ köprüsü (Gemini) ──
// Ayrı bir Apps Script projesine yapıştırılır ve "Web uygulaması" olarak yayınlanır.
// Gemini anahtarı yalnız bu projenin gizli ayarında durur: Proje ayarları → Komut dosyası özellikleri → GEMINI_API_KEY
// İsteğe bağlı: GEMINI_MODEL (yoksa sırayla denenir), NTFY_TOPIC (vardiya özetinin gideceği ntfy konusu),
// NTFY_SERVER_URL (varsayılan https://ntfy.sh), NTFY_ACCESS_TOKEN.
// İşlemler:
//  - fotoğraftan parti no: {image, mime, candidates} → {found, other, model}
//  - {action:'gen', prompt, json} → {text, model}                     (pano: makine dağıtım önerisi vb.)
//  - {action:'summary', send}     → {text, facts}; send:true ise ntfy'ye de gönderir
// Vardiya özetini otomatik göndermek için bir kez vardiyaOzetiKur() çalıştırılır (16:05 ve 00:05).

const OCR_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
const OCR_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function doGet() {
  const hasKey = !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  return ocrJson_({ok: true, service: 'parti-ocr', key: hasKey ? 'tanımlı' : 'TANIMLI DEĞİL'});
}

function doPost(e) {
  const key = String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '').trim();
  if (!key) return ocrJson_({ok: false, error: 'no_key'});
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (_) {
    return ocrJson_({ok: false, error: 'json'});
  }
  // panodan genel yapay zekâ isteği (ör. makine dağıtım önerisi)
  if (body.action === 'gen') return ocrJson_(aiGen_(key, body));
  // vardiya özeti: göster (send:false) ya da telefona da gönder (send:true)
  if (body.action === 'summary') {
    const r = ozetHazirla_(key);
    if (body.send && r.ok) {
      try { ozetGonder_(r.text); r.sent = true; } catch (err) { r.sent = false; r.sendError = String(err && err.message || err); }
    }
    return ocrJson_(r);
  }
  const image = String(body.image || '').replace(/^data:[^,]*,/, '');
  const mime = /^image\/(jpeg|png|webp)$/.test(body.mime) ? body.mime : 'image/jpeg';
  if (!image || image.length * 0.75 > OCR_MAX_IMAGE_BYTES) return ocrJson_({ok: false, error: 'image'});
  const candidates = ocrDigits_(body.candidates).slice(0, 3000);
  const fixed = String(PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || '').trim();
  const models = fixed ? [fixed] : OCR_MODELS;
  let last = null;
  for (let i = 0; i < models.length; i++) {
    let r = ocrAsk_(key, models[i], image, mime, candidates);
    // geçici yoğunluk / sunucu hatası: kısa bekleyip aynı modeli bir kez daha dene
    if (r.status === 503 || r.status === 500 || r.status === 502) { Utilities.sleep(1500); r = ocrAsk_(key, models[i], image, mime, candidates); }
    if (r.status === 200) return ocrJson_({ok: true, found: r.found, other: r.other, model: models[i]});
    last = r;
    // model adı yoksa ya da yoğunsa sıradaki modeli dene; kota (429) / anahtar (401, 403) hatasında dur
    if (r.status === 429 || r.status === 401 || r.status === 403) break;
  }
  return ocrJson_({ok: false, error: last && last.status === 429 ? 'quota' : ((last && last.error) || 'okunamadı')});
}

function ocrPrompt_(candidates) {
  return [
    'Bu fotoğraf bir tekstil fabrikasından: üzerinde el yazısıyla ya da basılı olarak parti numaraları (3–6 haneli sayılar) yazıyor.',
    'Geçerli parti numaraları listesi (yalnızca bunlar şu an fabrikada var):',
    candidates.join(' '),
    '',
    'Görev: fotoğraftaki parti numaralarını oku.',
    '- "found": fotoğrafta yazan ve listede olan numaralar. Bir rakam belirsizse (1/7, 5/6, 0/6, 3/8 gibi) listede olan seçeneği seç.',
    '- "other": fotoğrafta parti numarası gibi duran ama listede karşılığı olmayan 3–6 haneli sayılar.',
    '- Parantez içindeki yılları (ör. (2026)), tarihleri, kilo / kg değerlerini, saatleri ve telefon numaralarını yok say.',
    '- Fotoğrafta olmayan bir numarayı asla ekleme; emin değilsen "other"a yaz.',
    'Yalnızca şu biçimde JSON döndür: {"found":["10104","9962"],"other":["5101"]}'
  ].join('\n');
}

function ocrAsk_(key, model, image, mime, candidates) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const payload = {
    contents: [{parts: [{text: ocrPrompt_(candidates)}, {inline_data: {mime_type: mime, data: image}}]}],
    generationConfig: {temperature: 0, responseMimeType: 'application/json'}
  };
  try {
    const res = UrlFetchApp.fetch(url, {method: 'post', contentType: 'application/json', headers: {'x-goog-api-key': key}, payload: JSON.stringify(payload), muteHttpExceptions: true});
    const status = res.getResponseCode();
    let j = {};
    try { j = JSON.parse(res.getContentText()); } catch (_) {}
    if (status !== 200) return {status: status, error: (j.error && j.error.message) || ('HTTP ' + status)};
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map(p => p.text || '').join('');
    let out = {};
    try { out = JSON.parse(text); } catch (_) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { out = JSON.parse(m[0]); } catch (__) {} } }
    return {status: 200, found: ocrDigits_(out.found), other: ocrDigits_(out.other)};
  } catch (err) {
    return {status: 502, error: String(err && err.message || err)};
  }
}

function ocrDigits_(a) {
  const seen = {};
  return (Array.isArray(a) ? a : []).map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 3 && x.length <= 6 && !seen[x] && (seen[x] = true));
}

function ocrJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Genel yapay zekâ çağrısı ──
function aiCall_(key, parts, json) {
  const fixed = String(PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || '').trim();
  const models = fixed ? [fixed] : OCR_MODELS;
  let last = null;
  for (let i = 0; i < models.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[i]) + ':generateContent';
      const cfg = {temperature: 0.2};
      if (json) cfg.responseMimeType = 'application/json';
      let status = 0, j = {};
      try {
        const res = UrlFetchApp.fetch(url, {method: 'post', contentType: 'application/json', headers: {'x-goog-api-key': key}, payload: JSON.stringify({contents: [{parts: parts}], generationConfig: cfg}), muteHttpExceptions: true});
        status = res.getResponseCode();
        try { j = JSON.parse(res.getContentText()); } catch (_) {}
      } catch (err) {
        status = 502; j = {error: {message: String(err && err.message || err)}};
      }
      if (status === 200) {
        const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('');
        return {status: 200, text: text, model: models[i]};
      }
      last = {status: status, error: (j.error && j.error.message) || ('HTTP ' + status)};
      if (status === 503 || status === 500 || status === 502) { Utilities.sleep(1500); continue; }
      break;
    }
    if (last && (last.status === 429 || last.status === 401 || last.status === 403)) break;
  }
  return last || {status: 500, error: 'okunamadı'};
}

function aiGen_(key, body) {
  const prompt = String(body.prompt || '').slice(0, 80000);
  if (!prompt) return {ok: false, error: 'prompt'};
  const r = aiCall_(key, [{text: prompt}], !!body.json);
  if (r.status !== 200) return {ok: false, error: r.status === 429 ? 'quota' : r.error};
  return {ok: true, text: r.text, model: r.model};
}

// ── Vardiya özeti ──
const AI_DATA_URL = 'https://raw.githubusercontent.com/adnsahin/parti-dashboard/main/data/';
const AI_SEL_URL = 'https://ntfy.sh/parti-secim-871336814773a498ffee';

function ozetFetchJson_(url) {
  const res = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'ts=' + Date.now(), {muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) throw new Error(url + ' HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

// pano seçimi (ntfy kanalındaki en yeni mesaj): {list:[parti], notes, mach}
function ozetSecim_() {
  try {
    const res = UrlFetchApp.fetch(AI_SEL_URL + '/json?poll=1&since=all', {muteHttpExceptions: true});
    let best = null;
    res.getContentText().split('\n').forEach(line => {
      if (!line.trim()) return;
      try {
        const m = JSON.parse(line); if (m.event !== 'message') return;
        const d = JSON.parse(m.message); if (!d || typeof d.t !== 'number' || !d.s) return;
        if (!best || d.t > best.t) best = d;
      } catch (_) {}
    });
    if (!best) return {list: [], notes: {}, mach: {}};
    const list = [];
    Object.keys(best.s).forEach(y => {
      if (y === 'x') (best.s.x || []).forEach(p => list.push(String(p)));
      else String(best.s[y] || '').split(',').filter(Boolean).forEach(n => list.push('(' + y + ') ' + n));
    });
    return {list: list, notes: best.n || {}, mach: best.mk || {}};
  } catch (_) {
    return {list: [], notes: {}, mach: {}};
  }
}

// müşteri: panodaki gibi — sipariş metninde "FSA" öncesi kelime (harflerden oluşuyorsa), yoksa firmanın ilk kelimesi
function ozetMusteri_(c) {
  const f = String(c.firma || '').split('/')[0].trim().toUpperCase().split(/\s+/)[0] || '';
  const t = String(c.customer || '').toUpperCase(), i = t.search(/FSA[\s._-]*\d/);
  let cu = '';
  if (i >= 0) {
    const segs = t.slice(0, i).split(/[._*]+/).map(x => x.trim()).filter(Boolean);
    const w = segs.length ? segs[segs.length - 1].split(/\s+/)[0] : '';
    if (/^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ-]{2,}$/.test(w)) cu = w;
  }
  return (cu && cu.slice(0, 4) !== f.slice(0, 4) ? cu : f) || '?';
}

function ozetVeri_() {
  const pd = ozetFetchJson_(AI_DATA_URL + 'partiler.json');
  let ul = null; try { ul = ozetFetchJson_(AI_DATA_URL + 'uretim_log.json'); } catch (_) {}
  const sel = ozetSecim_();
  const cards = pd.cards || [];
  const st = c => String(c.stage || '').toUpperCase();
  const isKK = c => /KAL[İI]TE KONTROL/.test(st(c));
  const isS1 = c => /SARIM ?1/.test(st(c));
  const kg = a => Math.round(a.reduce((s, c) => s + (Number(c.kg) || 0), 0));
  const short = p => String(p).replace(/^\s*\(\d{4}\)\s*/, '');
  // bugünkü vardiya günü (08:00'de başlar)
  const sh = ul && ul.shiftStartHour != null ? Number(ul.shiftStartHour) : 8;
  const now = new Date(), d0 = new Date(now.getTime() - (now.getHours() < sh ? 86400000 : 0));
  const dayKey = Utilities.formatDate(d0, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const day = (ul && ul.days && ul.days[dayKey]) || {};
  const prod = {};
  Object.keys(day).forEach(k => { const v = day[k] || {}; const ks = Object.keys(v); prod[k] = {adet: ks.length, kg: Math.round(ks.reduce((s, p) => s + (Number(v[p].kg) || 0), 0))}; });
  // aşamalar (sevk hariç), uzun bekleyenler
  const byStage = {};
  cards.filter(c => !/SEVK/.test(st(c))).forEach(c => { const s = st(c) || '?'; (byStage[s] = byStage[s] || []).push(c); });
  const stages = Object.keys(byStage).map(s => ({asama: s, adet: byStage[s].length, kg: kg(byStage[s])})).sort((a, b) => b.adet - a.adet).slice(0, 6);
  const longWait = cards.filter(c => !/SEVK/.test(st(c)) && Number(c.wait) >= 3).sort((a, b) => b.wait - a.wait);
  // seçilenler
  const selSet = {}; sel.list.forEach(p => selSet[p] = 1);
  const selCards = cards.filter(c => selSet[String(c.parti).trim()]);
  const selRow = c => {
    const p = String(c.parti).trim(), mk = String(sel.mach[p] || '').split('.');
    return {parti: short(p), asama: st(c), kg: Math.round(Number(c.kg) || 0), musteri: ozetMusteri_(c), renk: c.recipe || '', makine: mk[0] || '', sira: mk[1] || '', bekleme_gun: Math.round((Number(c.wait) || 0) * 10) / 10, not: sel.notes[p] || ''};
  };
  return {
    zaman: Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'),
    veri_zamani: pd.generatedAt || (ul && ul.snapshotAt) || '',
    toplam: {adet: cards.length, kg: kg(cards)},
    kalite_kontrolde: {adet: cards.filter(isKK).length, kg: kg(cards.filter(isKK))},
    sarim1de: {adet: cards.filter(isS1).length, kg: kg(cards.filter(isS1))},
    bugun_uretim: prod,
    en_kalabalik_asamalar: stages,
    uc_gunden_fazla_bekleyen: {adet: longWait.length, ilk5: longWait.slice(0, 5).map(c => ({parti: short(c.parti), asama: st(c), gun: Math.round(Number(c.wait) * 10) / 10, musteri: ozetMusteri_(c)}))},
    secilenler: {adet: selCards.length, kg: kg(selCards), partiler: selCards.slice(0, 60).map(selRow), veride_olmayan: sel.list.length - selCards.length}
  };
}

function ozetHazirla_(key) {
  let f;
  try { f = ozetVeri_(); } catch (err) { return {ok: false, error: 'veri okunamadı: ' + (err && err.message || err)}; }
  const prompt = [
    'Bir tekstil boyahanesinin vardiya özetini yaz. Okuyan: üretim sorumlusu, telefonda okuyacak.',
    'Kurallar: Türkçe; en fazla 14 kısa satır; madde işaretleri (•) kullan; sayıları aşağıdaki veriden aynen al, asla uydurma;',
    "önce genel durum (bugün KK ve Sarım'dan geçen/gelen adet ve kg), sonra darboğaz (en kalabalık aşama), sonra 3 günden uzun bekleyenler,",
    "en sonda seçilen partiler (KK / Sarım'da olanlar, makine ataması varsa makine ve sırası, dikkat isteyenler). Başlık ve selamlama yazma.",
    "Alan adları: kkGelen = KK'ya gelen, kkGecen = KK'dan geçen, sr1Gelen / sr1Gecen = Sarım1, sr2Gelen / sr2Gecen = Sarım2.",
    '', 'VERİ (JSON):', JSON.stringify(f)
  ].join('\n');
  const r = key ? aiCall_(key, [{text: prompt}], false) : {status: 0, error: 'no_key'};
  const head = '📋 Vardiya özeti • ' + f.zaman;
  if (r.status === 200 && r.text.trim()) return {ok: true, text: head + '\n' + r.text.trim(), facts: f, model: r.model};
  // yapay zekâ yoksa düz özet
  const p = f.bugun_uretim, g = k => p[k] ? p[k].adet + ' parti / ' + p[k].kg + ' kg' : '0';
  const lines = [head,
    '• KK: gelen ' + g('kkGelen') + ', geçen ' + g('kkGecen'),
    '• Sarım1: gelen ' + g('sr1Gelen') + ', geçen ' + g('sr1Gecen'),
    "• Şu an KK'da " + f.kalite_kontrolde.adet + ' parti (' + f.kalite_kontrolde.kg + " kg), Sarım1'de " + f.sarim1de.adet + ' parti',
    '• En kalabalık: ' + f.en_kalabalik_asamalar.slice(0, 3).map(s => s.asama + ' ' + s.adet).join(', '),
    '• 3 günden uzun bekleyen: ' + f.uc_gunden_fazla_bekleyen.adet + ' parti',
    '• Seçilenler: ' + f.secilenler.adet + ' parti / ' + f.secilenler.kg + ' kg'];
  return {ok: true, text: lines.join('\n'), facts: f, model: '', aiError: r.error};
}

function ozetGonder_(text) {
  const props = PropertiesService.getScriptProperties();
  const topic = String(props.getProperty('NTFY_TOPIC') || '').trim();
  if (!topic) throw new Error('NTFY_TOPIC ayarlanmamış');
  const server = (String(props.getProperty('NTFY_SERVER_URL') || '').trim() || 'https://ntfy.sh').replace(/\/+$/, '');
  const headers = {Title: 'Vardiya ozeti', Tags: 'clipboard'};
  const token = String(props.getProperty('NTFY_ACCESS_TOKEN') || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = UrlFetchApp.fetch(server + '/' + encodeURIComponent(topic), {method: 'post', payload: text, contentType: 'text/plain; charset=utf-8', headers: headers, muteHttpExceptions: true});
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('ntfy HTTP ' + res.getResponseCode());
}

// zamanlanmış: vardiya bitişlerinde telefona özet
function vardiyaOzetiGonder() {
  const key = String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '').trim();
  const r = ozetHazirla_(key);
  if (r.ok) ozetGonder_(r.text);
}

// bir kez elle çalıştırılır: her gün 16:05 ve 00:05 otomatik özet (eski tetikleyiciler silinir)
function vardiyaOzetiKur() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'vardiyaOzetiGonder').forEach(t => ScriptApp.deleteTrigger(t));
  [16, 0].forEach(h => ScriptApp.newTrigger('vardiyaOzetiGonder').timeBased().atHour(h).nearMinute(5).everyDays(1).create());
  return 'Vardiya özeti her gün 16:05 ve 00:05 için kuruldu';
}
