FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
       build-essential git libpq-dev tesseract-ocr tesseract-ocr-por poppler-utils \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r backend/requirements.txt

RUN npm install --legacy-peer-deps \
    && npm run build \
    && npm cache clean --force \
    && rm -rf node_modules

RUN chmod +x start.sh

EXPOSE 7860

CMD ["./start.sh"]
