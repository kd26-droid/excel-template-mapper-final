# FactWise Excel Template Mapper - Windows Handoff

This zip is meant to be copied to another Windows system, unzipped, and started with one command.

## What She Needs Installed

- Docker Desktop for Windows
- Windows 10/11 with WSL2 enabled, as required by Docker Desktop
- Internet access for the first build, because Docker downloads base images and npm/pip packages

No local Python, Node.js, Redis, or PostgreSQL install is required.

## One Command

Open PowerShell or Command Prompt in the unzipped folder and run:

```bat
RUN_ON_WINDOWS.bat
```

The script builds and starts:

- Redis
- Django backend at `http://localhost:8000`
- React frontend at `http://localhost:3000`

It also runs Django migrations and opens the app in the browser.

## Included Runtime Files

- `docker-compose.yml` - main local Docker stack
- `Dockerfile.backend` - backend image
- `Dockerfile.frontend.local` - frontend image used by Compose
- `Dockerfile.frontend` and `Dockerfile` - alternate/production Docker builds kept with the project
- `backend/.env` - included so OCR/API features work without extra setup
- `backend/.env.example` - placeholder template
- `backend/.env.production` and `main.env.template` - deployment reference templates
- `FACTWISE.xlsx`, `CLIENT.xlsx`, `test_files/`, and `SFO_Technologies/` - sample/template/BOM files present in this checkout

## Commands She Can Run Later

```bat
docker compose logs -f
docker compose restart
docker compose down
docker compose down -v
```

Use `docker compose down -v` only when she wants to reset local database/container volumes.

If her Docker install uses the older command, replace `docker compose` with `docker-compose`.

## URLs

- App: `http://localhost:3000`
- Backend health: `http://localhost:8000/api/health/`
- Redis: `localhost:6379`

## Common Fixes

If the app does not start, make sure Docker Desktop is open and fully running, then run `RUN_ON_WINDOWS.bat` again.

If port `3000`, `8000`, or `6379` is already in use, stop the other program or edit `docker-compose.yml` ports before starting.

If the browser shows an old frontend after a rebuild, refresh the page once.
