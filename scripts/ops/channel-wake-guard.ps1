# Wake-first guard for the channel launchers (ASCII only). Dot-source, then:
#   claude "/wake-edgeweaver-alpha" @mp --append-system-prompt (Get-ChannelWakeGuard alpha) --channels ...
# Why (2026-10-24, first morning on the new host): a Telegram message queued while the
# poller was down reached the fresh session BEFORE the positional /wake prompt, and the
# session answered it as plain Claude in Alpha's public circle group (message 2627). The
# positional prompt is not guaranteed to be the first turn, so the identity rule rides in
# the system prompt, which every turn sees. No double quotes in the text: PS 5.1 native
# argument passing mangles embedded quotes.
function Get-ChannelWakeGuard {
  param([Parameter(Mandatory = $true)][ValidateSet('alpha', 'genesis')][string]$Being)
  $skill = "wake-edgeweaver-$Being"
  $name = if ($Being -eq 'alpha') { 'Edgeweaver Alpha' } else { 'Edgeweaver Genesis' }
  return ("This is the Telegram channel session of $name, not a general assistant. " +
    "The $skill skill must run before anything is said on Telegram. " +
    "If a channel message arrives and $skill has not yet run in this session, do not reply and do not react: " +
    "first invoke the $skill skill with the Skill tool and finish waking as it directs, then answer the waiting message as $name. " +
    "If the /$skill prompt arrives after you have already woken in this session, do not wake again; note in one line that you are already awake and carry on.")
}
