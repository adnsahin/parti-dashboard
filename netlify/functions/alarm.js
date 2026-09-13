const {getStore} = require('@netlify/blobs');

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Alarm-Token',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function response(statusCode, body) {
  return {statusCode, headers, body: statusCode === 204 ? '' : JSON.stringify(body)};
}

function parseBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const body = JSON.parse(text);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function authorized(event, body) {
  const expected = String(process.env.ALARM_RELAY_TOKEN || '').trim();
  if (!expected) return true;
  const requestHeaders = event.headers || {};
  const suppliedHeader = Object.entries(requestHeaders).find(([name]) => name.toLowerCase() === 'x-alarm-token');
  const supplied = String((suppliedHeader && suppliedHeader[1]) || body.token || '').trim();
  return supplied === expected;
}
async function store() {
  const siteID = String(process.env.PARTI_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || '').trim() || undefined;
  const token = String(process.env.PARTI_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || '').trim() || undefined;
  return getStore('parti-alarm-events', {
    siteID,
    token,
    consistency: 'strong'
  });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  let body = {};
  try { body = parseBody(event); } catch (_) { return response(400, {ok: false, error: 'Geçersiz JSON'}); }
  if (!authorized(event, body)) return response(401, {ok: false, error: 'Yetkisiz alarm isteği'});

  try {
    const alarms = await store();
    if (event.httpMethod === 'POST') {
      if (!body.card && !Array.isArray(body.cards) && !body.message) return response(400, {ok: false, error: 'Alarm içeriği boş'});
      const storedEvents = await alarms.get('events', {type: 'json'});
      const events = Array.isArray(storedEvents) ? storedEvents : [];
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date().toISOString(),
        title: String(body.title || 'Parti Alarmi'),
        message: String(body.message || ''),
        card: body.card || null,
        cards: Array.isArray(body.cards) ? body.cards : null
      };
      events.push(item);
      await alarms.setJSON('events', events.slice(-100));
      return response(200, {ok: true, id: item.id});
    }
    if (event.httpMethod === 'GET') {
      const after = String((event.queryStringParameters && event.queryStringParameters.after) || '');
      const events = (await alarms.get('events', {type: 'json'})) || [];
      return response(200, {ok: true, events: events.filter(item => !after || item.id > after).slice(-25)});
    }
    return response(405, {ok: false, error: 'Method desteklenmiyor'});
  } catch (error) {
    return response(500, {ok: false, error: error.message});
  }
};
