# syntax=docker/dockerfile:1.6

FROM node:20-bookworm AS frontend-builder

WORKDIR /workspace

ENV NODE_ENV=production \
    VITE_BACKEND_URL=self

COPY package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .
RUN npm run build


FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/data/.cache/huggingface \
    HF_HUB_CACHE=/data/.cache/huggingface \
    TRANSFORMERS_CACHE=/data/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/data/.cache/sentencetransformers

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
        libpq-dev \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-por \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r backend/requirements.txt

COPY . .
COPY --from=frontend-builder /workspace/dist ./dist

RUN chmod +x start.sh

EXPOSE 7860

CMD ["./start.sh"]
