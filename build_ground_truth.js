/**
 * Connects to CRM-Database, joins piis + leads_v2 via pii_id,
 * extracts phone prefix -> state ground truth mapping,
 * merges with TRAI base, and writes final enhanced mapping.
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI ||
  'mongodb+srv://CRM-Database-ReadOnly:3rOi6HYp2YHztL2I@cluster0.okk1w.mongodb.net/CRM-Database?readPreference=secondary&readPreferenceTags=nodeType:ANALYTICS,priority:1&readPreferenceTags=&readConcernLevel=local';
const DB_NAME = 'CRM-Database';
const BATCH_SIZE = 5000;
const TRAI_FILE = path.join(__dirname, 'final_prefix_state.json');
const OUTPUT_FILE = path.join(__dirname, 'enhanced_prefix_state.json');

// Canonical state names
const STATE_ALIASES = {
  'UTTAR PRADESH': 'Uttar Pradesh', 'UP': 'Uttar Pradesh',
  'MADHYA PRADESH': 'Madhya Pradesh', 'MP': 'Madhya Pradesh',
  'MAHARASHTRA': 'Maharashtra', 'MH': 'Maharashtra',
  'ANDHRA PRADESH': 'Andhra Pradesh', 'AP': 'Andhra Pradesh',
  'WEST BENGAL': 'West Bengal', 'WB': 'West Bengal',
  'BIHAR': 'Bihar', 'BR': 'Bihar',
  'TELANGANA': 'Telangana', 'TS': 'Telangana',
  'KARNATAKA': 'Karnataka', 'KA': 'Karnataka',
  'ODISHA': 'Odisha', 'OR': 'Odisha', 'ORISSA': 'Odisha',
  'RAJASTHAN': 'Rajasthan', 'RJ': 'Rajasthan',
  'TAMIL NADU': 'Tamil Nadu', 'TN': 'Tamil Nadu',
  'KERALA': 'Kerala', 'KL': 'Kerala',
  'GUJARAT': 'Gujarat', 'GJ': 'Gujarat',
  'PUNJAB': 'Punjab', 'PB': 'Punjab',
  'HARYANA': 'Haryana', 'HR': 'Haryana',
  'CHHATTISGARH': 'Chhattisgarh', 'CG': 'Chhattisgarh',
  'DELHI': 'Delhi', 'DL': 'Delhi',
  'HIMACHAL PRADESH': 'Himachal Pradesh', 'HP': 'Himachal Pradesh',
  'ASSAM': 'Assam', 'AS': 'Assam',
  'JAMMU AND KASHMIR': 'Jammu & Kashmir', 'JK': 'Jammu & Kashmir',
  'JHARKHAND': 'Jharkhand', 'JH': 'Jharkhand',
  'UTTARAKHAND': 'Uttarakhand', 'UK': 'Uttarakhand',
  'TRIPURA': 'Tripura', 'TR': 'Tripura',
  'PUDUCHERRY': 'Puducherry', 'PY': 'Puducherry',
  'ARUNACHAL PRADESH': 'Arunachal Pradesh',
  'MANIPUR': 'Manipur', 'GOA': 'Goa',
  'NORTH EAST': 'North East',
  'ANDAMAN AND NICOBAR ISLANDS': 'Andaman & Nicobar',
  'CHANDIGARH': 'Chandigarh', 'SIKKIM': 'Sikkim',
  'MEGHALAYA': 'Meghalaya', 'NAGALAND': 'Nagaland',
  'MIZORAM': 'Mizoram', 'LAKSHADWEEP': 'Lakshadweep',
};

function canonicalState(raw) {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return STATE_ALIASES[upper] || null;
}

async function extractGroundTruth() {
  console.log('Connecting to CRM-Database...');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log('Connected.\n');

  // prefixMap: { "9826": { "Madhya Pradesh": 2591, "Chhattisgarh": 87, ... }, ... }
  const prefixMap = {};
  let processed = 0;
  let matched = 0;

  // Use aggregation with cursor to stream results in batches
  console.log('Running aggregation: leads_v2 -> piis join...');
  const cursor = db.collection('leads_v2').aggregate([
    { $match: { state: { $ne: '' }, pii_id: { $exists: true } } },
    { $lookup: { from: 'piis', localField: 'pii_id', foreignField: 'pii_id', as: 'pii' } },
    { $unwind: '$pii' },
    { $unwind: '$pii.phone_number' },
    { $project: { phone: '$pii.phone_number', state: 1, _id: 0 } }
  ], { allowDiskUse: true, batchSize: BATCH_SIZE });

  for await (const doc of cursor) {
    processed++;
    const phone = String(doc.phone || '').replace(/\D/g, '');
    const last10 = phone.length >= 10 ? phone.slice(-10) : phone;
    if (last10.length !== 10 || !/^[6-9]/.test(last10)) continue;

    const state = canonicalState(doc.state);
    if (!state) continue;

    const prefix = last10.slice(0, 4);
    if (!prefixMap[prefix]) prefixMap[prefix] = {};
    prefixMap[prefix][state] = (prefixMap[prefix][state] || 0) + 1;
    matched++;

    if (processed % 50000 === 0) {
      console.log(`  Processed ${processed} docs, ${matched} matched, ${Object.keys(prefixMap).length} prefixes...`);
    }
  }

  await client.close();
  console.log(`\nDone. Processed: ${processed}, Matched: ${matched}, Prefixes: ${Object.keys(prefixMap).length}\n`);
  return prefixMap;
}

function mergeWithTrai(groundTruth) {
  console.log('Loading TRAI base mapping...');
  const trai = JSON.parse(fs.readFileSync(TRAI_FILE, 'utf8'));
  console.log(`  TRAI prefixes: ${Object.keys(trai).length}`);
  console.log(`  Ground truth prefixes: ${Object.keys(groundTruth).length}\n`);

  const final = {};
  const allPrefixes = new Set([...Object.keys(trai), ...Object.keys(groundTruth)]);
  let fromGT = 0, fromTRAI = 0, conflicts = 0;

  for (const prefix of allPrefixes) {
    const gt = groundTruth[prefix];
    const base = trai[prefix];

    if (gt) {
      const total = Object.values(gt).reduce((a, b) => a + b, 0);
      // Sort states by count descending
      const sorted = Object.entries(gt).sort((a, b) => b[1] - a[1]);
      const topState = sorted[0][0];
      const topCount = sorted[0][1];
      const dominance = topCount / total;
      const sizeFactor = Math.min(1, total / 50);
      const confidence = Math.round(dominance * sizeFactor * 100) / 100;

      // Only trust ground truth if enough samples
      if (total >= 10) {
        const alternates = sorted.slice(1, 4)
          .filter(([, c]) => c / total >= 0.01)
          .map(([s, c]) => ({ state: s, share: Math.round(c / total * 100) / 100 }));

        final[prefix] = {
          state: topState,
          confidence,
          source: 'ground_truth',
          samples: total,
          dominance: Math.round(dominance * 100) / 100,
          operator: base ? base.operator : null,
        };
        if (alternates.length) final[prefix].alternates = alternates;

        if (base && base.state && canonicalState(base.state.toUpperCase()) !== topState) {
          conflicts++;
        }
        fromGT++;
      } else if (base) {
        // Not enough GT samples, use TRAI base
        final[prefix] = { ...base, source: 'trai_base', gt_samples: total };
        fromTRAI++;
      }
    } else if (base) {
      final[prefix] = { ...base };
      fromTRAI++;
    }
  }

  console.log('Merge stats:');
  console.log(`  From ground truth: ${fromGT}`);
  console.log(`  From TRAI base: ${fromTRAI}`);
  console.log(`  Total prefixes: ${Object.keys(final).length}`);
  console.log(`  TRAI vs GT conflicts: ${conflicts}\n`);

  // Confidence distribution
  const buckets = { high: 0, medium: 0, low: 0 };
  for (const v of Object.values(final)) {
    if (v.confidence >= 0.85) buckets.high++;
    else if (v.confidence >= 0.65) buckets.medium++;
    else buckets.low++;
  }
  console.log(`Confidence: High(>=0.85): ${buckets.high}, Medium(0.65-0.85): ${buckets.medium}, Low(<0.65): ${buckets.low}\n`);

  return final;
}

async function main() {
  console.log('=== Phone Prefix -> State Ground Truth Builder ===\n');
  const groundTruth = await extractGroundTruth();

  // Save raw ground truth
  const gtFile = path.join(__dirname, 'ground_truth_raw.json');
  fs.writeFileSync(gtFile, JSON.stringify(groundTruth, null, 2));
  console.log(`Saved raw ground truth: ${gtFile}\n`);

  const final = mergeWithTrai(groundTruth);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(final, null, 2));
  console.log(`Saved enhanced mapping: ${OUTPUT_FILE}`);
  console.log(`Total prefixes: ${Object.keys(final).length}`);

  // Show top 10 examples
  console.log('\n--- Sample entries ---');
  const entries = Object.entries(final).sort((a, b) => (b[1].samples || 0) - (a[1].samples || 0));
  for (const [prefix, data] of entries.slice(0, 10)) {
    console.log(`  ${prefix} -> ${data.state} (conf: ${data.confidence}, samples: ${data.samples || 0}, src: ${data.source})`);
  }
}

main().catch(console.error);
