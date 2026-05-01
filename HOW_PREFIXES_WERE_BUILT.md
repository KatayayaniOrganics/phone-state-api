# How Phone Prefix Mappings Were Built

Complete technical documentation of the phone prefix → state mapping generation process.

---

## Table of Contents
1. [Overview](#overview)
2. [Data Sources](#data-sources)
3. [Step-by-Step Process](#step-by-step-process)
4. [Prefix Generation Logic](#prefix-generation-logic)
5. [Quality Metrics](#quality-metrics)
6. [File Structure](#file-structure)

---

## Overview

We built a comprehensive phone number prefix (4-digit) to Indian state mapping using:
- **TRAI/DoT official allocation data** (baseline)
- **938K verified phone-state pairs** from CRM database (ground truth)
- **Statistical confidence scoring** based on sample size and dominance

### Final Output:
- **2,800 unique prefixes** mapped to states
- **85% overall accuracy**, **94% on high-confidence predictions**
- **937,277 verified samples** used for training

---

## Data Sources

### 1. TRAI Base Data (Government Source)
- **Source**: Telecom Regulatory Authority of India (TRAI)
- **Data**: Original number series allocation to operators and circles
- **Format**: CSV files with prefix, operator code, circle code
- **Coverage**: 1,709 4-digit prefixes
- **Limitation**: Pre-MNP (Mobile Number Portability), not updated for ported numbers

### 2. MongoDB Ground Truth (Real Customer Data)
- **Source**: CRM-Database (Katyayani Organics customer data)
- **Collections Used**:
  - `piis` - 984K records with phone numbers
  - `leads_v2` - 977K records with phone + state
- **Data Quality**: KYC-verified customer information
- **Advantage**: Reflects real-world state distribution including MNP

---

## Step-by-Step Process

### Phase 1: TRAI Base Mapping (Not Used in Production)

**Script**: `01_build_base_mapping.js` (Original prototype)

**Input**: CSV files with TRAI allocations
- `raw_6xxx.csv`
- `raw_7xxx.csv`
- `raw_8xxx.csv`
- `raw_9xxx.csv`

**Process**:
```javascript
1. Parse CSV: prefix, operator_code, circle_code
2. Map circle_code → state (26 circles to states)
3. Map operator_code → readable name (Airtel, Jio, etc.)
4. Set baseline confidence: 0.7 (pre-MNP allocation)
```

**Output**: `final_prefix_state.json` (1,709 prefixes)

**Why Not Used**:
- Doesn't account for MNP
- No real-world verification
- Lower accuracy (70%)

---

### Phase 2: MongoDB Ground Truth Extraction

**Script**: `build_ground_truth.js` (Production version)

**Input**:
- MongoDB connection: `CRM-Database`
- Collections: `leads_v2` + `piis`

**Process**:

#### Step 2.1: Data Extraction
```javascript
// MongoDB aggregation pipeline
db.leads_v2.aggregate([
  // Filter: only leads with state
  { $match: { state: { $ne: "" }, pii_id: { $exists: true } } },

  // Join with piis to get phone numbers
  { $lookup: {
      from: "piis",
      localField: "pii_id",
      foreignField: "pii_id",
      as: "pii"
  }},

  // Unwind arrays
  { $unwind: "$pii" },
  { $unwind: "$pii.phone_number" },

  // Extract phone + state
  { $project: {
      phone: "$pii.phone_number",
      state: 1
  }}
])
```

**Result**: 938,852 verified phone-state pairs

#### Step 2.2: Phone Normalization
```javascript
function normalizePhone(raw) {
  // Remove non-digits
  const digits = raw.replace(/\D/g, '');

  // Get last 10 digits (handles +91, 0 prefix)
  const last10 = digits.slice(-10);

  // Validate: must start with 6-9
  if (!/^[6-9]/.test(last10)) return null;

  return last10;
}
```

**Examples**:
- `+91 9826 123456` → `9826123456`
- `09893-123456` → `9893123456`
- `918839782589` → `8839782589`

#### Step 2.3: Prefix Extraction
```javascript
// Extract 4-digit prefix
const prefix = normalizedPhone.slice(0, 4);
// e.g., "9826123456" → "9826"
```

#### Step 2.4: State Normalization
```javascript
// Handle 30+ state name variations
const STATE_ALIASES = {
  'MADHYA PRADESH': 'Madhya Pradesh',
  'MP': 'Madhya Pradesh',
  'M.P.': 'Madhya Pradesh',
  'UTTAR PRADESH': 'Uttar Pradesh',
  'UP': 'Uttar Pradesh',
  // ... 30+ mappings
}

function canonicalState(raw) {
  return STATE_ALIASES[raw.toUpperCase()] || raw;
}
```

#### Step 2.5: Frequency Aggregation
```javascript
// Build prefix → {state: count} map
const prefixMap = {};

for (const {phone, state} of verifiedData) {
  const prefix = phone.slice(0, 4);

  if (!prefixMap[prefix]) prefixMap[prefix] = {};
  prefixMap[prefix][state] = (prefixMap[prefix][state] || 0) + 1;
}

// Example result:
// "9826": {
//   "Madhya Pradesh": 2591,
//   "Chhattisgarh": 87,
//   "Maharashtra": 3,
//   "Uttar Pradesh": 18,
//   ...
// }
```

**Output**: `ground_truth_raw.json` (3,390 prefixes with frequency data)

---

### Phase 3: Merge & Confidence Scoring

**Script**: `build_ground_truth.js` (mergeWithTrai function)

**Inputs**:
- `final_prefix_state.json` (TRAI base - 1,709 prefixes)
- `ground_truth_raw.json` (MongoDB data - 3,390 prefixes)

**Process**:

#### Step 3.1: Decision Logic
```javascript
for (const prefix of allPrefixes) {
  const groundTruth = mongoData[prefix];
  const traiBase = traiData[prefix];

  if (groundTruth && totalSamples >= 10) {
    // Use ground truth (real data)
    useGroundTruth(prefix, groundTruth);
  } else if (traiBase) {
    // Fallback to TRAI base
    useTRAI(prefix, traiBase);
  }
}
```

**Minimum Sample Threshold**: 10 samples
- Less than 10 samples → use TRAI base (if available)
- 10+ samples → trust ground truth

#### Step 3.2: Confidence Calculation

**Formula**:
```javascript
confidence = dominance × sampleSizeFactor

where:
  dominance = topStateCount / totalSamples
  sampleSizeFactor = min(1, totalSamples / 50)
```

**Example Calculation**:

**Prefix 9826** (Madhya Pradesh):
```javascript
Total samples: 2726
Top state: Madhya Pradesh (2591 samples)
Other states: Chhattisgarh (87), Others (48)

dominance = 2591 / 2726 = 0.95
sampleSizeFactor = min(1, 2726 / 50) = 1.0

confidence = 0.95 × 1.0 = 0.95 (High confidence!)
```

**Prefix 9000** (Ambiguous - Telangana vs Andhra):
```javascript
Total samples: 2403
Telangana: 1296 (54%)
Andhra Pradesh: 1061 (44%)

dominance = 1296 / 2403 = 0.54
sampleSizeFactor = 1.0

confidence = 0.54 × 1.0 = 0.54 (Low - state split in 2014)
```

#### Step 3.3: Alternate States
```javascript
// Track significant minorities (>1% share)
const alternates = sortedStates
  .slice(1, 4)  // Top 3 alternates
  .filter(([state, count]) => count / total >= 0.01)
  .map(([state, count]) => ({
    state: state,
    share: round(count / total, 2)
  }));
```

**Example**:
```json
{
  "9826": {
    "state": "Madhya Pradesh",
    "confidence": 0.95,
    "alternates": [
      {"state": "Chhattisgarh", "share": 0.03}
    ]
  }
}
```

**Output**: `enhanced_prefix_state.json` (2,800 prefixes with confidence)

---

## Prefix Generation Logic

### Complete Pipeline Visualization

```
┌─────────────────────────────────────────────────────────────┐
│ INPUT DATA                                                   │
├─────────────────────────────────────────────────────────────┤
│ MongoDB: 977K leads × piis (phone + state pairs)            │
│ TRAI CSV: 1,709 prefix allocations                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: EXTRACT & NORMALIZE                                 │
├─────────────────────────────────────────────────────────────┤
│ • Join leads_v2 ← piis (via pii_id)                         │
│ • Normalize phones: +91/0 removal, last 10 digits           │
│ • Validate: must start with 6-9                             │
│ • Normalize states: 30+ aliases → canonical names           │
│ Result: 938,852 clean phone-state pairs                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: AGGREGATE BY PREFIX                                 │
├─────────────────────────────────────────────────────────────┤
│ • Extract 4-digit prefix from each phone                    │
│ • Group by prefix → count states                            │
│ • Build frequency distribution                              │
│                                                              │
│ Example:                                                     │
│   9826: {                                                    │
│     "Madhya Pradesh": 2591,                                 │
│     "Chhattisgarh": 87,                                     │
│     "Uttar Pradesh": 18                                     │
│   }                                                          │
│                                                              │
│ Result: 3,390 prefix → state distributions                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: MERGE WITH TRAI BASE                                │
├─────────────────────────────────────────────────────────────┤
│ FOR each prefix:                                             │
│   IF ground_truth_samples >= 10:                            │
│     source = "ground_truth"                                 │
│     state = top_state_from_distribution                     │
│   ELSE IF trai_base_exists:                                 │
│     source = "trai_base"                                    │
│     state = trai_allocated_state                            │
│                                                              │
│ Result: 2,800 prefixes (kept only high-quality ones)        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: CALCULATE CONFIDENCE                                │
├─────────────────────────────────────────────────────────────┤
│ confidence = dominance × sample_size_factor                 │
│                                                              │
│ where:                                                       │
│   dominance = top_state_count / total_count                 │
│   sample_size_factor = min(1, total_count / 50)            │
│                                                              │
│ Confidence Buckets:                                          │
│   High (≥0.85):   1,628 prefixes → 94% accuracy            │
│   Medium (0.65-0.85): 425 prefixes → 74% accuracy          │
│   Low (<0.65):    747 prefixes → 54% accuracy              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ FINAL OUTPUT: enhanced_prefix_state.json                     │
├─────────────────────────────────────────────────────────────┤
│ {                                                            │
│   "9826": {                                                  │
│     "state": "Madhya Pradesh",                              │
│     "confidence": 0.95,                                     │
│     "source": "ground_truth",                               │
│     "samples": 2726,                                        │
│     "dominance": 0.95,                                      │
│     "operator": "Vodafone Idea",                            │
│     "alternates": [                                         │
│       {"state": "Chhattisgarh", "share": 0.03}             │
│     ]                                                        │
│   },                                                         │
│   ... (2,800 total prefixes)                                │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Quality Metrics

### Validation Results (2,000 Random Samples)

| Metric | Value |
|--------|-------|
| **Overall Accuracy** | 85.09% |
| **High Confidence (≥0.85)** | 94.1% accuracy |
| **Medium Confidence** | 73.6% accuracy |
| **Low Confidence** | 54.2% accuracy |

### Per-State Accuracy (Top States)

| State | Accuracy | Sample Size |
|-------|----------|-------------|
| West Bengal | 96.9% | 129 |
| Maharashtra | 96.0% | 199 |
| Tamil Nadu | 95.5% | 66 |
| Bihar | 94.4% | 143 |
| Uttar Pradesh | 93.7% | 317 |
| Madhya Pradesh | 93.5% | 293 |
| Gujarat | 93.0% | 43 |
| Rajasthan | 91.5% | 94 |

### Known Challenges

**Telangana vs Andhra Pradesh** (46.5% / 65.7% accuracy):
- States split in 2014
- Same number series allocated
- Impossible to distinguish without external data

**Chhattisgarh vs Madhya Pradesh**:
- CG split from MP in 2000
- Shared number pools
- Lower accuracy on CG detection

**Solution**: Confidence scores help identify ambiguous cases!

---

## File Structure

### Production Files

```
enhanced_prefix_state.json    (875 KB) ← MAIN PRODUCTION FILE
  ├─ 2,800 prefixes
  ├─ Confidence scores
  ├─ Source indicators
  ├─ Sample counts
  └─ Alternate states

phone_state_api_secure.js     (6.2 KB)
  └─ Loads enhanced_prefix_state.json at startup
```

### Intermediate Files (Not in Production)

```
final_prefix_state.json       (234 KB)
  └─ TRAI-only base (1,709 prefixes, confidence 0.7)

ground_truth_raw.json         (551 KB)
  └─ Raw frequency distributions (3,390 prefixes)
```

### Build Scripts

```
build_ground_truth.js         (Production builder)
  ├─ extractGroundTruth()  → MongoDB extraction
  ├─ mergeWithTrai()       → Merge + scoring
  └─ Output: enhanced_prefix_state.json

verify_system.js              (Validation tool)
  └─ Tests API vs real DB data
```

---

## Key Design Decisions

### 1. Why 4-Digit Prefixes (Not 5)?

**Tested Both**:
- 4-digit: Broader coverage, higher sample sizes
- 5-digit: More specific, but many prefixes had <10 samples

**Decision**: Use 4-digit as primary, fallback to 5-digit in lookup
```javascript
// Lookup logic
const p5 = phone.slice(0, 5);
const p4 = phone.slice(0, 4);
const match = mapping[p5] || mapping[p4];  // Try 5, fallback to 4
```

### 2. Why Minimum 10 Samples?

**Tested Thresholds**: 5, 10, 20, 50

| Threshold | Prefixes | Avg Confidence | Accuracy |
|-----------|----------|----------------|----------|
| 5 | 3,100 | 0.68 | 79% |
| **10** | **2,800** | **0.76** | **85%** ✅ |
| 20 | 2,400 | 0.81 | 87% |
| 50 | 1,900 | 0.86 | 89% |

**Decision**: 10 samples balances coverage (2,800 prefixes) with quality (85% accuracy)

### 3. Why Confidence = Dominance × SampleSize?

**Rationale**:
- **Dominance**: How clear the winner is (95% vs 54%)
- **Sample Size**: How much data we have (10 samples vs 2,000)

**Formula Tuning**:
```javascript
// Tested different sample size curves:
min(1, samples / 25)   // Too aggressive (hits 1.0 at 25 samples)
min(1, samples / 100)  // Too conservative (needs 100 for full weight)
min(1, samples / 50)   // ✅ Sweet spot (full weight at 50 samples)
```

### 4. Why Keep TRAI Base as Fallback?

**Coverage Gaps**:
- MongoDB only has customer data from certain regions
- Some prefixes have 0 samples in our DB
- TRAI base provides nationwide coverage

**Hybrid Approach**:
- 2,773 prefixes from ground truth (99%)
- 27 prefixes from TRAI base (1%)
- Total: 2,800 prefixes

---

## Reproducing the Build

### Prerequisites

```bash
# 1. MongoDB access
export MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/CRM-Database"

# 2. Node.js 18+
node --version  # Should be 18+

# 3. Install dependencies
npm install
```

### Run Build Pipeline

```bash
# Extract ground truth + merge + score
node build_ground_truth.js

# Output:
# → ground_truth_raw.json (raw frequencies)
# → enhanced_prefix_state.json (final mapping)
```

### Validate Results

```bash
# Test against live DB
node verify_system.js

# Expected output:
# ✓ Accuracy: 85%+
# ✓ High confidence: 94%+
```

### Deploy

```bash
# Local
pm2 start phone_state_api_secure.js

# GCP Cloud Run
gcloud run deploy phone-state-api --source .
```

---

## Future Improvements

1. **5-Digit Prefix Support**
   - Add secondary 5-digit mapping for high-traffic prefixes
   - Fallback chain: 5-digit → 4-digit → TRAI base

2. **Periodic Retraining**
   - Run `build_ground_truth.js` monthly
   - Auto-deploy updated mappings
   - Track accuracy drift over time

3. **MNP Detection**
   - Flag low-confidence predictions as "likely ported"
   - Add `mnp_risk` score based on confidence

4. **Operator Data Enhancement**
   - Current operator data from TRAI (static)
   - Could extract operator from MongoDB too

5. **Regional Variations**
   - Some prefixes used differently in rural vs urban
   - Could add geographic sub-region detection

---

## Credits

**Data Sources**:
- TRAI (Telecom Regulatory Authority of India)
- Katyayani Organics CRM Database

**Built by**: Claude + Katyayani Team
**Date**: April-May 2026
**Version**: 2.0.0
