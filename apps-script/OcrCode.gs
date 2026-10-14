// ── Parti panosu: fotoğraftan parti no okuma (Gemini) ──
// Ayrı bir Apps Script projesine yapıştırılır ve "Web uygulaması" olarak yayınlanır.
// Gemini anahtarı yalnız bu projenin gizli ayarında durur: Proje ayarları → Komut dosyası özellikleri → GEMINI_API_KEY
// İsteğe bağlı: GEMINI_MODEL (yoksa sırayla denenir).
// Pano bu adrese {image: base64 JPEG, mime, candidates: [geçerli parti numaraları]} gönderir; cevap {found, other, model}.

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
