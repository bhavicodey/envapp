@echo off
title firescout
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo python isn't installed. get it from https://www.python.org/downloads/ and tick "add python to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo first-time setup, this takes a minute...
  %PY% -m venv .venv
)

".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
".venv\Scripts\python.exe" run.py
pause
