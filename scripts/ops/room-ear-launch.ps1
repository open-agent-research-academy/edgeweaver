# Sibling room ear launcher (ASCII only; D44). Runs the listener-only bot that mirrors
# human messages from the one shared topic into ew_ops.sibling_room (room-ear.mjs;
# token EW_SIBLING_EAR_TOKEN in repo .env.local, never here). Self-healing loop: if
# the ear exits (network blip, node crash), wait 30s and start it again. Runs from the
# scheduled task \Edgeweaver\EdgeweaverRoomEar (logon + every 15 min, since 2026-09-03),
# so every tick is also a watchdog pass:
#   - no ear running            -> this instance becomes the ear's keeper (loop below)
#   - ear running, heartbeat ok -> exit, nothing to do
#   - ear running, heartbeat stale (state/sibling-ear-heartbeat.txt older than 5 min while
#     the process is older than 5 min) -> a hung ear; end that node process and exit. The
#     keeper's loop starts a fresh ear within 30s (the Telegram offset lives in the cursor
#     file, so nothing is lost). Two ears on one token would fight over getUpdates
#     (one-poller-per-token, proven 2026-07-16), which is why a healthy ear is left alone.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$heartbeat = Join-Path $repo 'state\sibling-ear-heartbeat.txt'
$log = Join-Path $repo 'logs\room-ear.log'
$wlog = Join-Path $repo 'logs\room-ear-watchdog.log'   # the ear's own log is held open by its cmd redirect
$staleAfterSec = 300

$dup = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*room-ear.mjs*' }
if ($dup) {
  $now = Get-Date
  $procAgeSec = ($now - $dup[0].CreationDate).TotalSeconds
  $beatAgeSec = if (Test-Path $heartbeat) { ($now - (Get-Item $heartbeat).LastWriteTime).TotalSeconds } else { $procAgeSec }
  if ($procAgeSec -gt $staleAfterSec -and $beatAgeSec -gt $staleAfterSec) {
    $stamp = $now.ToString('s')
    Add-Content -Path $wlog -Value "$stamp watchdog: ear pid $($dup[0].ProcessId) alive but heartbeat $([int]$beatAgeSec)s old; ending it so the keeper loop starts a fresh one"
    foreach ($d in $dup) { Stop-Process -Id $d.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  exit 0
}

$host.UI.RawUI.WindowTitle = 'EdgeweaverRoomEar'
Set-Location $repo
# cmd owns the stderr redirect: PS 5.1 wraps a native command's stderr in
# NativeCommandError records (the documented trap), which can abort the child
# under strict preferences. Proven live 2026-08-22: the direct 2>> form killed
# the ear seconds after its first stderr line.
while ($true) {
  # Keep the log bounded: roll it at 5 MB (one generation kept).
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
    Move-Item -Path $log -Destination ($log + '.1') -Force -ErrorAction SilentlyContinue
  }
  cmd /c "node scripts\sibling\room-ear.mjs 2>> logs\room-ear.log"
  Start-Sleep -Seconds 30
}
