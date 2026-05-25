# Dockerfile — Analytics API + Worker
# Multi-stage: build frontend, then assemble final image

# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --silent

COPY index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
COPY src ./src
COPY public ./public

# Build with a placeholder token — override at runtime via nginx/env
ARG VITE_API_AUTH_TOKEN=dev-token
ENV VITE_API_AUTH_TOKEN=$VITE_API_AUTH_TOKEN

RUN npm run build

# ─── Stage 2: Python backend ──────────────────────────────────────────────────
FROM python:3.12-slim AS backend

# System dependencies for pdfplumber, lxml, scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    libxml2-dev \
    libxslt1-dev \
    poppler-utils \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Poetry
RUN pip install --no-cache-dir poetry==1.8.2

# Copy dependency files
COPY pyproject.toml poetry.lock* ./

# Install dependencies (no dev extras, no virtualenv inside container)
RUN poetry config virtualenvs.create false \
    && poetry install --no-dev --no-interaction --no-ansi

# Copy application source
COPY app ./app
COPY worker ./worker
COPY migrations ./migrations
COPY scripts ./scripts

# Copy built frontend into a location the API can serve
COPY --from=frontend-builder /app/dist ./static

# Data directory
RUN mkdir -p /data/uploads /data/results

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/data
ENV UPLOAD_DIR=/data/uploads

RUN useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

# Entrypoint runs as root, fixes /data volume permissions, then drops to appuser
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
