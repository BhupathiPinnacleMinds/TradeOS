$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDir = Join-Path $repoRoot 'apps\api'
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$apiLog = Join-Path $repoRoot 'api-runtime.log'
$apiErrorLog = Join-Path $repoRoot 'api-runtime-error.log'
$apiExitLog = Join-Path $repoRoot 'api-runtime-exit.log'
$expoLog = Join-Path $repoRoot 'expo-runtime.log'
$launcherRunId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMddHHmmss'), $PID
$expoExitLog = Join-Path $env:TEMP "tradeos-expo-$launcherRunId.exit"
$expoPidLog = Join-Path $env:TEMP "tradeos-expo-$launcherRunId.pid"
$expoPsLauncher = Join-Path $env:TEMP "tradeos-dev-expo-$launcherRunId.ps1"
$apiLocalUrl = 'http://localhost:3000/api'
$apiHealthUrl = "$apiLocalUrl/health"

function Write-Section($message) {
  Write-Host ''
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Write-Ok($message) {
  Write-Host "[OK] $message" -ForegroundColor Green
}

function Write-Warn($message) {
  Write-Host "[WARN] $message" -ForegroundColor Yellow
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

  throw 'Could not detect a private LAN IP address for Expo Go.'
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
        Address = $parts[1]
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

function Test-IsTradeOsListener($listener) {
  $commandLine = Get-ProcessCommandLine $listener.Pid
  if (-not $commandLine) {
    return $false
  }

  $normalised = $commandLine.ToLowerInvariant()
  return (
    $normalised.Contains('\tradeos\') -or
    $normalised.Contains('/tradeos/') -or
    $normalised.Contains('apps\api') -or
    $normalised.Contains('apps/mobile') -or
    $normalised.Contains('expo') -or
    $normalised.Contains('metro')
  )
}

function Invoke-JsonHealth($url) {
  try {
    return Invoke-RestMethod -Uri $url -TimeoutSec 3
  } catch {
    return $null
  }
}

function Test-ApiHealthy {
  $health = Invoke-JsonHealth $apiHealthUrl
  return ($health -and $health.status -eq 'ok')
}

function Get-ApiPid {
  $listener = Get-PortListeners | Where-Object { $_.Port -eq 3000 } | Select-Object -First 1
  if ($listener) {
    return $listener.Pid
  }
  return $null
}

function Get-MetroStatus {
  foreach ($port in @(8081, 8082)) {
    try {
      $statusUrl = "http://127.0.0.1:$port/status"
      $response = Invoke-WebRequest -UseBasicParsing -Uri $statusUrl -TimeoutSec 3
      $isRunning = $response.StatusCode -eq 200 -and (
        $response.Content -match 'packager-status:running' -or
        $response.Content -match 'running'
      )
      if ($isRunning) {
        return [pscustomobject]@{
          Port = $port
          Body = $response.Content
          Pid = (Get-PortListeners | Where-Object { $_.Port -eq $port } | Select-Object -First 1).Pid
          StatusUrl = $statusUrl
          ReadySignal = 'Metro status endpoint'
        }
      }
    } catch {}
  }
  return $null
}

function Stop-StaleTradeOsListeners {
  foreach ($listener in @(Get-PortListeners)) {
    if ($listener.Port -eq 3000 -and (Test-ApiHealthy)) {
      continue
    }

    if (($listener.Port -in @(8081, 8082)) -and (Get-MetroStatus)) {
      continue
    }

    if (Test-IsTradeOsListener $listener) {
      Stop-Process -Id $listener.Pid -Force
      Write-Ok "Stopped stale TradeOS listener on port $($listener.Port), PID $($listener.Pid)"
    } else {
      throw "Port $($listener.Port) is occupied by PID $($listener.Pid), but it is not verified as TradeOS. Stop it manually before running pnpm dev:local."
    }
  }
}

function Assert-DockerDesktopRunning {
  $dockerProcesses = @(Get-Process -Name 'Docker Desktop', 'com.docker.backend', 'dockerd' -ErrorAction SilentlyContinue)
  if ($dockerProcesses.Count -eq 0) {
    throw 'Docker Desktop does not appear to be running. Start Docker Desktop manually, wait for the engine, then rerun pnpm dev:local.'
  }
}

function Assert-RequiredEnvironment {
  $nodeExe = 'C:\Program Files\nodejs\node.exe'
  $apiEnv = Join-Path $apiDir '.env'
  $mobilePackage = Join-Path $mobileDir 'package.json'
  $expoCmd = Join-Path $mobileDir 'node_modules\.bin\expo.CMD'

  if (-not (Test-Path $nodeExe)) {
    throw "Node.js executable not found at $nodeExe"
  }
  if (-not (Test-Path $apiEnv)) {
    throw "API .env file is missing: $apiEnv"
  }
  if (-not (Select-String -Path $apiEnv -Pattern '^DATABASE_URL=' -Quiet)) {
    throw 'DATABASE_URL is missing from apps/api/.env'
  }
  if (-not (Select-String -Path $apiEnv -Pattern '^JWT_SECRET=' -Quiet)) {
    throw 'JWT_SECRET is missing from apps/api/.env'
  }
  if (-not (Test-Path $mobilePackage)) {
    throw "Mobile package.json is missing: $mobilePackage"
  }
  if (-not (Test-Path $expoCmd)) {
    throw "Expo CLI shim is missing: $expoCmd. Run pnpm install first."
  }
}

function Invoke-PrismaCommand($arguments, $successPattern, $failureMessage) {
  $prismaCmd = Join-Path $apiDir 'node_modules\.bin\prisma.CMD'
  if (-not (Test-Path $prismaCmd)) {
    throw "Prisma CLI not found at $prismaCmd. Run pnpm install first."
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
    if ($exitCode -ne 0) {
      Write-Host $text
      throw $failureMessage
    }
    if ($successPattern -and -not ($text -match $successPattern)) {
      Write-Host $text
      throw $failureMessage
    }
    $output | ForEach-Object { Write-Host $_ }
  } finally {
    Pop-Location
  }
}

function Wait-ForApi($seconds) {
  $startedAt = Get-Date
  $deadline = $startedAt.AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ApiHealthy) {
      return [pscustomobject]@{
        Duration = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
        Pid = Get-ApiPid
      }
    }

    if (Test-Path $apiExitLog) {
      break
    }

    Start-Sleep -Seconds 2
  }

  $duration = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  $exitCode = if (Test-Path $apiExitLog) { Get-Content $apiExitLog -Raw } else { 'Process still running or exit code unavailable' }
  Write-Host ''
  Write-Host 'API failed to become healthy.' -ForegroundColor Red
  Write-Host "Startup duration: $duration seconds"
  Write-Host "Process exit code: $exitCode"
  Write-Host 'Last 50 API log lines:'
  if (Test-Path $apiLog) { Get-Content $apiLog -Tail 50 }
  if (Test-Path $apiErrorLog) {
    Write-Host 'Last 50 API error log lines:'
    Get-Content $apiErrorLog -Tail 50
  }
  throw 'API startup failed; Expo was not started.'
}

function Get-NumericExitCodeFromFile($path) {
  if (-not (Test-Path $path)) {
    return $null
  }

  $raw = (Get-Content $path -Raw -ErrorAction SilentlyContinue).Trim()
  $exitCode = 0
  if ([int]::TryParse($raw, [ref]$exitCode)) {
    return $exitCode
  }

  return $null
}

function Get-ProcessAlive($processId) {
  if (-not $processId) {
    return $false
  }
  return $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Get-ExpoPid {
  if (-not (Test-Path $expoPidLog)) {
    return $null
  }

  $raw = (Get-Content $expoPidLog -Raw -ErrorAction SilentlyContinue).Trim()
  $processId = 0
  if ([int]::TryParse($raw, [ref]$processId)) {
    return $processId
  }

  return $null
}

function ConvertTo-PowerShellSingleQuotedLiteral($value) {
  return ($value -replace "'", "''")
}

function Wait-ForMetro($seconds, $expoCommand, $expoWorkingDirectory, $expoApiUrl) {
  $startedAt = Get-Date
  $deadline = $startedAt.AddSeconds($seconds)
  Write-Host '[INFO] Waiting for Metro on ports 8081/8082...'
  while ((Get-Date) -lt $deadline) {
    $metro = Get-MetroStatus
    if ($metro) {
      return $metro
    }

    if (Test-Path $expoExitLog) {
      break
    }

    Start-Sleep -Seconds 2
  }

  $metro = Get-MetroStatus
  if ($metro) {
    return $metro
  }

  $expoPid = Get-ExpoPid
  $isAlive = Get-ProcessAlive $expoPid
  $exitCode = Get-NumericExitCodeFromFile $expoExitLog
  $duration = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)

  Write-Host ''
  Write-Host '[FAIL] Expo failed to become ready.' -ForegroundColor Red
  Write-Host "[INFO] Expo command: $expoCommand"
  Write-Host "[INFO] Expo working directory: $expoWorkingDirectory"
  Write-Host "[INFO] Expo API URL: $expoApiUrl"
  Write-Host "[INFO] Expo PID: $(if ($expoPid) { $expoPid } else { 'unavailable' })"
  Write-Host '[INFO] Checked ports: 8081, 8082'
  Write-Host "[INFO] Startup duration: $duration seconds"

  if ($null -ne $exitCode) {
    Write-Host "[FAIL] Expo process exited with code $exitCode" -ForegroundColor Red
  } elseif ($isAlive) {
    Write-Host "[FAIL] Expo process is still running, but Metro was not detected within $seconds seconds" -ForegroundColor Red
  } else {
    Write-Host '[FAIL] Expo process state is unavailable and no numeric exit code was recorded' -ForegroundColor Red
  }

  if (Test-Path $expoLog) {
    Write-Host 'Last 100 Expo log lines:'
    Get-Content $expoLog -Tail 100
  }
  throw 'Expo startup failed.'
}

function New-Launcher($name, [string[]]$lines) {
  $path = Join-Path $env:TEMP $name
  Set-Content -LiteralPath $path -Value (@('@echo off') + $lines) -Encoding ASCII
  return $path
}

function Open-VisibleTerminal($title, $launcherPath) {
  cmd.exe /d /c "start `"$title`" cmd.exe /k `"$launcherPath`""
}

function Write-Summary($lanIp, $apiPid, $metro) {
  $apiLanUrl = "http://$lanIp`:3000/api"
  $expoLanUrl = "exp://$lanIp`:$($metro.Port)"

  Write-Host ''
  Write-Host '====================================' -ForegroundColor White
  Write-Host 'TradeOS Local Development' -ForegroundColor White
  Write-Host '====================================' -ForegroundColor White
  Write-Host ''
  Write-Host 'Docker:'
  Write-Ok 'Running'
  Write-Host ''
  Write-Host 'Database:'
  Write-Ok 'Reachable'
  Write-Host ''
  Write-Host 'Prisma:'
  Write-Ok 'Up to date'
  Write-Host ''
  Write-Host 'API:'
  Write-Ok 'Running'
  Write-Host "PID: $apiPid"
  Write-Host 'Port: 3000'
  Write-Host "Health URL: $apiHealthUrl"
  Write-Host ''
  Write-Host 'Expo:'
  Write-Ok 'Running'
  Write-Host "Metro Port: $($metro.Port)"
  Write-Host "LAN URL: $expoLanUrl"
  Write-Host 'QR Ready: Yes'
  Write-Host ''
  Write-Host 'Environment:'
  Write-Host "API URL: $apiLanUrl"
  Write-Host ''
  Write-Host 'Ready for Mobile Testing:'
  Write-Ok 'YES'
  Write-Host '====================================' -ForegroundColor White
}

$lanIp = Get-PrivateLanIp
$apiLanUrl = "http://$lanIp`:3000/api"

Write-Host ''
Write-Host 'TradeOS Local Development' -ForegroundColor White
Write-Host '====================================' -ForegroundColor White

Write-Section 'Pre-start validation'
Assert-DockerDesktopRunning
Write-Ok 'Docker Desktop is running'

if (-not (Test-TcpPort 'localhost' 5432)) {
  throw 'PostgreSQL is not reachable on localhost:5432. Start Docker Desktop and the postgres service first.'
}
Write-Ok 'PostgreSQL is reachable'

Assert-RequiredEnvironment
Write-Ok 'Required local environment/files are present'

Write-Ok "Detected LAN IP: $lanIp"
Write-Ok "EXPO_PUBLIC_API_URL will be $apiLanUrl"

Write-Section 'Prisma validation'
Invoke-PrismaCommand @('validate') 'The schema .* is valid' 'Prisma schema validation failed.'
Write-Ok 'Prisma schema is valid'
Invoke-PrismaCommand @('migrate', 'status') 'Database schema is up to date' 'Prisma migrations are not current.'
Write-Ok 'Prisma migrations are current'

Write-Section 'Process management'
Stop-StaleTradeOsListeners

$apiPid = $null
if (Test-ApiHealthy) {
  $apiPid = Get-ApiPid
  Write-Ok "API is already healthy on port 3000; reusing PID $apiPid"
} else {
  Write-Section 'Starting API'
  Remove-Item $apiLog, $apiErrorLog, $apiExitLog -Force -ErrorAction SilentlyContinue
  $apiLauncher = New-Launcher 'tradeos-dev-api.cmd' @(
    'title TradeOS API',
    "cd /d `"$apiDir`"",
    'set "HOST=0.0.0.0"',
    'set "NODE_ENV=development"',
    "echo Starting TradeOS API on http://localhost:3000/api",
    "`"C:\Program Files\nodejs\node.exe`" dist\src\main.js >> `"$apiLog`" 2>> `"$apiErrorLog`"",
    'set "EXIT_CODE=%ERRORLEVEL%"',
    "> `"$apiExitLog`" echo(%EXIT_CODE%",
    'echo TradeOS API exited with code %EXIT_CODE%.',
    'echo Check api-runtime.log and api-runtime-error.log for details.'
  )
  Open-VisibleTerminal 'TradeOS API' $apiLauncher
  $apiStart = Wait-ForApi 60
  $apiPid = $apiStart.Pid
  Write-Ok "API became healthy in $($apiStart.Duration) seconds"
}

$metro = Get-MetroStatus
if ($metro) {
  Write-Ok "Metro is already running on port $($metro.Port); reusing PID $($metro.Pid)"
} else {
  Write-Section 'Starting Expo/Metro'
  Remove-Item $expoLog, $expoExitLog, $expoPidLog, $expoPsLauncher -Force -ErrorAction SilentlyContinue
  $expoCommand = 'pnpm start -- --lan --clear'
  Write-Host "[INFO] Expo command: $expoCommand"
  Write-Host "[INFO] Expo working directory: $mobileDir"
  Write-Host "[INFO] Expo API URL: $apiLanUrl"

  $escapedApiLanUrl = ConvertTo-PowerShellSingleQuotedLiteral $apiLanUrl
  $escapedLanIp = ConvertTo-PowerShellSingleQuotedLiteral $lanIp
  $escapedMobileDir = ConvertTo-PowerShellSingleQuotedLiteral $mobileDir
  $escapedExpoPidLog = ConvertTo-PowerShellSingleQuotedLiteral $expoPidLog
  $escapedExpoLog = ConvertTo-PowerShellSingleQuotedLiteral $expoLog
  $escapedExpoExitLog = ConvertTo-PowerShellSingleQuotedLiteral $expoExitLog

  Set-Content -LiteralPath $expoPsLauncher -Encoding UTF8 -Value @(
    '$ErrorActionPreference = ''Continue''',
    "`$env:EXPO_PUBLIC_API_URL = '$escapedApiLanUrl'",
    "`$env:REACT_NATIVE_PACKAGER_HOSTNAME = '$escapedLanIp'",
    "`$env:EXPO_NO_TELEMETRY = '1'",
    "`$PID | Set-Content -LiteralPath '$escapedExpoPidLog' -Encoding ASCII",
    "Set-Location -LiteralPath '$escapedMobileDir'",
    "Write-Host '[INFO] Expo command: pnpm start -- --lan --clear'",
    "Write-Host '[INFO] Expo working directory: $escapedMobileDir'",
    "Write-Host '[INFO] Expo API URL: $escapedApiLanUrl'",
    "pnpm start -- --lan --clear 2>&1 | Tee-Object -FilePath '$escapedExpoLog'",
    '$exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }',
    "`$exitCode | Set-Content -LiteralPath '$escapedExpoExitLog' -Encoding ASCII",
    'Write-Host "TradeOS Expo exited with code $exitCode."',
    'exit $exitCode'
  )

  $expoLauncher = New-Launcher 'tradeos-dev-expo.cmd' @(
    'title TradeOS Expo',
    "powershell -NoProfile -ExecutionPolicy Bypass -File `"$expoPsLauncher`""
  )
  Open-VisibleTerminal 'TradeOS Expo' $expoLauncher
  Write-Ok 'Expo terminal launched'

  $pidDeadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path $expoPidLog) -and (Get-Date) -lt $pidDeadline) {
    Start-Sleep -Milliseconds 250
  }
  $expoPid = Get-ExpoPid
  if ($expoPid) {
    Write-Host "[INFO] Expo PID: $expoPid"
  } else {
    Write-Warn 'Expo PID was not recorded before readiness polling started'
  }

  $metro = Wait-ForMetro 120 $expoCommand $mobileDir $apiLanUrl
  Write-Ok "Metro ready on port $($metro.Port)"
}

Write-Summary $lanIp $apiPid $metro
