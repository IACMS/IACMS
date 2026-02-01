# IACMS Comprehensive Test Script
# Tests all Day 1 and Day 2 implementations

Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "    IACMS COMPREHENSIVE TEST - Day 1 & Day 2" -ForegroundColor Cyan
Write-Host "="*60 + "`n" -ForegroundColor Cyan

$passed = 0
$failed = 0

function Test-Result($name, $success, $details = "") {
    if ($success) {
        Write-Host "[PASS] $name" -ForegroundColor Green
        if ($details) { Write-Host "       $details" -ForegroundColor Gray }
        $script:passed++
    } else {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        if ($details) { Write-Host "       $details" -ForegroundColor Yellow }
        $script:failed++
    }
}

# ========================================
# 1. INFRASTRUCTURE TESTS
# ========================================
Write-Host "`n--- 1. INFRASTRUCTURE ---" -ForegroundColor Yellow

# Check Docker containers
$postgres = docker ps --filter "name=iacms-postgres" --format "{{.Status}}" 2>$null
Test-Result "PostgreSQL Container" ($postgres -match "Up") $postgres

$redis = docker ps --filter "name=iacms-redis" --format "{{.Status}}" 2>$null
Test-Result "Redis Container" ($redis -match "Up") $redis

# ========================================
# 2. SERVICE HEALTH CHECKS
# ========================================
Write-Host "`n--- 2. SERVICE HEALTH ---" -ForegroundColor Yellow

try {
    $gw = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
    $gwJson = $gw.Content | ConvertFrom-Json
    Test-Result "API Gateway (port 3000)" ($gwJson.status -eq "ok") "Service: $($gwJson.service)"
} catch {
    Test-Result "API Gateway (port 3000)" $false "Not responding"
}

try {
    $auth = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 5
    $authJson = $auth.Content | ConvertFrom-Json
    Test-Result "Auth Service (port 3001)" ($authJson.status -eq "ok") "Service: $($authJson.service)"
} catch {
    Test-Result "Auth Service (port 3001)" $false "Not responding"
}

try {
    $rbac = Invoke-WebRequest -Uri "http://localhost:3002/health" -UseBasicParsing -TimeoutSec 5
    $rbacJson = $rbac.Content | ConvertFrom-Json
    Test-Result "RBAC Service (port 3002)" ($rbacJson.status -eq "ok") "Service: $($rbacJson.service)"
} catch {
    Test-Result "RBAC Service (port 3002)" $false "Not responding"
}

# ========================================
# 3. DATABASE TESTS
# ========================================
Write-Host "`n--- 3. DATABASE ---" -ForegroundColor Yellow

$tenants = docker exec iacms-postgres psql -U postgres -d iacms -t -c "SELECT COUNT(*) FROM tenants" 2>$null
Test-Result "Tenants table populated" ([int]$tenants.Trim() -ge 1) "Count: $($tenants.Trim())"

$users = docker exec iacms-postgres psql -U postgres -d iacms -t -c "SELECT COUNT(*) FROM users" 2>$null
Test-Result "Users table populated" ([int]$users.Trim() -ge 3) "Count: $($users.Trim())"

$roles = docker exec iacms-postgres psql -U postgres -d iacms -t -c "SELECT COUNT(*) FROM roles" 2>$null
Test-Result "Roles table populated" ([int]$roles.Trim() -eq 3) "Count: $($roles.Trim())"

$perms = docker exec iacms-postgres psql -U postgres -d iacms -t -c "SELECT COUNT(*) FROM permissions" 2>$null
Test-Result "Permissions table populated" ([int]$perms.Trim() -eq 22) "Count: $($perms.Trim())"

# ========================================
# 4. AUTHENTICATION TESTS
# ========================================
Write-Host "`n--- 4. AUTHENTICATION (via Gateway) ---" -ForegroundColor Yellow

# Test Login
$loginBody = @{email="admin@test-org.com"; password="password123"; tenantCode="TEST-ORG"} | ConvertTo-Json
try {
    $loginResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/login" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
    $loginJson = $loginResp.Content | ConvertFrom-Json
    $token = $loginJson.accessToken
    Test-Result "User Login" ($null -ne $token) "User: $($loginJson.user.email)"
} catch {
    Test-Result "User Login" $false $_.Exception.Message
    $token = $null
}

