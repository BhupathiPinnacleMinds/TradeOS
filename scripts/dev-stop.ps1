$ErrorActionPreference = 'Stop'

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

Write-Host ''
Write-Host 'TradeOS Local Development Stop' -ForegroundColor White
Write-Host '====================================' -ForegroundColor White
Write-Host 'Docker and PostgreSQL will be left running.' -ForegroundColor DarkGray

$listeners = @(Get-PortListeners)
if ($listeners.Count -eq 0) {
  Write-Host '[OK] No TradeOS API/Metro listeners found on ports 3000, 8081 or 8082.' -ForegroundColor Green
  exit 0
}

$stopped = 0
$skipped = 0
foreach ($listener in $listeners) {
  if (Test-IsTradeOsListener $listener) {
    Stop-Process -Id $listener.Pid -Force
    Write-Host "[OK] Stopped TradeOS listener on port $($listener.Port), PID $($listener.Pid)." -ForegroundColor Green
    $stopped++
  } else {
    Write-Host "[WARN] Skipped port $($listener.Port), PID $($listener.Pid): not verified as TradeOS." -ForegroundColor Yellow
    $skipped++
  }
}

Write-Host ''
Write-Host "Stopped: $stopped"
Write-Host "Skipped: $skipped"
