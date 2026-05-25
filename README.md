# DataSense

> Audit data analytics platform — upload datasets, run AI-powered analysis, and collaborate by sharing datasets with team members.

**URL**: https://datasense.varma.ai | **Access**: All Users | **Status**: Live

## What it does

DataSense is the firm's discovery-tier analytics platform. Auditors upload client datasets (XLSX, CSV, PDF) scoped to a specific engagement, then run AI-powered analyses — trend detection, anomaly flags, Benford's law, ratio analysis, and more. Datasets can be shared with team members and viewed in Saved Views. FraudGuard uses DataSense datasets as its data source for journal-entry testing.

## Features

- Upload CSV, XLSX, and PDF datasets scoped to client engagements
- AI-powered analysis — trend detection, anomaly flags, Benford's law, ratio analysis
- Share datasets with team members — recipient gets an email notification instantly
- RLS-enforced access — shared datasets visible to grantee, not modifiable or re-shareable
- History of all uploads and analyses per engagement
- Export results and AI narratives to Excel
- Saved Views — pre-built and custom analytical views per engagement
- Journal entry testing integrated with FraudGuard

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Lucide |
| Backend | FastAPI (Python 3.12), asyncpg |
| Worker | Celery 5.x (async analysis jobs) |
| Broker | Redis |
| Analytics | DuckDB (embedded), Polars, PyArrow, scikit-learn, NumPy |
| Database | `data_analytics-postgres`, schema `datasense` / `analytics` |
| Email | aiosmtplib (dataset share notifications) |
| Build | Multi-stage Docker (Node 20 → Python) |

## Deployment

- **Container**: `data-analytics` (API + Celery worker + frontend) in `docker-compose.yml`
- **Schema**: `datasense` and `analytics` schemas in shared `data_analytics-postgres`
- **Rebuild**: `docker compose up -d --build data-analytics`

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis URL for Celery broker |
| `API_AUTH_TOKEN` | Token for programmatic API access |
| `VITE_API_AUTH_TOKEN` | Build-time token for SPA (must match `API_AUTH_TOKEN`) |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Email for dataset share notifications |

## Development notes

- The architecture is an API + async Celery worker. File uploads are stored as Parquet files on disk (or in a volume); DuckDB queries them in-process for fast analytics without loading into Postgres.
- Column-name normalisation is a known gap: the UI and Postgres use "safe" column names (lowercased, spaces replaced), while raw CSV original headers are preserved separately. See `project_data_analytics_pipeline.md` in memory for the full column-name contract before debugging ColumnNotFoundError issues.
- Celery 5.6+ requires strict task argument passing — tasks must not use `**kwargs` shorthand for bound arguments. See memory notes for details.
- `POST /jobs` accepts the job parameters in the request body, not as query params. This is a common gotcha.
- Auth is Authentik ForwardAuth; the API reads `X-Authentik-Email` for identity and uses Row Level Security (RLS) on Postgres to enforce dataset visibility.
- The `seed_showcase.py` script at `scripts/seed_showcase.py` seeds a 97-row demo trial balance and 5 pre-built Saved Views for the demo engagement `VV-DEMO-0001/SA/26`.
