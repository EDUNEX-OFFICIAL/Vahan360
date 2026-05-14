#!/bin/bash

echo "🚀 Vahan360 smoke script"
echo "================================"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_service() {
  local url=$1
  local service_name=$2

  echo -n "Checking $service_name... "
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" || echo "000")
  if [[ "$code" == "200" ]]; then
    echo -e "${GREEN}✅ OK${NC}"
    return 0
  fi
  echo -e "${RED}❌ FAILED (HTTP $code)${NC}"
  return 1
}

echo ""
echo -e "${YELLOW}📊 Testing backend:${NC}"
check_service "http://localhost:3001/health" "Backend /health"
check_service "http://localhost:3001/api/khanan/stats" "Khanan API"

echo ""
echo -e "${YELLOW}📦 Async scrape pipeline (expects 401 without credentials):${NC}"
echo -n "Checking POST /api/v1/scrape-jobs... "
scode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  'http://localhost:3001/api/v1/scrape-jobs' || echo "000")
if [[ "$scode" == "401" || "$scode" == "400" ]]; then
  echo -e "${GREEN}✅ OK (${scode})${NC}"
else
  echo -e "${RED}❌ UNEXPECTED (${scode})${NC}"
fi

echo ""
echo -e "${YELLOW}🎨 Testing frontend:${NC}"
check_service "http://localhost:3000" "Frontend"

echo ""
echo -e "${YELLOW}🐳 Docker (optional):${NC}"
if docker ps 2>/dev/null | grep -Eq 'vahan360|spybot'; then
  echo -e "${GREEN}✅ Containers look present${NC}"
else
  echo -e "${YELLOW}⚠️  Expected stack containers not found${NC}"
fi

echo ""
echo "🎯 Smoke pass complete."
echo "Next: login in the web app (httpOnly cookies), then POST /api/v1/scrape-jobs with credentials."
echo "Optional CLI-only: set AUTH_ALLOW_BEARER=true on the API to allow Authorization: Bearer."
