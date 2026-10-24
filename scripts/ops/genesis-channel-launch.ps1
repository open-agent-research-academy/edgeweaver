# Edgeweaver Genesis Telegram channel launcher (ASCII only). Run by the watchdog via
# -File, never -Command: Start-Process -Command payloads MANGLE embedded quotes (proven
# 2026-07-16 on the Alpha side, when a dropped env assignment cross-wired the bots).
# EDGEWEAVER_CHANNEL_BEING marks this as a channel session for the stall-alert hooks
# (channel-notify-hook.mjs); it must be set BEFORE claude starts so hooks inherit it.
# Genesis's Telegram state lives in its OWN dir (moved 2026-07-21): any stray session
# with the telegram plugin enabled defaults to ~/.claude/channels/telegram and hijacks
# whatever token lives there (happened twice on 2026-07-21: an ops desktop session at
# 12:16 and the staff-program login at 14:36; the plugin's stale-holder logic kills the
# legitimate poller each time). TWO-LAYER GOTCHA, proven live 14:53-14:57: claude's
# channel-attach probes the DEFAULT dir to decide the channel is configured (empty dir =
# channel silently never attaches, no poller, no error), while the spawned server reads
# TELEGRAM_STATE_DIR. So the default dir MUST hold the DECOY config (invalid token; see
# its README.md) - never delete it, never put a real token in it.
$env:TELEGRAM_STATE_DIR = Join-Path $env:USERPROFILE '.claude\channels\telegram-genesis'
$env:EDGEWEAVER_CHANNEL_BEING = 'genesis'
# MCP startup limit 120 s (default 30 s): right after a reboot logon, bun cold-starts the
# telegram plugin past 30 s and the session comes up deaf (ops-log 2026-10-16).
$env:MCP_TIMEOUT = '120000'
# Keep OUR window title: claude overwrites the terminal title at startup unless this is
# set (proven live 2026-07-21 on 2.1.177; the alternate name CLAUDE_CODE_DISABLE_TITLE
# does NOT work on this version). This is why Alan had to rename tabs by hand.
$env:CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1'
$host.UI.RawUI.WindowTitle = 'EdgeweaverGenesisTelegram'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Model + effort come from the fleet policy (scripts/ops/model-policy.mjs; /mind in Telegram).
. (Join-Path $PSScriptRoot 'model-policy.ps1')
$mp = Get-FleetModelArgs -Agent genesis -Role channel
# Wake-first guard: a message queued before startup must not be answered by plain Claude.
. (Join-Path $PSScriptRoot 'channel-wake-guard.ps1')
claude "/wake-edgeweaver-genesis" @mp --append-system-prompt (Get-ChannelWakeGuard genesis) --channels plugin:telegram@claude-plugins-official
