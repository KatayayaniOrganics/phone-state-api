/**
 * STEP 3: Merge base TRAI mapping + your ground truth → final confidence-scored mapping
 *
 * Strategy:
 *   - For each prefix, look at ground-truth distribution (your real data)
 *   - If we have ≥10 samples for that prefix, trust your data over TRAI base
 *   - Otherwise fall back to TRAI base mapping
 *   - Compute confidence based on:
 *       (a) sample size for that prefix in your data
 *       (b) dominance of top state (e.g., 95% MP vs 5% MH = high confidence)
 *
 * Output: data/final_prefix_state.json
 *   {
 *     "9826": {
 *       "state": "Madhya Pradesh",
 *       "operator": "Airtel",
 *       "confidence": 0.94,
 *       "source": "ground_truth",
 *       "samples": 1278,
 *       "dominance": 0.97,
 *       "alternates": [{ "state": "Maharashtra", "share": 0.02 }]
 *     },
 *     ...
 *   }
 */

const fs = require('fs');
const path = require('path');

const MIN_SAMPLES_FOR_GROUND_TRUTH = 10;
const HIGH_CONFIDENCE_THRESHOLD = 50;

function buildFinalMapping() {
  const dataDir = path.join(__dirname, '..', 'data');

  const baseMapping = JSON.parse(fs.readFileSync(path.join(dataDir, 'base_prefix_state.json'), 'utf8'));
  const groundTruth = fs.existsSync(path.join(dataDir, 'ground_truth_mapping.json'))
    ? JSON.parse(fs.readFileSync(path.join(dataDir, 'ground_truth_mapping.json'), 'utf8'))
    : {};

  const final = {};
  let fromGroundTruth = 0;
  let fromBase = 0;
  let conflictsResolved = 0;

  // Union of all prefixes
  const allPrefixes = new Set([...Object.keys(baseMapping), ...Object.keys(groundTruth)]);

  for (const prefix of allPrefixes) {
    const gt = groundTruth[prefix];        // { "MP": 1234, "MH": 56, ... }
    const base = baseMapping[prefix];      // { state, operator, ... }

    if (gt) {
      const totalSamples = Object.values(gt).reduce((a, b) => a + b, 0);
      const sortedStates = Object.entries(gt).sort((a, b) => b[1] - a[1]);
      const [topState, topCount] = sortedStates[0];
      const dominance = topCount / totalSamples;

      if (totalSamples >= MIN_SAMPLES_FOR_GROUND_TRUTH) {
        // Confidence = dominance × sample-size factor
        const sizeFactor = Math.min(1, totalSamples / HIGH_CONFIDENCE_THRESHOLD);
        const confidence = Math.round(dominance * sizeFactor * 100) / 100;

        final[prefix] = {
          state: topState,
          operator: base?.operator || 'Unknown',
          confidence,
          source: 'ground_truth',
          samples: totalSamples,
          dominance: Math.round(dominance * 100) / 100,
          alternates: sortedStates.slice(1, 4).map(([s, c]) => ({
            state: s,
            share: Math.round((c / totalSamples) * 100) / 100,
          })),
        };

        // Did we override TRAI base?
        if (base && base.state !== topState) {
          conflictsResolved++;
          final[prefix].trai_base_state = base.state;
        }

        fromGroundTruth++;
        continue;
      }
    }

    // Fallback to TRAI base
    if (base) {
      final[prefix] = {
        state: base.state,
        operator: base.operator,
        confidence: base.confidence,         // 0.7
        source: 'trai_base',
        samples: gt ? Object.values(gt).reduce((a, b) => a + b, 0) : 0,
      };
      fromBase++;
    }
  }

  fs.writeFileSync(
    path.join(dataDir, 'final_prefix_state.json'),
    JSON.stringify(final, null, 2)
  );

  console.log('=== Final Mapping Build Complete ===');
  console.log(`Total prefixes:           ${Object.keys(final).length}`);
  console.log(`From ground truth:        ${fromGroundTruth}`);
  console.log(`From TRAI base:           ${fromBase}`);
  console.log(`Conflicts overridden:     ${conflictsResolved}`);

  // Confidence distribution
  const buckets = { high: 0, medium: 0, low: 0 };
  Object.values(final).forEach(v => {
    if (v.confidence >= 0.85) buckets.high++;
    else if (v.confidence >= 0.65) buckets.medium++;
    else buckets.low++;
  });
  console.log(`\nConfidence distribution:`);
  console.log(`  High   (≥0.85): ${buckets.high}`);
  console.log(`  Medium (0.65–0.85): ${buckets.medium}`);
  console.log(`  Low    (<0.65): ${buckets.low}`);

  console.log(`\n✅ Output: data/final_prefix_state.json`);
}

buildFinalMapping();
