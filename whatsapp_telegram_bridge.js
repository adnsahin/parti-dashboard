'use strict';

const http = require('http');
const https = require('https');
const {URL} = require('url');
const {Client, LocalAuth} = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const TELEGRAM_ENDPOINT = process.env.WHATSAPP_TELEGRAM_ENDPOINT || 'http://127.0.0.1:8783/api/telegram/forward';
const GROUPS = String(process.env.WHATSAPP_GROUPS || '').split(',').map(x => x.trim()).filter(Boolean);
const KEYWORDS = String(process.env.WHATSAPP_KEYWORDS || '').split(',').map(x => x.trim()).filter(Boolean);
const FORWARD_SELF = String(process.env.WHATSAPP_FORWARD_SELF || '').toLowerCase() === 'true';
const MAX_TEXT = 4000;
let reconnectTimer = null;
let reconnecting = false;

function clean(value) { return String(value == null ? '' : value).trim(); }
function key(value) { return clean(value).toLocaleLowerCase('tr-TR'); }
function log(...args) { console.log(new Date().toISOString(), ...args); }
function groupAllowed(name) { return !GROUPS.length || GROUPS.some(group => key(group) === key(name)); }
function keywordAllowed(text) { return !KEYWORDS.length || KEYWORDS.some(word => key(text).includes(key(word))); }
function postToTelegram(body) {
    return new Promise((resolve, reject) => {
        const target = new URL(TELEGRAM_ENDPOINT);
        const payload = JSON.stringify(body);
        const transport = target.protocol === 'https:' ? https : http;
        const request = transport.request({
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)},
            timeout: 15000
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                let value;
                try { value = JSON.parse(text); } catch (_) { value = {ok: false, error: text}; }
                if (response.statusCode >= 200 && response.statusCode < 300 && value.ok !== false) resolve(value);
                else reject(new Error(value.error || `Telegram servisi HTTP ${response.statusCode}`));
            });
        });
        request.on('timeout', () => request.destroy(new Error('Telegram servisi zaman aşımına uğradı')));
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}
async function forwardMessage(message) {
    if (message.fromMe && !FORWARD_SELF) return;
    const chat = await message.getChat();
    if (!chat.isGroup || !groupAllowed(chat.name)) return;
    const text = clean(message.body);
    if (!text || text.length > MAX_TEXT || !keywordAllowed(text)) return;
    let sender = clean(message.author);
    try {
        const contact = await message.getContact();
        sender = clean(contact.pushname || contact.name || contact.number || sender);
    } catch (_) {}
    const result = await postToTelegram({group: clean(chat.name), sender: sender || 'Bilinmeyen kullanıcı', text});
    log(`WhatsApp → Telegram gönderildi: ${chat.name} / ${sender || 'Bilinmeyen kullanıcı'}`, result.sentTo ? `(${result.sentTo} alıcı)` : '');
}
async function listGroups(client) {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup).map(chat => chat.name).filter(Boolean);
    log('WhatsApp grupları:');
    groups.forEach(name => console.log(' - ' + name));
}
const client = new Client({
    authStrategy: new LocalAuth({clientId: 'parti-dashboard-whatsapp'}),
    puppeteer: {headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']}
});
client.on('qr', qr => {
    log('WhatsApp QR kodu hazır. Telefon > Bağlı cihazlar > Cihaz bağla ile okutun.');
    qrcode.generate(qr, {small: true});
});
client.on('authenticated', () => log('WhatsApp oturumu doğrulandı.'));
client.on('ready', async () => {
    reconnecting = false;
    log('WhatsApp hazır.');
    log(`İzlenen grup filtresi: ${GROUPS.length ? GROUPS.join(', ') : '(grup seçilmedi; mesaj aktarımı kapalı)'}`);
    log(`Anahtar kelime filtresi: ${KEYWORDS.length ? KEYWORDS.join(', ') : '(tüm metinler)'}`);
    try { await listGroups(client); } catch (error) { log('Grup listesi alınamadı:', error.message); }
});
client.on('message', message => forwardMessage(message).catch(error => log('WhatsApp mesajı aktarılmadı:', error.message)));
client.on('auth_failure', reason => log('WhatsApp doğrulama hatası:', reason));
client.on('disconnected', reason => {
    log('WhatsApp bağlantısı koptu:', reason);
    if (reconnecting) return;
    reconnecting = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => client.initialize().catch(error => log('WhatsApp yeniden bağlanamadı:', error.message)), 5000);
});
client.initialize().catch(error => { log('WhatsApp başlatılamadı:', error.message); process.exitCode = 1; });
