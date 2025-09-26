#!/usr/bin/env bash
set -euo pipefail

# --- deps ---
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

# --- fixed config ---
CID="ldVYl0SUXGNT91OgsQMQn1MJfc8i9wrwbtw54YemUY6Si7Wi"
SITE="${SITE:-IN}"
LANG="${LANG:-en}"
CUR="${CUR:-INR}"

# --- tokens ---
ACCESS="${ACCESS:-}"
if [[ -z "$ACCESS" ]]; then
  read -r -p "Enter Access Token (Bearer): " ACCESS
fi

# --- input ---
read -r -p "Enter MPN: " MPN
read -r -p "Optional Manufacturer ID (e.g., 296 for TI). Press Enter to skip: " MFR_ID || true

# --- helpers ---
api() {
  local url="$1"; shift
  curl -sS "$url" \
    -H "Authorization: Bearer $ACCESS" \
    -H "X-DIGIKEY-Client-Id: $CID" \
    -H "X-DIGIKEY-Locale-Site: $SITE" \
    -H "X-DIGIKEY-Locale-Language: $LANG" \
    -H "X-DIGIKEY-Locale-Currency: $CUR" \
    -H "Accept: application/json" "$@"
}
hr() { printf '%*s\n' "$(tput cols 2>/dev/null || echo 80)" '' | tr ' ' '-'; }

# --- 1) Validate MPN + packaging variants ---
if [[ -n "${MFR_ID:-}" ]]; then
  BODY=$(jq -n --arg k "$MPN" --argjson mid "$MFR_ID" '{Keywords:$k, RecordCount:10, Filters:{ManufacturerIds:[$mid]}}')
else
  BODY=$(jq -n --arg k "$MPN" '{Keywords:$k, RecordCount:10}')
fi

SEARCH_JSON=$(api "https://api.digikey.com/products/v4/search/keyword" -X POST -H "Content-Type: application/json" -d "$BODY")
VALID=$(echo "$SEARCH_JSON" | jq '((.ExactMatches|length)>0) or ((.Products|length)>0)')
if [[ "$VALID" != "true" ]]; then
  echo "MPN valid number?  NO (no matches)"; exit 0
fi

