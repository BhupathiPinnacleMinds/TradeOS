$ErrorActionPreference = 'Continue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDir = Join-Path $repoRoot 'apps\api'
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$apiHealthUrl = 'http://localhost:3000/api/health'

$results = [ordered]@{}

function Add-Result($name, $status, $message, $critical = $true) {
  $results[$name] = [pscustomobject]@{
    Status = $status
    Message = $message
    Critical = [bool]$critical
  }
}

function Write-Result($name) {
  $result = $results[$name]
  switch ($result.Status) {
    'OK' { Write-Host "[OK] $name`: $($result.Message)" -ForegroundColor Green }
    'INFO' { Write-Host "[INFO] $name`: $($result.Message)" -ForegroundColor Cyan }
    'WARN' { Write-Host "[WARN] $name`: $($result.Message)" -ForegroundColor Yellow }
    default { Write-Host "[FAIL] $name`: $($result.Message)" -ForegroundColor Red }
  }
}

function Test-TcpPort($hostName, $port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect($hostName, $port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(3000, $false)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-PrivateLanIp {
  $ipconfig = cmd.exe /d /c ipconfig
  foreach ($line in $ipconfig) {
    if ($line -match 'IPv4.*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)') {
      $candidate = $Matches[1]
      if ($candidate -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)') {
        return $candidate
      }
    }
  }

  return $null
}

function Get-PortListeners {
  $rows = cmd.exe /d /c 'netstat -ano -p tcp'
  foreach ($row in $rows) {
    $parts = ($row -split '\s+') | Where-Object { $_ }
    if (
      $parts.Length -ge 5 -and
      $parts[3] -eq 'LISTENING' -and
      $parts[1] -match ':(3000|8081|8082)$'
    ) {
      [pscustomobject]@{
        Port = [int]$Matches[1]
        Pid = [int]$parts[4]
      }
    }
  }
}

function Test-HttpOk($url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Invoke-PrismaCheck($arguments, $pattern) {
  $prismaCmd = Join-Path $apiDir 'node_modules\.bin\prisma.CMD'
  if (-not (Test-Path $prismaCmd)) {
    return [pscustomobject]@{ Ok = $false; Output = "Prisma CLI missing at $prismaCmd" }
  }

  Push-Location $apiDir
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $output = & $prismaCmd @arguments 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    $text = $output -join "`n"
    return [pscustomobject]@{
      Ok = ($exitCode -eq 0 -and (-not $pattern -or $text -match $pattern))
      ExitCode = $exitCode
      Output = $text
    }
  } finally {
    Pop-Location
  }
}

Write-Host ''
Write-Host 'TradeOS Local Development Doctor' -ForegroundColor White
Write-Host '====================================' -ForegroundColor White

$dockerProcesses = @(Get-Process -Name 'Docker Desktop', 'com.docker.backend', 'dockerd' -ErrorAction SilentlyContinue)
Add-Result 'Docker' ($(if ($dockerProcesses.Count -gt 0) { 'OK' } else { 'FAIL' })) ($(if ($dockerProcesses.Count -gt 0) { 'Docker Desktop process is running' } else { 'Docker Desktop process was not found' }))

$postgresReachable = Test-TcpPort 'localhost' 5432
Add-Result 'PostgreSQL' ($(if ($postgresReachable) { 'OK' } else { 'FAIL' })) ($(if ($postgresReachable) { 'localhost:5432 is reachable' } else { 'localhost:5432 is not reachable' }))

$schema = Invoke-PrismaCheck @('validate') 'The schema .* is valid'
Add-Result 'Prisma schema' ($(if ($schema.Ok) { 'OK' } else { 'FAIL' })) ($(if ($schema.Ok) { 'valid' } else { "invalid or unavailable. Output: $($schema.Output)" }))

$migrations = Invoke-PrismaCheck @('migrate', 'status') 'Database schema is up to date'
Add-Result 'Prisma migrations' ($(if ($migrations.Ok) { 'OK' } else { 'FAIL' })) ($(if ($migrations.Ok) { 'up to date' } else { "not current or unavailable. Output: $($migrations.Output)" }))

$apiHealthy = Test-HttpOk $apiHealthUrl
Add-Result 'API health' ($(if ($apiHealthy) { 'OK' } else { 'INFO' })) ($(if ($apiHealthy) { $apiHealthUrl } else { 'API is not running; this is OK before pnpm dev:local' })) $false

$metro = $null
foreach ($port in @(8081, 8082)) {
  if (Test-HttpOk "http://localhost:$port/status") {
    $metro = $port
    break
  }
}
Add-Result 'Metro' ($(if ($metro) { 'OK' } else { 'INFO' })) ($(if ($metro) { "running on port $metro" } else { 'Metro is not running; this is OK before pnpm dev:local' })) $false

$lanIp = Get-PrivateLanIp
Add-Result 'LAN IP' ($(if ($lanIp) { 'OK' } else { 'FAIL' })) ($(if ($lanIp) { $lanIp } else { 'no private LAN IP detected' }))

$apiUrl = if ($lanIp) { "http://$lanIp`:3000/api" } else { 'unavailable until LAN IP is detected' }
Add-Result 'API URL' ($(if ($lanIp -and $apiUrl -notmatch 'localhost|127\.0\.0\.1|/api/api') { 'OK' } else { 'FAIL' })) $apiUrl

$listeners = @(Get-PortListeners)
$portSummary = if ($listeners.Count) {
  ($listeners | ForEach-Object { "port $($_.Port) PID $($_.Pid)" }) -join ', '
} else {
  'no listeners on 3000, 8081 or 8082'
}
Add-Result 'Ports' 'OK' $portSummary $false

$mobilePackage = Test-Path (Join-Path $mobileDir 'package.json')
$expoShim = Test-Path (Join-Path $mobileDir 'node_modules\.bin\expo.CMD')
Add-Result 'Expo configuration' ($(if ($mobilePackage -and $expoShim -and $lanIp) { 'OK' } else { 'FAIL' })) "EXPO_PUBLIC_API_URL=$apiUrl"

foreach ($name in $results.Keys) {
  Write-Result $name
}

Write-Host '====================================' -ForegroundColor White

if (($results.Values | Where-Object { $_.Critical -and $_.Status -ne 'OK' }).Count -gt 0) {
  exit 1
}
