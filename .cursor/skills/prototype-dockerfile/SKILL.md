---
name: prototype-dockerfile
description: Generate a Dockerfile for a prototype project deployed via the Cognigy prototype automation pipeline. Use when the user asks to create, fix, or improve a Dockerfile, containerize an app, or when no Dockerfile exists and the project has a "prototype" topic. Handles single-service apps (Node, React, Python, Go, static) and full-stack apps (frontend + backend + optional database) as a single container.
---

# Prototype Dockerfile Generator

This project is deployed by the **prototype automation pipeline**: a single Docker image is pushed to Azure Container Registry, FluxCD deploys it to Kubernetes, and Traefik routes traffic to `https://prototypes.cognigy.dev/{slug}/`. The Dockerfile you generate must produce **one container** that exposes **one HTTP port**.

## Constraints

- **Single image, single port.** The pipeline builds one Dockerfile and creates one Deployment, one Service, one Ingress.
- **Port**: read from `.prototype-meta.toml` field `port`, or default to `3000`. The port must match the `EXPOSE` directive.
- **Path prefix**: Traefik strips `/{slug}` before forwarding. The app must serve from `/`. For React/Vite/CRA, ensure the build uses `"homepage": "."` or `base: "./"` so assets use relative paths.
- **No docker-compose in CI.** If you generate a `docker-compose.yaml`, mark it clearly as local-dev only.

## Step 1 — Analyse the project

Before generating anything, examine the repo:

1. Check if `Dockerfile` already exists — if so, ask before overwriting.
2. Check if `.prototype-meta.toml` exists — read `port`, `display_name`, and any hints.
3. Identify the stack:

| Signal | Stack |
|--------|-------|
| `package.json` with `react`/`react-dom` dep (no `next`) | **React SPA** |
| `package.json` with `next` | **Next.js** |
| `package.json` (other) | **Node.js** |
| `requirements.txt` / `pyproject.toml` / `Pipfile` | **Python** |
| `go.mod` | **Go** |
| `index.html` at root (no package.json) | **Static** |
| Multiple of the above in subdirectories | **Full-stack** (see Step 3) |

## Step 2 — Single-service Dockerfile

For a project with one stack, generate a Dockerfile following these patterns.

### React SPA (CRA / Vite)

Multi-stage: build with Node, serve with nginx.

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN if [ -d dist ]; then mv dist output; \
    elif [ -d build ]; then mv build output; \
    else echo "No build output found" && exit 1; fi

FROM nginx:alpine
COPY --from=build /app/output /usr/share/nginx/html
RUN printf 'server {\n\
    listen 3000;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

### Node.js (Express / Fastify / Next.js)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Python (Flask / FastAPI / Streamlit)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null \
    || pip install --no-cache-dir . 2>/dev/null \
    || true
COPY . .
EXPOSE 3000
CMD ["python", "main.py"]
```

Pick the right CMD based on framework:
- **FastAPI/Uvicorn**: `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]`
- **Flask**: `CMD ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=3000"]`
- **Streamlit**: `CMD ["streamlit", "run", "app.py", "--server.port=3000", "--server.address=0.0.0.0", "--server.headless=true"]`

### Go

Multi-stage: build with Go toolchain, run on distroless.

```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app .

FROM gcr.io/distroless/static-debian12
COPY --from=build /app /app
EXPOSE 3000
ENTRYPOINT ["/app"]
```

### Static site

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN printf 'server {\n\
    listen 3000;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri $uri/ =404; }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

## Step 3 — Full-stack app (single container)

When the project has **frontend + backend** (and optionally a database), bundle everything into one container. The strategy depends on complexity.

### Layout detection

Look for directory structures like:
- `frontend/` + `backend/` (or `client/` + `server/`, `web/` + `api/`)
- `package.json` at root with workspaces pointing to subdirectories
- A Python/Go backend alongside a React/static frontend directory

### Pattern: nginx reverse proxy + backend process

This is the standard approach. Nginx serves the frontend and proxies `/api` to the backend.

```dockerfile
# ── Build frontend ──
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build
RUN if [ -d dist ]; then mv dist output; \
    elif [ -d build ]; then mv build output; \
    else echo "No frontend build output" && exit 1; fi

# ── Build backend (example: Python) ──
FROM python:3.12-slim AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends nginx supervisor && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/output /usr/share/nginx/html

# nginx config: serve frontend + proxy /api to backend
RUN printf 'server {\n\
    listen 3000;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri $uri/ /index.html; }\n\
    location /api/ { proxy_pass http://127.0.0.1:8000; }\n\
}\n' > /etc/nginx/conf.d/default.conf

# supervisord runs both processes
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/dev/stdout\nlogfile_maxbytes=0\n\n\
[program:nginx]\ncommand=nginx -g "daemon off;"\nautorestart=true\n\n\
[program:backend]\ncommand=uvicorn backend.main:app --host 127.0.0.1 --port 8000\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nstderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n' > /etc/supervisord.conf

EXPOSE 3000
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
```

Adapt the backend command for the actual framework (Node, Go binary, etc.).

### Pattern: Node.js serves both API and static frontend

When the backend is Node/Express/Fastify, skip nginx — have the backend serve the frontend build as static files.

```dockerfile
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

The backend must serve `./public` as static files and handle `/api` routes.

### Database in the container

For prototypes that need a database:

- **SQLite** — simplest. No extra process, file-based. Data is ephemeral (lost on pod restart) unless a PVC is configured. Good enough for demos.
- **PostgreSQL sidecar** — if the prototype genuinely needs Postgres, note this in `.prototype-meta.toml` (`needs_database = true`) and mention to the user that the fleet manifests will need a database sidecar or managed database. The skill cannot solve this with just a Dockerfile.

For SQLite, no Dockerfile changes are needed — just ensure the app writes to a path like `/app/data/`.

## Step 4 — Local development compose file

Optionally generate `docker-compose.yaml` for local dev. This is **not used by CI** — it's for developers running the app locally.

```yaml
# Local development only — not used by the prototype pipeline.
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
```

For full-stack apps with a real database locally:

```yaml
# Local development only — not used by the prototype pipeline.
services:
  frontend:
    build:
      context: ./frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules

  backend:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
    environment:
      - DATABASE_URL=postgresql://proto:proto@db:5432/proto
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: proto
      POSTGRES_PASSWORD: proto
      POSTGRES_DB: proto
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Step 5 — Update `.prototype-meta.toml`

If the file doesn't exist, create it with at least the port. If it exists, ensure `port` matches the Dockerfile `EXPOSE`.

```toml
port = 3000
```

## Checklist before finishing

- [ ] Single `Dockerfile` at repo root
- [ ] Exactly one `EXPOSE` directive matching the port in `.prototype-meta.toml` (or 3000)
- [ ] Frontend assets use relative paths (no hardcoded `/slug/` prefix)
- [ ] If full-stack: supervisord or single-process server handles all services
- [ ] No secrets or credentials baked into the image
- [ ] `.dockerignore` exists (exclude `node_modules`, `.git`, `dist`, `__pycache__`, `.env`)
