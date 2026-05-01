/**
 * STEP 5: Production lookup service
 *
 * Two ways to use:
 *   1. As a module:   const { getStateFromPhone } = require('./05_lookup_service');
 *   2. As HTTP API:   node scripts/05_lookup_service.js  → starts on PORT 3000
 *      GET /lookup?phone=9826xxxxxx
 *
 * In-memory: ~1700 prefixes ≈ <1MB RAM, sub-millisecond lookup.
 */

const fs = require('fs');
const path = require('path');

const MAPPING_FILE = path.join(__dirname, 'final_prefix_state.json');
let mapping = null;

function loadMapping() {
  if (!mapping) {
    if (!fs.existsSync(MAPPING_FILE)) {
      throw new Error(`Mapping file not found: ${MAPPING_FILE}. Run scripts 1-3 first.`);
    }
    mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
  }
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

/**
 * Main API: get state info from phone number
 * @returns {Object|null} { state, operator, confidence, source, samples, alternates? }
 */
function getStateFromPhone(rawPhone) {
  const m = loadMapping();
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { error: 'invalid_phone', input: rawPhone };
  }

  // Longest-prefix match: 5-digit then 4-digit
  const p5 = phone.slice(0, 5);
  const p4 = phone.slice(0, 4);
  const entry = m[p5] || m[p4];

  if (!entry) {
    return { phone, state: null, confidence: 0, source: 'no_match' };
  }

  return {
    phone,
    matched_prefix: m[p5] ? p5 : p4,
    ...entry,
  };
}

/**
 * Bulk lookup
 */
function getStatesFromPhones(rawPhones) {
  return rawPhones.map(p => ({ input: p, ...getStateFromPhone(p) }));
}

module.exports = { getStateFromPhone, getStatesFromPhones, normalizePhone };

// ─── HTTP server mode ──────────────────────────────────────────────────
if (require.main === module) {
  const http = require('http');
  const url = require('url');
  const PORT = process.env.PORT || 3000;

  loadMapping(); // pre-load
  console.log(`✓ Mapping loaded: ${Object.keys(mapping).length} prefixes`);

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    res.setHeader('Content-Type', 'application/json');

    if (parsed.pathname === '/lookup' && req.method === 'GET') {
      const phone = parsed.query.phone;
      if (!phone) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'phone query param required' }));
      }
      return res.end(JSON.stringify(getStateFromPhone(phone)));
    }

    if (parsed.pathname === '/bulk' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const { phones } = JSON.parse(body);
          if (!Array.isArray(phones)) throw new Error('phones must be array');
          res.end(JSON.stringify(getStatesFromPhones(phones)));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (parsed.pathname === '/health') {
      return res.end(JSON.stringify({ ok: true, prefixes: Object.keys(mapping).length }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, () => {
    console.log(`🚀 Phone-to-state lookup API running on http://localhost:${PORT}`);
    console.log(`   GET  /lookup?phone=9826123456`);
    console.log(`   POST /bulk         body: { "phones": ["9826...", ...] }`);
    console.log(`   GET  /health`);
  });
}
