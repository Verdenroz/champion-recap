#!/bin/bash
#
# Upload champion GPT-SoVITS models to S3 for ECS voice generator
#
# Uploads all .pth/.ckpt files from champion-models/ to s3://champion-recap-models/
# Format: {championId}.pth → {championId}/{championId}_sovits.pth
#         {championId}.ckpt → {championId}/{championId}_gpt.ckpt
#

set -e

BUCKET="champion-recap-models"
REGION="us-east-1"
MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/champion-models"

echo "Uploading champion models to s3://${BUCKET}/"
echo ""

cd "$MODELS_DIR"

for pth_file in *.pth; do
    [ -f "$pth_file" ] || continue

    champion=$(basename "$pth_file" .pth)
    ckpt_file="${champion}.ckpt"

    echo "📤 $champion"

    # Upload .pth as sovits model
    aws s3 cp "$pth_file" "s3://${BUCKET}/${champion}/${champion}_sovits.pth" \
        --region "$REGION"

    # Upload .ckpt as gpt model (if exists)
    if [ -f "$ckpt_file" ]; then
        aws s3 cp "$ckpt_file" "s3://${BUCKET}/${champion}/${champion}_gpt.ckpt" \
            --region "$REGION"
    fi
done

echo ""
echo "✅ Upload complete"
