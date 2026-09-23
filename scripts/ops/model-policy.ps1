# Fleet model policy helper for PowerShell launchers (ASCII only). Dot-source, then:
#   $mp = Get-FleetModelArgs -Agent genesis -Role channel
#   claude "/wake-edgeweaver-genesis" @mp --channels ...
# Returns @('--model', X, '--effort', Y) from scripts/ops/model-policy.mjs (live
# state/model-policy.json over the committed default). If node or the policy fails, the
# launcher must still come up, so the fallback is the fleet default, never a stale pin.
function Get-FleetModelArgs {
  param(
    [Parameter(Mandatory = $true)][string]$Agent,
    [string]$Role = 'channel',
    [string[]]$Fallback = @('--model', 'claude-opus-5-5', '--effort', 'medium')
  )
  $script = 'C:\Users\agent\Project\Edgeweaver\scripts\ops\model-policy.mjs'
  try {
    # cmd owns the stderr redirect (PS 5.1 wraps native stderr in error records).
    $out = cmd /c "node ""$script"" args $Agent $Role 2>nul"
    if ($LASTEXITCODE -eq 0 -and $out -and ($out -match '^--model \S+ --effort \S+$')) {
      return @($out.Trim() -split ' ')
    }
  } catch {}
  return $Fallback
}
# Model id only (Buzz harnesses take --model but no --effort; they add [1m] themselves).
function Get-FleetModel {
  param([Parameter(Mandatory = $true)][string]$Agent, [string]$Role = 'buzz', [string]$Fallback = 'claude-opus-5-5')
  $a = Get-FleetModelArgs -Agent $Agent -Role $Role -Fallback @('--model', $Fallback, '--effort', 'medium')
  return $a[1]
}
