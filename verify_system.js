/**
 * System Verification Script
 *
 * 1. Pick 500 random phone numbers from piis (CRM-Database)
 * 2. Bulk lookup via our API to get predicted state
 * 3. Find actual state from leads_v2 (joined via pii_id)
 * 4. Compare and report accuracy
 */

const { MongoClient } = require('mongodb');
const http = require('http');

const MONGO_URI = process.env.MONGO_URI ||
  'mongodb+srv://CRM-Database-ReadOnly:3rOi6HYp2YHztL2I@cluster0.okk1w.mongodb.net/CRM-Database?readPreference=secondary&readPreferenceTags=nodeType:ANALYTICS,priority:1&readPreferenceTags=&readConcernLevel=local';
const DB_NAME = 'CRM-Database';
const API_URL = 'http://localhost:3001';
const SAMPLE_SIZE = 2000;

// State normalization (to match API output)
const STATE_MAP = {
  'UTTAR PRADESH': 'Uttar Pradesh', 'MADHYA PRADESH': 'Madhya Pradesh',
  'MAHARASHTRA': 'Maharashtra', 'ANDHRA PRADESH': 'Andhra Pradesh',
  'WEST BENGAL': 'West Bengal', 'BIHAR': 'Bihar', 'TELANGANA': 'Telangana',
  'KARNATAKA': 'Karnataka', 'ODISHA': 'Odisha', 'RAJASTHAN': 'Rajasthan',
  'TAMIL NADU': 'Tamil Nadu', 'KERALA': 'Kerala', 'GUJARAT': 'Gujarat',
  'PUNJAB': 'Punjab', 'HARYANA': 'Haryana', 'CHHATTISGARH': 'Chhattisgarh',
  'DELHI': 'Delhi', 'HIMACHAL PRADESH': 'Himachal Pradesh', 'ASSAM': 'Assam',
  'JAMMU AND KASHMIR': 'Jammu & Kashmir', 'JHARKHAND': 'Jharkhand',
  'UTTARAKHAND': 'Uttarakhand', 'TRIPURA': 'Tripura', 'PUDUCHERRY': 'Puducherry',
  'ARUNACHAL PRADESH': 'Arunachal Pradesh', 'MANIPUR': 'Manipur', 'GOA': 'Goa',
  'NORTH EAST': 'North East', 'ANDAMAN AND NICOBAR ISLANDS': 'Andaman & Nicobar',
  'CHANDIGARH': 'Chandigarh', 'SIKKIM': 'Sikkim', 'MEGHALAYA': 'Meghalaya',
  'NAGALAND': 'Nagaland', 'MIZORAM': 'Mizoram', 'LAKSHADWEEP': 'Lakshadweep',
};

