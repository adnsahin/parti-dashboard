const DEFAULT_DATA_URL = 'https://raw.githubusercontent.com/adnsahin/parti-dashboard/main/data/partiler.json';
const ALARMS_KEY = 'PARTI_ALARMS';
const SENT_KEY = 'PARTI_ALARM_SENT';

function props_() {
  return PropertiesService.getScriptProperties();
}

function setup() {
  const props = props_();
  if (!props.getProperty('DATA_URL')) props.setProperty('DATA_URL', DEFAULT_DATA_URL);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkAlarms').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkAlarms').timeBased().everyMinutes(5).create();
  return json_({ok: true, message: '5 dakikalık alarm tetikleyicisi kuruldu'});
}

function doGet() {
  return json_({ok: true, service: 'parti-alarm-apps-script'});
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (_) {
    return json_({ok: false, error: 'Geçersiz JSON'});
  }
  if (!authorized_(body.token)) return json_({ok: false, error: 'Yetkisiz istek'});
  if (body.action === 'sync') {
    const alarms = Array.isArray(body.alarms) ? body.alarms : [];
    props_().setProperty(ALARMS_KEY, JSON.stringify({alarms, updatedAt: new Date().toISOString()}));
    return json_({ok: true, alarms: alarms.length});
  }
  if (body.action === 'test') {
    sendNtfy_('Parti Dashboard Apps Script bağlantı testi başarılı.', 'Parti Alarm Testi');
    return json_({ok: true});
  }
  return json_({ok: false, error: 'Bilinmeyen işlem'});
}

function checkAlarms() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const stored = readJsonProperty_(ALARMS_KEY, {alarms: []});
    const alarms = Array.isArray(stored.alarms) ? stored.alarms : [];
    if (!alarms.length) return;
    const dataUrl = props_().getProperty('DATA_URL') || DEFAULT_DATA_URL;
    const response = UrlFetchApp.fetch(dataUrl + (dataUrl.indexOf('?') >= 0 ? '&' : '?') + 'ts=' + Date.now(), {muteHttpExceptions: true});
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Veri HTTP ' + response.getResponseCode());
    const data = JSON.parse(response.getContentText());
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const sent = readJsonProperty_(SENT_KEY, {});
    const now = Date.now();
    alarms.forEach(alarm => {
      if (!alarm || alarm.active === false) return;
      if (alarm.kind === 'filter') {
        processFilterAlarm_(alarm, cards, sent, now);
        return;
      }
      const target = targetStage_(alarm);
      const scheduled = alarmTime_(alarm);
      if (!target && scheduled !== null && now < scheduled) return;
      const card = cards.find(item => clean_(item.parti) === clean_(alarm.parti));
      if (!card || (target && !cardReachedTarget_(card, target))) return;
      const elapsed = waitingMinutes_(card);
      const required = durationMinutes_(alarm);
      if (required > 0 && (elapsed === null || elapsed < required)) return;
      const key = clean_(alarm.uid) || [clean_(alarm.parti), target || 'datetime'].join('|');
      if (sent[key]) return;
      sendNtfy_(messageFor_(card, alarm, target), clean_(alarm.title) || 'Parti Alarmi');
      sent[key] = new Date().toISOString();
    });
    props_().setProperty(SENT_KEY, JSON.stringify(sent));
  } finally {
    lock.releaseLock();
  }
}

function processFilterAlarm_(alarm, cards, sent, now) {
  const matches = cards.filter(card => filterMatches_(card, alarm));
  const fresh = matches.filter(card => !sent[filterKey_(alarm, card)]);
  if (!fresh.length) return;
  sendNtfy_(listMessage_(alarm.title, matches), clean_(alarm.title) || 'Filtreli bekleme alarmı');
  fresh.forEach(card => { sent[filterKey_(alarm, card)] = new Date(now).toISOString(); });
}

function authorized_(token) {
  const expected = clean_(props_().getProperty('ALARM_SYNC_TOKEN'));
  return !expected || clean_(token) === expected;
}

