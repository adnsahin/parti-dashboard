#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const {URL} = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.TELEGRAM_ALARM_PORT || 8783);
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_IDS = String(process.env.TELEGRAM_CHAT_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const stateDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'PartiDashboardTelegram')
    : path.join(os.homedir(), '.parti-dashboard-telegram');
const STATE_FILE = path.join(stateDir, 'state.json');
const MAX_BODY = 12 * 1024 * 1024;

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
    if (x === 'KK' || y === 'KK') {
        return x === y || x.includes('KALITEKONTROL') || x.includes('KALİTEKONTROL') || y.includes('KALITEKONTROL') || y.includes('KALİTEKONTROL');
    }
    if (x === 'SARIM1' || y === 'SARIM1') return x.includes('SARIM1') || y.includes('SARIM1');
    return x.includes(y) || y.includes(x);
}
function targetStage(alarm) {
    const raw = alarm && (alarm.telegramTarget || alarm.targetStage || alarm.bir_sonraki || '');
    if (stageEquals(raw, 'KK') || stageEquals(raw, 'KALİTE KONTROL')) return 'KK';
    if (stageEquals(raw, 'SARIM1')) return 'SARIM1';
    return '';
}
function cardReachedTarget(card, target) {
    return stageEquals(card && card.bir_sonraki, target) || stageEquals(card && card.son_asama, target) || stageEquals(card && card._asama, target);
}
function cardLabel(card) {
    return [card && card.parti, card && (card._asama || card.asama), card && card.bir_sonraki].filter(Boolean).join(' • ');
}
function readState() {
    try {
        const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return value && typeof value === 'object' ? value : {cards: {}, sent: {}};
    } catch (_) {
        return {cards: {}, sent: {}};
    }
}
function writeState(state) {
    fs.mkdirSync(stateDir, {recursive: true});
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
function messageFor(card, alarm, target) {
    const wait = card && (card.bekleme || card.bekleme_gun != null ? (card.bekleme || `${card.bekleme_gun} gün`) : '-');
    return [
        '🔔 Parti Aşama Alarmı',
        '',
        `Parti: ${clean(card && card.parti) || clean(alarm && alarm.parti) || '-'}`,
        `Hedef aşama: ${target === 'KK' ? 'Kalite Kontrol' : 'Sarım1'}`,
        `Önceki/mevcut aşama: ${clean(card && (card._asama || card.asama || card.son_asama)) || '-'}`,
        `Bir sonraki aşama: ${clean(card && card.bir_sonraki) || '-'}`,
        `Kilo: ${Math.round(Number(card && card.kilo) || 0).toLocaleString('tr-TR')} kg`,
        `Bekleme: ${wait}`,
        alarm && alarm.title ? `Alarm: ${clean(alarm.title)}` : ''
    ].filter(Boolean).join('\n');
}
function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TOKEN}/${method}`,
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)},
            timeout: 15000
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                let value;
                try { value = JSON.parse(text); } catch (_) { value = {ok: false, description: text}; }
                if (response.statusCode >= 200 && response.statusCode < 300 && value.ok !== false) resolve(value);
                else reject(new Error(value.description || `Telegram HTTP ${response.statusCode}`));
            });
        });
        req.on('timeout', () => req.destroy(new Error('Telegram isteği zaman aşımına uğradı')));
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
async function sendText(text, chatIds = CHAT_IDS) {
    if (!TOKEN || !chatIds.length) {
        log('[DRY-RUN] Telegram ayarı eksik; gönderilecek mesaj:\n' + text);
        return {sent: false, dryRun: true};
    }
    for (const chatId of chatIds) await telegramRequest('sendMessage', {chat_id: chatId, text});
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
async function processSnapshot(payload) {
    const state = readState();
    const previous = state.cards || {};
    const current = cardMap(payload.cards);
    const alarms = Array.isArray(payload.alarms) ? payload.alarms : [];
    const sent = state.sent || {};
    const events = [];
    for (const alarm of alarms) {
        if (!alarm || alarm.active === false) continue;
        const target = targetStage(alarm);
        if (!target) continue;
        const key = clean(alarm.id) || clean(alarm.parti);
        const card = Object.values(current).find(x => clean(x.parti) === clean(alarm.parti)) || current[key];
        if (!card || !cardReachedTarget(card, target)) continue;
        const prevCard = Object.values(previous).find(x => clean(x.parti) === clean(alarm.parti)) || previous[key];
        const wasReached = prevCard ? cardReachedTarget(prevCard, target) : false;
        const eventKey = [clean(alarm.uid), clean(card.parti), target, clean(card.son_asama_tarihi || card.hareket || card.bir_sonraki)].join('|');
        if (wasReached || sent[eventKey]) continue;
        const result = await sendText(messageFor(card, alarm, target));
        events.push({parti: card.parti, target, sent: result.sent, dryRun: result.dryRun});
        if (result.sent) sent[eventKey] = new Date().toISOString();
    }
    state.cards = current;
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
        if (req.method === 'GET' && url.pathname === '/api/telegram/status') {
            json(res, 200, {ok: true, configured: Boolean(TOKEN && CHAT_IDS.length), chatCount: CHAT_IDS.length, stateFile: STATE_FILE, port: PORT});
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/telegram/test') {
            const body = await readBody(req);
            const text = clean(body.text) || '✅ Parti Dashboard Telegram bağlantı testi başarılı.';
            const ids = Array.isArray(body.chatIds) ? body.chatIds.map(clean).filter(Boolean) : CHAT_IDS;
            if (!TOKEN || !ids.length) { json(res, 400, {ok: false, error: 'TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_IDS ayarlanmalı'}); return; }
            await sendText(text, ids);
            json(res, 200, {ok: true, sentTo: ids.length});
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/telegram/snapshot') {
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
    log(`Parti Dashboard Telegram servisi http://127.0.0.1:${PORT}`);
    log(`Telegram ayarı: ${TOKEN && CHAT_IDS.length ? 'hazır' : 'kuru çalışma / ayar bekliyor'}`);
});
