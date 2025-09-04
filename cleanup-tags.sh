#!/bin/bash

# Excel Template Mapper - Image Tag Cleanup Script
# Deletes all image tags except those in v60-v70 range

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration from deploy-fresh.sh
REGISTRY_NAME="excelmapperacr20994"
REGISTRY_URL="${REGISTRY_NAME}.azurecr.io"
IMAGE_NAME="excel-template-mapper"

echo -e "${PURPLE}🧹 Excel Template Mapper - Tag Cleanup Script${NC}"
echo -e "${PURPLE}=============================================${NC}"
echo -e "${YELLOW}This script will delete ALL tags except v60-v70${NC}"
echo ""

# Step 1: Login to Azure Container Registry
echo -e "${BLUE}🔐 Step 1: Azure Container Registry Login${NC}"
if az acr login --name ${REGISTRY_NAME}; then
    echo -e "${GREEN}✅ Successfully logged in to ACR${NC}"
else
    echo -e "${RED}❌ Failed to login to ACR. Please check your Azure credentials.${NC}"
    exit 1
fi
echo ""

# Step 2: List all tags
echo -e "${BLUE}📋 Step 2: Fetching all image tags${NC}"
ALL_TAGS=$(az acr repository show-tags --name ${REGISTRY_NAME} --repository ${IMAGE_NAME} --output tsv 2>/dev/null || echo "")

if [ -z "$ALL_TAGS" ]; then
    echo -e "${YELLOW}⚠️  No tags found in repository${NC}"
    exit 0
fi

echo -e "${GREEN}Found the following tags:${NC}"
echo "$ALL_TAGS" | while read tag; do
    echo "  - $tag"
done
echo ""

# Step 3: Filter tags to delete (everything except v60-v70)
echo -e "${BLUE}🔍 Step 3: Identifying tags to delete${NC}"

TAGS_TO_DELETE=""
TAGS_TO_KEEP=""

while IFS= read -r tag; do
    # Check if tag matches v6X pattern where X is 0-9
    if [[ "$tag" =~ ^v6[0-9]$ ]]; then
        TAGS_TO_KEEP="$TAGS_TO_KEEP $tag"
    else
        TAGS_TO_DELETE="$TAGS_TO_DELETE $tag"
    fi
done <<< "$ALL_TAGS"

if [ -z "$TAGS_TO_DELETE" ]; then
    echo -e "${GREEN}✅ No tags to delete - all existing tags are in v60-v70 range${NC}"
    exit 0
fi

echo -e "${GREEN}Tags to keep (v60-v70):${NC}"
for tag in $TAGS_TO_KEEP; do
    echo "  ✅ $tag"
done

echo -e "${RED}Tags to delete:${NC}"
for tag in $TAGS_TO_DELETE; do
    echo "  ❌ $tag"
done
echo ""

# Step 4: Confirmation
echo -e "${YELLOW}⚠️  WARNING: This will permanently delete the tags listed above!${NC}"
echo -e "${YELLOW}Are you sure you want to continue? (yes/no):${NC}"
read -p "Confirmation: " CONFIRMATION

if [ "$CONFIRMATION" != "yes" ]; then
    echo -e "${BLUE}🚫 Operation cancelled by user${NC}"
    exit 0
fi
echo ""

# Step 5: Delete tags
echo -e "${BLUE}🗑️  Step 5: Deleting tags${NC}"

DELETED_COUNT=0
FAILED_COUNT=0

for tag in $TAGS_TO_DELETE; do
    echo -e "${YELLOW}Deleting tag: $tag${NC}"
    if az acr repository delete --name ${REGISTRY_NAME} --image ${IMAGE_NAME}:${tag} --yes >/dev/null 2>&1; then
        echo -e "${GREEN}  ✅ Successfully deleted $tag${NC}"
        DELETED_COUNT=$((DELETED_COUNT + 1))
    else
        echo -e "${RED}  ❌ Failed to delete $tag${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi
done
echo ""

# Step 6: Summary
echo -e "${BLUE}📊 Step 6: Cleanup Summary${NC}"
echo -e "${GREEN}🎉 CLEANUP COMPLETE!${NC}"
echo -e "${GREEN}==================${NC}"
echo ""
echo -e "${BLUE}Results:${NC}"
echo -e "  ✅ Successfully deleted: $DELETED_COUNT tags"
echo -e "  ❌ Failed to delete: $FAILED_COUNT tags"
echo -e "  🔒 Tags preserved (v60-v70): $(echo $TAGS_TO_KEEP | wc -w | tr -d ' ') tags"
echo ""

# Step 7: Verify remaining tags
echo -e "${BLUE}🔍 Step 7: Verifying remaining tags${NC}"
REMAINING_TAGS=$(az acr repository show-tags --name ${REGISTRY_NAME} --repository ${IMAGE_NAME} --output tsv 2>/dev/null || echo "")

if [ -n "$REMAINING_TAGS" ]; then
    echo -e "${GREEN}Remaining tags in registry:${NC}"
    echo "$REMAINING_TAGS" | while read tag; do
        echo "  - $tag"
    done
else
    echo -e "${YELLOW}⚠️  No tags remaining in registry${NC}"
fi
echo ""

echo -e "${PURPLE}✨ Tag cleanup completed!${NC}"