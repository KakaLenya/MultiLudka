@echo off
chcp 65001 >nul
rem Запуск казино-зала без Claude: открывает пульт, который запускает сервер и туннель
rem и показывает ссылку для друзей и адрес админки.
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
if "%CF%"=="cloudflared" set "CF="
set "CASINO_CF=%CF%"

rem Пульт — окно с кнопками. Это консольное окно можно закрыть, зал от этого не выключится.
start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher.ps1"
