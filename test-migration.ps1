# Vahan360 migration / local smoke helper (manual — adjust localhost port if BACKEND_PORT differs).
Write-Host '🚀 Vahan360 smoke script' -ForegroundColor Cyan
Write-Host '================================' -ForegroundColor Cyan

function Test-Service {
  param (
    [string]$Url,
    [string]$ServiceName
  )

  Write-Host "Checking $ServiceName... " -NoNewline
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 10 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
      Write-Host '✅ OK' -ForegroundColor Green
      return $true
    }
  }
  catch {
    Write-Host '❌ FAILED' -ForegroundColor Red
    return $false
  }
}

function Test-ScrapeJobsRouteReachable {
  Write-Host -NoNewline 'Checking POST /api/v1/scrape-jobs (401/400 = OK)... '
  try {
    $response = Invoke-WebRequest `
      -Uri 'http://localhost:3001/api/v1/scrape-jobs' `
      -Method POST `
      -Body '{}' `
      -ContentType 'application/json' `
      -TimeoutSec 10 `
      -ErrorAction Stop
    if ($response.StatusCode -eq 401 -or $response.StatusCode -eq 400) {
      Write-Host '✅ OK' -ForegroundColor Green
      return $true
    }
    Write-Host "❌ UNEXPECTED $($response.StatusCode)" -ForegroundColor Red
    return $false
  }
  catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $code = [int]$resp.StatusCode
      if ($code -eq 401 -or $code -eq 400) {
        Write-Host '✅ OK' -ForegroundColor Green
        return $true
      }
    }
    Write-Host '❌ FAILED' -ForegroundColor Red
    return $false
  }
}

Write-Host "`n📊 Testing backend:" -ForegroundColor Yellow
Test-Service 'http://localhost:3001/health' 'Backend /health'
Test-Service 'http://localhost:3001/api/khanan/stats' 'Khanan API'

Write-Host "`n📦 Async scrape pipeline (expects 401 without credentials):" -ForegroundColor Yellow
Test-ScrapeJobsRouteReachable

Write-Host "`n🎨 Testing frontend:" -ForegroundColor Yellow
Test-Service 'http://localhost:3000' 'Frontend'

Write-Host "`n🐳 Docker (optional):" -ForegroundColor Yellow
$containers = docker ps --format '{{.Names}}' 2>$null
if ($containers -match 'vahan360|spybot') {
  Write-Host '✅ Containers look present' -ForegroundColor Green
} else {
  Write-Host '⚠️  Expected stack containers not found' -ForegroundColor Yellow
}

Write-Host "`n🎯 Smoke pass complete.`nLogin (cookie session), then POST /api/v1/scrape-jobs with credentials.`nOptional: AUTH_ALLOW_BEARER=true on API for Bearer scripts.`nDashboard: http://localhost:3000" -ForegroundColor Cyan
