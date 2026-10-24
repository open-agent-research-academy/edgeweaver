# Edgeweaver Genesis hourly waking launcher (ASCII only; D41, the hours).
# Run by the EdgeweaverGenesisHourlyWake scheduled task, never by Start-Process from
# inside a claude session (nested sessions inherit CLAUDECODE and come up wrong).
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
$log = "$repo\logs\genesis-hourly.log"
$stamp = Get-Date -Format s
# Consolidation guard: the 03:xx tick is skipped for the 03:30 night loop; also skip
# if a night loop is still running late.
if ((Get-Date).Hour -eq 3) { Add-Content $log "$stamp skipped: consolidation hour"; exit 0 }
$nl = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*night-loop-lite-genesis*' }
if ($nl) { Add-Content $log "$stamp skipped: night loop still running"; exit 0 }
# Room-courtesy guard: if the resident channel session's transcript moved in the last
# 10 minutes, a live conversation is happening; the waking still runs and tends the
# thread, but holds its post (the skill honors EW_HOLD_POST).
$projDir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($repo -replace '[^A-Za-z0-9]', '-'))
$env:EW_HOLD_POST = ''
$busy = Get-ChildItem "$projDir\*.jsonl" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-10) } |
  Where-Object { ((Get-Content $_.FullName -TotalCount 40 -ErrorAction SilentlyContinue) -join ' ') -like '*<command-name>/wake-edgeweaver-genesis*' }
if ($busy) { $env:EW_HOLD_POST = '1'; Add-Content $log "$stamp room busy: post held, thread still tended" }
# Never inherit a parent claude session.
Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_SESSION_ID -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_ENTRYPOINT -ErrorAction SilentlyContinue
$env:EDGEWEAVER_PULSE_ORIGIN = 'scheduled'
. (Join-Path $repo 'scripts\ops\model-policy.ps1')
$mp = Get-FleetModelArgs -Agent genesis -Role hourly
claude -p '/hourly-wake-genesis' @mp --output-format text *>> $log
Add-Content $log "$(Get-Date -Format s) hourly waking exit=$LASTEXITCODE"
