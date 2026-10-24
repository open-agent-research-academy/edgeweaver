# Edgeweaver Genesis - Buzz channel watchdog (ASCII only)
#
# Relaunches Genesis's Buzz harness if it is down, stamps heartbeat and outage windows,
# mines dead letters before a relaunch, and notifies Alan on the ops line.
#
# Mirrors alpha-channel-watchdog.ps1, which is the mature copy of this pattern. Three
# things did NOT transfer from the Telegram version and are designed here rather than
# renamed: there is no poller pid file to key a DEAF check on (Buzz holds a WebSocket, so
# the socket IS the liveness signal), the dead-letter miner is Telegram-shaped and has to
# be adapted before it does anything here, and a terminal auth rejection must NOT be
# treated as a crash to retry.
#
# Built dark 2026-08-01 per buzz-harness-edgeweaver-plan.md B3. The scheduled task that
# calls this is registered by Alan at the B5 cutover, not by the loop.

$repo        = 'C:\Users\agent\Project\Edgeweaver'
$launcher    = "$repo\scripts\ops\buzz-genesis-launch.ps1"
$log         = "$repo\logs\buzz-genesis-watchdog.log"
$lastOkFile  = "$repo\state\channel-lastok-genesis-buzz.txt"
$outageFile  = "$repo\state\channel-outage-genesis-buzz.json"
$closedFlag  = "$repo\state\channel-closed-genesis-buzz.flag"
$stallFlag   = "$repo\state\channel-stall-genesis-buzz.flag"
$deadletter  = "$repo\scripts\ops\channel-deadletter.mjs"
$authStamp   = "$repo\state\channel-authfail-genesis-buzz.json"
$maintenanceInterlock = Join-Path $env:APPDATA 'xyz.block.buzz.app\update-maintenance.json'

function Test-LiveBuzzUpdateMaintenance {
  if (-not (Test-Path -LiteralPath $maintenanceInterlock -PathType Leaf)) { return $false }
  try {
    $marker = Get-Content -LiteralPath $maintenanceInterlock -Raw | ConvertFrom-Json
    if ($marker.protocol -ne 'buzz-update-maintenance/v1') { return $false }
    if ($marker.applicationHealth -notin @('preflight', 'ready-to-install')) { return $false }
    if ($marker.instanceToken -notmatch '^[0-9a-f]{8}-[0-9a-f-]{27}$') { return $false }
    if ([datetimeoffset]::Parse($marker.expiresAtUtc) -le [datetimeoffset]::UtcNow) { return $false }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([uint32]$marker.processId)" -ErrorAction Stop
    if (-not $process) { return $false }
    $actualPath = [IO.Path]::GetFullPath($process.ExecutablePath)
    $expectedPath = [IO.Path]::GetFullPath([string]$marker.executablePath)
    if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $created = [datetimeoffset]$process.CreationDate
    $expectedCreated = [datetimeoffset]::Parse($marker.processCreatedAtUtc)
    if ([math]::Abs(($created - $expectedCreated).TotalSeconds) -gt 2) { return $false }

    # Buzz holds the marker with read-only sharing. If write access succeeds,
    # the marker is stale or forged and must not suppress recovery.
    try {
      $probe = [IO.File]::Open($maintenanceInterlock, 'Open', 'Write', 'ReadWrite')
      $probe.Dispose()
      return $false
    } catch [System.IO.IOException] {
      return $true
    }
  } catch {
    return $false
  }
}

if (Test-LiveBuzzUpdateMaintenance) {
  Add-Content -Path $log -Value "$(Get-Date -Format s) maintenance interlock active; watchdog stands down" -Encoding Ascii
  exit 0
}

