#!/usr/bin/env bash
# ==============================================================================
# IELTS OS — Cloud Run Scale-to-Zero Deployment Script
# Deploys backend API to Google Cloud Run in asia-southeast1 (Singapore)
#
# Cost Guardrails:
# - min-instances=0: Pure Scale-to-Zero ($0 cost when idle)
# - max-instances=4: Hard cap to eliminate runaway billing
# - cpu-throttling: True Scale-to-Zero (no CPU billing outside active requests)
# - timeout=900: Up to 15m for large audio transcriptions & OCR
# ==============================================================================

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-ielts-os-api}"
REGION="${GCP_REGION:-asia-southeast1}"
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: No active GCP project found. Run 'gcloud config set project <PROJECT_ID>' or set GCP_PROJECT_ID."
  exit 1
fi

echo "Deploying ${SERVICE_NAME} to Google Cloud Run..."
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "  Config:  Scale-to-Zero (min=0, max=4, cpu=2, mem=2Gi, timeout=900s)"

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --source="." \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=4 \
  --cpu=2 \
  --memory=2Gi \
  --timeout=900 \
  --concurrency=40 \
  --cpu-throttling \
  --set-env-vars="ENABLE_GCP_VERTEX=1,GCP_VERTEX_LOCATION=${REGION},GCP_DAILY_REQUEST_CAP=800"

echo "Deployment completed successfully."
