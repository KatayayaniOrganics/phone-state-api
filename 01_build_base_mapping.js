/**
 * STEP 1: Build base prefix → state mapping
 * 
 * Source: hstsethi/in-mob-prefix (CC-BY-4.0)
 * Data sourced from Wikipedia + DoT + TRAI publications
 * 
 * Output: data/base_prefix_state.json
 *   {
 *     "9826": { "state": "Madhya Pradesh", "operator": "Airtel", "source": "trai_base", "confidence": 0.7 },
 *     ...
 *   }
 */

const fs = require('fs');
const path = require('path');

// Telecom circle code → State name (full)
// Note: Some circles span multiple states (BR=Bihar+Jharkhand, MP=MP+CG, NE=North-East states)
// We pick the dominant state. Adjust as per your business needs.
const CIRCLE_TO_STATE = {
  'AP': 'Andhra Pradesh',     // includes Telangana historically
  'AS': 'Assam',
  'BR': 'Bihar',              // also Jharkhand (BR circle covers both)
  'DL': 'Delhi',
  'GJ': 'Gujarat',
  'HP': 'Himachal Pradesh',
  'HR': 'Haryana',
  'JK': 'Jammu and Kashmir',
  'KA': 'Karnataka',
  'KL': 'Kerala',
  'MH': 'Maharashtra',        // (Mumbai metro merged into MH per DoT 2021)
  'MP': 'Madhya Pradesh',     // also Chhattisgarh
  'NE': 'North East',         // Arunachal, Manipur, Meghalaya, Mizoram, Nagaland, Tripura
  'OR': 'Odisha',
  'PB': 'Punjab',             // also Chandigarh
  'RJ': 'Rajasthan',
  'TN': 'Tamil Nadu',         // (Chennai metro merged into TN)
  'UE': 'Uttar Pradesh',      // UP East
  'UP': 'Uttar Pradesh',
  'UW': 'Uttar Pradesh',      // UP West
  'WB': 'West Bengal',        // (Kolkata metro merged into WB per DoT 2021)
};

// Operator code → readable name
const OPERATOR_MAP = {
  'AT': 'Airtel',
  'BPL': 'BPL Mobile',
  'BS': 'BSNL',
  'BSNL': 'BSNL',
  'I': 'Idea',
  'ID': 'Idea',
  'IDEA': 'Idea',
  'JIO': 'Reliance Jio',
  'RJ': 'Reliance Jio',
  'R': 'Reliance Communications',
  'RC': 'Reliance Communications',
  'V': 'Vodafone',
  'VI': 'Vodafone Idea',
  'VOD': 'Vodafone',
  'TT': 'Tata Teleservices',
  'T': 'Tata Teleservices',
  'A': 'Aircel',
  'AC': 'Aircel',
  'D': 'Dishnet/Aircel',
  'S': 'Spice',
  'U': 'Uninor/Telenor',
  'M': 'MTNL',
  'MTNL': 'MTNL',
};

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n').slice(1); // skip header
  return lines.map(line => {
    const [series, operator, circle] = line.split(',').map(s => (s || '').trim());
    return { series, operator, circle };
  });
}

function buildBaseMapping() {
  const dataDir = path.join(__dirname, '..', 'data');
  const sources = ['raw_6xxx.csv', 'raw_7xxx.csv', 'raw_8xxx.csv', 'raw_9xxx.csv'];

  const mapping = {};
  let totalRows = 0;
  let mappedRows = 0;
  let droppedRows = 0;

  for (const file of sources) {
    const rows = parseCSV(path.join(dataDir, file));
    for (const row of rows) {
      totalRows++;

      if (!row.series || !row.circle) {
        droppedRows++;
        continue;
      }
      // Skip series that begin with non-mobile starting digits (defensive)
      if (!/^[6-9]\d{3}$/.test(row.series)) {
        droppedRows++;
        continue;
      }

      const state = CIRCLE_TO_STATE[row.circle.toUpperCase()];
      if (!state) {
        droppedRows++;
        continue;
      }

      const operatorName = OPERATOR_MAP[row.operator?.toUpperCase()] || row.operator || 'Unknown';

      mapping[row.series] = {
        state,
        circle_code: row.circle,
        operator: operatorName,
        source: 'trai_base',
        confidence: 0.7, // pre-MNP allocation, ~70% accuracy in practice
      };
      mappedRows++;
    }
  }

  // Stats
  const stateCounts = {};
  Object.values(mapping).forEach(v => {
    stateCounts[v.state] = (stateCounts[v.state] || 0) + 1;
  });

  const outPath = path.join(dataDir, 'base_prefix_state.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));

  console.log('=== Base Mapping Build Complete ===');
  console.log(`Total rows processed: ${totalRows}`);
  console.log(`Successfully mapped:  ${mappedRows}`);
  console.log(`Dropped (no data):    ${droppedRows}`);
  console.log(`Unique prefixes:      ${Object.keys(mapping).length}`);
  console.log(`\nState distribution (top 10):`);
  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([s, c]) => console.log(`  ${s.padEnd(25)} ${c} prefixes`));
  console.log(`\n✅ Output: ${outPath}`);
}

buildBaseMapping();
