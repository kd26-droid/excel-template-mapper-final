# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: React app (Material UI, Tailwind). Source in `src/`, static in `public/`.
- `backend/`: Django REST API. Apps in `excel_mapper/` and `excel_mapping/`; entry via `manage.py`.
- Root tooling: `docker-compose.yml`, `Dockerfile*`, deploy scripts, `Execute.md`.
- Tests & samples: `comprehensive_test.py`, `test_files/`, `Dockerfile.test`, `run_tests_docker.*`.
- Deploy: `deploy-*.sh|ps1`, `.github/` workflows (if enabled), `deployments/`.

## Build, Test, and Development Commands
- Backend (local):
  - `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
  - `python manage.py migrate && python manage.py runserver` (serves on `:8000`).
- Frontend (local):
  - `cd frontend && npm install && npm start` (serves on `:3000`, proxies to API).
- Docker (full stack):
  - `docker-compose up -d` / `docker-compose down` (serves on `http://localhost:8080`).
- Tests:
  - Frontend: `cd frontend && npm test` or `npm run test:coverage`.
  - Integration: `python comprehensive_test.py` (expects backend/frontends running) or `./run_tests_docker.sh`.

## Coding Style & Naming Conventions
- Python (Django): PEP 8, 4 spaces; `snake_case` for functions/variables, `PascalCase` for classes, app modules under `excel_mapper/*` keep clear boundaries.
- JavaScript/React: ESLint + Prettier (`npm run lint`, `npm run lint:fix`, `npm run format`); 2 spaces; components `PascalCase.jsx`, hooks/utilities `camelCase.js`.
- API routes live under `backend/excel_mapper/urls.py`; React API calls via `axios` in `src/` services.

## Testing Guidelines
- Frontend unit tests with Testing Library/Jest; name as `*.test.jsx` colocated with components.
- Backend: no strict unit test harness yet; prefer adding Django tests in `tests.py` or `tests/` per app.
- Integration flow validated by `comprehensive_test.py` and Docker test runner; no enforced coverage, but cover critical mapping flows and regressions.

## Commit & Pull Request Guidelines
- Commits: imperative and scoped when helpful. Examples:
  - `frontend: fix mapping grid column resize`
  - `backend: optimize template apply endpoint`
  - `infra: tighten CORS and nginx cache`
- Pull Requests: include summary, linked issues, test plan (commands run), screenshots/GIFs for UI changes, and note any migrations or breaking changes.

## Security & Configuration Tips
- Never commit secrets; use `backend/.env.example` and `main.env.template` to derive local envs.
- Production: set `DEBUG=False`, configure `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`; verify Azure Blob credentials if used.
- Large files/logs stay out of Git; rely on `.gitignore` and `LogFiles/` for runtime logs.