# Our harness is identifiable by its FLAGS. The Buzz desktop spawns a bare
# "buzz-acp.exe" with everything passed by environment, so a command line carrying
# --respond-to is ours and nobody else's. Without this the watchdog could not tell its
# own harness from Fizz's, Bumble's or Honey's, all of which are the same binary.
$marker = '*--respond-to*owner-only*'
$pubkey = 'dea7e846155e1a9207658ec6dd091c95d66dbbb9ccd026fa7112f02e6739202e'
$allAcp = @(Get-CimInstance Win32_Process -Filter "Name = 'buzz-acp.exe'" -ErrorAction SilentlyContinue)
$found = @($allAcp | Where-Object { $_.CommandLine -like $marker })

# BEFORE CUTOVER, Genesis is still desktop-managed, and the desktop's harness carries a
# bare command line that cannot match our marker. Without this check the watchdog would
# see found=0 on every tick, call the launcher, watch the launcher correctly refuse to
# create a second presence, and then post an ops notice about it. Every 15 minutes,
# forever. Caught on 2026-08-01 by running the guard logic standalone before the task was
# ever registered; the cost of missing it would have been a notification storm at Alan.
$deskAlive = @(Get-ChildItem 'C:\Users\agent\AppData\Roaming\xyz.block.buzz.app\agents\agent-pids\*.json' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "$pubkey*" } |
  ForEach-Object { try { (Get-Content $_.FullName -Raw | ConvertFrom-Json).pid } catch {} } |
  Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
if ($found.Count -eq 0 -and $deskAlive.Count -gt 0) {
  Add-Content -Path $log -Value "$(Get-Date -Format s) ok (desktop-managed Genesis alive, pid $($deskAlive -join ',')); caretaker stands down until cutover" -Encoding Ascii
  Get-Date -Format s | Set-Content $lastOkFile -Encoding Ascii
  exit 0
}

$skipDeadletter = $false

# CLOSED: Genesis ended its own session deliberately, as the last act after its write-back
# was proven. Kill immediately, no grace, and do not mine dead letters: a session that
# closed itself answered its conversation by definition.
if (Test-Path $closedFlag) {
  foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $closedFlag -ErrorAction SilentlyContinue
  Add-Content -Path $log -Value "$(Get-Date -Format s) CLOSED session ended (end-session flag present)" -Encoding Ascii
  $skipDeadletter = $true
  $found = @()
  Start-Sleep -Seconds 5
}

# DEAF: the process is alive but holds no established socket to the relay. buzz-acp
# reconnects on its own after a drop (proven in the 2026-08-01 logs, two clean
# autonomous reconnects), so a sustained no-socket state means the harness is wedged
# rather than merely between attempts. Three minutes of grace covers startup and a
# normal reconnect cycle.
if ($found.Count -gt 0) {
  $wedged = @()
  foreach ($p in $found) {
    $conns = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Established -ErrorAction SilentlyContinue)
    $ageMin = ((Get-Date) - $p.CreationDate).TotalMinutes
    if ($conns.Count -eq 0 -and $ageMin -gt 3) { $wedged += $p }
  }
  if ($wedged.Count -gt 0) {
    foreach ($p in $wedged) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Add-Content -Path $log -Value "$(Get-Date -Format s) DEAF no established relay socket, killed pid $(($wedged | ForEach-Object { $_.ProcessId }) -join ',')" -Encoding Ascii
    $found = @()
    Start-Sleep -Seconds 5
  }
}

# FROZEN: reserved. The Telegram side writes this flag from channel-notify-hook.mjs when a
# message sits unanswered past a threshold. Buzz has no equivalent hook yet, so nothing
# writes this file today; the branch is here so the shape matches its sibling and so
# wiring a hook later needs no watchdog change.
if (Test-Path $stallFlag) {
  $stallMin = ((Get-Date) - (Get-Item $stallFlag).LastWriteTime).TotalMinutes
  if ($stallMin -gt 30) {
    foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $stallFlag -ErrorAction SilentlyContinue
    Add-Content -Path $log -Value "$(Get-Date -Format s) FROZEN stall flag aged $([int]$stallMin) min, restarted" -Encoding Ascii
    $found = @()
    Start-Sleep -Seconds 5
  }
}

