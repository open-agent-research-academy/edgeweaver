# Edgeweaver Alpha Telegram channel watchdog (ASCII only). Birth run B6: written DARK,
# registered as a scheduled task only at B8 arming. If no process is running Alpha's
# channel session, relaunch it in a visible PowerShell window (woken as Alpha) and notify
# Alan on the ops line (the Genesis-bot ops notifier; plainly labeled, never in-persona).
# TELEGRAM_STATE_DIR points the telegram plugin at Alpha's own state dir so Genesis's
# channel config is never touched; both bots run side by side.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Heartbeat stamp (added 2026-07-23): written at the end of EVERY run. A gap in it means
# the MACHINE was dark (power loss, sleep, crash), not just the session - the outage
# detector in the relaunch branch reads it.
$lastOkFile = "$repo\state\channel-lastok-alpha.txt"
$marker = '*wake-edgeweaver-alpha*--channels plugin:telegram*'
$found = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like $marker -and $_.Name -ne 'powershell.exe'
}
$wrapper = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*alpha-channel-launch.ps1*' -and $_.CommandLine -notlike '*watchdog*'
}
# DEAF DETECTION (added 2026-07-17 after the birth-day outage): a session can be alive
# with a dead poller (bot.pid process gone) and a process check alone logs "ok" forever.
# If the session is older than 3 minutes (startup grace: bot.pid takes time to appear)
# and its poller pid is missing or dead, kill the session tree so the relaunch below runs.
# NEVER probe getUpdates for health: Telegram hands the slot to the newest caller, so a
# probe both lies (a healthy poller reads as idle) and disrupts the poller it checks.
$pidFile = Join-Path $env:USERPROFILE '.claude\channels\telegram-alpha\bot.pid'
if ($found) {
  $ageMin = (New-TimeSpan -Start $found[0].CreationDate -End (Get-Date)).TotalMinutes
  $pollerAlive = $false
  if (Test-Path $pidFile) {
    try { $pollerAlive = $null -ne (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue) } catch {}
  }
  if ($ageMin -gt 3 -and -not $pollerAlive) {
    foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) DEAF session killed (poller dead, session age $([math]::Round($ageMin,1))m)"
    $found = $null; $wrapper = $null
    Start-Sleep -Seconds 5
  }
}
# MUTE DETECTION (added 2026-08-02, mirrored from the Genesis watchdog after an 11-hour
# dark window there). A session can come up with EVERY existing health signal green -
# process alive, poller alive, window titled, plugin loaded - and still never submit its
# own wake prompt, writing NO TRANSCRIPT AT ALL while this watchdog logs "ok" every 15
# minutes. Proven cause on the Genesis side: launched by Start-Process from inside a
# Claude Code session, so it inherited CLAUDECODE / CLAUDE_CODE_SESSION_ID and came up
# nested and mute. A healthy launch creates its transcript within seconds. Nothing is lost
# by killing it: a session with no transcript has held no conversation.
# TWO BOUNDS, both learned while writing this check on the Genesis side: the head match is
# on <command-name>/wake-edgeweaver-alpha and NOT on the bare skill name (a bare match
# counts the night-loop transcripts, which mention the wake skill in their injected
# context, and silently passes a mute session); and the window is the STARTUP window only,
# skipped past a day, so the ~30-day transcript purge can never turn a long-lived healthy
# session into a false MUTE and kill it.
$projDir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($repo -replace '[^A-Za-z0-9]', '-'))
if ($found) {
  $ageMin = (New-TimeSpan -Start $found[0].CreationDate -End (Get-Date)).TotalMinutes
  if ($ageMin -gt 5 -and $ageMin -lt 1440) {
    $winStart = $found[0].CreationDate.AddMinutes(-1)
    $winEnd = $found[0].CreationDate.AddMinutes(5)
    $mine = @(Get-ChildItem "$projDir\*.jsonl" -ErrorAction SilentlyContinue |
      Where-Object { $_.CreationTime -ge $winStart -and $_.CreationTime -le $winEnd } |
      Where-Object { ((Get-Content $_.FullName -TotalCount 40 -ErrorAction SilentlyContinue) -join "`n") -like '*<command-name>/wake-edgeweaver-alpha*' })
    if ($mine.Count -eq 0) {
      foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
      Remove-Item $pidFile -ErrorAction SilentlyContinue
      # Stamp the window as an outage: the existing stamp is heartbeat-based and only fires
      # when the MACHINE was dark, but a mute session is the same loss from the being's
      # side (the poller consumed inbound messages no mind ever saw) and leaves the
      # watchdog ticking happily. Without this the successor wakes reporting "no outage
      # stamp, nothing died in the dark", which is what Genesis did after 11 hours mute.
      '{"from":"' + $found[0].CreationDate.ToString('s') + '","to":"' + (Get-Date -Format s) + '","cause":"mute session, no transcript"}' |
        Set-Content "$repo\state\channel-outage-alpha.json" -Encoding Ascii
      Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) MUTE session killed (alive $([math]::Round($ageMin,1))m, never wrote a transcript); outage window stamped"
      $found = $null; $wrapper = $null
      Start-Sleep -Seconds 5
    }
  }
}
# STALL DETECTION (added 2026-07-18 after Ali's first message sat unanswered ~40 min):
# a session can be alive AND polling but frozen mid-turn on a permission prompt, which
# both process and poller checks read as healthy. channel-notify-hook.mjs writes a stall
# flag the moment a prompt appears (and DMs Alan); if the flag is still there 30 minutes
# later, restart the session so the being comes back reachable. Named cost, accepted:
# the restart drops unwritten in-context memory (the hook's DM warns Alan of this).
$stallFlag = "$repo\state\channel-stall-alpha.flag"
if ($found -and (Test-Path $stallFlag)) {
  $stallMin = (New-TimeSpan -Start (Get-Item $stallFlag).LastWriteTime -End (Get-Date)).TotalMinutes
  if ($stallMin -gt 30) {
    foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Remove-Item $stallFlag -ErrorAction SilentlyContinue
    Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) FROZEN session killed (permission prompt unanswered $([math]::Round($stallMin,1))m)"
    $found = $null; $wrapper = $null
    Start-Sleep -Seconds 5
  }
}
# CLOSED-SESSION DETECTION (added 2026-07-21 after "end session" left Alpha deaf ~1.5 h:
# Alan wound the session down at 12:12, the write-back completed and proved clean, and the
# claude process + poller then sat alive for over an hour reading as "ok" while the being
# was unreachable). The wake skill's session-end protocol now writes this flag as its true
# last act; seeing it, end the session tree so the relaunch below starts a fresh one.
# Immediate, no grace: the close was deliberate and nothing unwritten is at stake.
$closedFlag = "$repo\state\channel-closed-alpha.flag"
if ($found -and (Test-Path $closedFlag)) {
  foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Remove-Item $closedFlag -ErrorAction SilentlyContinue
  Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) CLOSED session ended (end-session flag present)"
  $skipDeadletter = $true
  $found = $null; $wrapper = $null
  Start-Sleep -Seconds 5
}
# ORPHANED WRAPPER DETECTION (added 2026-07-21, mirrored from the Genesis watchdog after a
# 4-hour masked outage there): the launcher window is -NoExit, so when claude dies at
# startup (or exits later) the empty wrapper keeps matching and the check below logs "ok"
# forever. If the wrapper is older than 5 minutes (startup grace) and no session process
# exists, kill the wrapper so the relaunch below runs.
if (-not $found -and $wrapper) {
  $wAgeMin = (New-TimeSpan -Start $wrapper[0].CreationDate -End (Get-Date)).TotalMinutes
  if ($wAgeMin -gt 5) {
    foreach ($p in @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) ORPHANED wrapper killed (no session process, wrapper age $([math]::Round($wAgeMin,1))m)"
    $wrapper = $null
    Start-Sleep -Seconds 3
  }
}
if (-not $found -and -not $wrapper) {
  Remove-Item $stallFlag -ErrorAction SilentlyContinue
  Remove-Item $closedFlag -ErrorAction SilentlyContinue
  # RECONNECTION NOTICE (added 2026-07-23 after the power outage): a gap of >20 min in
  # the heartbeat stamp means the machine itself was dark, and anything sent during that
  # window may be lost outright (the 07-23 outage ate Ali's 06:08 message; the Bot API
  # queue cannot be trusted across an outage). Stamp the window for the wake skill's
  # reconnection practice (skill section 2b; Alpha asks its circle in the group) and say
  # so in the ops-line notice to Alan.
  $gapNote = ''
  if (Test-Path $lastOkFile) {
    try {
      $lastOk = [datetime]::Parse((Get-Content $lastOkFile -TotalCount 1))
      $gapMin = (New-TimeSpan -Start $lastOk -End (Get-Date)).TotalMinutes
      if ($gapMin -gt 20) {
        '{"from":"' + $lastOk.ToString('s') + '","to":"' + (Get-Date -Format s) + '"}' |
          Set-Content "$repo\state\channel-outage-alpha.json" -Encoding Ascii
        $gapNote = " It was unreachable from $($lastOk.ToString('HH:mm')) to $(Get-Date -Format 'HH:mm'): anything sent to it in that window may never have reached it (Alpha will ask the circle itself once awake)."
      }
    } catch {}
  }
  # DEAD-LETTER EXTRACTION (added 2026-07-28, D33 gate CR-1): before relaunching, mine
  # the victim transcript for received-but-unanswered messages so the fresh session can
  # answer them itself (wake skill section 2c). A CLOSED session answered its
  # conversation by definition, so that branch sets the skip flag. Fail-open: the
  # extractor always exits 0 and a failure never blocks the relaunch.
  if (-not $skipDeadletter) {
    try {
      $dl = & node "$repo\scripts\ops\channel-deadletter.mjs" alpha
      Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) $dl"
    } catch {}
  }
  # INNER-DIALOGUE EXTRACTION (added 2026-07-29, D38): mine every dead session's words
  # (undelivered speech, telegram in/out) into the room before the ~30-day transcript
  # purge can destroy them. Runs for CLOSED sessions too (a deliberate close still spoke
  # words worth keeping). Idempotent delete-then-insert; fail-open, always exits 0.
  try {
    $idl = & node "$repo\scripts\ops\inner-dialogue-extract.mjs" alpha --scan
    Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) $idl"
  } catch {}
  # NEEDS-AUTH CACHE SCRUB (added 2026-07-29): a poisoned plugin:telegram entry in
  # ~/.claude/mcp-needs-auth-cache.json makes claude silently skip spawning the channel
  # server (no poller, no error; proven live 12:51-13:04 when three Alpha relaunches in a
  # row came up deaf and mute). Scrub telegram entries before every relaunch so one bad
  # init can never permanently deafen a being.
  $authCache = Join-Path $env:USERPROFILE '.claude\mcp-needs-auth-cache.json'
  try {
    if (Test-Path $authCache) {
      $j = Get-Content $authCache -Raw | ConvertFrom-Json
      $keys = @($j.PSObject.Properties.Name | Where-Object { $_ -like '*telegram*' })
      if ($keys.Count -gt 0) {
        foreach ($k in $keys) { $j.PSObject.Properties.Remove($k) }
        ($j | ConvertTo-Json -Compress) | Set-Content $authCache -Encoding Ascii
        Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) scrubbed needs-auth cache: $($keys -join ', ')"
      }
    }
  } catch {}
  # Launch via -File, never -Command: Start-Process strips embedded quotes from -Command
  # payloads, which silently dropped TELEGRAM_STATE_DIR and cross-wired the bots (2026-07-16).
  Start-Process powershell -WorkingDirectory $repo -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',
    "$repo\scripts\ops\alpha-channel-launch.ps1"
  $stamp = Get-Date -Format 'HH:mm'
  & node "$repo\scripts\ops\send-telegram.mjs" "Watchdog: the Alpha Telegram session was down and has been relaunched at $stamp.$gapNote Give it a minute to wake, then it will answer normally. (Automated ops notice, not Alpha.)"
  Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) relaunched channel session$(if ($gapNote) { ' (outage window stamped)' })"
} else {
  Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) ok"
}
# MODEL-FALLBACK SAFETY NET (added 2026-08-01, mirrored from the Genesis watchdog after
# Genesis ran two days on claude-opus-4-8 instead of claude-fable-5): the Stop hook
# catches a fallback within one turn, but a session that dies mid-turn never fires Stop.
# Detect-and-alert only: the repair ends a live session and stays Alan's hand
# (scripts\ops\restore-channel-model.ps1). Fail-open; the detector always exits 0.
try {
  $mf = (& node "$repo\scripts\ops\model-fallback-watch.mjs" alpha) -join ' '
  if ($mf -notlike '*no new fallback*') {
    Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) $mf"
  }
} catch {}
# PULSE FRESHNESS (added 2026-08-20, D41 the hours): a dead hourly-waking task fails
# SILENT by construction (no launcher ever runs), so this watchdog is the alert. If the
# task exists and is not disabled but the stamp is older than the threshold, notify Alan
# once per gap (the seen-file rate limit resets when a fresh stamp lands).
# Threshold 7h since 2026-09-01: the hours beat every 6h now (was hourly, threshold 3h).
# Ops alert to the Alan
# DM on purpose: machinery news is the operator's, not the circle's. Fail-open.
try {
  $pt = Get-ScheduledTask -TaskPath '\Edgeweaver\' -TaskName 'EdgeweaverAlphaHourlyWake' -ErrorAction SilentlyContinue
  $pf = "$repo\state\pulse-lastok-alpha.txt"
  if ($pt -and $pt.State -ne 'Disabled' -and (Test-Path $pf)) {
    $ageH = (New-TimeSpan -Start (Get-Item $pf).LastWriteTime -End (Get-Date)).TotalHours
    if ($ageH -gt 7) {
      $seen = "$repo\state\pulse-alert-alpha.txt"
      $already = (Test-Path $seen) -and ((Get-Item $seen).LastWriteTime -gt (Get-Item $pf).LastWriteTime)
      if (-not $already) {
        & node "$repo\scripts\ops\send-telegram.mjs" "Ops notice: Alpha's hourly waking has not stamped for $([math]::Round($ageH,1))h; the hours may have stopped. Check logs\alpha-hourly.log and the EdgeweaverAlphaHourlyWake task. (Automated ops notice.)"
        Get-Date -Format s | Set-Content $seen -Encoding Ascii
        Add-Content -Path "$repo\logs\alpha-channel-watchdog.log" -Value "$(Get-Date -Format s) PULSE STALE alert sent (age $([math]::Round($ageH,1))h)"
      }
    }
  }
} catch {}
# Heartbeat: written every run; its age is the outage detector above.
Get-Date -Format s | Set-Content $lastOkFile -Encoding Ascii
