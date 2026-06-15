#!/usr/bin/env bash
# run.sh — cài deps (lần đầu) rồi chạy backend Qwen3 ở cổng 8000.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}"
