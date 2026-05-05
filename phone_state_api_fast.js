/**
 * Phone -> State Lookup API (Optimized with Fastify)
 * High-performance API with compression and caching
 */

const fastify = require('fastify')({
  logger: false,
  trustProxy: true,
  keepAliveTimeout: 65000,
  connectionTimeout: 10000,
});
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const MAPPING_FILE = path.join(__dirname, 'enhanced_prefix_state.json');

// API Keys
const API_KEYS = new Set([
  process.env.API_KEY_1 || 'demo-key-12345',
  process.env.API_KEY_2 || 'prod-key-67890',
]);

let mapping = null;
let stats = null;

// Load mapping into memory (cached)
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

// Register plugins
fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/compress'), {
  global: true,
  threshold: 1024,
  encodings: ['gzip', 'deflate']
});

// Auth hook (skip for /health)
fastify.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/health')) return;

  const apiKey = request.headers['x-api-key'] || request.query.apikey || request.query.api_key;

  if (!apiKey) {
    reply.code(401).send({ error: 'missing_api_key', message: 'API key required' });
    return;
  }

  if (!API_KEYS.has(apiKey)) {
    reply.code(401).send({ error: 'invalid_api_key', message: 'Invalid API key' });
    return;
  }
});

// Routes
fastify.get('/health', async (request, reply) => {
  return { ok: true, prefixes: stats.total_prefixes };
});

fastify.get('/lookup', async (request, reply) => {
  const phone = request.query.phone;
  if (!phone) {
    reply.code(400);
    return { error: 'phone query param required. Usage: /lookup?phone=9826123456&apikey=YOUR_KEY' };
  }
  return lookup(phone);
});

fastify.get('/lookup/:phone', async (request, reply) => {
  const phone = request.params.phone;
  if (!phone) {
    reply.code(400);
    return { error: 'phone required in path. Usage: /lookup/9826123456?apikey=YOUR_KEY' };
  }
  return lookup(phone);
});

fastify.post('/bulk', async (request, reply) => {
  const { phones } = request.body || {};

  if (!Array.isArray(phones)) {
    reply.code(400);
    return { error: 'phones must be an array' };
  }

  if (phones.length > 500) {
    reply.code(400);
    return { error: 'max 500 phones per request' };
  }

  return phones.map(p => ({ input: p, ...lookup(p) }));
});

fastify.get('/stats', async (request, reply) => {
  return stats;
});

// 404 handler
fastify.setNotFoundHandler((request, reply) => {
  reply.code(404).send({
    error: 'Not found',
    endpoints: [
      'GET /lookup?phone=9826123456&apikey=YOUR_KEY',
      'GET /lookup/9826123456?apikey=YOUR_KEY',
      'POST /bulk (body: {"phones":["..."]})',
      'GET /stats?apikey=YOUR_KEY',
      'GET /health (no auth)'
    ],
    note: 'API key can be passed as: ?apikey=KEY or X-API-Key header'
  });
});

// Start server
loadMapping();
console.log(`🚀 High-Performance Phone-State API (Fastify)`);
console.log(`Mapping loaded: ${stats.total_prefixes} prefixes`);
console.log(`Verified samples: ${stats.total_verified_samples.toLocaleString()}`);
console.log(`API Keys configured: ${API_KEYS.size}`);
console.log(`Rate limit: DISABLED (unlimited requests)\n`);

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Server running at ${address}`);
  console.log(`\n📋 Usage Examples:`);
  console.log(`  # Path-based:`);
  console.log(`  curl "${address}/lookup/9826123456?apikey=demo-key-12345"`);
  console.log(`\n  # Query param:`);
  console.log(`  curl "${address}/lookup?phone=9826123456&apikey=demo-key-12345"`);
  console.log(`\n  # Header-based:`);
  console.log(`  curl -H "X-API-Key: demo-key-12345" "${address}/lookup?phone=9826123456"`);
});

module.exports = { lookup, normalizePhone };
