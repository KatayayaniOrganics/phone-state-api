# GCP Cloud Run Deployment Guide

## Prerequisites

1. Google Cloud account with billing enabled
2. `gcloud` CLI installed ✅ (already installed)
3. Docker installed (optional - Cloud Run can build from source)

## Step-by-Step Deployment

### Step 1: Authenticate

```bash
gcloud auth login
```

This will open browser for authentication.

### Step 2: Set Project

```bash
gcloud config set project micro-dealer
```

### Step 3: Enable Required APIs

```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com

# Enable Container Registry API (for Docker images)
gcloud services enable containerregistry.googleapis.com

# Enable Cloud Build API (for building from source)
gcloud services enable cloudbuild.googleapis.com
```

### Step 4: Deploy to Cloud Run

**Option A: Deploy from Source (Recommended - Easiest)**

```bash
cd C:\Users\Katyayani\Downloads\files

gcloud run deploy phone-state-api \
  --source . \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --timeout 60s \
  --project micro-dealer
```

**Option B: Build Docker Image First, Then Deploy**

```bash
# Set project ID
export PROJECT_ID=micro-dealer

# Build and push Docker image
gcloud builds submit --tag gcr.io/$PROJECT_ID/phone-state-api

# Deploy the image
gcloud run deploy phone-state-api \
  --image gcr.io/$PROJECT_ID/phone-state-api \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --project micro-dealer
```

### Step 5: Get Deployment URL

After successful deployment, you'll get a URL like:

```
https://phone-state-api-<random-hash>-as.a.run.app
```

### Step 6: Test Deployment

```bash
# Replace with your actual URL
export API_URL="https://phone-state-api-xxxxx-as.a.run.app"

# Health check
curl "$API_URL/health"

# Stats
curl "$API_URL/stats"

# Lookup test
curl "$API_URL/lookup?phone=9826123456"
```

## Configuration Details

| Setting | Value | Why |
|---------|-------|-----|
| Region | `asia-south1` (Mumbai) | Closest to India |
| Memory | 512Mi | Enough for 2800 prefixes in-memory |
| CPU | 1 | Sufficient for API lookups |
| Max instances | 10 | Auto-scale up to 10 containers |
| Timeout | 60s | API requests are fast (<1ms) |
| Authentication | Public | No auth required for lookups |

## Cost Estimate

Cloud Run pricing (Mumbai region):
- **First 2 million requests/month**: FREE
- **CPU time**: $0.00002400 per vCPU-second
- **Memory**: $0.00000250 per GiB-second
- **Network egress**: First 1GB free, then $0.12/GB

**Expected monthly cost for moderate usage (100K requests/month):**
- ~$0-5 USD (within free tier)

## Post-Deployment

### View Logs
```bash
gcloud run logs read phone-state-api --region asia-south1
```

### Update Service
```bash
gcloud run services update phone-state-api \
  --region asia-south1 \
  --memory 1Gi
```

### Delete Service
```bash
gcloud run services delete phone-state-api --region asia-south1
```

### Set Custom Domain (Optional)

```bash
gcloud run domain-mappings create \
  --service phone-state-api \
  --domain api.yourdomain.com \
  --region asia-south1
```

## Monitoring

### Dashboard
https://console.cloud.google.com/run/detail/asia-south1/phone-state-api

### Metrics to Monitor
- Request count
- Latency (p50, p95, p99)
- Error rate
- Memory usage
- CPU usage

## Troubleshooting

### Build Fails
```bash
# Check build logs
gcloud builds log <BUILD_ID>
```

### Service Not Starting
```bash
# Check service logs
gcloud run logs read phone-state-api --region asia-south1 --limit 50
```

### Port Issues
Cloud Run automatically sets `PORT` environment variable to 8080.
Our Dockerfile already handles this.

## Environment Variables (if needed)

```bash
gcloud run services update phone-state-api \
  --region asia-south1 \
  --set-env-vars "NODE_ENV=production"
```

## Manual Steps Summary

1. Run: `gcloud auth login`
2. Run: `gcloud services enable run.googleapis.com cloudbuild.googleapis.com`
3. Run the deploy command from Step 4
4. Copy the deployment URL
5. Test the endpoints

## Expected Output

```
Deploying from source...
Building using Dockerfile...
✓ Creating Cloud Build...
✓ Uploading sources...
✓ Building container...
✓ Pushing container to Container Registry...
✓ Deploying to Cloud Run...
Service [phone-state-api] revision [phone-state-api-00001-xyz] has been deployed
Service URL: https://phone-state-api-xxxxx-as.a.run.app
```
