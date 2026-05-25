# Testing — DataSense

> See [`../TESTING.md`](../TESTING.md) for the shared backend (pytest/httpx) and frontend (Vitest/MSW) setup.

---

## What to test

### Backend

| Area | What to cover |
|---|---|
| `routers/uploads.py` | CSV upload stores correct row/column counts; XLSX upload converts and stores correctly; files exceeding the size limit are rejected |
| `routers/jobs.py` | `POST /jobs` enqueues a Celery task and returns a `job_id`; `GET /jobs/{id}` returns correct status; a job belonging to another user is not accessible (RLS) |
| `routers/datasets.py` | Dataset is visible to the owner; after sharing, the recipient can see it; the sharer cannot re-share someone else's dataset |
| `routers/saved_views.py` | Saved views are scoped to the creating user; CRUD operations persist correctly |
| `routers/ai.py` | AI narrative endpoint returns a string; patches Azure OpenAI — never call the real API in tests |
| Column name normalisation | The normalisation logic that maps raw CSV headers to Postgres-safe names is pure Python — test it directly |

### Column normalisation — unit test

This is critical because a bug here silently corrupts column lookups throughout the app:

```python
# tests/test_column_normalisation.py
from app.utils import normalise_column_name  # adjust import to match actual location

def test_spaces_become_underscores():
    assert normalise_column_name("Invoice Date") == "invoice_date"

def test_special_chars_stripped():
    assert normalise_column_name("Amount (₹)") == "amount_"

def test_leading_digit_prefixed():
    # Postgres column names cannot start with a digit
    assert normalise_column_name("3rd Quarter").startswith("_")

def test_duplicate_underscores_collapsed():
    assert "__" not in normalise_column_name("Amount  Total")
```

### Celery tasks

DataSense uses Celery for async analysis. Do not test via the queue in unit tests — call the task function directly with `task.apply()`:

```python
# tests/test_tasks.py
from app.tasks import run_benford_analysis

def test_benford_task_returns_findings():
    result = run_benford_analysis.apply(
        args=[],
        kwargs={"dataset_id": "test-id", "column": "amount", "user": "test@varmaandvarma.com"}
    ).get(timeout=10)
    assert "findings" in result
```

### Frontend

| Component | What to cover |
|---|---|
| `EngagementPicker` | Renders engagement list; selecting an engagement fires the onChange callback |
| Dataset upload flow | Shows progress indicator during upload; shows error on bad file type |
| Saved Views | Create a view, list appears; delete removes from list |
| Analysis tabs | Each analysis tab shows empty state before a job completes; shows results table after job completes (mock `/jobs/{id}` returning `status: "complete"`) |

---

## Special considerations

**DuckDB** — query endpoints use DuckDB to read Parquet files. In tests, point `settings.STORAGE_PATH` at a temp directory with a small test Parquet file:

```python
@pytest.fixture
def test_parquet(tmp_path):
    import pandas as pd
    df = pd.DataFrame({"amount": [100, 200, 300], "date": ["2026-01-01"] * 3})
    path = tmp_path / "test.parquet"
    df.to_parquet(path)
    return str(path)
```

**Celery** — set `CELERY_TASK_ALWAYS_EAGER = True` in test config so tasks execute synchronously without a running broker:

```python
# tests/conftest.py
import pytest
from app.worker import celery_app

@pytest.fixture(autouse=True)
def celery_eager():
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    yield
    celery_app.conf.task_always_eager = False
```
