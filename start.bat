@echo off
chcp 65001 >nul
rem Запуск казино-зала без Claude: сервер + туннель cloudflared, каждый в своём окне.
cd /d "%~dp0"
title Казино-зал

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Поставь его с https://nodejs.org и запусти снова.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Ставлю зависимости...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not exist "%CF%" if not "%CF%"=="cloudflared" (
  echo cloudflared не найден. Поставь: winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)

start "Казино-зал: сервер" cmd /k node server\index.js
timeout /t 2 /nobreak >nul
start "Казино-зал: туннель" cmd /k ""%CF%" tunnel --protocol http2 --url http://127.0.0.1:3000"

echo.
echo Открылись два окна:
echo   "сервер"  - сам зал. Закроешь его - зал выключится.
echo   "туннель" - через ~10 секунд там появится ссылка https://....trycloudflare.com
echo              Её и отправляй друзьям. При каждом запуске ссылка новая.
echo.
echo Зал на этом компьютере:  http://127.0.0.1:3000
echo Админка:                 http://127.0.0.1:3000/admin.html
echo.
echo Остановить: Ctrl+C в окне "сервер" (фишки со столов вернутся игрокам), потом закрыть оба окна.
echo.
pause
