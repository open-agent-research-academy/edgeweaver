# set-alpha-github-token.ps1 - store edgeweaverai-bot's token for Alpha's soul proposals
# (ops; ASCII only). Prompts for the token without echoing it, writes EW_ALPHA_GITHUB_TOKEN
# into avatars\alpha\.env.local (backup first, other lines untouched, no BOM), then has the
# bot accept its repo invitation and checks its access. The token is never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $root 'avatars\alpha\.env.local'
$key = 'EW_ALPHA_GITHUB_TOKEN'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'node is not on PATH; nothing written.'; exit 1 }
$secure = Read-Host -AsSecureString 'Paste the edgeweaverai-bot token (input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $tok = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($tok -notmatch '^(ghp_|github_pat_)[A-Za-z0-9_]+$') { Write-Host 'That does not look like a GitHub token; nothing written.'; exit 1 }

$lines = @()
$backup = $null
if (Test-Path $envFile) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$envFile.bak-$stamp"
    Copy-Item $envFile $backup
    $lines = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -notmatch "^\s*$key\s*=" })
}
$lines += "$key=$tok"
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
$tok = $null
Write-Host "$key written to avatars\alpha\.env.local (backup kept beside it)"

$script = Join-Path $root 'scripts\ops\soul-propose.mjs'
# PowerShell 5.1 does not stop on a native non-zero exit, so check each one. A token that
# is not the bot's is taken back out (the file returns to exactly its earlier state), so a
# person's token never stays in Alpha's file and a working earlier token is not lost.
function Undo-Token {
    if ($backup) { Copy-Item $backup $envFile -Force; Write-Host 'avatars\alpha\.env.local restored to its earlier state.' }
    else { Remove-Item $envFile; Write-Host 'avatars\alpha\.env.local removed again (it did not exist before).' }
}
try { node $script accept-invite alpha; $ok = ($LASTEXITCODE -eq 0) }
catch { Write-Host "Could not run node: $($_.Exception.Message)"; $ok = $false }
if (-not $ok) { Write-Host 'Token check or invite acceptance failed (see above).'; Undo-Token; exit 1 }
node $script check alpha
if ($LASTEXITCODE -ne 0) { Write-Host 'Access check failed (see above); token kept, rerun after the invite is in place.'; exit 1 }