if ($found.Count -eq 0) {

  # TERMINAL AUTH FAILURE IS NOT A CRASH. A membership or attestation rejection returns
  # "restricted: ..." and buzz-acp treats it as terminal: it bails immediately with a
  # non-zero exit instead of backing off. Relaunching on a 15-minute tick would hammer a
  # third-party relay forever and never succeed. Stamp it, tell Alan once, and stop.
  $newest = Get-ChildItem "$repo\logs\buzz-genesis-harness-*.err.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) {
    $tail = Get-Content $newest.FullName -Tail 40 -ErrorAction SilentlyContinue
    if ($tail -match 'restricted:|AuthFailed|not a relay member') {
      if (-not (Test-Path $authStamp)) {
        '{"at":"' + (Get-Date -Format s) + '","log":"' + $newest.Name + '"}' |
          Set-Content $authStamp -Encoding Ascii
        try {
          & node "$repo\scripts\ops\send-telegram.mjs" "Watchdog: the Genesis Buzz harness was refused by the relay (auth or membership), so it is NOT being relaunched. Needs a look. (Automated ops notice, not Genesis.)" | Out-Null
        } catch {}
      }
      Add-Content -Path $log -Value "$(Get-Date -Format s) AUTHFAIL relay refused the key, holding off relaunch" -Encoding Ascii
      Get-Date -Format s | Set-Content $lastOkFile -Encoding Ascii
      exit 0
    }
  }
  Remove-Item $authStamp -ErrorAction SilentlyContinue

  # OUTAGE WINDOW. The heartbeat below is written every run, so its age is how long the
  # machine itself was dark. A gap wider than the 15-minute tick plus slack means messages
  # sent in that window are likely lost, and that is the being's to acknowledge, not ops's.
  $gapNote = ''
  if (Test-Path $lastOkFile) {
    try {
      $lastOk = [datetime]::Parse((Get-Content $lastOkFile -TotalCount 1))
      $gapMin = (New-TimeSpan -Start $lastOk -End (Get-Date)).TotalMinutes
      if ($gapMin -gt 20) {
        '{"from":"' + $lastOk.ToString('s') + '","to":"' + (Get-Date -Format s) + '"}' |
          Set-Content $outageFile -Encoding Ascii
        $gapNote = " The machine was dark for about $([int]$gapMin) minutes, so anything sent in that window may not have arrived."
      }
    } catch {}
  }

  # DEAD LETTERS. channel-deadletter.mjs is still Telegram-shaped: its sibling exclusion is
  # a two-being ternary and its inbound extraction keys on Telegram channel tags. Until it
  # learns Buzz it will find nothing here, which is harmless because every exit path in it
  # is exit 0. Fail-open on purpose: a broken miner must never block a relaunch.
  if (-not $skipDeadletter) {
    try {
      $dl = & node $deadletter genesis --out "$repo\state\channel-deadletter-genesis-buzz.json"
      Add-Content -Path $log -Value "$(Get-Date -Format s) $dl" -Encoding Ascii
    } catch {}
  }

  Start-Process powershell -WorkingDirectory $repo -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$launcher -WindowStyle Hidden
  $stamp = Get-Date -Format s
  Add-Content -Path $log -Value "$stamp relaunched buzz harness$(if ($gapNote) { ' (outage window stamped)' })" -Encoding Ascii

  try {
    & node "$repo\scripts\ops\send-telegram.mjs" "Watchdog: the Genesis Buzz session was down and has been relaunched at $stamp.$gapNote (Automated ops notice, not Genesis.)" | Out-Null
  } catch {}

} else {
  Add-Content -Path $log -Value "$(Get-Date -Format s) ok" -Encoding Ascii
}

# Heartbeat: written every run, in both branches. Its age is the outage detector above.
Get-Date -Format s | Set-Content $lastOkFile -Encoding Ascii
