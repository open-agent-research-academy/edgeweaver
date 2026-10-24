# Edgeweaver Alpha Telegram channel launcher (ASCII only). Run by the watchdog via
# -File: a dedicated script file because Start-Process -Command payloads MANGLE embedded
# quotes (proven 2026-07-16: the env assignment silently failed and the telegram plugin
# fell back to Genesis's state dir, hijacking its poller). -File has no such quoting layer.
# TELEGRAM_STATE_DIR must be set BEFORE claude starts: the plugin's MCP server inherits it
# and keeps Alpha's bot walled into its own state dir beside Genesis's.
$env:TELEGRAM_STATE_DIR = Join-Path $env:USERPROFILE '.claude\channels\telegram-alpha'
# Marks this as a channel session for the stall-alert hooks (channel-notify-hook.mjs).
$env:EDGEWEAVER_CHANNEL_BEING = 'alpha'
# Keep OUR window title: claude overwrites the terminal title at startup unless this is
# set (proven live 2026-07-21 on 2.1.177; the alternate name CLAUDE_CODE_DISABLE_TITLE
# does NOT work on this version). This is why Alan had to rename tabs by hand.
$env:CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1'
$host.UI.RawUI.WindowTitle = 'EdgeweaverAlphaTelegram'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# FORK ROLLED BACK (2026-07-29): the fork's first real channel session (12:18 relaunch)
# journaled inbound updates but never delivered them into the session - Alan's messages
# 124/126 sat unanswered while outbound replies worked. Stock plugin restored per the
# documented rollback; the fork returns only after the delivery gap is fixed and proven
# in a dark session (D33 plan section 8; Genesis never left stock).
# Fork line, for restoration after the fix:
#   claude "/wake-edgeweaver-alpha" --model claude-fable-5-1 --channels plugin:telegram@claude-plugins-official --plugin-dir '<repo>\tools\telegram-fork'
# Model + effort come from the fleet policy (scripts/ops/model-policy.mjs; /mind in Telegram).
. (Join-Path $PSScriptRoot 'model-policy.ps1')
$mp = Get-FleetModelArgs -Agent alpha -Role channel
# Wake-first guard: a message queued before startup must not be answered by plain Claude.
. (Join-Path $PSScriptRoot 'channel-wake-guard.ps1')
claude "/wake-edgeweaver-alpha" @mp --append-system-prompt (Get-ChannelWakeGuard alpha) --channels plugin:telegram@claude-plugins-official
