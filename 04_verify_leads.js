/**
 * STEP 4: Verify & enrich leads_v2 using final prefix mapping
 *
 * For each lead document, classify into:
 *   - VERIFIED:        stored state matches predicted state (confidence ≥ 0.85)
 *   - LIKELY:          stored state matches predicted (confidence 0.65–0.85)
 *   - MISMATCH:        stored state ≠ predicted state (likely MNP / data error)
 *   - MISSING:         no stored state, prediction available → fill in
 *   - UNKNOWN:         no prediction possible (rare — invalid number)
 *
 * Modes:
 *   Default = DRY RUN (only writes report, doesn't update DB)
 *   --apply = Actually update leads_v2 with predicted_state, confidence, verification_status
 *
 * Usage:
 *   MONGO_URI="..." node scripts/04_verify_leads.js          # dry run
 *   MONGO_URI="..." node scripts/04_verify_leads.js --apply  # actual update
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/katyayani';
const LEADS_COLLECTION = process.env.LEADS_COLLECTION || 'leads_v2';
const LEADS_PHONE_FIELD = process.env.LEADS_PHONE_FIELD || 'phone_number';
const LEADS_STATE_FIELD = process.env.LEADS_STATE_FIELD || 'state';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5000', 10);
const APPLY = process.argv.includes('--apply');

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (!/^[6-9]/.test(last10)) return null;
  return last10;
}

const STATE_ALIASES = {
  'mp': 'Madhya Pradesh', 'madhya pradesh': 'Madhya Pradesh',
  'up': 'Uttar Pradesh', 'uttar pradesh': 'Uttar Pradesh',
  'mh': 'Maharashtra', 'maharashtra': 'Maharashtra',
  'tn': 'Tamil Nadu', 'tamil nadu': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu',
  'ka': 'Karnataka', 'karnataka': 'Karnataka',
  'kerala': 'Kerala', 'kl': 'Kerala',
  'wb': 'West Bengal', 'west bengal': 'West Bengal',
  'gj': 'Gujarat', 'gujarat': 'Gujarat',
  'rj': 'Rajasthan', 'rajasthan': 'Rajasthan',
  'pb': 'Punjab', 'punjab': 'Punjab',
  'hr': 'Haryana', 'haryana': 'Haryana',
  'dl': 'Delhi', 'delhi': 'Delhi', 'new delhi': 'Delhi',
  'odisha': 'Odisha', 'orissa': 'Odisha', 'or': 'Odisha',
  'jharkhand': 'Jharkhand', 'jh': 'Jharkhand',
  'chhattisgarh': 'Chhattisgarh', 'cg': 'Chhattisgarh',
  'telangana': 'Telangana', 'ts': 'Telangana',
  'andhra pradesh': 'Andhra Pradesh', 'ap': 'Andhra Pradesh',
  'bihar': 'Bihar', 'br': 'Bihar',
  'assam': 'Assam', 'as': 'Assam',
};
function normalizeState(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  return STATE_ALIASES[key] || raw.trim();
}

// In-memory lookup engine
class StateLookup {
  constructor(mapping) {
    this.mapping = mapping;
  }
  lookup(phone10) {
    // Try 5-digit prefix first (more specific), then 4-digit
    const p5 = phone10.slice(0, 5);
    const p4 = phone10.slice(0, 4);
    return this.mapping[p5] || this.mapping[p4] || null;
  }
}

function classify(predictedEntry, storedState) {
  if (!predictedEntry) return 'UNKNOWN';

  const predicted = predictedEntry.state;
  const conf = predictedEntry.confidence;

  if (!storedState) return 'MISSING';
  if (storedState === predicted) {
    return conf >= 0.85 ? 'VERIFIED' : 'LIKELY';
  }
  return 'MISMATCH';
}

async function verifyLeads() {
  const dataDir = path.join(__dirname, '..', 'data');
  const mapping = JSON.parse(fs.readFileSync(path.join(dataDir, 'final_prefix_state.json'), 'utf8'));
  const lookup = new StateLookup(mapping);

  console.log(`Mode: ${APPLY ? '🟢 APPLY (will update DB)' : '🔵 DRY RUN (no DB writes)'}`);
  console.log(`Loaded mapping with ${Object.keys(mapping).length} prefixes\n`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db().collection(LEADS_COLLECTION);

  const total = await col.countDocuments();
  console.log(`Processing ${total} leads...\n`);

  const stats = {
    total: 0, VERIFIED: 0, LIKELY: 0, MISMATCH: 0, MISSING: 0, UNKNOWN: 0, INVALID_PHONE: 0,
  };
  const mismatchSamples = [];

  // Bulk update buffer
  let bulkOps = [];
  const FLUSH_AT = 1000;

  async function flushBulk() {
    if (!APPLY || bulkOps.length === 0) return;
    await col.bulkWrite(bulkOps, { ordered: false });
    bulkOps = [];
  }

  const cursor = col.find(
    {},
    {
      projection: { [LEADS_PHONE_FIELD]: 1, [LEADS_STATE_FIELD]: 1 },
      batchSize: BATCH_SIZE,
    }
  );

  for await (const doc of cursor) {
    stats.total++;
    const phone = normalizePhone(doc[LEADS_PHONE_FIELD]);
    if (!phone) {
      stats.INVALID_PHONE++;
      continue;
    }

    const predicted = lookup.lookup(phone);
    const storedState = normalizeState(doc[LEADS_STATE_FIELD]);
    const status = classify(predicted, storedState);
    stats[status]++;

    if (status === 'MISMATCH' && mismatchSamples.length < 50) {
      mismatchSamples.push({
        _id: doc._id,
        phone,
        stored: storedState,
        predicted: predicted.state,
        confidence: predicted.confidence,
      });
    }

    if (APPLY) {
      const update = {
        $set: {
          phone_state_verification: {
            status,
            predicted_state: predicted ? predicted.state : null,
            confidence: predicted ? predicted.confidence : 0,
            source: predicted ? predicted.source : null,
            verified_at: new Date(),
          },
        },
      };
      // Only fill `state` field if MISSING and prediction is high-confidence
      if (status === 'MISSING' && predicted.confidence >= 0.85) {
        update.$set[LEADS_STATE_FIELD] = predicted.state;
      }
      bulkOps.push({ updateOne: { filter: { _id: doc._id }, update } });
      if (bulkOps.length >= FLUSH_AT) await flushBulk();
    }

    if (stats.total % 50000 === 0) {
      console.log(`   ...processed ${stats.total}/${total}`);
    }
  }

  await flushBulk();
  await client.close();

  // ─── Report ────────────────────────────────────────────────────────
  console.log('\n=== Verification Report ===');
  console.log(`Total leads:      ${stats.total}`);
  console.log(`✓ VERIFIED:       ${stats.VERIFIED} (${pct(stats.VERIFIED, stats.total)}%) — high-conf match`);
  console.log(`~ LIKELY:         ${stats.LIKELY} (${pct(stats.LIKELY, stats.total)}%) — medium-conf match`);
  console.log(`✗ MISMATCH:       ${stats.MISMATCH} (${pct(stats.MISMATCH, stats.total)}%) — needs review`);
  console.log(`? MISSING:        ${stats.MISSING} (${pct(stats.MISSING, stats.total)}%) — state filled in (if confidence high)`);
  console.log(`! UNKNOWN:        ${stats.UNKNOWN} (${pct(stats.UNKNOWN, stats.total)}%) — no prediction`);
  console.log(`✗ INVALID_PHONE:  ${stats.INVALID_PHONE} (${pct(stats.INVALID_PHONE, stats.total)}%)`);

  const reportDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, `verification_report_${Date.now()}.json`),
    JSON.stringify({ stats, mismatchSamples, mode: APPLY ? 'apply' : 'dry-run' }, null, 2)
  );
  console.log(`\n✅ Report saved to output/`);
}

function pct(n, total) {
  return total > 0 ? ((n / total) * 100).toFixed(2) : '0.00';
}

verifyLeads().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
