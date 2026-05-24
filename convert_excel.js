const fs = require('fs');
const path = require('path');
const XLSX = require('./tools/xlsx.full.min.js');

const root = __dirname;
const mainFile = process.argv[2] || path.join(root, '..', 'partiler.xlsx');
const repairFile = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : '';
const outFile = process.argv[4] || path.join(root, 'data', 'partiler.json');
const outRepairFile = process.argv[5] || path.join(root, 'data', 'tamirler.json');

function clean(v) {
  return v == null ? '' : String(v).trim();
}

function norm(v) {
  return clean(v).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

function num(v) {
  const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function col(obj, names) {
  const keys = Object.keys(obj || {});
  for (const n of names) {
    const k = keys.find(x => norm(x) === norm(n));
    if (k) return k;
  }
  for (const n of names) {
    const k = keys.find(x => norm(x).includes(norm(n)) || norm(n).includes(norm(x)));
    if (k) return k;
  }
  return null;
}

function readRows(file) {
  if (!file || !fs.existsSync(file)) return [];
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  let out = [];
  wb.SheetNames.forEach(name => {
    out = out.concat(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true }));
  });
  return out;
}

function excelDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? new Date(p.y, p.m - 1, p.d) : null;
  }
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) return new Date(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(v) {
  const d = excelDate(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : clean(v);
}

function dueDays(v) {
  const d = excelDate(v);
  if (!d) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

function waitDays(v) {
  const s = clean(v);
  let m = s.match(/(\d+)\s*g[üu]n/i);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+):(\d+):(\d+)/);
  if (m) return Number(m[1]) / 24;
  return num(v);
}

function build(mainRows, repairRows) {
  const sample = mainRows[0] || {};
  const cParti = col(sample, ['Parti No', 'Parti']);
  const cStage = col(sample, ['Sonra Yapılacak Aşama', 'SONRAKİ', 'Sonraki Aşama']);
  if (!cParti || !cStage) throw new Error('Parti No veya Sonra Yapılacak Aşama kolonu bulunamadı.');

  const cKg = col(sample, ['Kilo', 'Kalan Kilo', 'Kalan Brüt Kilo']);
  const cWait = col(sample, ['Geçen Süre (Son Hareketten Sonra)', 'Çıkıştan Sonra Geçen Süre', 'Bekleme Notu']);
  const cFirm = col(sample, ['Firma Adı', 'Firma']);
  const cOrder = col(sample, ['Sipariş No']);
  const cCustomer = col(sample, ['Müşteri Sipariş No', 'Müşteri Sipariş', 'MUSTERISIPARISNO']);
  const cFabric = col(sample, ['Ham Adı', 'Ham Ad', 'Kumaş']);
  const cRecipe = col(sample, ['Reçete Adı', 'Renk Adı', 'Reçete']);
  const cTerm = col(sample, ['Termin Tarihi', 'Termin Tarihi (Sipariş)', 'Revize Parti Termin Tarihi']);
  const cPri = col(sample, ['Öncelik No', 'Sevk Öncelik No']);
  const cInner = col(sample, ['İç Tamir Durumu', 'Ic Tamir Durumu']);
  const cBlocked = col(sample, ['Beklemeye Alınmış Aşama Var']);
  const cFlow = col(sample, ['Üretim Aşamaları', 'Aşamalar', 'İş Akışı']);
  const cMachine = col(sample, ['Planlandigi Makina Kodu', 'Planlandığı Makina Kodu', 'Son Makina Kodu']);

  const rSample = repairRows[0] || {};
  const rParti = col(rSample, ['Parti No', 'Parti']);
  const rWhy = col(rSample, ['Tamir Sebebi', 'Tamir Nedeni', 'Hata Nedeni', 'Nedeni', 'Açıklama']);
  const rNote = col(rSample, ['Tamir Sebep Notu', 'Yapılacaklar Notu', 'Not', 'Açıklama']);
  const rType = col(rSample, ['Tamir Tipi', 'Tamir Tipi Grup Adı', 'Tamir Düzeltme Tipi Adı']);
  const rStage = col(rSample, ['Sebep Aşama', 'Sebep Aşama 2', 'Sebep Aşama 3']);
  const rStatus = col(rSample, ['Tamir Durumu', 'Çözüm Şekli']);
  const rDate = col(rSample, ['Tarih', 'Tamir Onay Tarihi']);
  const rKg = col(rSample, ['Kilo']);
  const rMeter = col(rSample, ['Metre']);
  const rFirm = col(rSample, ['Firma Adı', 'Firma']);
  const repairs = repairRows.map((r, i) => ({
    uid: `ext_${i}`,
    source: 'tamir_excel',
    parti: clean(r[rParti]),
    neden: rWhy ? clean(r[rWhy]) : '',
    not: rNote ? clean(r[rNote]) : '',
    tip: rType ? clean(r[rType]) : '',
    stage: rStage ? clean(r[rStage]) : '',
    durum: rStatus ? clean(r[rStatus]) : '',
    tarih: rDate ? fmtDate(r[rDate]) : '',
    kg: rKg ? num(r[rKg]) : 0,
    metre: rMeter ? num(r[rMeter]) : 0,
    firma: rFirm ? clean(r[rFirm]) : ''
  })).filter(r => r.parti);
  const hasExternalRepairs = repairs.length > 0;

  const cards = mainRows.map((r, i) => {
    const parti = clean(r[cParti]);
    const stage = clean(r[cStage]);
    if (!parti || !stage) return null;
    const wait = waitDays(cWait ? r[cWait] : '');
    const internalRepair = cInner ? clean(r[cInner]) : '';
    if (internalRepair && !hasExternalRepairs) {
      repairs.push({
        uid: `ic_${i}`,
        source: 'partiler_excel',
        parti,
        neden: internalRepair,
        stage,
        kg: cKg ? num(r[cKg]) : 0,
        firma: cFirm ? clean(r[cFirm]) : ''
      });
    }
    const repairList = repairs.filter(x => x.parti === parti);
    return {
      id: `p${i}`,
      parti,
      stage,
      kg: cKg ? num(r[cKg]) : 0,
      wait,
      sev: wait >= 14 ? 'crit' : wait >= 7 ? 'warn' : 'ok',
      firma: cFirm ? clean(r[cFirm]) : '',
      order: cOrder ? clean(r[cOrder]) : '',
      customer: cCustomer ? clean(r[cCustomer]) : '',
      fabric: cFabric ? clean(r[cFabric]) : '',
      recipe: cRecipe ? clean(r[cRecipe]) : '',
      term: cTerm ? fmtDate(r[cTerm]) : '',
      due: cTerm ? dueDays(r[cTerm]) : null,
      pri: cPri ? clean(r[cPri]) : '',
      inner: internalRepair,
      blocked: cBlocked ? clean(r[cBlocked]) : '',
      flow: cFlow ? clean(r[cFlow]) : '',
      machine: cMachine ? clean(r[cMachine]) : '',
      repairs: repairList
    };
  }).filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      mainFile: path.basename(mainFile),
      repairFile: repairFile ? path.basename(repairFile) : ''
    },
    cards,
    repairs
  };
}

const mainRows = readRows(mainFile);
const repairRows = readRows(repairFile);
if (!mainRows.length) throw new Error(`Ana Excel okunamadı veya boş: ${mainFile}`);

const payload = build(mainRows, repairRows);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
fs.writeFileSync(outRepairFile, JSON.stringify({
  generatedAt: payload.generatedAt,
  source: payload.source,
  repairs: payload.repairs
}, null, 2), 'utf8');
console.log(`OK: ${payload.cards.length} parti yazıldı -> ${outFile}`);
console.log(`OK: ${payload.repairs.length} tamir kaydı yazıldı -> ${outRepairFile}`);
