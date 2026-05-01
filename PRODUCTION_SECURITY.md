# Production Security Guide

## Current Situation
Your API is deployed but has **403 Forbidden** because public access isn't enabled.

## Security Options (Best to Worst)

### ✅ Option 1: API Key Authentication (RECOMMENDED)

**Pros:**
- Simple to implement
- Works with any client (mobile, web, server)
- Easy to rotate keys
- Can track usage per key
- Rate limiting per key

**Setup:**

1. **Use secure API file:**
```bash
# Stop current PM2 service
pm2 stop phone-state-api

# Start secure version
pm2 start phone_state_api_secure.js --name phone-state-api-secure

# Set API keys via environment
pm2 restart phone-state-api-secure --update-env -- API_KEY_1="your-secret-key-here" API_KEY_2="another-key"
```

2. **For GCP Cloud Run:**
```bash
# Redeploy with secure version
gcloud run deploy phone-state-api \
  --source . \
  --region asia-south1 \
  --set-env-vars "API_KEY_1=your-production-key-12345,API_KEY_2=backup-key-67890" \
  --allow-unauthenticated \
  --project micro-dealer
```

3. **Usage:**
```bash
# With API key
curl -H "X-API-Key: your-secret-key-here" \
  "https://phone-state-api-614840473250.asia-south1.run.app/lookup?phone=9826123456"

# Without API key = 401 Unauthorized
curl "https://phone-state-api-614840473250.asia-south1.run.app/lookup?phone=9826123456"
# Response: {"error":"missing_api_key","message":"X-API-Key header required"}
```

**Features included:**
- ✅ API key validation
- ✅ Rate limiting (1000 req/hour per key)
- ✅ Multiple API keys support
- ✅ Public health check (no auth)
- ✅ Easy to add/revoke keys

---

### ✅ Option 2: Google Cloud IAM (For Cloud-to-Cloud)

**Best for:** When your backend services call this API

**Pros:**
- No API keys to manage
- Google handles authentication
- Service accounts
- Audit logs

**Setup:**

1. **Keep service private (NO allUsers)**
2. **Create Service Account:**
```bash
gcloud iam service-accounts create phone-state-api-client \
  --display-name "Phone State API Client" \
  --project micro-dealer
```

3. **Grant access:**
```bash
gcloud run services add-iam-policy-binding phone-state-api \
  --region asia-south1 \
  --member "serviceAccount:phone-state-api-client@micro-dealer.iam.gserviceaccount.com" \
  --role roles/run.invoker \
  --project micro-dealer
```

4. **Usage from your backend:**
```javascript
const { GoogleAuth } = require('google-auth-library');

async function callAPI() {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient('https://phone-state-api-614840473250.asia-south1.run.app');
  const response = await client.request({
    url: 'https://phone-state-api-614840473250.asia-south1.run.app/lookup?phone=9826123456'
  });
  console.log(response.data);
}
```

---

### ✅ Option 3: IP Whitelisting (Cloud Armor)

**Best for:** Fixed server IPs

**Setup via GCP Console:**
1. Go to: https://console.cloud.google.com/net-security/securitypolicies
2. Create security policy
3. Add rule: Allow only specific IPs
4. Attach to Cloud Run service

**Cost:** ~$0.75/policy/month + $0.01 per 10K requests

---

### ✅ Option 4: VPC Access (Private Network)

**Best for:** Internal services only

**Setup:**
- Deploy Cloud Run in VPC
- Only accessible from your VPC network
- No public internet access

---

### ⚠️ Option 5: Public with Rate Limiting Only

**Setup:**
```bash
# Enable public access
gcloud run services add-iam-policy-binding phone-state-api \
  --region asia-south1 \
  --member=allUsers \
  --role=roles/run.invoker \
  --project micro-dealer
```

**Add Cloud Armor rate limiting:**
- 100 requests/minute per IP
- Block after threshold

**Risk:** Anyone can use API (but limited)

---

## Recommended Setup for Your Use Case

### For Internal Use (Your Apps Only):
**Use Option 1 (API Keys)**

```bash
# Generate strong API keys
export API_KEY_PROD=$(openssl rand -hex 32)
export API_KEY_STAGING=$(openssl rand -hex 32)

echo "Production Key: $API_KEY_PROD"
echo "Staging Key: $API_KEY_STAGING"

# Deploy with keys
gcloud run deploy phone-state-api \
  --source . \
  --region asia-south1 \
  --set-env-vars "API_KEY_1=$API_KEY_PROD,API_KEY_2=$API_KEY_STAGING" \
  --allow-unauthenticated \
  --project micro-dealer
```

### For External Clients:
**Use Option 1 (API Keys) + Option 3 (IP Whitelist)**

Give each client:
1. Unique API key
2. Add their IP to whitelist

---

## Key Management Best Practices

### Where to Store API Keys:

**❌ Don't:**
- Hardcode in source code
- Commit to Git
- Share via email/Slack
- Use same key everywhere

**✅ Do:**
- Use environment variables
- Store in Google Secret Manager
- Rotate every 90 days
- Use different keys per environment
- Log key usage

### Google Secret Manager Setup:

```bash
# Create secret
echo -n "your-api-key-here" | gcloud secrets create phone-state-api-key --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding phone-state-api-key \
  --member "serviceAccount:614840473250-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor

# Use in Cloud Run
gcloud run deploy phone-state-api \
  --set-secrets "API_KEY_1=phone-state-api-key:latest"
```

---

## Monitoring & Alerts

### Track Unauthorized Access:

```bash
# Cloud Logging query
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.message=~'invalid_api_key'"
```

### Setup Alerts:
1. Go to: https://console.cloud.google.com/monitoring
2. Create alert: "401 errors > 100 in 5 min"
3. Notification: Email/SMS

---

## Cost Comparison

| Option | Setup Cost | Monthly Cost | Complexity |
|--------|-----------|--------------|------------|
| **API Keys** | Free | Free | Low ✅ |
| IAM | Free | Free | Medium |
| Cloud Armor | $0.75/policy | ~$1-10 | Medium |
| VPC Access | Free | ~$5-20 | High |

---

## What Should You Do NOW?

### Recommended Flow:

1. **Use API Key Authentication** (Option 1)
   - Fastest to implement
   - Works for all clients
   - Free

2. **Add Rate Limiting** (already included in secure version)

3. **Monitor Usage** (Cloud Run metrics)

4. **Later:** Add IP whitelisting if needed

---

## Quick Deploy Secure Version

```bash
# Stop current deployment
pm2 stop phone-state-api

# Start secure version locally
API_KEY_1="your-secret-key" pm2 start phone_state_api_secure.js --name phone-state-api-secure

# Or deploy to Cloud Run
gcloud run deploy phone-state-api \
  --source . \
  --region asia-south1 \
  --set-env-vars "API_KEY_1=your-production-key-xyz" \
  --allow-unauthenticated \
  --max-instances 10 \
  --project micro-dealer
```

**Note:** Even with `--allow-unauthenticated`, the API code itself checks for API key!

---

## Decision Tree

```
Do you control all clients?
├─ YES → API Keys (Option 1)
│  └─ Need extra security? → Add IP Whitelist (Option 3)
│
└─ NO (Public API)
   ├─ Free tier users → API Keys + Rate Limiting
   └─ Paid users → API Keys + Higher rate limits
```

**Your case: Internal use → API Keys kaam kar jayegi!**
