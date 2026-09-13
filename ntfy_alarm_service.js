#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const {URL} = require('url');
const ROOT = __dirname;
const PORT = Number(process.env.NTFY_ALARM_PORT || 8783);
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || '').trim();
const NTFY_SERVER_URL = String(process.env.NTFY_SERVER_URL || 'https://ntfy.sh').trim().replace(/\/+$/, '');
const NTFY_ACCESS_TOKEN = String(process.env.NTFY_ACCESS_TOKEN || '').trim();
const DATA_URL = String(process.env.NTFY_DATA_URL || 'https://raw.githubusercontent.com/adnsahin/parti-dashboard/main/data/partiler.json').trim();
const POLL_SECONDS = Math.max(30, Number(process.env.NTFY_POLL_SECONDS || 300));
const stateDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'PartiDashboardNtfy')
    : path.join(os.homedir(), '.parti-dashboard-ntfy');
const STATE_FILE = process.env.NTFY_STATE_FILE
    ? path.resolve(process.env.NTFY_STATE_FILE)
    : path.join(stateDir, 'state.json');
const MAX_BODY = 12 * 1024 * 1024;
let lastPoll = null;
let lastPollError = '';

function log(...args) { console.log(new Date().toISOString(), ...args); }
function clean(v) { return String(v == null ? '' : v).trim(); }
function stageKey(v) {
    return clean(v).toLocaleUpperCase('tr-TR').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}
