/**
 * Phone -> State Lookup API (With API Key Authentication)
 *
 * Security: Requires X-API-Key header for all requests
 *
 * Usage:
 *   curl -H "X-API-Key: your-secret-key" http://localhost:3001/lookup?phone=9826123456
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const MAPPING_FILE = path.join(__dirname, 'enhanced_prefix_state.json');

// API Keys - Store these securely (environment variables in production)
const API_KEYS = new Set([
  process.env.API_KEY_1 || 'demo-key-12345',
  process.env.API_KEY_2 || 'prod-key-67890',
  // Add more keys for different clients
]);

// Rate limiting (simple in-memory)
const rateLimits = new Map(); // { apiKey: { count, resetTime } }
const RATE_LIMIT = 10; // requests per second
const RATE_WINDOW = 1000; // 1 second in ms

let mapping = null;
let stats = null;

function loadMapping() {
  if (mapping) return mapping;
  if (!fs.existsSync(MAPPING_FILE)) {
    throw new Error(`Mapping not found: ${MAPPING_FILE}`);
  }
  mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));

  const entries = Object.values(mapping);
  const gtEntries = entries.filter(e => e.source === 'ground_truth');
  const highConf = entries.filter(e => e.confidence >= 0.85).length;
  const medConf = entries.filter(e => e.confidence >= 0.65 && e.confidence < 0.85).length;
  const lowConf = entries.filter(e => e.confidence < 0.65).length;

  stats = {
    total_prefixes: entries.length,
    ground_truth_prefixes: gtEntries.length,
    trai_only_prefixes: entries.length - gtEntries.length,
    total_verified_samples: gtEntries.reduce((s, e) => s + (e.samples || 0), 0),
    confidence_high: highConf,
    confidence_medium: medConf,
    confidence_low: lowConf,
  };

  return mapping;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (!/^[6-9]/.test(last10)) return null;
  return last10;
}

function lookup(rawPhone) {
  const m = loadMapping();
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { error: 'invalid_phone', input: rawPhone };
  }

  const p5 = phone.slice(0, 5);
  const p4 = phone.slice(0, 4);
  const entry = m[p5] || m[p4];

  if (!entry) {
    return { phone, state: null, confidence: 0, source: 'no_match' };
  }

  return {
    phone,
    matched_prefix: m[p5] ? p5 : p4,
    state: entry.state,
    confidence: entry.confidence,
    source: entry.source,
    samples: entry.samples || 0,
    operator: entry.operator || null,
    alternates: entry.alternates || [],
  };
}

function bulkLookup(phones) {
  return phones.map(p => ({ input: p, ...lookup(p) }));
}

// Authentication middleware
function authenticate(apiKey) {
  if (!apiKey) {
    return { valid: false, error: 'missing_api_key', message: 'X-API-Key header required' };
  }
  if (!API_KEYS.has(apiKey)) {
    return { valid: false, error: 'invalid_api_key', message: 'Invalid API key' };
  }
  return { valid: true, apiKey };
}

// Rate limiting
function checkRateLimit(apiKey) {
  const now = Date.now();
  const limit = rateLimits.get(apiKey);

  if (!limit || now > limit.resetTime) {
    rateLimits.set(apiKey, { count: 1, resetTime: now + RATE_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (limit.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((limit.resetTime - now) / 1000);
    return { allowed: false, resetIn };
  }

  limit.count++;
  return { allowed: true, remaining: RATE_LIMIT - limit.count };
}

// --- HTTP Server ---
loadMapping();
console.log(`🔒 Secure Phone-State API`);
console.log(`Mapping loaded: ${stats.total_prefixes} prefixes`);
console.log(`Verified samples: ${stats.total_verified_samples.toLocaleString()}`);
console.log(`API Keys configured: ${API_KEYS.size}`);
console.log(`Rate limit: ${RATE_LIMIT} requests/second per key\n`);

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Public health check (no auth required)
  if (parsed.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, prefixes: stats.total_prefixes }));
  }

  // All other endpoints require authentication
  // Support API key in: header, query param, or path
  const apiKey = req.headers['x-api-key'] || parsed.query.apikey || parsed.query.api_key;
  const auth = authenticate(apiKey);

  if (!auth.valid) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: auth.error, message: auth.message }));
  }

  // Rate limiting
  const rateCheck = checkRateLimit(auth.apiKey);
  if (!rateCheck.allowed) {
    res.statusCode = 429;
    res.setHeader('X-RateLimit-Reset', rateCheck.resetIn);
    return res.end(JSON.stringify({
      error: 'rate_limit_exceeded',
      message: `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds.`
    }));
  }

  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);

  // GET /lookup?phone=... OR GET /lookup/:phone
  if (parsed.pathname === '/lookup' && req.method === 'GET') {
    const phone = parsed.query.phone;
    if (!phone) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'phone query param required. Usage: /lookup?phone=9826123456&apikey=YOUR_KEY' }));
    }
    return res.end(JSON.stringify(lookup(phone)));
  }

  // GET /lookup/:phone (path-based)
  if (parsed.pathname.startsWith('/lookup/') && req.method === 'GET') {
    const phone = parsed.pathname.replace('/lookup/', '');
    if (!phone) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'phone required in path. Usage: /lookup/9826123456?apikey=YOUR_KEY' }));
    }
    return res.end(JSON.stringify(lookup(phone)));
  }

  // POST /bulk
  if (parsed.pathname === '/bulk' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { phones } = JSON.parse(body);
        if (!Array.isArray(phones)) throw new Error('phones must be an array');
        if (phones.length > 500) throw new Error('max 500 phones per request');
        res.end(JSON.stringify(bulkLookup(phones)));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /stats (authenticated)
  if (parsed.pathname === '/stats') {
    return res.end(JSON.stringify(stats));
  }

  res.statusCode = 404;
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: [
      'GET /lookup?phone=9826123456&apikey=YOUR_KEY',
      'GET /lookup/9826123456?apikey=YOUR_KEY',
      'POST /bulk (body: {"phones":["..."]})',
      'GET /stats?apikey=YOUR_KEY',
      'GET /health (no auth)'
    ],
    note: 'API key can be passed as: ?apikey=KEY or X-API-Key header'
  }));
});

server.listen(PORT, () => {
  console.log(`🚀 Secure API running on http://localhost:${PORT}`);
  console.log(`\n📋 Usage Examples:`);
  console.log(`  # Path-based (like numlookupapi):`);
  console.log(`  curl "http://localhost:${PORT}/lookup/9826123456?apikey=demo-key-12345"`);
  console.log(`\n  # Query param:`);
  console.log(`  curl "http://localhost:${PORT}/lookup?phone=9826123456&apikey=demo-key-12345"`);
  console.log(`\n  # Header-based:`);
  console.log(`  curl -H "X-API-Key: demo-key-12345" "http://localhost:${PORT}/lookup?phone=9826123456"`);
  console.log(`\n🔑 Environment variables:`);
  console.log(`  API_KEY_1 - Primary API key (default: demo-key-12345)`);
  console.log(`  API_KEY_2 - Secondary API key (default: prod-key-67890)`);
  console.log(`  PORT - Server port (default: 3001)`);
});

module.exports = { lookup, bulkLookup, normalizePhone };
