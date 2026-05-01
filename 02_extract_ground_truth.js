/**
 * STEP 2: Extract ground truth from MongoDB
 *
 * Flow:
 *   1. Read PIIS collection → get phone numbers + verified states (source of truth)
 *   2. Match those numbers in leads_v2 to cross-validate
 *   3. Build a prefix → {state, count} aggregation for high-confidence learning
 *
 * Input: MONGO_URI env var (e.g., mongodb://localhost:27017/katyayani)
 * Output: data/ground_truth_mapping.json
 *
 * Ground truth mapping structure:
 *   {
 *     "9826": {
 *       "Madhya Pradesh": 1247,
 *       "Maharashtra": 23,    // these are ported numbers
 *       "Delhi": 8
 *     },
 *     ...
 *   }
 *
 * Usage:
 *   MONGO_URI="mongodb://localhost:27017/yourdb" node scripts/02_extract_ground_truth.js
 *
 *   Optional env:
 *     PIIS_COLLECTION=piis        (default)
 *     LEADS_COLLECTION=leads_v2   (default)
 *     PIIS_PHONE_FIELD=phone_number
 *     PIIS_STATE_FIELD=state
 *     LEADS_PHONE_FIELD=phone_number
 *     LEADS_STATE_FIELD=state
 *     BATCH_SIZE=5000
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/katyayani';
const PIIS_COLLECTION = process.env.PIIS_COLLECTION || 'piis';
const LEADS_COLLECTION = process.env.LEADS_COLLECTION || 'leads_v2';
const PIIS_PHONE_FIELD = process.env.PIIS_PHONE_FIELD || 'phone_number';
const PIIS_STATE_FIELD = process.env.PIIS_STATE_FIELD || 'state';
const LEADS_PHONE_FIELD = process.env.LEADS_PHONE_FIELD || 'phone_number';
const LEADS_STATE_FIELD = process.env.LEADS_STATE_FIELD || 'state';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5000', 10);

// Normalise phone — strip +91, 91, 0, spaces; return last 10 digits
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (!/^[6-9]/.test(last10)) return null; // must be valid Indian mobile
  return last10;
}

// State normalisation — handles common variations in user data
const STATE_ALIASES = {
  'mp': 'Madhya Pradesh',
  'madhya pradesh': 'Madhya Pradesh',
  'm.p.': 'Madhya Pradesh',
  'up': 'Uttar Pradesh',
  'uttar pradesh': 'Uttar Pradesh',
  'u.p.': 'Uttar Pradesh',
  'mh': 'Maharashtra',
  'maharashtra': 'Maharashtra',
  'tn': 'Tamil Nadu',
  'tamil nadu': 'Tamil Nadu',
  'tamilnadu': 'Tamil Nadu',
  'ka': 'Karnataka',
  'karnataka': 'Karnataka',
  'kerala': 'Kerala',
  'kl': 'Kerala',
  'wb': 'West Bengal',
  'west bengal': 'West Bengal',
  'gj': 'Gujarat',
  'gujarat': 'Gujarat',
  'rj': 'Rajasthan',
  'rajasthan': 'Rajasthan',
  'pb': 'Punjab',
  'punjab': 'Punjab',
  'hr': 'Haryana',
  'haryana': 'Haryana',
  'dl': 'Delhi',
  'delhi': 'Delhi',
  'new delhi': 'Delhi',
  'odisha': 'Odisha',
  'orissa': 'Odisha',
  'or': 'Odisha',
  'jharkhand': 'Jharkhand',
  'jh': 'Jharkhand',
  'chhattisgarh': 'Chhattisgarh',
  'cg': 'Chhattisgarh',
  'telangana': 'Telangana',
  'ts': 'Telangana',
  'andhra pradesh': 'Andhra Pradesh',
  'ap': 'Andhra Pradesh',
  'bihar': 'Bihar',
  'br': 'Bihar',
  'assam': 'Assam',
  'as': 'Assam',
  'jk': 'Jammu and Kashmir',
  'jammu and kashmir': 'Jammu and Kashmir',
  'jammu & kashmir': 'Jammu and Kashmir',
  'hp': 'Himachal Pradesh',
  'himachal pradesh': 'Himachal Pradesh',
};

function normalizeState(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  return STATE_ALIASES[key] || raw.trim();
}

async function extractGroundTruth() {
  console.log(`Connecting to MongoDB...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  const piisCol = db.collection(PIIS_COLLECTION);
  const leadsCol = db.collection(LEADS_COLLECTION);

  console.log(`✓ Connected. DB: ${db.databaseName}`);
  console.log(`  PIIS collection:  ${PIIS_COLLECTION}`);
  console.log(`  Leads collection: ${LEADS_COLLECTION}\n`);

  // ─────────────────────────────────────────────────────────────────
  // Pass 1: Read PIIS, build phone → state map (verified ground truth)
  // ─────────────────────────────────────────────────────────────────
  console.log(`📥 Pass 1: Reading ${PIIS_COLLECTION}...`);
  const piisCount = await piisCol.countDocuments();
  console.log(`   Total PIIS documents: ${piisCount}`);

  const phoneToState = new Map();   // phone (10-digit) → state
  let piisRead = 0, piisValid = 0;

  const piisCursor = piisCol.find(
    {},
    {
      projection: {
        [PIIS_PHONE_FIELD]: 1,
        [PIIS_STATE_FIELD]: 1,
      },
      batchSize: BATCH_SIZE,
    }
  );

  for await (const doc of piisCursor) {
    piisRead++;
    const phone = normalizePhone(doc[PIIS_PHONE_FIELD]);
    const state = normalizeState(doc[PIIS_STATE_FIELD]);
    if (phone && state) {
      phoneToState.set(phone, state);
      piisValid++;
    }
    if (piisRead % 50000 === 0) {
      console.log(`   ...read ${piisRead}/${piisCount}`);
    }
  }
  console.log(`   ✓ PIIS: ${piisRead} read, ${piisValid} valid phone+state pairs\n`);

  // ─────────────────────────────────────────────────────────────────
  // Pass 2: Cross-reference with leads_v2 — find overlap & enrich
  // ─────────────────────────────────────────────────────────────────
  console.log(`📥 Pass 2: Cross-referencing ${LEADS_COLLECTION}...`);
  const leadsCount = await leadsCol.countDocuments();
  console.log(`   Total leads documents: ${leadsCount}`);

  // For aggregation: prefix → {state → count}
  const prefixStateCount = {};   // { "9826": { "Madhya Pradesh": 1234, ... } }
  let leadsRead = 0, leadsWithState = 0, leadsMatchedInPiis = 0;
  let agreement = 0, disagreement = 0;

  const leadsCursor = leadsCol.find(
    {},
    {
      projection: {
        [LEADS_PHONE_FIELD]: 1,
        [LEADS_STATE_FIELD]: 1,
      },
      batchSize: BATCH_SIZE,
    }
  );

  for await (const doc of leadsCursor) {
    leadsRead++;
    const phone = normalizePhone(doc[LEADS_PHONE_FIELD]);
    const leadState = normalizeState(doc[LEADS_STATE_FIELD]);
    if (!phone) continue;

    const prefix = phone.slice(0, 4);

    // PIIS verified state (highest priority)
    let groundTruthState = phoneToState.get(phone);
    if (groundTruthState) {
      leadsMatchedInPiis++;
      if (leadState && leadState === groundTruthState) agreement++;
      else if (leadState && leadState !== groundTruthState) disagreement++;
    } else if (leadState) {
      // Fallback — leads_v2 own state (lower confidence)
      groundTruthState = leadState;
      leadsWithState++;
    }

    if (groundTruthState) {
      if (!prefixStateCount[prefix]) prefixStateCount[prefix] = {};
      prefixStateCount[prefix][groundTruthState] =
        (prefixStateCount[prefix][groundTruthState] || 0) + 1;
    }

    if (leadsRead % 50000 === 0) {
      console.log(`   ...read ${leadsRead}/${leadsCount}`);
    }
  }
  console.log(`   ✓ Leads: ${leadsRead} read`);
  console.log(`     ${leadsMatchedInPiis} matched in PIIS (high-confidence)`);
  console.log(`     ${leadsWithState} unmatched but have leads_v2 state (medium-confidence)`);
  console.log(`     PIIS↔leads agreement: ${agreement}, disagreement: ${disagreement}`);

  await client.close();

  // ─────────────────────────────────────────────────────────────────
  // Save outputs
  // ─────────────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, '..', 'data');
  fs.writeFileSync(
    path.join(outDir, 'ground_truth_mapping.json'),
    JSON.stringify(prefixStateCount, null, 2)
  );

  const stats = {
    generated_at: new Date().toISOString(),
    piis_total: piisRead,
    piis_valid: piisValid,
    leads_total: leadsRead,
    leads_matched_in_piis: leadsMatchedInPiis,
    leads_only_state: leadsWithState,
    piis_leads_agreement: agreement,
    piis_leads_disagreement: disagreement,
    unique_prefixes_observed: Object.keys(prefixStateCount).length,
  };
  fs.writeFileSync(
    path.join(outDir, 'ground_truth_stats.json'),
    JSON.stringify(stats, null, 2)
  );

  console.log(`\n✅ Output:`);
  console.log(`   data/ground_truth_mapping.json (${Object.keys(prefixStateCount).length} prefixes observed)`);
  console.log(`   data/ground_truth_stats.json`);
}

extractGroundTruth().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