SUMMARY=$(
  echo "$SEARCH_JSON" | jq '{
    mpn: (.ExactMatches[0].ManufacturerProductNumber // .Products[0].ManufacturerProductNumber),
    manufacturer: (.ExactMatches[0].Manufacturer.Name // .Products[0].Manufacturer.Name),
    lifecycle: (.ExactMatches[0].ProductStatus.Status // .Products[0].ProductStatus.Status),
    endOfLife: (.ExactMatches[0].EndOfLife // .Products[0].EndOfLife // false),
    product_url: (.ExactMatches[0].ProductUrl // .Products[0].ProductUrl // ""),
    datasheet_url: (.ExactMatches[0].DatasheetUrl // .Products[0].DatasheetUrl // ""),
    variants: (
      (.ExactMatches[0].ProductVariations // .Products[0].ProductVariations // [])
      | map({
          dkpn: .DigiKeyProductNumber,
          package: .PackageType.Name,
          moq: (.MinimumOrderQuantity // 0),
          spq: (.StandardPackage // 0),
          qty_available: (.QuantityAvailableforPackageType // 0)
        })
    )
  }'
)

MPN_CANON=$(echo "$SUMMARY" | jq -r '.mpn')
MFR_NAME=$(echo "$SUMMARY" | jq -r '.manufacturer')
PRODUCT_URL=$(echo "$SUMMARY" | jq -r '.product_url')
DATASHEET_URL=$(echo "$SUMMARY" | jq -r '.datasheet_url')

DKPN=$(echo "$SUMMARY" | jq -r '
  .variants
  | (map(select(.package=="Cut Tape (CT)")) + .)
  | .[0].dkpn // empty
')
if [[ -z "$DKPN" || "$DKPN" == "null" ]]; then
  DKPN=$(echo "$SEARCH_JSON" | jq -r '.Products[0].ProductVariations[0].DigiKeyProductNumber // empty')
fi

echo; hr; echo "MPN VALIDATION"; hr
echo "MPN valid number?  YES"
echo "Canonical MPN     : $MPN_CANON"
echo "Manufacturer      : $MFR_NAME"
echo "Product URL       : ${PRODUCT_URL:-N/A}"
echo "Datasheet URL     : ${DATASHEET_URL:-N/A}"
echo "Chosen DKPN       : ${DKPN:-N/A}"

echo; hr; echo "PACKAGING VARIANCES (DKPN / Package / MOQ / SPQ / Qty Available)"; hr
VAR_COUNT=$(echo "$SUMMARY" | jq '.variants | length')
if [[ "$VAR_COUNT" -eq 0 ]]; then
  echo "- None"
else
  echo "$SUMMARY" \
  | jq -r '.variants[] | "\(.dkpn)\t\(.package)\t\(.moq)\t\(.spq)\t\(.qty_available)"' \
  | awk -F'\t' '{printf "- %s / %s / MOQ:%s / SPQ:%s / Qty:%s\n",$1,$2,$3,$4,$5}'
fi

# --- 2) ProductDetails: lifecycle + global stock (also has ProductUrl) ---
DETAILS_JSON=$(api "https://api.digikey.com/products/v4/search/$DKPN/productdetails")
EOL=$(echo "$DETAILS_JSON" | jq -r '.Product.EndOfLife // false')
DISC=$(echo "$DETAILS_JSON" | jq -r '.Product.Discontinued // false')
LIFE=$(echo "$DETAILS_JSON" | jq -r '.Product.ProductStatus.Status // "Unknown"')
QTY_GLOBAL=$(echo "$DETAILS_JSON" | jq -r '.Product.QuantityAvailable // 0')
LEAD_WKS=$(echo "$DETAILS_JSON" | jq -r '.Product.ManufacturerLeadWeeks // empty')
DETAIL_URL_PD=$(echo "$DETAILS_JSON" | jq -r '.Product.ProductUrl // empty')
[[ -n "$DETAIL_URL_PD" && "$PRODUCT_URL" == "" ]] && PRODUCT_URL="$DETAIL_URL_PD"

echo; hr; echo "PRODUCT LIFECYCLE & STOCK"; hr
echo "Product Lifecycle Validity: $LIFE"
echo "EOL?                      : $EOL"
echo "Discontinued?             : $DISC"
echo "Available stock (global)  : $QTY_GLOBAL"
[[ -n "$LEAD_WKS" ]] && echo "Manufacturer Lead (weeks)  : $LEAD_WKS"
[[ -n "$PRODUCT_URL" ]] && echo "Product URL (details)      : $PRODUCT_URL"

# --- 3) Pricing (INR) incl. MOQ/SPQ per package ---
PRICING_JSON=$(api "https://api.digikey.com/products/v4/search/$DKPN/pricing")
echo; hr; echo "PRICE / MOQ / SPQ (per package) – currency: $CUR"; hr
echo "$PRICING_JSON" | jq -r '
  .ProductPricings[0].ProductVariations[]? as $v
  | "• \($v.DigiKeyProductNumber) (\($v.PackageType.Name))  MOQ:\($v.MinimumOrderQuantity // 0)  SPQ:\($v.StandardPackage // 0)  Qty:\($v.QuantityAvailableforPackageType // 0)\n  Price breaks: " +
    ([$v.StandardPricing[]? | "\(.BreakQuantity)@\(.UnitPrice)"] | join(", "))
'

# --- 4) Alternates (with URLs from API) ---
SUBS=$(api "https://api.digikey.com/products/v4/search/$DKPN/substitutions")
SUB_CNT=$(echo "$SUBS" | jq '.ProductSubstitutesCount // 0')
RECS=$(api "https://api.digikey.com/products/v4/search/$DKPN/recommendedproducts")
REC_CNT=$(echo "$RECS" | jq '([.Recommendations[0].RecommendedProducts[]?] | length) // 0')

echo; hr; echo "ALTERNATES"; hr
echo "Are alternates available?  $([[ "$SUB_CNT" -gt 0 || "$REC_CNT" -gt 0 ]] && echo YES || echo NO)"
if [[ "$SUB_CNT" -gt 0 ]]; then
  echo "• Substitutions:"
  echo "$SUBS" | jq -r '.ProductSubstitutes[] | "- " + .ManufacturerProductNumber + " / " + .Manufacturer.Name + " / " + (.ProductUrl // "N/A")'
fi
if [[ "$REC_CNT" -gt 0 ]]; then
  echo "• Recommended (top 5):"
  echo "$RECS" | jq -r '.Recommendations[0].RecommendedProducts[:5][] |
    "- " + .ManufacturerProductNumber + " / " + .ManufacturerName + " / Qty:" + (.QuantityAvailable|tostring) + " / Price:" + (.UnitPrice|tostring) + " / " + (.ProductUrl // "N/A")'
fi

echo; hr; echo "DONE"
