@echo off
setlocal
title Edgeweaver - Seal the secrets bundle
set STAGE=%~dp0..\state\dr-staging
set BIN=%USERPROFILE%\.local\bin
cd /d %STAGE% || (echo Staging folder missing - ask the build agent. & pause & exit /b 1)

echo.
echo  ============================================================
echo   EDGEWEAVER - SEAL THE SECRETS BUNDLE
echo  ============================================================
echo.
echo   You need ONE thing: a passphrase of 4-5 random words that
echo   you have MEMORIZED and WRITTEN ON PAPER kept at home.
echo   That paper + your memory are the vault. Nothing else is.
echo.
echo   Steps this window will walk you through:
echo     1. Notepad opens the age key - hand-copy the line that
echo        starts AGE-SECRET-KEY- onto the same paper (gold!).
echo     2. Type your passphrase twice to SEAL the bundle.
echo     3. Type it once more to VERIFY the seal opens.
echo     4. Plaintext secrets are deleted; sealed copies are
echo        placed on your Desktop and in the private backups repo.
echo.
pause

if exist age-key.txt (
  start /wait notepad age-key.txt
) else (
  echo   NOTE: age-key.txt already sealed and removed - skipping paper step.
)

echo.
echo   --- SEAL: type your passphrase twice (typing is hidden) ---
"%BIN%\age.exe" -p -o secrets-backup.age secrets-backup.tar
if errorlevel 1 (echo SEALING FAILED - nothing deleted. Run again. & pause & exit /b 1)

echo.
echo   --- VERIFY: type it once more to prove the seal opens ---
"%BIN%\age.exe" -d secrets-backup.age > NUL
if errorlevel 1 (
  echo VERIFY FAILED - the passphrase you typed the third time did not
  echo match. The sealed file was kept, but if YOU cannot reopen it,
  echo delete secrets-backup.age and run this again from the start.
  pause & exit /b 1
)

echo   Seal verified. Removing plaintext secrets...
del /q age-key.txt env.local.copy secrets-backup.tar 2>NUL

for /f "delims=" %%D in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set DESK=%%D
copy /y secrets-backup.age "%DESK%\edgeweaver-secrets-backup.age" >NUL
echo   Copied to Desktop: edgeweaver-secrets-backup.age
echo   (your Desktop syncs via OneDrive - that copy is already in the
echo    cloud, sealed; drag one more to a USB stick if you want copy #3)

echo   Uploading sealed copy to the private backups repo...
"%BIN%\gh.exe" release create dr-bundle-%DATE:~10,4%%DATE:~4,2%%DATE:~7,2% secrets-backup.age --repo alanshurafa/edgeweaver-backups --title "DR secrets bundle (age-sealed)" --notes "Passphrase-sealed disaster-recovery bundle. Decrypt: age -d secrets-backup.age > secrets-backup.tar (passphrase is on Alan's paper)." 2>NUL || "%BIN%\gh.exe" release upload dr-bundle-%DATE:~10,4%%DATE:~4,2%%DATE:~7,2% secrets-backup.age --repo alanshurafa/edgeweaver-backups --clobber

echo.
echo  ============================================================
echo   DONE. The vault is: your memory + your paper.
echo   Sealed copies: this folder, your Desktop, the backups repo.
echo  ============================================================
echo.
pause