function normalize(state) {
  if (!state) return null;
  return STATE_MAP[state.trim().toUpperCase()] || state.trim();
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== System Verification: API vs Actual DB State ===\n');

  // Step 1: Get 500 random piis that have a matching lead with state
  console.log('Step 1: Fetching 500 random verified phone-state pairs from DB...');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const samples = await db.collection('leads_v2').aggregate([
    { $match: { state: { $ne: '' }, pii_id: { $exists: true } } },
    { $sample: { size: SAMPLE_SIZE } },
    { $lookup: { from: 'piis', localField: 'pii_id', foreignField: 'pii_id', as: 'pii' } },
    { $unwind: '$pii' },
    { $unwind: '$pii.phone_number' },
    { $project: { phone: '$pii.phone_number', actual_state: '$state', pii_id: 1, _id: 0 } }
  ], { allowDiskUse: true }).toArray();

  await client.close();

  // Filter valid phones
  const valid = samples.filter(s => {
    const digits = String(s.phone).replace(/\D/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    return last10.length === 10 && /^[6-9]/.test(last10);
  });

  console.log(`  Got ${valid.length} valid phone-state pairs\n`);

  // Step 2: Bulk lookup via API (batches of 500)
  console.log('Step 2: Running bulk lookup via API...');
  const phones = valid.map(v => v.phone);
  const apiResults = [];
  for (let i = 0; i < phones.length; i += 500) {
    const batch = phones.slice(i, i + 500);
    const res = await apiPost('/bulk', { phones: batch });
    apiResults.push(...res);
    console.log(`  Batch ${Math.floor(i / 500) + 1}: ${batch.length} phones sent, ${res.length} results`);
  }
  console.log(`  Total API results: ${apiResults.length}\n`);

  // Step 3: Compare
  console.log('Step 3: Comparing predicted vs actual...\n');
  let match = 0, mismatch = 0, noMatch = 0, invalidPhone = 0;
  const mismatchDetails = [];
  const stateAccuracy = {}; // per-state accuracy

  for (let i = 0; i < valid.length; i++) {
    const actual = normalize(valid[i].actual_state);
    const api = apiResults[i];

    if (!actual) continue;

    if (api.error) {
      invalidPhone++;
      continue;
    }

    if (!api.state) {
      noMatch++;
      continue;
    }

    // Track per-state
    if (!stateAccuracy[actual]) stateAccuracy[actual] = { correct: 0, wrong: 0, total: 0 };
    stateAccuracy[actual].total++;

    if (api.state === actual) {
      match++;
      stateAccuracy[actual].correct++;
    } else {
      mismatch++;
      stateAccuracy[actual].wrong++;
      mismatchDetails.push({
        phone: valid[i].phone,
        predicted: api.state,
        actual: actual,
        confidence: api.confidence,
        prefix: api.matched_prefix,
      });
    }
  }

  const total = match + mismatch;
  const accuracy = total > 0 ? ((match / total) * 100).toFixed(2) : 0;

  // Print results
  console.log('┌─────────────────────────────────────────┐');
  console.log('│         VERIFICATION RESULTS             │');
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  Total tested:      ${String(valid.length).padStart(6)}              │`);
  console.log(`│  Matched (correct): ${String(match).padStart(6)}              │`);
  console.log(`│  Mismatched:        ${String(mismatch).padStart(6)}              │`);
  console.log(`│  No match (prefix): ${String(noMatch).padStart(6)}              │`);
  console.log(`│  Invalid phone:     ${String(invalidPhone).padStart(6)}              │`);
  console.log(`│                                         │`);
  console.log(`│  ACCURACY:          ${(accuracy + '%').padStart(7)}             │`);
  console.log('└─────────────────────────────────────────┘');

  // Per-state accuracy
  console.log('\n--- Per-State Accuracy ---');
  console.log('State                   | Correct | Wrong | Total | Accuracy');
  console.log('─'.repeat(70));
  const sorted = Object.entries(stateAccuracy).sort((a, b) => b[1].total - a[1].total);
  for (const [state, s] of sorted) {
    const acc = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(1) : '0.0';
    console.log(`${state.padEnd(24)}| ${String(s.correct).padStart(7)} | ${String(s.wrong).padStart(5)} | ${String(s.total).padStart(5)} | ${acc}%`);
  }

  // Show mismatches
  if (mismatchDetails.length > 0) {
    console.log(`\n--- Mismatches (${mismatchDetails.length}) ---`);
    console.log('Phone          | Prefix | Predicted            | Actual               | Conf');
    console.log('─'.repeat(85));
    for (const m of mismatchDetails.slice(0, 30)) {
      console.log(`${m.phone.padEnd(15)}| ${m.prefix.padEnd(7)}| ${m.predicted.padEnd(21)}| ${m.actual.padEnd(21)}| ${m.confidence}`);
    }
    if (mismatchDetails.length > 30) {
      console.log(`  ... and ${mismatchDetails.length - 30} more`);
    }
  }

  // Accuracy by confidence bucket
  console.log('\n--- Accuracy by Confidence Level ---');
  const confBuckets = { high: { match: 0, total: 0 }, medium: { match: 0, total: 0 }, low: { match: 0, total: 0 } };
  for (let i = 0; i < valid.length; i++) {
    const actual = normalize(valid[i].actual_state);
    const api = apiResults[i];
    if (!actual || api.error || !api.state) continue;
    const bucket = api.confidence >= 0.85 ? 'high' : api.confidence >= 0.65 ? 'medium' : 'low';
    confBuckets[bucket].total++;
    if (api.state === actual) confBuckets[bucket].match++;
  }
  for (const [level, b] of Object.entries(confBuckets)) {
    const acc = b.total > 0 ? ((b.match / b.total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${level.padEnd(8)}: ${b.match}/${b.total} = ${acc}%`);
  }
}

main().catch(console.error);
