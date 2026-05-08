# Spybot Migration Test Script
Write-Host "🚀 Spybot Migration Test Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Function to check service
function Test-Service {
    param (
        [string]$Url,
        [string]$ServiceName
    )

    Write-Host "Checking $ServiceName... " -NoNewline
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 10 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ OK" -ForegroundColor Green
            return $true
        }
    }
    catch {
        Write-Host "❌ FAILED" -ForegroundColor Red
        return $false
    }
}

# Test backend health
Write-Host "`n📊 Testing Backend Services:" -ForegroundColor Yellow
Test-Service "http://localhost:3001/health" "Backend Health"
Test-Service "http://localhost:3001/api/khanan/stats" "Khanan API"
Test-Service "http://localhost:3001/api/selenium/status" "Selenium API"

Write-Host "`n🎨 Testing Frontend:" -ForegroundColor Yellow
Test-Service "http://localhost:3000" "Frontend"

Write-Host "`n🐳 Testing Docker Services:" -ForegroundColor Yellow
# Check if containers are running
$containers = docker ps --format "{{.Names}}" 2>$null
if ($containers -match "spybot") {
    Write-Host "✅ Docker containers are running" -ForegroundColor Green
} else {
    Write-Host "⚠️  Docker containers not found" -ForegroundColor Yellow
}

Write-Host "`n📈 Testing Database Connection:" -ForegroundColor Yellow
# Test MongoDB connection
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/khanan/stats" -ErrorAction Stop
    if ($response.Content -match "totalRecords") {
        Write-Host "✅ Database connection OK" -ForegroundColor Green
    } else {
        Write-Host "❌ Database connection FAILED" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Database connection FAILED" -ForegroundColor Red
}

Write-Host "`n🔧 Testing Scraping Functionality:" -ForegroundColor Yellow
# Test scraper status
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/selenium/status" -ErrorAction Stop
    if ($response.Content -match "running") {
        Write-Host "✅ Scraper status OK" -ForegroundColor Green
    } else {
        Write-Host "❌ Scraper status FAILED" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Scraper status FAILED" -ForegroundColor Red
}

Write-Host "`n🎯 Migration Test Complete!" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host "If all checks are green, migration is successful! 🎉" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Test scraping: GET /api/selenium/by-date-range" -ForegroundColor White
Write-Host "2. Check data: GET /api/khanan/data" -ForegroundColor White
Write-Host "3. View dashboard: http://localhost:3000" -ForegroundColor White