function sendNtfy_(text, title) {
  const props = props_();
  const topic = clean_(props.getProperty('NTFY_TOPIC'));
  if (!topic) throw new Error('NTFY_TOPIC ayarlanmamış');
  const server = (clean_(props.getProperty('NTFY_SERVER_URL')) || 'https://ntfy.sh').replace(/\/+$/, '');
  const options = {
    method: 'post', payload: text, contentType: 'text/plain', muteHttpExceptions: true,
    headers: {Title: clean_(title) || 'Parti Alarmi', Priority: 'high', Tags: 'bell'}
  };
  const accessToken = clean_(props.getProperty('NTFY_ACCESS_TOKEN'));
  if (accessToken) options.headers.Authorization = 'Bearer ' + accessToken;
  const response = UrlFetchApp.fetch(server + '/' + encodeURIComponent(topic), options);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('ntfy HTTP ' + response.getResponseCode());
}

function cardReachedTarget_(card, target) {
  return stageEquals_(card.son_asama || card.lastStage || card.currentStage || card._asama || card.stage || card.asama, target);
}

function filterMatches_(card, alarm) {
  const fabrics = Array.isArray(alarm.fabricTypes) ? alarm.fabricTypes.filter(Boolean) : [];
  const fabric = card.ham_adi || card.fabric || card.kumas || '';
  if (fabrics.length && !fabrics.some(value => valueMatches_(value, fabric))) return false;
  const stages = Array.isArray(alarm.targetStages) ? alarm.targetStages.filter(Boolean) : [];
  const field = clean_(alarm.stageField) || 'waitingStage';
  const stage = field === 'actualStage' ? (card.son_asama || card.lastStage || '') : field === 'nextStage' ? (card.bir_sonraki || card.nextStage || '') : (card._asama || card.stage || card.asama || '');
  if (stages.length && !stages.some(value => stageEquals_(value, stage))) return false;
  const required = Number(alarm.minWaitingMinutes);
  const elapsed = waitingMinutes_(card);
  return Number.isFinite(required) && required > 0 && elapsed !== null && elapsed >= required;
}

function filterKey_(alarm, card) {
  const field = clean_(alarm.stageField) || 'waitingStage';
  const stage = field === 'actualStage' ? (card.son_asama || card.lastStage || '') : field === 'nextStage' ? (card.bir_sonraki || '') : (card._asama || card.stage || card.asama || '');
  return ['filter', clean_(alarm.uid), clean_(card.parti), stage, card.hareket || card.son_asama_tarihi || ''].join('|');
}

function targetStage_(alarm) {
  const value = Object.prototype.hasOwnProperty.call(alarm, 'notificationTarget') ? alarm.notificationTarget : (alarm.telegramTarget || alarm.targetStage || '');
  if (stageEquals_(value, 'KK')) return 'KK';
  if (stageEquals_(value, 'SARIM1') || stageEquals_(value, 'SARIM 1')) return 'SARIM1';
  return clean_(value);
}

