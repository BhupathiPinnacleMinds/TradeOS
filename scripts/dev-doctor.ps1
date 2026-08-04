$ErrorActionPreference = 'Continue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDir = Join-Path $repoRoot 'apps\api'
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$apiHealthUrl = 'http://localhost:3000/api/health'
$apiDistController = Join-Path $apiDir 'dist\src\appointments\appointments.controller.js'
$apiDistMain = Join-Path $apiDir 'dist\src\main.js'
$appointmentActionRouteSegments = @(
  'confirm',
  'start',
  'start-travel',
  'arrive',
  'pause',
  'resume',
  'complete',
  'cancel'
)

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

function Test-PrivateIpv4($ipAddress) {
  return (
    $ipAddress -match '^(10)\.' -or
    $ipAddress -match '^(192\.168)\.' -or
    $ipAddress -match '^172\.(1[6-9]|2\d|3[0-1])\.'
  )
}

function Test-UsableIpv4($ipAddress) {
  return (
    $ipAddress -match '^(\d{1,3}\.){3}\d{1,3}$' -and
    $ipAddress -notmatch '^(127\.|169\.254\.|0\.|255\.)' -and
    (Test-PrivateIpv4 $ipAddress)
  )
}

function Test-VirtualAdapterName($adapterName) {
  return $adapterName -match '(?i)(docker|dockernat|wsl|hyper-v|hyperv|vethernet|vpn|loopback|virtual|vmware|virtualbox|tunnel|tap|tun|wireguard|openvpn|zerotier|tailscale)'
}

function Test-PreferredPhysicalAdapterName($adapterName) {
  return $adapterName -match '(?i)(wi-?fi|wireless|ethernet)'
}

function Test-GatewayReachable($gateway) {
  if (-not $gateway) {
    return $false
  }

  try {
    $ping = cmd.exe /d /c "ping -n 1 -w 250 $gateway"
    return $LASTEXITCODE -eq 0 -and ($ping -join "`n") -match 'TTL='
  } catch {
    return $false
  }
}

function Get-IpConfigLanCandidates {
  $sections = @()
  $current = $null
  $waitingForGateway = $false

  foreach ($line in (cmd.exe /d /c ipconfig)) {
    if ($line -match '^[^\s].*adapter\s+(.+):\s*$') {
      if ($current) {
        $sections += $current
      }
      $current = [ordered]@{
        AdapterName = $Matches[1].Trim()
        Ip = $null
        Gateway = $null
        Disconnected = $false
      }
      $waitingForGateway = $false
      continue
    }

    if (-not $current) {
      continue
    }

    if ($line -match 'Media disconnected') {
      $current.Disconnected = $true
      $waitingForGateway = $false
      continue
    }

    if ($line -match 'IPv4.*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)') {
      $current.Ip = $Matches[1]
      $waitingForGateway = $false
      continue
    }

    if ($line -match 'Default Gateway.*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)') {
      $current.Gateway = $Matches[1]
      $waitingForGateway = $false
      continue
    }

    if ($line -match 'Default Gateway.*:') {
      $waitingForGateway = $true
      continue
    }

    if ($line -match 'Default Gateway.*:\s*$') {
      $waitingForGateway = $true
      continue
    }

    if ($waitingForGateway -and $line -match '^\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s*$') {
      $current.Gateway = $Matches[1]
      $waitingForGateway = $false
    }
  }

  if ($current) {
    $sections += $current
  }

  foreach ($section in $sections) {
    if (-not (Test-UsableIpv4 $section.Ip)) {
      continue
    }

    [pscustomobject]@{
      AdapterName = $section.AdapterName
      Ip = $section.Ip
      Gateway = $section.Gateway
      GatewayReachable = Test-GatewayReachable $section.Gateway
      IsVirtual = Test-VirtualAdapterName $section.AdapterName
      IsPreferredPhysical = Test-PreferredPhysicalAdapterName $section.AdapterName
      IsDisconnected = [bool]$section.Disconnected
    }
  }
}

