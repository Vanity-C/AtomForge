FROM node:24-bookworm-slim AS frontend
WORKDIR /build
RUN npm install --global pnpm@11.1.2
COPY app/frontend/package.json app/frontend/pnpm-lock.yaml app/frontend/pnpm-workspace.yaml ./
COPY app/frontend/scripts/ ./scripts/
RUN pnpm install --frozen-lockfile
COPY app/frontend/ ./
RUN pnpm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app/backend
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
