'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = __dirname;
const ALARM_FILE = process.env.TELEGRAM_ALARM_FILE
    ? path.resolve(process.env.TELEGRAM_ALARM_FILE)
    : path.join(ROOT, 'data', 'alarms.json');
const DATA_FILE = process.env.TELEGRAM_DATA_FILE
    ? path.resolve(process.env.TELEGRAM_DATA_FILE)
    : path.join(ROOT, 'data', 'partiler.json');
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_IDS = String(process.env.TELEGRAM_CHAT_IDS || '').split(',').map(clean).filter(Boolean);
const DRY_RUN = ['1','true','yes'].includes(String(process.env.TELEGRAM_DRY_RUN || '').trim().toLowerCase());

function clean(value) { return String(value == null ? '' : value).trim(); }
function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function stageKey(value) {
    return clean(value).toLocaleUpperCase('tr-TR').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}
function stageEquals(a, b) {
    const x = stageKey(a), y = stageKey(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if ((x === 'KK' && y === 'KALİTEKONTROL') || (x === 'KALİTEKONTROL' && y === 'KK')) return true;
    if ((x === 'SARIM1' && y === 'SARIM') || (x === 'SARIM' && y === 'SARIM1')) return true;
    return x.includes(y) || y.includes(x);
}
function targetStage(alarm) {
    const raw = clean(alarm && (alarm.telegramTarget || alarm.targetStage || alarm.bir_sonraki));
    if (stageEquals(raw, 'KK') || stageEquals(raw, 'KALİTE KONTROL')) return 'KK';
    if (stageEquals(raw, 'SARIM1') || stageEquals(raw, 'SARIM 1')) return 'SARIM1';
    return raw;
}
function alarmTime(alarm) {
    const raw = clean(alarm && alarm.datetime);
    if (!raw) return null;
    const value = Date.parse(raw);
    return Number.isFinite(value) ? value : null;
}
function flowStages(card) {
    return clean(card && (card.flow || card.uretim_asamalari)).split(',').map(clean).filter(Boolean);
}
function latestFlowIndex(card, value) {
    const stages = flowStages(card);
    let index = -1;
    stages.forEach((stage, i) => { if (stageEquals(stage, value)) index = i; });
    return index;
}
function cardReachedTarget(card, target) {
    if (stageEquals(card.stage, target) || stageEquals(card.nextStage, target) || stageEquals(card.lastStage, target)) return true;
    const currentIndex = Math.max(latestFlowIndex(card, card.lastStage), latestFlowIndex(card, card.stage), latestFlowIndex(card.nextStage));
    if (currentIndex < 0) return false;
    return flowStages(card).some((stage, i) => i <= currentIndex && stageEquals(stage, target));
}
function nextStage(card) {
    const stages = flowStages(card);
    const lastIndex = stages.reduce((found, stage, i) => stageEquals(stage, card.lastStage) ? i : found, -1);
    const waitingIndex = stages.findIndex((stage, i) => stageEquals(stage, card.stage) && (lastIndex < 0 || i >= lastIndex));
    return waitingIndex >= 0 ? stages[waitingIndex + 1] || '' : '';
}
function cardsFromData(data) {
    return (data && Array.isArray(data.cards) ? data.cards : []).map(card => ({
        id: clean(card.id || card.parti),
        parti: clean(card.parti),
        stage: clean(card.stage || card.nextStage),
        nextStage: clean(card.nextStage),
        lastStage: clean(card.lastStage),
        flow: clean(card.flow),
        hareket: clean(card.hareket),
        firma: clean(card.firma),
        kg: card.kg
    })).filter(card => card.id && card.parti);
}
function alarmRows() {
    const value = readJson(ALARM_FILE, {alarms: []});
    return Array.isArray(value) ? value : (Array.isArray(value.alarms) ? value.alarms : []);
}
function normalizeAlarm(alarm) {
    return {
        uid: clean(alarm.uid),
        id: clean(alarm.id),
        parti: clean(alarm.parti),
        asama: clean(alarm.asama),
        bir_sonraki: clean(alarm.bir_sonraki),
        telegramTarget: clean(alarm.telegramTarget || alarm.targetStage),
        firma: clean(alarm.firma),
        title: clean(alarm.title),
        description: clean(alarm.description),
        priority: clean(alarm.priority),
        datetime: clean(alarm.datetime),
        active: alarm.active !== false,
        created_at: clean(alarm.created_at),
        notifiedAt: clean(alarm.notifiedAt)
    };
}
function issueAlarms(issue) {
    const body = clean(issue && issue.body);
    const match = body.match(/<!--\s*PARTI_DASHBOARD_ALARM\s*([\s\S]*?)-->/i);
    if (!match) return [];
    try {
        const payload = JSON.parse(match[1].trim());
        const rows = Array.isArray(payload && payload.alarms) ? payload.alarms : payload && payload.alarm ? [payload.alarm] : [];
        return rows.map(normalizeAlarm).filter(alarm => alarm.uid && alarm.parti);
    } catch (_) {
        return [];
    }
}
function ingestIssue() {
    const event = readJson(process.env.GITHUB_EVENT_PATH, {});
    const issue = event.issue;
    if (!issue || !/^\[PARTİ ALARM(?: SYNC)?\]/i.test(clean(issue.title))) return false;
    const incoming = issueAlarms(issue);
    if (!incoming.length) throw new Error('Alarm issue gövdesi geçersiz');
    const alarms = alarmRows().map(normalizeAlarm);
    incoming.forEach(item => {
        const index = alarms.findIndex(alarm => alarm.uid === item.uid);
        if (event.action === 'deleted' || event.action === 'closed') {
            if (index >= 0) alarms[index] = {...alarms[index], active: false};
        } else if (index >= 0) {
            const targetChanged = targetStage(alarms[index]) !== targetStage(item) || alarms[index].parti !== item.parti;
            alarms[index] = targetChanged ? {...item, notifiedAt: ''} : {...alarms[index], ...item, notifiedAt: alarms[index].notifiedAt};
        } else {
            alarms.push(item);
        }
    });
    writeJson(ALARM_FILE, {alarms});
    return true;
}
function telegramRequest(chatId, text) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({chat_id: chatId, text});
        const req = https.request({hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendMessage`, method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                let value = {};
                try { value = JSON.parse(body); } catch (_) {}
                if (response.statusCode >= 200 && response.statusCode < 300 && value.ok !== false) resolve(value);
                else reject(new Error(value.description || `Telegram HTTP ${response.statusCode}`));
            });
        });
        req.setTimeout(15000, () => req.destroy(new Error('Telegram isteği zaman aşımına uğradı')));
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
function messageFor(card, alarm, target) {
    return ['🔔 PARTİ ALARMI', `Parti: ${card.parti}`, `Firma: ${card.firma || alarm.firma || '-'}`, `Hedef aşama: ${target}`, `Alarm: ${alarm.title || 'Aşama alarmı'}`, alarm.description ? `Açıklama: ${alarm.description}` : '', `Son aşama: ${card.lastStage || '-'}`, `Hareket: ${card.hareket || '-'}`].filter(Boolean).join('\n');
}
async function checkAlarms() {
    if ((!TOKEN || !CHAT_IDS.length) && !DRY_RUN) throw new Error('TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_IDS GitHub Secrets içinde ayarlanmalı');
    const cards = cardsFromData(readJson(DATA_FILE, {cards: []}));
    const alarms = alarmRows().map(normalizeAlarm);
    const events = [];
    let changed = false;
    for (const alarm of alarms) {
        if (!alarm.active || alarm.notifiedAt) continue;
        const scheduledAt = alarmTime(alarm);
        if (scheduledAt !== null && Date.now() < scheduledAt) continue;
        const card = cards.find(item => item.parti === alarm.parti) || cards.find(item => item.id === alarm.id);
        const target = targetStage(alarm);
        if (!card || !target || !cardReachedTarget(card, target)) continue;
        if (DRY_RUN) console.log(`[DRY-RUN] ${card.parti} / ${target}`);
        else for (const chatId of CHAT_IDS) await telegramRequest(chatId, messageFor(card, alarm, target));
        alarm.notifiedAt = new Date().toISOString();
        changed = true;
        events.push({parti: card.parti, target, dryRun: DRY_RUN});
    }
    if (changed) writeJson(ALARM_FILE, {alarms});
    console.log(JSON.stringify({checkedCards: cards.length, checkedAlarms: alarms.length, events}));
}

(async () => {
    const mode = process.argv[2] || 'check';
    if (mode === 'ingest') ingestIssue();
    else if (mode !== 'check') throw new Error(`Bilinmeyen çalışma modu: ${mode}`);
    await checkAlarms();
})().catch(error => { console.error(error.message || error); process.exitCode = 1; });
