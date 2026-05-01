/**
 * Phone -> State Lookup API
 *
 * Uses enhanced mapping built from:
 *   - TRAI/DoT base allocation data (1709 prefixes)
 *   - CRM-Database ground truth: 938K verified phone-state pairs (2773 prefixes)
 *
 * Endpoints:
 *   GET  /lookup?phone=9826123456        Single lookup
 *   POST /bulk   body: {"phones":[...]}  Bulk lookup (max 500)
 *   GET  /stats                          Mapping statistics
 *   GET  /health                         Health check
 *
 * Run: node phone_state_api.js
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const MAPPING_FILE = path.join(__dirname, 'enhanced_prefix_state.json');

let mapping = null;
let stats = null;

function loadMapping() {
  if (mapping) return mapping;
  if (!fs.existsSync(MAPPING_FILE)) {
    throw new Error(`Mapping not found: ${MAPPING_FILE}. Run build_ground_truth.js first.`);
  }
  mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));

  // Pre-compute stats
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

  // Longest prefix match: try 5 digits, then 4
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

// --- HTTP Server ---
loadMapping();
console.log(`Mapping loaded: ${stats.total_prefixes} prefixes (${stats.ground_truth_prefixes} ground truth, ${stats.trai_only_prefixes} TRAI-only)`);
console.log(`Verified samples: ${stats.total_verified_samples.toLocaleString()}`);
console.log(`Confidence: ${stats.confidence_high} high, ${stats.confidence_medium} medium, ${stats.confidence_low} low\n`);

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // GET /lookup?phone=...
  if (parsed.pathname === '/lookup' && req.method === 'GET') {
    const phone = parsed.query.phone;
    if (!phone) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'phone query param required. Usage: /lookup?phone=9826123456' }));
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

  // GET /stats
  if (parsed.pathname === '/stats') {
    return res.end(JSON.stringify(stats));
  }

  // GET /health
  if (parsed.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, prefixes: stats.total_prefixes }));
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found. Endpoints: GET /lookup?phone=..., POST /bulk, GET /stats, GET /health' }));
});

server.listen(PORT, () => {
  console.log(`Phone -> State API running on http://localhost:${PORT}`);
  console.log(`  GET  /lookup?phone=9826123456`);
  console.log(`  POST /bulk   body: {"phones":["9826...","7000..."]}`);
  console.log(`  GET  /stats`);
  console.log(`  GET  /health`);
});

module.exports = { lookup, bulkLookup, normalizePhone };
