# Phone State Lookup API

🚀 Production-ready API for Indian mobile number to state mapping with 85%+ accuracy.

## 🌐 Live API

**Production URL**: https://phone-state-api-614840473250.asia-south1.run.app

**Example**:
```bash
https://phone-state-api-614840473250.asia-south1.run.app/lookup/9826123456?apikey=YOUR_KEY
```

## ⚡ Quick Start

```bash
# Install
npm install

# Start locally
npm start

# Deploy to GCP
gcloud run deploy phone-state-api --source .
```

## 📊 Features

| Feature | Value |
|---------|-------|
| **Total Prefixes** | 2,800 |
| **Verified Samples** | 937,277 |
| **Overall Accuracy** | 85.09% |
| **High Confidence Accuracy** | 94.1% |
| **Rate Limit** | Unlimited |
| **Latency** | <50ms (avg) |

## 🔑 API Usage

### Method 1: Path-based (Recommended)
```bash
curl "https://your-api.run.app/lookup/9826123456?apikey=YOUR_KEY"
```

### Method 2: Query parameter
```bash
curl "https://your-api.run.app/lookup?phone=9826123456&apikey=YOUR_KEY"
```

### Method 3: Header
```bash
curl -H "X-API-Key: YOUR_KEY" "https://your-api.run.app/lookup?phone=9826123456"
```

### Response Format
```json
{
  "phone": "9826123456",
  "matched_prefix": "9826",
  "state": "Madhya Pradesh",
  "confidence": 0.95,
  "source": "ground_truth",
  "samples": 2726,
  "operator": "Vodafone Idea",
  "alternates": [
    {"state": "Chhattisgarh", "share": 0.03}
  ]
}
```

## 📖 Documentation

- **[HOW_PREFIXES_WERE_BUILT.md](./HOW_PREFIXES_WERE_BUILT.md)** - Complete technical documentation of prefix generation process
- **[PRODUCTION_SECURITY.md](./PRODUCTION_SECURITY.md)** - Security implementation guide
- **[DEPLOY_GCP.md](./DEPLOY_GCP.md)** - GCP Cloud Run deployment guide

## 🏗️ Architecture

```
TRAI Base Data (1,709 prefixes)
        +
MongoDB Ground Truth (938K verified samples)
        ↓
Confidence Scoring Algorithm
        ↓
enhanced_prefix_state.json (2,800 prefixes)
        ↓
In-Memory HTTP API with API Key Auth
```

## 🎯 Accuracy by Confidence Level

| Confidence | Accuracy | Prefixes | Use Case |
|------------|----------|----------|----------|
| **High (≥0.85)** | **94.1%** | 1,628 | Production use |
| Medium (0.65-0.85) | 73.6% | 425 | Use with caution |
| Low (<0.65) | 54.2% | 747 | Not recommended |

## 🔒 Security

- ✅ API Key authentication (3 methods: path, query, header)
- ✅ No rate limiting (unlimited requests)
- ✅ Multiple API keys support
- ✅ Request logging
- ✅ CORS enabled

## ⚡ Performance

**Optimizations:**
- Fastify framework (10x faster than native HTTP)
- Response compression (gzip/deflate)
- 2 vCPUs + 1GB RAM on Cloud Run
- In-memory prefix mapping (O(1) lookup)
- Minimum 1 instance (no cold starts)
- 1000 concurrent requests per instance

**Benchmarks:**
- Single lookup: <50ms average
- Bulk 500 numbers: <200ms
- Throughput: 10,000+ req/sec

## 📁 Project Structure

```
phone-state-api/
├── phone_state_api_fast.js          # High-performance API (Fastify)
├── phone_state_api_secure.js        # Original API server
├── enhanced_prefix_state.json       # Production mapping (2,800 prefixes)
├── build_ground_truth.js            # Build pipeline
├── verify_system.js                 # Validation tool
├── Dockerfile                       # Cloud Run deployment
├── package.json                     # Dependencies
├── HOW_PREFIXES_WERE_BUILT.md      # Technical docs
└── README.md                        # This file
```

## 🚀 Deployment

### Local (PM2)
```bash
npm install -g pm2
pm2 start phone_state_api_secure.js --name phone-state-api
```

### Docker
```bash
docker build -t phone-state-api .
docker run -p 3001:8080 phone-state-api
```

### GCP Cloud Run
```bash
gcloud run deploy phone-state-api \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "API_KEY_1=your-key"
```

## 🔄 Rebuilding Mappings

```bash
# Set MongoDB connection
export MONGO_URI="mongodb+srv://..."

# Run build pipeline
node build_ground_truth.js

# Validate
node verify_system.js

# Redeploy
pm2 restart phone-state-api
```

## 💰 Cost (GCP Cloud Run)

- **Free**: First 2M requests/month
- **After**: $0.24 per million requests
- **Expected**: $0-5/month for moderate usage

## 📈 Monitoring

### View Logs
```bash
# Real-time
gcloud run services logs tail phone-state-api --region asia-south1

# Last 100
gcloud run services logs read phone-state-api --region asia-south1 --limit 100
```

### GCP Console
https://console.cloud.google.com/run/detail/asia-south1/phone-state-api

## 🧪 Testing

```bash
# Health check (no auth)
curl "https://your-api.run.app/health"

# Lookup test
curl "https://your-api.run.app/lookup/9826123456?apikey=YOUR_KEY"

# Stats
curl "https://your-api.run.app/stats?apikey=YOUR_KEY"

# Bulk (up to 500)
curl -X POST "https://your-api.run.app/bulk?apikey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phones":["9826123456","6202123456"]}'
```

## 🤝 Contributing

See [HOW_PREFIXES_WERE_BUILT.md](./HOW_PREFIXES_WERE_BUILT.md) for details on the data pipeline.

## 📄 License

MIT

## 🙋 Support

For issues or questions, contact: katyayani@example.com

---

**Built with**: Node.js, MongoDB, Google Cloud Run
**Data Sources**: TRAI + 938K verified customer records
**Accuracy**: 85%+ overall, 94%+ on high confidence