function stageEquals(a, b) {
    const x = stageKey(a), y = stageKey(b);
    if (!x || !y) return false;
    if ((x === 'SUBLİMEBASKI' && y === 'SUBBASKI') || (x === 'SUBBASKI' && y === 'SUBLİMEBASKI')) return true;
    if (x === y) return true;
    if ((x === 'KK' && y === 'KALİTEKONTROL') || (x === 'KALİTEKONTROL' && y === 'KK')) return true;
    if ((x === 'SARIM1' && y === 'SARIM') || (x === 'SARIM' && y === 'SARIM1')) return true;
    return x.includes(y) || y.includes(x);
}
function targetStage(alarm) {
    const hasNotificationTarget=Boolean(alarm && Object.prototype.hasOwnProperty.call(alarm,'notificationTarget'));
    const raw = clean(alarm && (hasNotificationTarget ? alarm.notificationTarget : (alarm.telegramTarget ?? alarm.targetStage ?? '')));
    if (stageEquals(raw, 'KK') || stageEquals(raw, 'KALİTE KONTROL')) return 'KK';
    if (stageEquals(raw, 'SARIM1') || stageEquals(raw, 'SARIM 1')) return 'SARIM1';
    return raw;
}
function alarmTime(alarm){
    const source=alarm&&alarm.datetime;
    if(typeof source==='number')return Number.isFinite(source)?source:null;
    const raw=clean(source);
    if(!raw)return null;
    if(/^\d{10,13}$/.test(raw))return Number(raw);
    const value=Date.parse(raw);
    return Number.isFinite(value)?value:null;
}
function targetDurationMinutes(alarm){
    const raw=alarm && (alarm.targetDurationMinutes ?? alarm.targetDuration ?? alarm.hedefSureDakika);
    const value=Number(String(raw ?? '').replace(',','.'));
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function parseMovementTime(value){
    const raw=clean(value);
    if(!raw)return null;
    const direct=Date.parse(raw);
    if(Number.isFinite(direct))return direct;
    const match=raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if(!match)return null;
    const year=Number(match[3].length===2?'20'+match[3]:match[3]);
    const valueDate=new Date(year,Number(match[2])-1,Number(match[1]),Number(match[4]||0),Number(match[5]||0),Number(match[6]||0));
    return Number.isNaN(valueDate.getTime())?null:valueDate.getTime();
}
function cardWaitingStage(card){
    return clean(card && (card._asama || card.asama || card.stage || card.waitingStage));
}
function cardActualStage(card){
    return clean(card && (card.son_asama || card.lastStage || card.currentStage));
}
function flowStages(card){
    return clean(card && (card.uretim_asamalari || card.flow)).split(',').map(x => x.trim()).filter(Boolean);
}
function flowStageIndex(stages, value){
    const key = stageKey(value);
    const exact = stages.findIndex(stage => stageKey(stage) === key);
    return exact >= 0 ? exact : stages.findIndex(stage => stageEquals(stage, value));
}
function cardAtTargetStage(card,target){
    return stageEquals(cardActualStage(card),target);
}
function cardWaitingMinutes(card){
    const movement=card && (card.hareket || card.son_asama_tarihi || card.lastMovement);
    const movementTime=parseMovementTime(movement);
    if(movementTime!==null)return Math.max(0,(Date.now()-movementTime)/60000);
    const raw=card && (card.bekleme_gun ?? card.bekleme ?? card.wait);
    const text=clean(raw);
    if(!text)return null;
    const dayMatch=text.match(/(-?\d+(?:[.,]\d+)?)\s*g[üu]n/i);
    const days=dayMatch?Number(dayMatch[1].replace(',','.')):Number(text.replace(',','.'));
    return Number.isFinite(days)?Math.max(0,days*1440):null;
}
function cardReachedTarget(card,target,previousCard){
    if(cardAtTargetStage(card,target))return true;
    const previous=cardActualStage(previousCard);
    const current=cardActualStage(card);
    if(!previous||!current)return false;
    const stages=flowStages(card);
    if(!stages.length)return false;
    const previousIndex=flowStageIndex(stages,previous);
    const currentIndex=flowStageIndex(stages,current);
    const targetIndex=flowStageIndex(stages,target);
    return previousIndex>=0 && currentIndex>previousIndex && targetIndex>previousIndex && targetIndex<=currentIndex;
}
function cardLabel(card) {
    return [card && card.parti, card && (card._asama || card.asama), card && card.bir_sonraki].filter(Boolean).join(' • ');
}
function readState() {
    try {
        const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return value && typeof value === 'object' ? value : {cards: {}, sent: {}, alarms: []};
    } catch (_) {
        return {cards: {}, sent: {}, alarms: []};
    }
}
function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), {recursive: true});
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
function json(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end(JSON.stringify(body));
}
function durationLabel(minutes){
    if(minutes===null || !Number.isFinite(minutes))return '-';
    if(minutes<60)return `${Math.floor(minutes)} dakika`;
    const hours=minutes/60;
    return `${hours.toFixed(hours<10?1:0)} saat`;
}
function messageFor(card, alarm, target) {
    const wait = card && (card.bekleme || card.bekleme_gun != null ? (card.bekleme || `${card.bekleme_gun} gün`) : '-');
    const targetLabel = target === 'KK' ? 'Kalite Kontrol' : target === 'SARIM1' ? 'Sarım1' : target || 'Tarih / saat alarmı';
    const required = targetDurationMinutes(alarm);
    const elapsed = cardWaitingMinutes(card);
    return [
        '🔔 Parti Aşama Alarmı',
        '',
        `Parti: ${clean(card && card.parti) || clean(alarm && alarm.parti) || '-'}`,
        `Hedef aşama: ${targetLabel}`,
        `Önceki/mevcut aşama: ${clean(card && (card.son_asama || card.lastStage || card._asama || card.asama)) || '-'}`,
        `Bir sonraki aşama: ${clean(card && card.bir_sonraki) || '-'}`,
        `Kilo: ${Math.round(Number(card && card.kilo) || 0).toLocaleString('tr-TR')} kg`,
        `Bekleme: ${wait}`,
        required > 0 ? `Hedef süre: ${durationLabel(required)}` : '',
        required > 0 ? `Geçen süre: ${durationLabel(elapsed)}` : '',
        alarm && alarm.title ? `Alarm: ${clean(alarm.title)}` : '',
        alarm && alarm.description ? `Not: ${clean(alarm.description)}` : ''
    ].filter(Boolean).join('\n');
}
function messageForNote(card, text) {
    return [
        '📝 Parti Notu',
        '',
        `Parti: ${clean(card && card.parti) || '-'}`,
        `Aşama: ${clean(card && (card._asama || card.asama || card.son_asama)) || '-'}`,
        `Bir sonraki aşama: ${clean(card && card.bir_sonraki) || '-'}`,
        `Firma: ${clean(card && (card.line1 || card.firma)) || '-'}`,
        '',
        clean(text)
    ].join('\n');
}
function ntfyRequest(text) {
    return new Promise((resolve, reject) => {
        const target = new URL(NTFY_SERVER_URL + '/' + encodeURIComponent(NTFY_TOPIC));
        const payload = Buffer.from(text, 'utf8');
        const transport = target.protocol === 'http:' ? http : https;
        const headers = {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': payload.length,
            'Title': 'Parti Alarmi',
            'Priority': 'high',
            'Tags': 'bell'
        };
        if (NTFY_ACCESS_TOKEN) headers.Authorization = `Bearer ${NTFY_ACCESS_TOKEN}`;
        const req = transport.request({
            hostname: target.hostname,
            port: target.port || (target.protocol === 'http:' ? 80 : 443),
            path: target.pathname + target.search,
            method: 'POST',
            headers,
            timeout: 15000
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) resolve(body);
                else reject(new Error(`ntfy HTTP ${response.statusCode}: ${body || 'mesaj gönderilemedi'}`));
            });
        });
        req.on('timeout', () => req.destroy(new Error('ntfy isteği zaman aşımına uğradı')));
        req.on('error', reject);
        req.end(payload);
    });
}
async function sendText(text) {
    if (!NTFY_TOPIC) {
        log('[DRY-RUN] NTFY_TOPIC ayarı eksik; gönderilecek mesaj:\n' + text);
        return {sent: false, dryRun: true};
    }
    await ntfyRequest(text);
    return {sent: true, dryRun: false};
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0, text = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
            size += Buffer.byteLength(chunk);
            if (size > MAX_BODY) { reject(new Error('İstek gövdesi çok büyük')); req.destroy(); return; }
            text += chunk;
        });
        req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (_) { reject(new Error('Geçersiz JSON')); } });
        req.on('error', reject);
    });
}
function cardMap(cards) {
    const out = {};
    (Array.isArray(cards) ? cards : []).forEach(card => {
        const key = clean(card && (card.id || card.parti));
        if (key) out[key] = card;
    });
    return out;
}
function githubNextStage(flow, waiting, last) {
    const stages = clean(flow).split(',').map(x => x.trim()).filter(Boolean);
    if (!stages.length || !clean(waiting)) return '';
    const lastIndex = stages.reduce((found, stage, i) => stageEquals(stage, last) ? i : found, -1);
    const waitingIndex = stages.findIndex((stage, i) => stageEquals(stage, waiting) && (lastIndex < 0 || i >= lastIndex));
    const index = waitingIndex >= 0 ? waitingIndex : stages.findIndex(stage => stageEquals(stage, waiting));
    return index >= 0 ? stages[index + 1] || '' : '';
}
function githubCards(data) {
    return (data && Array.isArray(data.cards) ? data.cards : []).map(card => ({
        id: clean(card.id || card.parti),
        parti: clean(card.parti),
        _asama: clean(card.stage || card.nextStage),
        bir_sonraki: githubNextStage(card.flow, card.stage || card.nextStage, card.lastStage),
        son_asama: clean(card.lastStage),
        son_asama_tarihi: clean(card.hareket),
        hareket: clean(card.hareket),
        kilo: card.kg,
        bekleme: clean(card.wait),
        line1: clean(card.firma),
        uretim_asamalari: clean(card.flow)
    })).filter(card => card.id && card.parti);
}
function fetchJson(urlString) {
    return new Promise((resolve, reject) => {
        const target = new URL(urlString);
        const req = https.get({
            hostname: target.hostname,
            port: target.port || 443,
            path: target.pathname + target.search,
            headers: {'User-Agent': 'parti-dashboard-ntfy-service'}
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`GitHub veri isteği HTTP ${response.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(text)); } catch (_) { reject(new Error('GitHub verisi geçersiz JSON')); }
            });
        });
        req.setTimeout(15000, () => req.destroy(new Error('GitHub veri isteği zaman aşımına uğradı')));
        req.on('error', reject);
    });
}
async function pollGithub() {
    if (lastPoll && lastPoll.inFlight) return;
    lastPoll = {inFlight: true, at: new Date().toISOString(), cards: 0, events: 0};
    try {
        const separator = DATA_URL.includes('?') ? '&' : '?';
        const cards = githubCards(await fetchJson(DATA_URL + separator + 'ts=' + Date.now()));
        const state = readState();
        const result = await processSnapshot({cards, alarms: Array.isArray(state.alarms) ? state.alarms : []});
        lastPoll = {inFlight: false, at: new Date().toISOString(), cards: cards.length, events: result.events.length};
        lastPollError = '';
        if (result.events.length) log(`ntfy senkronu: ${result.events.length} alarm işlendi`);
    } catch (error) {
        lastPoll = {...(lastPoll || {}), inFlight: false};
        lastPollError = error.message;
        log('GitHub senkron hatası:', error.message);
    }
}
async function processSnapshot(payload) {
    payload = payload || {};
    const state = readState();
    const current = cardMap(payload.cards);
    const previousCards = state.cards || {};
    const hasAlarms = Array.isArray(payload.alarms);
    const alarms = hasAlarms ? payload.alarms : (Array.isArray(state.alarms) ? state.alarms : []);
    const sent = state.sent || {};
    const events = [];
    for (const alarm of alarms) {
        if (!alarm || alarm.active === false) continue;
        const scheduledAt = alarmTime(alarm);
        if (scheduledAt !== null && Date.now() < scheduledAt) continue;
        const target = targetStage(alarm);
        const key = clean(alarm.id) || clean(alarm.parti);
        const card = Object.values(current).find(x => clean(x.parti) === clean(alarm.parti)) || current[key];
        if (!card) continue;
        const previousCard = Object.values(previousCards).find(x => clean(x.parti) === clean(card.parti)) || previousCards[key];
        const requiredMinutes = targetDurationMinutes(alarm);
        const elapsedMinutes = cardWaitingMinutes(card);
        if (target && !cardReachedTarget(card, target, previousCard)) continue;
        if (requiredMinutes > 0 && (!target || elapsedMinutes === null || elapsedMinutes < requiredMinutes)) continue;
        const eventKey = clean(alarm.uid) || [clean(card.parti), target || 'datetime'].join('|');
        if (sent[eventKey]) continue;
        try {
            const result = await sendText(messageFor(card, alarm, target));
            events.push({parti: card.parti, target: target || null, requiredMinutes, elapsedMinutes, sent: result.sent, dryRun: result.dryRun});
            if (result.sent) sent[eventKey] = new Date().toISOString();
        } catch (error) {
            events.push({parti: card.parti, target, sent: false, error: error.message});
            log(`ntfy alarmı gönderilemedi (${card.parti} / ${target}):`, error.message);
        }
    }
    state.cards = current;
    state.alarms = alarms;
    state.sent = sent;
    writeState(state);
    return {ok: true, checkedCards: Object.keys(current).length, checkedAlarms: alarms.length, events};
}
function safeStaticPath(requestPath) {
    let pathname;
    try { pathname = decodeURIComponent(requestPath); } catch (_) { return null; }
    if (pathname === '/') pathname = '/index.html';
    const full = path.resolve(ROOT, '.' + pathname);
    if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
    return full;
}
function contentType(file) {
    const ext = path.extname(file).toLowerCase();
    return ({'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'})[ext] || 'application/octet-stream';
}
const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { json(res, 204, {}); return; }
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    try {
        if (req.method === 'GET' && url.pathname === '/api/ntfy/status') {
            json(res, 200, {
                ok: true,
                version: 4,
                configured: Boolean(NTFY_TOPIC),
                channel: 'ntfy',
                serverUrl: NTFY_SERVER_URL,
                topicConfigured: Boolean(NTFY_TOPIC),
                stateFile: STATE_FILE,
                port: PORT,
                githubDataUrl: DATA_URL,
                pollSeconds: POLL_SECONDS,
                lastPoll,
                lastPollError
            });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/ntfy/test') {
            const body = await readBody(req);
            const text = clean(body.text) || '✅ Parti Dashboard ntfy bağlantı testi başarılı.';
            if (!NTFY_TOPIC) { json(res, 400, {ok: false, error: 'NTFY_TOPIC ayarlanmalı'}); return; }
            await sendText(text);
            json(res, 200, {ok: true, sentTo: 'ntfy'});
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/ntfy/note') {
            const body = await readBody(req);
            const text = clean(body.text);
            if (!text) { json(res, 400, {ok: false, error: 'Not boş bırakılamaz'}); return; }
            if (text.length > 4000) { json(res, 400, {ok: false, error: 'Not 4000 karakterden kısa olmalı'}); return; }
            if (!NTFY_TOPIC) { json(res, 400, {ok: false, error: 'NTFY_TOPIC ayarlanmalı'}); return; }
            await sendText(messageForNote(body.card || {parti: body.parti}, text));
            json(res, 200, {ok: true, sentTo: 'ntfy'});
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/ntfy/snapshot') {
            json(res, 200, await processSnapshot(await readBody(req)));
            return;
        }
        if (req.method === 'GET') {
            const file = safeStaticPath(url.pathname);
            if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Bulunamadı'); return; }
            res.writeHead(200, {'Content-Type': contentType(file)});
            fs.createReadStream(file).pipe(res);
            return;
        }
        json(res, 404, {ok: false, error: 'Endpoint bulunamadı'});
    } catch (error) {
        log('İstek hatası:', error.message);
        json(res, 500, {ok: false, error: error.message});
    }
});
server.listen(PORT, '127.0.0.1', () => {
    log(`Parti Dashboard ntfy servisi http://127.0.0.1:${PORT}`);
    log(`ntfy ayarı: ${NTFY_TOPIC ? 'hazır' : 'kuru çalışma / ayar bekliyor'}`);
    log(`GitHub veri senkronu: ${DATA_URL} / ${POLL_SECONDS} saniye`);
    pollGithub();
    setInterval(pollGithub, POLL_SECONDS * 1000);
});
