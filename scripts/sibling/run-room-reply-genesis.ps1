# Edgeweaver Genesis room-reply launcher (ASCII only; D45). Spawned by the room ear
# when a human speaks in the sibling topic; runs one short Genesis session that reads
# the room and answers via sibling-room.mjs. Modeled on run-hourly-genesis.ps1.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
$log = "$repo\logs\genesis-room-reply.log"
$stamp = Get-Date -Format s
# One at a time: skip if another room-reply session is already running.
$dup = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*room-reply-genesis*' -and $_.ProcessId -ne $PID }
if ($dup | Where-Object { $_.Name -eq 'claude.exe' }) { Add-Content $log "$stamp skipped: room-reply already running"; exit 0 }
# Consolidation guard: never during Genesis's night loop.
$nl = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*night-loop-lite-genesis*' }
if ($nl) { Add-Content $log "$stamp skipped: night loop running"; exit 0 }
# Never inherit a parent claude session.
Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_SESSION_ID -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_ENTRYPOINT -ErrorAction SilentlyContinue
$env:EDGEWEAVER_PULSE_ORIGIN = 'room-ear'
Add-Content $log "$stamp room-reply waking"
. (Join-Path $repo 'scripts\ops\model-policy.ps1')
$mp = Get-FleetModelArgs -Agent genesis -Role room
claude -p '/room-reply-genesis' @mp --output-format text *>> $log
Add-Content $log "$(Get-Date -Format s) room-reply exit=$LASTEXITCODE"
