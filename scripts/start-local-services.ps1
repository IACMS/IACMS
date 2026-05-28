# Start IACMS microservices locally (infra must be up: postgres:5433, redis:6379, kafka:9092)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/iacms?schema=public"
$env:KAFKA_BROKERS = "localhost:9092"
$env:REDIS_URL = "redis://localhost:6379"
$env:JWT_SECRET = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { "change-this-secret-key" }
$env:WORKFLOW_SERVICE_URL = "http://localhost:3004"

if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $k = $matches[1].Trim(); $v = $matches[2].Trim()
      if ($k -eq 'JWT_SECRET') { $env:JWT_SECRET = $v }
    }
  }
}

$services = @(
  @{ Name = "rbac"; Dir = "services/rbac-service"; Port = 3002 },
  @{ Name = "auth"; Dir = "services/auth-service"; Port = 3001 },
  @{ Name = "workflow"; Dir = "services/workflow-service"; Port = 3004 },
  @{ Name = "case"; Dir = "services/case-service"; Port = 3003 },
  @{ Name = "referral"; Dir = "services/referral-service"; Port = 3005 },
  @{ Name = "audit"; Dir = "services/audit-service"; Port = 3006 },
  @{ Name = "integration"; Dir = "services/integration-service"; Port = 3007 },
  @{ Name = "notification"; Dir = "services/notification-service"; Port = 3008 },
  @{ Name = "gateway"; Dir = "services/api-gateway"; Port = 3000 }
)

$logDir = Join-Path $Root ".run-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

foreach ($svc in $services) {
  $wd = Join-Path $Root $svc.Dir
  $logOut = Join-Path $logDir "$($svc.Name).out.log"
  $logErr = Join-Path $logDir "$($svc.Name).err.log"
  $env:PORT = "$($svc.Port)"
  $p = Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory $wd `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru -WindowStyle Hidden
  Write-Host "Started $($svc.Name) on :$($svc.Port) (PID $($p.Id))"
  if ($svc.Name -eq "workflow") { Start-Sleep -Seconds 1 }
}
Write-Host "Wait ~5s then hit http://localhost:3000/health"
