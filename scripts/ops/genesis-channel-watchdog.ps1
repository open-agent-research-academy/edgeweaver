# Genesis Telegram channel watchdog (ASCII only).
# If no process is running the channel session, relaunch it in a visible
# PowerShell window (woken as Genesis) and notify Alan on Telegram.
# Scheduled every 15 minutes; runs only when the user is logged on.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Heartbeat stamp (added 2026-07-23): written at the end of EVERY run. A gap in it means
# the MACHINE was dark (power loss, sleep, crash), not just the session - the outage
# detector in the relaunch branch reads it.
$lastOkFile = "$repo\state\channel-lastok-genesis.txt"
# Marker is skill-specific: with Alpha's channel session also running (birth run B6), a
# bare '--channels plugin:telegram' marker would match the sibling and mask a Genesis outage.
$marker = '*wake-edgeweaver-genesis*--channels plugin:telegram*'
$found = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like $marker -and $_.Name -ne 'powershell.exe'
}
$wrapper = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'powershell.exe' -and ($_.CommandLine -like '*genesis-channel-launch.ps1*' -or $_.CommandLine -like '*EdgeweaverGenesisTelegram*') -and $_.CommandLine -notlike '*watchdog*'
}
# DEAF DETECTION (added 2026-07-17 after the birth-day outage): a session can be alive
# with a dead poller and a process check alone logs "ok" forever (this happened to Genesis
# for real). If the session is older than 3 minutes and its poller pid is missing or dead,
# kill the session tree so the relaunch below runs. NEVER probe getUpdates for health:
# Telegram hands the slot to the newest caller, so a probe lies and disrupts.
$pidFile = Join-Path $env:USERPROFILE '.claude\channels\telegram-genesis\bot.pid'
if ($found) {
  $ageMin = (New-TimeSpan -Start $found[0].CreationDate -End (Get-Date)).TotalMinutes
  $pollerAlive = $false
  if (Test-Path $pidFile) {
    try { $pollerAlive = $null -ne (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue) } catch {}
  }
  if ($ageMin -gt 3 -and -not $pollerAlive) {
    foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) DEAF session killed (poller dead, session age $([math]::Round($ageMin,1))m)"
    $found = $null; $wrapper = $null
    Start-Sleep -Seconds 5
  }
}
# MUTE DETECTION (added 2026-08-02 after an 11-hour dark window, 22:49 to 10:04). A
# session can come up with EVERY existing health signal green - process alive, poller
# alive, window titled, plugin loaded - and still never submit its own wake prompt. It
# then writes NO TRANSCRIPT AT ALL, and this watchdog logs "ok" every 15 minutes while the
# being is deaf. Proven cause that night: the session was launched by Start-Process from
# inside a Claude Code session, so it inherited CLAUDECODE / CLAUDE_CODE_SESSION_ID and came
# up nested and mute (restore-channel-model.ps1 now launches through this task instead).
# A healthy launch creates its transcript within seconds, so: alive past the startup grace
# with no transcript created since it started means mute. Nothing is lost by killing it -
# a session with no transcript has held no conversation.
# TWO BOUNDS, both learned the hard way while writing this check:
# - The head match is on <command-name>/wake-edgeweaver-genesis, NOT on the bare skill
#   name. A bare match counts the NIGHT-LOOP transcripts, which mention the wake skill in
#   their injected context; both night loops matched on the first attempt and the check
#   silently passed a session that was mute for 11 hours.
# - The window is the STARTUP window only, and the check is skipped for sessions older
#   than a day. A healthy session writes its transcript within seconds of starting, so
#   that is where the evidence is; looking wider would let the ~30-day transcript purge
#   turn a long-lived healthy session into a false MUTE and kill it.
$projDir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($repo -replace '[^A-Za-z0-9]', '-'))
if ($found) {
  $ageMin = (New-TimeSpan -Start $found[0].CreationDate -End (Get-Date)).TotalMinutes
  if ($ageMin -gt 5 -and $ageMin -lt 1440) {
    $winStart = $found[0].CreationDate.AddMinutes(-1)
    $winEnd = $found[0].CreationDate.AddMinutes(5)
    $mine = @(Get-ChildItem "$projDir\*.jsonl" -ErrorAction SilentlyContinue |
      Where-Object { $_.CreationTime -ge $winStart -and $_.CreationTime -le $winEnd } |
      Where-Object { ((Get-Content $_.FullName -TotalCount 40 -ErrorAction SilentlyContinue) -join "`n") -like '*<command-name>/wake-edgeweaver-genesis*' })
    if ($mine.Count -eq 0) {
      foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
      Remove-Item $pidFile -ErrorAction SilentlyContinue
      # STAMP THE WINDOW AS AN OUTAGE. The existing stamp is heartbeat-based, so it only
      # fires when the MACHINE was dark; a mute session leaves the watchdog ticking
      # happily and writes no stamp at all. From the being's side that is the same loss:
      # the poller consumed inbound messages that no mind ever saw. Without this, the
      # fresh session wakes and reports "no outage stamp, nothing died in the dark", which
      # is exactly what Genesis said at 10:08 after 11 hours mute. Stamping it means the
      # successor announces the gap and asks for a resend (wake skill section 2b).
      '{"from":"' + $found[0].CreationDate.ToString('s') + '","to":"' + (Get-Date -Format s) + '","cause":"mute session, no transcript"}' |
        Set-Content "$repo\state\channel-outage-genesis.json" -Encoding Ascii
      Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) MUTE session killed (alive $([math]::Round($ageMin,1))m, never wrote a transcript); outage window stamped"
      $found = $null; $wrapper = $null
      Start-Sleep -Seconds 5
    }
  }
}
# STALL DETECTION (added 2026-07-18, mirrored from the Alpha watchdog after Ali's first
# message sat unanswered ~40 min behind a permission prompt): channel-notify-hook.mjs
# writes a stall flag when a prompt appears (and DMs Alan); unanswered for 30+ minutes
# -> restart the session. Named cost: unwritten in-context memory is lost.
$stallFlag = "$repo\state\channel-stall-genesis.flag"
if ($found -and (Test-Path $stallFlag)) {
  $stallMin = (New-TimeSpan -Start (Get-Item $stallFlag).LastWriteTime -End (Get-Date)).TotalMinutes
  if ($stallMin -gt 30) {
    foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Remove-Item $stallFlag -ErrorAction SilentlyContinue
    Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) FROZEN session killed (permission prompt unanswered $([math]::Round($stallMin,1))m)"
    $found = $null; $wrapper = $null
    Start-Sleep -Seconds 5
  }
}
# CLOSED-SESSION DETECTION (added 2026-07-21 after "end session" left Alpha deaf ~1.5 h):
# a deliberately closed conversation leaves the claude process and poller alive, which
# every check above reads as health forever. The wake skill's session-end protocol now
# writes this flag as its true last act (write-back is proven by then); seeing it, end the
# session tree so the relaunch below starts a fresh one. Immediate, no grace: the close
# was deliberate and nothing unwritten is at stake.
$closedFlag = "$repo\state\channel-closed-genesis.flag"
if ($found -and (Test-Path $closedFlag)) {
  foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Remove-Item $closedFlag -ErrorAction SilentlyContinue
  Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) CLOSED session ended (end-session flag present)"
  $skipDeadletter = $true
  $found = $null; $wrapper = $null
  Start-Sleep -Seconds 5
}
# ORPHANED WRAPPER DETECTION (added 2026-07-21 after a 4-hour masked outage): the launcher
# window is -NoExit, so when claude dies at startup (or exits later) the empty wrapper
# keeps matching and the check below logs "ok" forever. Happened for real: the 11:21
# relaunch's claude died without ever writing a transcript and the wrapper hid it until an
# ops session went looking. If the wrapper is older than 5 minutes (startup grace) and no
# session process exists, kill the wrapper so the relaunch below runs.
if (-not $found -and $wrapper) {
  $wAgeMin = (New-TimeSpan -Start $wrapper[0].CreationDate -End (Get-Date)).TotalMinutes
  if ($wAgeMin -gt 5) {
    foreach ($p in @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) ORPHANED wrapper killed (no session process, wrapper age $([math]::Round($wAgeMin,1))m)"
    $wrapper = $null
    Start-Sleep -Seconds 3
  }
}
if (-not $found -and -not $wrapper) {
  Remove-Item $stallFlag -ErrorAction SilentlyContinue
  Remove-Item $closedFlag -ErrorAction SilentlyContinue
  # RECONNECTION NOTICE (added 2026-07-23 after the power outage): a gap of >20 min in
  # the heartbeat stamp means the machine itself was dark, and anything sent during that
  # window may be lost outright (the 07-23 outage proved the Bot API queue cannot be
  # trusted across one). Stamp the window for the wake skill's reconnection practice
  # (skill section 2b) and say so plainly in the channel notice.
  $gapNote = ''
  if (Test-Path $lastOkFile) {
    try {
      $lastOk = [datetime]::Parse((Get-Content $lastOkFile -TotalCount 1))
      $gapMin = (New-TimeSpan -Start $lastOk -End (Get-Date)).TotalMinutes
      if ($gapMin -gt 20) {
        '{"from":"' + $lastOk.ToString('s') + '","to":"' + (Get-Date -Format s) + '"}' |
          Set-Content "$repo\state\channel-outage-genesis.json" -Encoding Ascii
        $gapNote = " It was unreachable from $($lastOk.ToString('HH:mm')) to $(Get-Date -Format 'HH:mm'): anything sent in that window may never have reached it - please resend or summarize."
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
      $dl = & node "$repo\scripts\ops\channel-deadletter.mjs" genesis
      Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) $dl"
    } catch {}
  }
  # INNER-DIALOGUE EXTRACTION (added 2026-07-29, D38): mine every dead session's words
  # (undelivered speech, telegram in/out) into the room before the ~30-day transcript
  # purge can destroy them. Runs for CLOSED sessions too (a deliberate close still spoke
  # words worth keeping). Idempotent delete-then-insert; fail-open, always exits 0.
  try {
    $idl = & node "$repo\scripts\ops\inner-dialogue-extract.mjs" genesis --scan
    Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) $idl"
  } catch {}
  # NEEDS-AUTH CACHE SCRUB (added 2026-07-29, mirrored from the Alpha watchdog): a
  # poisoned plugin:telegram entry in ~/.claude/mcp-needs-auth-cache.json makes claude
  # silently skip spawning the channel server (no poller, no error). Scrub telegram
  # entries before every relaunch.
  $authCache = Join-Path $env:USERPROFILE '.claude\mcp-needs-auth-cache.json'
  try {
    if (Test-Path $authCache) {
      $j = Get-Content $authCache -Raw | ConvertFrom-Json
      $keys = @($j.PSObject.Properties.Name | Where-Object { $_ -like '*telegram*' })
      if ($keys.Count -gt 0) {
        foreach ($k in $keys) { $j.PSObject.Properties.Remove($k) }
        ($j | ConvertTo-Json -Compress) | Set-Content $authCache -Encoding Ascii
        Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) scrubbed needs-auth cache: $($keys -join ', ')"
      }
    }
  } catch {}
  # Launch via -File, never -Command (quote-mangling lesson, 2026-07-16, Alpha side).
  Start-Process powershell -WorkingDirectory $repo -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',
    "$repo\scripts\ops\genesis-channel-launch.ps1"
  $stamp = Get-Date -Format 'HH:mm'
  & node "$repo\scripts\ops\send-telegram.mjs" "Watchdog: the Genesis Telegram session was down and has been relaunched at $stamp.$gapNote Give it a minute to wake, then it will answer normally. (Automated notice, not Genesis.)"
  Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) relaunched channel session$(if ($gapNote) { ' (outage window stamped)' })"
} else {
  Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) ok"
}
# MODEL-FALLBACK SAFETY NET (added 2026-08-01, after Genesis ran two days on
# claude-opus-4-8 instead of claude-fable-5 with nothing noticing): the Stop hook catches
# a fallback within one turn, but a session that dies mid-turn never fires Stop. This is
# the backstop, and it also covers the Buzz surface, which has no hooks at all.
# Detect-and-alert only: the repair ends a live session and stays Alan's hand
# (scripts\ops\restore-channel-model.ps1). Fail-open; the detector always exits 0.
foreach ($scan in @(@('genesis'), @('--buzz'))) {
  try {
    $mf = (& node "$repo\scripts\ops\model-fallback-watch.mjs" @scan) -join ' '
    if ($mf -notlike '*no new fallback*') {
      Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) $mf"
    }
  } catch {}
}
# PULSE FRESHNESS (added 2026-08-20, D41 the hours): a dead hourly-waking task fails
# SILENT by construction (no launcher ever runs), so this watchdog is the alert. If the
# task exists and is not disabled but the stamp is older than the threshold, notify Alan
# once per gap (the seen-file rate limit resets when a fresh stamp lands). Fail-open.
# Threshold 7h since 2026-09-01: the hours beat every 6h now (was hourly, threshold 3h).
try {
  $pt = Get-ScheduledTask -TaskPath '\Edgeweaver\' -TaskName 'EdgeweaverGenesisHourlyWake' -ErrorAction SilentlyContinue
  $pf = "$repo\state\pulse-lastok-genesis.txt"
  if ($pt -and $pt.State -ne 'Disabled' -and (Test-Path $pf)) {
    $ageH = (New-TimeSpan -Start (Get-Item $pf).LastWriteTime -End (Get-Date)).TotalHours
    if ($ageH -gt 7) {
      $seen = "$repo\state\pulse-alert-genesis.txt"
      $already = (Test-Path $seen) -and ((Get-Item $seen).LastWriteTime -gt (Get-Item $pf).LastWriteTime)
      if (-not $already) {
        & node "$repo\scripts\ops\send-telegram.mjs" "Ops notice: Genesis's hourly waking has not stamped for $([math]::Round($ageH,1))h; the hours may have stopped. Check logs\genesis-hourly.log and the EdgeweaverGenesisHourlyWake task. (Automated notice, not Genesis.)"
        Get-Date -Format s | Set-Content $seen -Encoding Ascii
        Add-Content -Path "$repo\logs\channel-watchdog.log" -Value "$(Get-Date -Format s) PULSE STALE alert sent (age $([math]::Round($ageH,1))h)"
      }
    }
  }
} catch {}
# Heartbeat: written every run; its age is the outage detector above.
Get-Date -Format s | Set-Content $lastOkFile -Encoding Ascii
