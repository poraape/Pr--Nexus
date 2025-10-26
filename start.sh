#!/bin/sh
set -euo pipefail

export SPACE_RUNTIME_DIR="${SPACE_RUNTIME_DIR:-/data}"
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-*}"
export POSTGRES_DSN="${POSTGRES_DSN:-sqlite+aiosqlite:///data/nexus.db}"
export STORAGE_PATH="${STORAGE_PATH:-${SPACE_RUNTIME_DIR%/}/uploads}"
export TASK_DISPATCH_MODE="${TASK_DISPATCH_MODE:-inline}"
export RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@rabbitmq:5672/}"
export RABBITMQ_QUEUE="${RABBITMQ_QUEUE:-audit_tasks}"
export CHROMA_PERSIST_DIRECTORY="${CHROMA_PERSIST_DIRECTORY:-${SPACE_RUNTIME_DIR%/}/chroma}"
export EMBEDDING_MODEL_NAME="${EMBEDDING_MODEL_NAME:-all-MiniLM-L6-v2}"
export RAG_TOP_K="${RAG_TOP_K:-6}"
export LLM_PROVIDER="${LLM_PROVIDER:-gemini}"
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-1.5-flash-8b}"
export GEMINI_API_KEY="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}"
export DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-chat}"
export DEEPSEEK_CUTOVER_CHARS="${DEEPSEEK_CUTOVER_CHARS:-4000}"
export UVICORN_HOST="${UVICORN_HOST:-0.0.0.0}"
export PORT="${PORT:-7860}"
export UVICORN_PORT="${UVICORN_PORT:-${PORT}}"

python - <<'PY'
from backend.main import ensure_runtime_directories

ensure_runtime_directories()
PY

alembic -c backend/alembic.ini upgrade head

exec uvicorn backend.main:app \
  --host "${UVICORN_HOST}" \
  --port "${UVICORN_PORT}" \
  --proxy-headers \
  --forwarded-allow-ips='*'