# Test Invalid Login
$badLogin = @{email="admin@test-org.com"; password="wrongpassword"; tenantCode="TEST-ORG"} | ConvertTo-Json
try {
    $badResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/login" -Method POST -Body $badLogin -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
    Test-Result "Invalid Login Rejected" $false "Should have returned error"
} catch {
    Test-Result "Invalid Login Rejected" ($_.Exception.Response.StatusCode.value__ -eq 401) "Returns 401"
}

# ========================================
# 5. PROTECTED ROUTES TESTS
# ========================================
Write-Host "`n--- 5. PROTECTED ROUTES ---" -ForegroundColor Yellow

# Test without token
try {
    $noAuth = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/rbac/roles" -UseBasicParsing -TimeoutSec 5
    Test-Result "Reject request without token" $false "Should have returned 401"
} catch {
    Test-Result "Reject request without token" ($_.Exception.Response.StatusCode.value__ -eq 401) "Returns 401"
}

# Test with valid token
if ($token) {
    $headers = @{Authorization="Bearer $token"}
    
    # Profile endpoint
    try {
        $profileResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/profile" -Headers $headers -UseBasicParsing -TimeoutSec 10
        $profileJson = $profileResp.Content | ConvertFrom-Json
        Test-Result "Get Profile with token" ($null -ne $profileJson.user) "User: $($profileJson.user.email)"
    } catch {
        Test-Result "Get Profile with token" $false $_.Exception.Message
    }
    
    # RBAC Roles endpoint
    try {
        $rolesResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/rbac/roles" -Headers $headers -UseBasicParsing -TimeoutSec 10
        $rolesJson = $rolesResp.Content | ConvertFrom-Json
        Test-Result "Get RBAC Roles" ($rolesJson.roles.Count -eq 3) "Roles: $($rolesJson.roles.Count)"
    } catch {
        Test-Result "Get RBAC Roles" $false $_.Exception.Message
    }
    
    # User Permissions endpoint
    $userId = $loginJson.user.id
    try {
        $permsResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/rbac/permissions/user/$userId" -Headers $headers -UseBasicParsing -TimeoutSec 10
        $permsJson = $permsResp.Content | ConvertFrom-Json
        Test-Result "Get User Permissions" ($permsJson.permissions.Count -eq 22) "Permissions: $($permsJson.permissions.Count)"
    } catch {
        Test-Result "Get User Permissions" $false $_.Exception.Message
    }
}

# ========================================
# 6. TENANT VALIDATION
# ========================================
Write-Host "`n--- 6. TENANT VALIDATION ---" -ForegroundColor Yellow

try {
    $tenantResp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/tenants/validate/TEST-ORG" -UseBasicParsing -TimeoutSec 5
    $tenantJson = $tenantResp.Content | ConvertFrom-Json
    Test-Result "Validate tenant code" ($tenantJson.valid -eq $true) "Tenant: $($tenantJson.tenant.name)"
} catch {
    Test-Result "Validate tenant code" $false $_.Exception.Message
}

try {
    $badTenant = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/tenants/validate/INVALID-CODE" -UseBasicParsing -TimeoutSec 5
    Test-Result "Reject invalid tenant" $false "Should have returned error"
} catch {
    Test-Result "Reject invalid tenant" ($_.Exception.Response.StatusCode.value__ -in @(400, 404)) "Returns error"
}

# ========================================
# SUMMARY
# ========================================
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "    TEST SUMMARY" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan
Write-Host "`n  Passed: $passed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host "  Total:  $($passed + $failed)`n" -ForegroundColor White

if ($failed -eq 0) {
    Write-Host "  ALL TESTS PASSED! Day 1 & Day 2 implementation verified.`n" -ForegroundColor Green
} else {
    Write-Host "  Some tests failed. Check the output above for details.`n" -ForegroundColor Yellow
}
