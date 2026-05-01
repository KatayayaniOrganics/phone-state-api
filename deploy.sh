#!/bin/bash

# GCP Cloud Run Deployment Script
# Run: bash deploy.sh

set -e

PROJECT_ID="micro-dealer"
SERVICE_NAME="phone-state-api"
REGION="asia-south1"

echo "🚀 Deploying Phone-State API to Google Cloud Run"
echo "================================================"
echo ""
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo ""

# Check if authenticated
echo "✓ Checking authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &>/dev/null; then
    echo "⚠️  Not authenticated. Running: gcloud auth login"
    gcloud auth login
fi

# Set project
echo "✓ Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "✓ Enabling required APIs..."
gcloud services enable run.googleapis.com --quiet
gcloud services enable cloudbuild.googleapis.com --quiet
gcloud services enable containerregistry.googleapis.com --quiet

# Deploy to Cloud Run
echo ""
echo "🔨 Building and deploying..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --timeout 60s \
  --project $PROJECT_ID

# Get service URL
echo ""
echo "✅ Deployment complete!"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")
echo ""
echo "🌐 Service URL: $SERVICE_URL"
echo ""
echo "Test endpoints:"
echo "  curl $SERVICE_URL/health"
echo "  curl $SERVICE_URL/stats"
echo "  curl \"$SERVICE_URL/lookup?phone=9826123456\""
