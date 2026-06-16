@echo off
REM run.bat — cai dependencies (lan dau) roi chay backend Qwen3 o cong 8000.
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate
python -m pip install -q -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8000
