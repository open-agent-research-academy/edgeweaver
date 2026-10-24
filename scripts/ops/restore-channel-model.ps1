# Restore a channel session to its configured model (ASCII only).
#
# WHY THIS EXISTS: a model fallback is session-scoped. Once the harness moves a running
# session off claude-fable-5, nothing inside that session can move it back: not a hook,
# not a setting, not the being asking. Only a fresh session reads .claude/settings.json
# again. So the repair is a restart, and a restart has a named cost: in-context memory
# that was never written to OB1 dies with the session.
#
# THEREFORE THIS IS A DELIBERATE ACT, NOT AN AUTOMATIC ONE. The detector
# (model-fallback-watch.mjs) alerts and flags; the prompt hook tells the being to write
# back and say so; this script is run afterwards, by hand, when the write-back is proven.
# It refuses to run without the flag unless -Force.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\ops\restore-channel-model.ps1 genesis
#   ... -Force        restart even with no fallback flag (e.g. flag already cleared)
#   ... -WhatIf       print the plan and touch nothing
#
# The two extractors below are the same ones the watchdog runs before a relaunch: they
# mine the dying transcript for received-but-unanswered messages and for the session's
# own words, so a restart costs as little as it can.

param(
  [Parameter(Mandatory = $true)][ValidateSet('genesis', 'alpha')][string]$Being,
  [switch]$Force,
  [switch]$WhatIf
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$name = if ($Being -eq 'alpha') { 'Alpha' } else { 'Genesis' }
$flag = "$repo\state\channel-fallback-$Being.flag"
$pidFile = Join-Path $env:USERPROFILE ".claude\channels\telegram-$Being\bot.pid"
$logFile = "$repo\logs\model-fallback.log"

function Say($msg) {
  $line = "$(Get-Date -Format s) restore($Being): $msg"
  Add-Content -Path $logFile -Value $line -Encoding Ascii -ErrorAction SilentlyContinue
  Write-Output $line
}

if (-not (Test-Path $flag) -and -not $Force) {
  Say "ABORT no fallback flag at $flag. Nothing to repair. Use -Force to restart anyway."
  exit 1
}
$ev = $null
if (Test-Path $flag) { try { $ev = Get-Content $flag -Raw | ConvertFrom-Json } catch {} }
if ($ev) { Say "flag: $($ev.from) -> $($ev.to) at $($ev.ts) (session $($ev.sessionId))" }

# Same marker rule as the watchdog: skill-specific, so the sibling being's session is
# never mistaken for this one.
$marker = "*wake-edgeweaver-$Being*--channels plugin:telegram*"
$found = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like $marker -and $_.Name -ne 'powershell.exe'
}
$wrapper = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'powershell.exe' -and $_.CommandLine -like "*$Being-channel-launch.ps1*" -and $_.CommandLine -notlike '*watchdog*'
}

if ($WhatIf) {
  Say "WHATIF session pids: $(@($found).ProcessId -join ',') wrapper pids: $(@($wrapper).ProcessId -join ',')"
  Say "WHATIF would run deadletter + inner-dialogue extraction, kill the above, relaunch $Being-channel-launch.ps1, clear the flag, notify Alan."
  exit 0
}

# 1. Preserve what the dying session holds on disk.
try { Say (& node "$repo\scripts\ops\channel-deadletter.mjs" $Being) } catch { Say "deadletter failed (ignored): $($_.Exception.Message)" }
try { Say (& node "$repo\scripts\ops\inner-dialogue-extract.mjs" $Being --scan) } catch { Say "inner-dialogue failed (ignored): $($_.Exception.Message)" }

