#!/bin/bash

echo "🚀 Spybot Migration Test Script"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check service
check_service() {
    local url=$1
    local service_name=$2

    echo -n "Checking $service_name... "
    if curl -s --max-time 10 "$url" > /dev/null; then
        echo -e "${GREEN}✅ OK${NC}"
        return 0
    else
        echo -e "${RED}❌ FAILED${NC}"
        return 1
    fi
}

# Test backend health
echo "📊 Testing Backend Services:"
check_service "http://localhost:3001/health" "Backend Health"
check_service "http://localhost:3001/api/khanan/stats" "Khanan API"
check_service "http://localhost:3001/api/selenium/status" "Selenium API"

echo ""
echo "🎨 Testing Frontend:"
check_service "http://localhost:3000" "Frontend"

echo ""
echo "🐳 Testing Docker Services:"
# Check if containers are running
if docker ps | grep -q spybot; then
    echo -e "${GREEN}✅ Docker containers are running${NC}"
else
    echo -e "${YELLOW}⚠️  Docker containers not found${NC}"
fi

echo ""
echo "📈 Testing Database Connection:"
# Test MongoDB connection
if curl -s "http://localhost:3001/api/khanan/stats" | grep -q "totalRecords"; then
    echo -e "${GREEN}✅ Database connection OK${NC}"
else
    echo -e "${RED}❌ Database connection FAILED${NC}"
fi

echo ""
echo "🔧 Testing Scraping Functionality:"
# Test scraper status
if curl -s "http://localhost:3001/api/selenium/status" | grep -q "running"; then
    echo -e "${GREEN}✅ Scraper status OK${NC}"
else
    echo -e "${RED}❌ Scraper status FAILED${NC}"
fi

echo ""
echo "🎯 Migration Test Complete!"
echo "==========================="
echo "If all checks are green, migration is successful! 🎉"
echo ""
echo "Next steps:"
echo "1. Test scraping: GET /api/selenium/by-date-range"
echo "2. Check data: GET /api/khanan/data"
echo "3. View dashboard: http://localhost:3000"