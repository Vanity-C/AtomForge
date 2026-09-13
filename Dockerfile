FROM node:24-bookworm-slim AS frontend
WORKDIR /build
RUN npm install --global pnpm@11.1.2
COPY app/frontend/package.json app/frontend/pnpm-lock.yaml app/frontend/pnpm-workspace.yaml ./
COPY app/frontend/scripts/ ./scripts/
RUN pnpm install --frozen-lockfile
COPY app/frontend/ ./
RUN pnpm run build

FROM node:24-bookworm-slim AS codex
ARG CODEX_VERSION=0.153.0
RUN npm install --global --registry=https://registry.npmjs.org "@openai/codex@${CODEX_VERSION}" \
    && codex --version \
    && find /usr/local/lib/node_modules/@openai -type f -name codex -executable \
       -exec cp {} /usr/local/bin/atomforge-codex \; \
    && test -x /usr/local/bin/atomforge-codex

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CODEX_HOME=/data/codex \
    ATOMFORGE_CODEX_BIN=/usr/local/bin/codex
WORKDIR /app/backend
COPY --from=codex /usr/local/bin/atomforge-codex /usr/local/bin/codex
RUN codex --version
COPY app/backend/requirements.lock.txt ./requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt
RUN groupadd --gid 10001 atomforge \
    && useradd --uid 10001 --gid atomforge --no-create-home atomforge \
    && mkdir -p /data /app/backend/logs \
    && chown -R atomforge:atomforge /data /app/backend/logs
COPY app/backend/ ./
COPY --from=frontend /build/dist/ /app/frontend/dist/
COPY scripts/bootstrap_db.py scripts/docker_entrypoint.py /app/scripts/
USER atomforge
EXPOSE 8000
ENTRYPOINT ["python", "/app/scripts/docker_entrypoint.py"]