function alarmTime_(alarm) {
  const source = alarm && alarm.datetime;
  if (typeof source === 'number' && Number.isFinite(source)) return source;
  const raw = clean_(source);
  if (/^\d{10,13}$/.test(raw)) return Number(raw);
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

function durationMinutes_(alarm) {
  const value = Number(String(alarm.targetDurationMinutes ?? alarm.targetDuration ?? alarm.hedefSureDakika ?? '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function waitingMinutes_(card) {
  const movement = parseMovement_(card.hareket || card.son_asama_tarihi || card.lastMovement);
  if (movement !== null) return Math.max(0, (Date.now() - movement) / 60000);
  const raw = clean_(card.bekleme_gun ?? card.bekleme ?? card.wait);
  if (!raw) return null;
  const match = raw.match(/(-?\d+(?:[.,]\d+)?)\s*g[üu]n/i);
  const value = Number((match ? match[1] : raw).replace(',', '.'));
  return Number.isFinite(value) ? Math.max(0, value * 1440) : null;
}

function parseMovement_(value) {
  const match = clean_(value).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) { const direct = Date.parse(clean_(value)); return Number.isFinite(direct) ? direct : null; }
  const year = Number(match[3].length === 2 ? '20' + match[3] : match[3]);
  const date = new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function messageFor_(card, alarm, target) {
  const wait = card.bekleme || (card.bekleme_gun != null ? card.bekleme_gun + ' gün' : '-');
  const targetLabel = target === 'KK' ? 'Kalite Kontrol' : target === 'SARIM1' ? 'Sarım 1' : target || 'Tarih / saat alarmı';
  const required = durationMinutes_(alarm);
  return ['🔔 Parti Aşama Alarmı', '', 'Parti: ' + (clean_(card.parti) || clean_(alarm.parti) || '-'), 'Hedef aşama: ' + targetLabel, 'Önceki/mevcut aşama: ' + (clean_(card.son_asama || card.lastStage || card._asama || card.stage) || '-'), 'Bir sonraki aşama: ' + (clean_(card.bir_sonraki) || '-'), 'Kilo: ' + Math.round(Number(card.kilo ?? card.kg) || 0).toLocaleString('tr-TR') + ' kg', 'Bekleme: ' + wait, required > 0 ? 'Hedef süre: ' + durationLabel_(required) : '', required > 0 ? 'Geçen süre: ' + durationLabel_(waitingMinutes_(card)) : '', alarm.title ? 'Alarm: ' + clean_(alarm.title) : '', alarm.description ? 'Not: ' + clean_(alarm.description) : ''].filter(Boolean).join('\n');
}

function listMessage_(title, cards) {
  const items = cards.filter(card => clean_(card.parti));
  const total = items.reduce((sum, card) => sum + (Number(card.kilo ?? card.kg) || 0), 0);
  const lines = ['📋 ' + (clean_(title) || 'Parti Listesi'), '', 'Toplam: ' + items.length + ' parti • ' + Math.round(total).toLocaleString('tr-TR') + ' kg', ''];
  let included = 0;
  items.forEach((card, index) => { const line = (index + 1) + '. ' + clean_(card.parti) + ' | ' + (clean_(card.son_asama || card.lastStage || card._asama || card.stage) || '-') + ' → ' + (clean_(card.bir_sonraki) || '-') + ' | ' + Math.round(Number(card.kilo ?? card.kg) || 0).toLocaleString('tr-TR') + ' kg | ' + (clean_(card.bekleme) || '-'); if (lines.join('\n').length + line.length + 80 <= 3800) { lines.push(line); included++; } });
  if (included < items.length) lines.push('', '... ' + (items.length - included) + ' parti daha var; liste kısaltıldı.');
  return lines.join('\n');
}

function valueMatches_(wanted, actual) {
  return clean_(wanted).toLocaleUpperCase('tr-TR').split(/\s*[,|]\s*/).some(value => stageEquals_(value, actual));
}

function stageEquals_(a, b) {
  const x = clean_(a).toLocaleUpperCase('tr-TR').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const y = clean_(b).toLocaleUpperCase('tr-TR').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  if (!x || !y) return false;
  if ((x === 'SUBLİMEBASKI' && y === 'SUBBASKI') || (x === 'SUBBASKI' && y === 'SUBLİMEBASKI')) return true;
  if ((x === 'SARIM1' && y === 'SARIM') || (x === 'SARIM' && y === 'SARIM1')) return true;
  if ((x === 'KK' && y === 'KALİTEKONTROL') || (x === 'KALİTEKONTROL' && y === 'KK')) return true;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

function durationLabel_(minutes) {
  if (minutes === null || !Number.isFinite(minutes)) return '-';
  if (minutes < 60) return Math.floor(minutes) + ' dakika';
  const hours = minutes / 60;
  return hours.toFixed(hours < 10 ? 1 : 0) + ' saat';
}

function readJsonProperty_(key, fallback) {
  try { return JSON.parse(props_().getProperty(key) || JSON.stringify(fallback)); } catch (_) { return fallback; }
}

function clean_(value) { return String(value == null ? '' : value).trim(); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