function Get-PrivateLanSelection {
  $candidates = @(Get-IpConfigLanCandidates)
  $override = $env:TRADIEOS_LAN_IP

  if ($override) {
    if (-not (Test-UsableIpv4 $override)) {
      return [pscustomobject]@{
        Ok = $false
        Error = "TRADIEOS_LAN_IP is not a valid private local IPv4 address: $override"
      }
    }

    $overrideCandidate = $candidates | Where-Object { $_.Ip -eq $override } | Select-Object -First 1
    if (-not $overrideCandidate) {
      return [pscustomobject]@{
        Ok = $false
        Error = "TRADIEOS_LAN_IP=$override is not assigned to a local network adapter."
      }
    }
    if ($overrideCandidate.IsVirtual -or $overrideCandidate.IsDisconnected) {
      return [pscustomobject]@{
        Ok = $false
        Error = "TRADIEOS_LAN_IP=$override belongs to a virtual or disconnected adapter: $($overrideCandidate.AdapterName)"
      }
    }

    return [pscustomobject]@{
      Ok = $true
      AdapterName = $overrideCandidate.AdapterName
      Ip = $overrideCandidate.Ip
      Gateway = $overrideCandidate.Gateway
      GatewayReachable = $overrideCandidate.GatewayReachable
      Source = 'TRADIEOS_LAN_IP'
    }
  }

  $physicalCandidates = @(
    $candidates |
      Where-Object { -not $_.IsVirtual -and -not $_.IsDisconnected -and $_.Gateway } |
      Sort-Object `
        @{ Expression = { if ($_.GatewayReachable) { 0 } else { 1 } } },
        @{ Expression = { if ($_.IsPreferredPhysical) { 0 } else { 1 } } },
        @{ Expression = { if ($_.Ip -match '^172\.') { 1 } else { 0 } } },
        AdapterName
  )

  if ($physicalCandidates.Count -gt 0) {
    $selected = $physicalCandidates[0]
    return [pscustomobject]@{
      Ok = $true
      AdapterName = $selected.AdapterName
      Ip = $selected.Ip
      Gateway = $selected.Gateway
      GatewayReachable = $selected.GatewayReachable
      Source = 'automatic physical adapter selection'
    }
  }

  $candidateSummary = if ($candidates.Count) {
    ($candidates | ForEach-Object { "$($_.AdapterName)=$($_.Ip)" }) -join ', '
  } else {
    'none'
  }
  return [pscustomobject]@{
    Ok = $false
    Error = "Could not detect a connected physical Wi-Fi/Ethernet LAN IP. Candidates: $candidateSummary"
  }
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

function Get-ProcessCommandLine($processId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop).CommandLine
  } catch {
    return $null
  }
}

function Get-ProcessExecutablePath($processId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop).ExecutablePath
  } catch {
    return $null
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

function Get-LatestSourceWriteTime {
  $paths = @(
    (Join-Path $apiDir 'src'),
    (Join-Path $repoRoot 'packages\shared\src')
  )
  $latest = Get-Date '1970-01-01'
  foreach ($path in $paths) {
    if (Test-Path $path) {
      $candidate = Get-ChildItem -LiteralPath $path -Recurse -File -Include *.ts,*.tsx |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      if ($candidate -and $candidate.LastWriteTimeUtc -gt $latest) {
        $latest = $candidate.LastWriteTimeUtc
      }
    }
  }
  return $latest
}

function Test-ApiDistAppointmentRoutes {
  if (-not (Test-Path $apiDistController)) {
    return $false
  }

  $content = Get-Content -LiteralPath $apiDistController -Raw
  foreach ($segment in $appointmentActionRouteSegments) {
    if ($content -notmatch [regex]::Escape("(0, common_1.Post)(':id/$segment')")) {
      return $false
    }
  }
  return $true
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

$apiListener = Get-PortListeners | Where-Object { $_.Port -eq 3000 } | Select-Object -First 1
if ($apiListener) {
  $commandLine = Get-ProcessCommandLine $apiListener.Pid
  $executable = Get-ProcessExecutablePath $apiListener.Pid
  Add-Result 'API process' 'INFO' "PID $($apiListener.Pid); executable: $(if ($executable) { $executable } else { 'unavailable' }); command: $(if ($commandLine) { $commandLine } else { 'unavailable' }); expected working directory: $apiDir" $false
} else {
  Add-Result 'API process' 'INFO' 'API is not listening on port 3000' $false
}

$latestSource = Get-LatestSourceWriteTime
$distMainTime = if (Test-Path $apiDistMain) { (Get-Item $apiDistMain).LastWriteTimeUtc } else { $null }
$distControllerTime = if (Test-Path $apiDistController) { (Get-Item $apiDistController).LastWriteTimeUtc } else { $null }
$distFresh = $distMainTime -and $distControllerTime -and (@($distMainTime, $distControllerTime) | Sort-Object | Select-Object -First 1) -ge $latestSource
Add-Result 'API dist freshness' ($(if ($distFresh) { 'OK' } else { 'WARN' })) "latest source/shared: $latestSource; dist main: $(if ($distMainTime) { $distMainTime } else { 'missing' }); appointments controller: $(if ($distControllerTime) { $distControllerTime } else { 'missing' })" $false

$distRoutesOk = Test-ApiDistAppointmentRoutes
Add-Result 'Appointment action routes in dist' ($(if ($distRoutesOk) { 'OK' } else { 'WARN' })) ($(if ($distRoutesOk) { 'confirm/start-travel/arrive/start/pause/resume/complete/cancel present' } else { 'one or more compiled appointment action routes are missing; run pnpm build or pnpm dev:local' })) $false

$metro = $null
foreach ($port in @(8081, 8082)) {
  if (Test-HttpOk "http://localhost:$port/status") {
    $metro = $port
    break
  }
}
Add-Result 'Metro' ($(if ($metro) { 'OK' } else { 'INFO' })) ($(if ($metro) { "running on port $metro" } else { 'Metro is not running; this is OK before pnpm dev:local' })) $false

$lanSelection = Get-PrivateLanSelection
$lanIp = if ($lanSelection.Ok) { $lanSelection.Ip } else { $null }
Add-Result 'LAN adapter' ($(if ($lanSelection.Ok) { 'OK' } else { 'FAIL' })) ($(if ($lanSelection.Ok) { "$($lanSelection.AdapterName) ($($lanSelection.Source))" } else { $lanSelection.Error }))
Add-Result 'LAN IP' ($(if ($lanSelection.Ok) { 'OK' } else { 'FAIL' })) ($(if ($lanSelection.Ok) { $lanIp } else { 'no phone-reachable physical LAN IP detected' }))

$apiUrl = if ($lanIp) { "http://$lanIp`:3000/api" } else { 'unavailable until LAN IP is detected' }
Add-Result 'API URL' ($(if ($lanIp -and $apiUrl -notmatch 'localhost|127\.0\.0\.1|/api/api') { 'OK' } else { 'FAIL' })) $apiUrl

$expectedMetroUrl = if ($lanIp) { "exp://$lanIp`:8081" } else { 'unavailable until LAN IP is detected' }
Add-Result 'Expected Metro URL' ($(if ($lanIp) { 'OK' } else { 'FAIL' })) $expectedMetroUrl

$listeners = @(Get-PortListeners)
$port3000 = $listeners | Where-Object { $_.Port -eq 3000 } | Select-Object -First 1
$port8081 = $listeners | Where-Object { $_.Port -eq 8081 } | Select-Object -First 1
Add-Result 'Port 3000 listener' 'INFO' ($(if ($port3000) { "listening, PID $($port3000.Pid)" } else { 'not listening' })) $false
Add-Result 'Port 8081 listener' 'INFO' ($(if ($port8081) { "listening, PID $($port8081.Pid)" } else { 'not listening' })) $false
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
