export class RateLimiter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const { ip, limit = 60, windowMs = 60_000 } = await request.json();
    if (!ip) return json({ error: 'Invalid request' }, 400);
    const key = `rl:${ip}`;
    const now = Date.now();
    const current = await this.state.storage.get(key);
    if (!current || now - current.windowStart >= windowMs) {
      await this.state.storage.put(key, { count: 1, windowStart: now }, { expirationTtl: 70 });
      return json({ allowed: true, remaining: limit - 1 });
    }
    if (current.count >= limit) return json({ allowed: false, remaining: 0 }, 429);
    const updated = { ...current, count: current.count + 1 };
    await this.state.storage.put(key, updated, { expirationTtl: 70 });
    return json({ allowed: true, remaining: Math.max(0, limit - updated.count) });
  }
}

const ALLOWED_ORIGIN = 'https://bubblebrowser.netlify.app';
const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade']);
const BLOCKED_HOSTS = new Set(['localhost','0.0.0.0','127.0.0.1','169.254.169.254','metadata.google.internal','metadata']);
const PRIVATE_RANGES = [/^10\./,/^127\./,/^192\.168\./,/^172\.(1[6-9]|2\d|3[0-1])\./,/^169\.254\./,/^0\./];
const IPV6_BLOCKED = ['::1','fc','fd','fe80'];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);
    if (request.method === 'OPTIONS') return handleOptions(request);
    if (!isAllowedOrigin(request)) return withCors(request, json({ error: 'Forbidden' }, 403));
    if (reqUrl.pathname === '/health' && request.method === 'GET') return withCors(request, json({ status: 'ok' }));
    if (reqUrl.pathname !== '/proxy' || request.method !== 'GET') return withCors(request, json({ error: 'Not found' }, 404));

    const allowed = await enforceRateLimit(request, env);
    if (!allowed) return withCors(request, json({ error: 'Rate limit exceeded' }, 429));

    const target = reqUrl.searchParams.get('url');
    const parsedTarget = parseAndValidateTarget(target);
    if (!parsedTarget.ok) return withCors(request, json({ error: 'Invalid URL' }, 400));

    try {
      const upstream = await fetchWithTimeout(parsedTarget.url, { method: 'GET', redirect: 'follow', headers: buildUpstreamHeaders() });
      const proxied = await buildProxyResponse(upstream, parsedTarget.url);
      return withCors(request, proxied);
    } catch (err) {
      if (err.name === 'AbortError') return withCors(request, json({ error: 'Timeout' }, 504));
      return withCors(request, json({ error: 'Upstream fetch failed' }, 502));
    }
  }
};

async function enforceRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
  const resp = await stub.fetch('https://rate-limit/check', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ ip }) });
  return resp.status < 400;
}

function handleOptions(request) {
  const headers = corsHeaders(request);
  return headers ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403 });
}
const isAllowedOrigin = (request) => !request.headers.get('Origin') || request.headers.get('Origin') === ALLOWED_ORIGIN;
function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== ALLOWED_ORIGIN) return null;
  return new Headers({ 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' });
}
function withCors(request, response) { const h = corsHeaders(request); if (h) for (const [k,v] of h) response.headers.set(k,v); return response; }

function parseAndValidateTarget(input) {
  if (!input || typeof input !== 'string') return { ok:false };
  let parsed; try { parsed = new URL(input); } catch { return { ok:false }; }
  if (!['http:','https:'].includes(parsed.protocol)) return { ok:false };
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || isPrivateHost(host)) return { ok:false };
  return { ok:true, url: parsed.toString() };
}
function isPrivateHost(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_RANGES.some((r)=>r.test(host));
  if (host.includes(':')) return IPV6_BLOCKED.some((p)=>host===p || host.startsWith(`${p}:`));
  return false;
}
function buildUpstreamHeaders() { return new Headers({ 'User-Agent': BROWSER_UA, Accept:'*/*', 'Accept-Language':'en-US,en;q=0.9' }); }
async function fetchWithTimeout(url, init) { const c = new AbortController(); const t = setTimeout(()=>c.abort(),20000); try { return await fetch(url,{...init,signal:c.signal}); } finally { clearTimeout(t);} }

async function buildProxyResponse(upstream, upstreamUrl) {
  const headers = sanitizeResponseHeaders(upstream.headers);
  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    const rewritten = rewriteHtml(upstream, upstreamUrl);
    return new Response(rewritten.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}
function sanitizeResponseHeaders(upstreamHeaders) {
  const headers = new Headers();
  for (const [k,v] of upstreamHeaders) {
    const l = k.toLowerCase();
    if (l === 'cookie' || l === 'set-cookie' || l.startsWith('cf-') || l.startsWith('x-forwarded-') || HOP_BY_HOP.has(l)) continue;
    if (l === 'content-type' || l === 'cache-control') headers.set(l,v);
  }
  return headers;
}
function rewriteHtml(response, baseUrl) {
  let rewriter = new HTMLRewriter();
  for (const [tag, attr] of [['a','href'],['img','src'],['script','src'],['link','href'],['form','action']]) {
    rewriter = rewriter.on(tag, new UrlAttributeRewriter(baseUrl, attr));
  }
  rewriter = rewriter.on('script', new ScriptTextRewriter(baseUrl));
  return rewriter.transform(response);
}
class UrlAttributeRewriter { constructor(baseUrl, attr){ this.baseUrl=baseUrl; this.attr=attr; } element(el){ const v=el.getAttribute(this.attr); if(!v) return; const p=makeProxyUrl(this.baseUrl,v); if(p) el.setAttribute(this.attr,p);} }
class ScriptTextRewriter { constructor(baseUrl){this.baseUrl=baseUrl;} text(t){ if (t.lastInTextNode) t.replace(rewriteScriptFetches(t.text,this.baseUrl),{html:false}); } }
function rewriteScriptFetches(script, baseUrl) {
  return script.replace(/fetch\((['"])(.*?)\1\)/g,(m,q,target)=>{ const p=makeProxyUrl(baseUrl,target); return p?`fetch(${q}${p}${q})`:m; })
    .replace(/open\((['"])(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\1\s*,\s*(['"])(.*?)\3/gi,(m,q1,method,q2,target)=>{ const p=makeProxyUrl(baseUrl,target); return p?`open(${q1}${method}${q1}, ${q2}${p}${q2}`:m; });
}
function makeProxyUrl(baseUrl, value) {
  const trimmed = (value||'').trim();
  if (!trimmed || trimmed.startsWith('#') || /^(data:|javascript:|mailto:|tel:)/i.test(trimmed)) return null;
  let absolute; try { absolute = new URL(trimmed, baseUrl); } catch { return null; }
  const host = absolute.hostname.toLowerCase();
  if (!['http:','https:'].includes(absolute.protocol) || BLOCKED_HOSTS.has(host) || isPrivateHost(host)) return null;
  return `/proxy?url=${encodeURIComponent(absolute.toString())}`;
}
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type':'application/json; charset=utf-8' } }); }