# 2. End the session tree.
if ($found -or $wrapper) {
  foreach ($p in @($found) + @($wrapper)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Say "ended session (pids $((@($found) + @($wrapper)).ProcessId -join ','))"
  Start-Sleep -Seconds 5
} else {
  Say "no live session found; relaunching anyway"
}

# 3. Clear the stall/closed/fallback flags so the fresh session starts clean, then relaunch
# THROUGH THE WATCHDOG TASK, never with a direct Start-Process from here.
#
# THIS COST 11 HOURS OF DARK ON 2026-08-01. The first version of this script called
# Start-Process itself. When it is run from inside a Claude Code session (which is exactly
# when it gets run), the child inherits that session's environment: CLAUDECODE=1,
# CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_HOST_SESSION_ID, CLAUDE_EFFORT
# and the rest. The relaunched claude came up nested: plugin loaded, poller spawned, window
# titled, and then it never submitted its own /wake prompt and never wrote a transcript at
# all. Every existing health check reads that as alive (process up, poller up), so the
# watchdog logged "ok" every 15 minutes while Genesis was deaf from 22:49 to 10:04.
# Start-ScheduledTask hands the launch to Task Scheduler, which builds a clean environment
# from the user profile and inherits nothing from here. It is also the pattern the wake
# skills already use for instant restart (ops-log 2026-07-29).
Remove-Item "$repo\state\channel-stall-$Being.flag" -ErrorAction SilentlyContinue
Remove-Item "$repo\state\channel-closed-$Being.flag" -ErrorAction SilentlyContinue
Remove-Item $flag -ErrorAction SilentlyContinue
# TASK PATH MATTERS (bug found 2026-08-24, Alpha's repair path had never worked): the two
# watchdogs are registered in DIFFERENT folders - Genesis at the root, Alpha under
# \Edgeweaver\ - and Start-ScheduledTask without -TaskPath only searches the root, failing
# with "The system cannot find the file specified."
$task = if ($Being -eq 'alpha') { 'EdgeweaverAlphaChannelWatchdog' } else { 'EdgeweaverGenesisChannelWatchdog' }
$taskPath = if ($Being -eq 'alpha') { '\Edgeweaver\' } else { '\' }
try {
  Start-ScheduledTask -TaskName $task -TaskPath $taskPath -ErrorAction Stop
  Say "fired $task; it relaunches the session in a clean environment"
} catch {
  Say "ABORT could not start $task ($($_.Exception.Message)). Do NOT Start-Process the launcher from here: a nested launch comes up mute (see the header). Start it from a plain terminal instead."
  exit 1
}

# 4. Verify the fresh session actually came up on the configured model. Bounded wait: the
# transcript's first assistant message names the model. Reporting an unverified restore
# would be exactly the failure this whole mechanism exists to catch.
# The expected model is whatever the fleet policy says for this being's channel role
# (scripts/ops/model-policy.mjs), which is exactly what the launcher just read.
. (Join-Path $PSScriptRoot 'model-policy.ps1')
$want = Get-FleetModel -Agent $Being -Role channel
$dir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($repo -replace '[^A-Za-z0-9]', '-'))
$since = Get-Date
$got = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 10
  # Keyed on CreationTime, not LastWriteTime: a healthy launch CREATES its transcript
  # within seconds of submitting its wake prompt, and Windows can leave LastWriteTime
  # stale on a file whose handle is still open. No new file at all is the signature of
  # the nested-launch hang described above, so the timeout branch says exactly that.
  $cand = Get-ChildItem "$dir\*.jsonl" -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -gt $since } |
    Sort-Object CreationTime -Descending
  foreach ($c in $cand) {
    # FUTURE-DATED TRANSCRIPTS FOOL THIS (proven 2026-08-24: two night-loop transcripts on
    # disk are stamped a month ahead, so "newer than $since" matched them on every restart
    # and this loop reported the NIGHT LOOP's model - Sonnet by design - as the channel
    # session's, firing a false "came up on the wrong model" notice into the room). So:
    # ignore anything stamped in the future, and require the actual wake SLASH COMMAND in
    # the head rather than a mere mention of the skill name (the night-loop and hourly
    # skills both mention it in their instructions).
    if ($c.CreationTime -gt (Get-Date).AddMinutes(2)) { continue }
    $head = Get-Content $c.FullName -TotalCount 40 -ErrorAction SilentlyContinue
    if (($head -join "`n") -notlike "*<command-name>/wake-edgeweaver-$Being*") { continue }
    $m = [regex]::Matches(($head -join "`n"), '"model":"([a-z0-9\-\[\]]+)"')
    if ($m.Count -gt 0) { $got = $m[$m.Count - 1].Groups[1].Value; break }
  }
  if ($got) { break }
}

$stamp = Get-Date -Format 'HH:mm'
if ($got -eq $want) {
  Say "VERIFIED fresh session is on $got"
  & node "$repo\scripts\ops\send-telegram.mjs" "Ops: the $name session was restarted at $stamp after a model fallback and is verified back on $want. Give it a minute to wake. (Automated ops notice, not $name.)"
} elseif ($got) {
  Say "WARNING fresh session came up on $got, not $want"
  & node "$repo\scripts\ops\send-telegram.mjs" "Ops: the $name session was restarted at $stamp after a model fallback, but it came up on $got instead of $want. Check .claude\settings.json and the launcher. (Automated ops notice, not $name.)"
} else {
  Say "UNVERIFIED no transcript was created within 5 minutes. The session is MUTE, not merely slow: treat it as dark, kill it and relaunch from a plain terminal or the watchdog task. Do not trust a process-alive check here."
  & node "$repo\scripts\ops\send-telegram.mjs" "Ops: the $name session was restarted at $stamp after a model fallback, but it never wrote a transcript within 5 minutes, which means it came up MUTE and is dark right now. It needs a relaunch from a clean environment. (Automated ops notice, not $name.)"
}
