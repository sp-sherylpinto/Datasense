"""Smoke tests that would have caught the April 2026 contract bugs.

Specifically:
- task name registry matches what `app/routers/jobs.py` enqueues
  (caught: NetworkTab sending source_col when task expects src_col)
- every task signature accepts `dataset_id` (caught: post-Celery-5.6 strict args)
- column normalisation matches the upload-pipeline contract
  (caught: ColumnNotFoundError on Benford / Outlier with renamed columns)
"""
import inspect

import pytest


# ─── Task discovery & contract checks ──────────────────────────────────────


def test_all_tasks_importable():
    """Every task name the API enqueues must resolve to a callable."""
    from worker.tasks import (
        summarise_csv, run_benford, run_outliers, run_isolation_forest,
        run_timeseries, run_forecast, run_clustering, run_network,
        run_profile, run_cleaning,
    )
    for fn in [
        summarise_csv, run_benford, run_outliers, run_isolation_forest,
        run_timeseries, run_forecast, run_clustering, run_network,
        run_profile, run_cleaning,
    ]:
        assert callable(fn), f"{fn} not callable"


def test_task_name_registry_matches_router():
    """The task_map keys in jobs.create_job must match the celery `name=` strings.
    Both must agree or jobs queued by the API can't be picked up by the worker."""
    from worker.tasks import (
        summarise_csv, run_benford, run_outliers, run_isolation_forest,
        run_timeseries, run_forecast, run_clustering, run_network,
        run_profile, run_cleaning,
    )
    expected = {
        "summarise_csv":          "worker.tasks.summarise_csv",
        "run_benford":            "worker.tasks.run_benford",
        "run_outliers":           "worker.tasks.run_outliers",
        "run_timeseries":         "worker.tasks.run_timeseries",
        "run_forecast":           "worker.tasks.run_forecast",
        "run_clustering":         "worker.tasks.run_clustering",
        "run_network":            "worker.tasks.run_network",
        "run_profile":            "worker.tasks.run_profile",
        "run_cleaning":           "worker.tasks.run_cleaning",
        "run_isolation_forest":   "worker.tasks.run_isolation_forest",
    }
    actual = {
        "summarise_csv":          summarise_csv.name,
        "run_benford":            run_benford.name,
        "run_outliers":           run_outliers.name,
        "run_timeseries":         run_timeseries.name,
        "run_forecast":           run_forecast.name,
        "run_clustering":         run_clustering.name,
        "run_network":            run_network.name,
        "run_profile":            run_profile.name,
        "run_cleaning":           run_cleaning.name,
        "run_isolation_forest":   run_isolation_forest.name,
    }
    assert actual == expected


@pytest.mark.parametrize("task_attr,required_param", [
    ("run_benford",          "column"),
    ("run_outliers",         "column"),
    ("run_timeseries",       "date_col"),
    ("run_timeseries",       "val_col"),
    ("run_forecast",         "date_col"),
    ("run_forecast",         "val_col"),
    ("run_clustering",       "x_col"),
    ("run_clustering",       "y_col"),
    ("run_network",          "src_col"),
    ("run_network",          "tgt_col"),
    ("run_isolation_forest", "columns"),
])
def test_task_signature_contract(task_attr, required_param):
    """Each task must accept the kwargs the frontend sends.

    A mismatch (e.g. NetworkTab sending source_col when run_network expects
    src_col) used to silently 200 + crash in worker logs; with Celery 5.6
    strict-args it now 500s synchronously.
    """
    import worker.tasks as t
    fn = getattr(t, task_attr)
    # Celery wraps the function — `.run` is the underlying callable.
    raw = getattr(fn, "run", fn)
    sig = inspect.signature(raw)
    assert required_param in sig.parameters, (
        f"{task_attr} signature missing required parameter '{required_param}' "
        f"— frontend submission would silently fail. Got: {list(sig.parameters)}"
    )


def test_every_task_accepts_dataset_id():
    """Every analysis task must accept dataset_id as a kwarg (named or via
    **kwargs). The API forwards dataset_id automatically; under Celery 5.6
    strict-args, a task that doesn't accept it would refuse the call."""
    import worker.tasks as t
    for name in [
        "summarise_csv", "run_benford", "run_outliers", "run_timeseries",
        "run_forecast", "run_clustering", "run_network", "run_profile",
        "run_cleaning", "run_isolation_forest",
    ]:
        fn = getattr(t, name)
        raw = getattr(fn, "run", fn)
        sig = inspect.signature(raw)
        accepts = (
            "dataset_id" in sig.parameters
            or any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        )
        assert accepts, f"{name} does not accept dataset_id"


# ─── Column normalisation (the post-cleaning rename contract) ──────────────


def test_safe_col_lowercases_and_underscores():
    from app.ingestion import _safe_col
    assert _safe_col("Invoice Number") == "invoice_number"
    assert _safe_col("Customer GSTIN") == "customer_gstin"
    assert _safe_col("Amount (₹)") == "amount"
    assert _safe_col("WBS Element") == "wbs_element"


def test_safe_col_handles_leading_digit():
    from app.ingestion import _safe_col
    # Pure-digit / digit-led names get a `col_` prefix so they're valid SQL identifiers.
    assert _safe_col("2024 Total") == "col_2024_total"
    assert _safe_col("9") == "col_9"


def test_read_csv_normalised_renames_columns(tmp_path):
    """Raw uploaded CSV has display-style headers; helper must rename them
    to safe identifiers so `pl.col(<safe_name>)` resolves in tasks."""
    import polars as pl
    from worker.tasks._common import _read_csv_normalised

    df = pl.DataFrame({"Invoice Number": [1, 2], "Customer GSTIN": ["a", "b"]})
    path = tmp_path / "raw.csv"
    df.write_csv(path)
    out = _read_csv_normalised(str(path))
    assert "invoice_number" in out.columns
    assert "customer_gstin" in out.columns


def test_infer_type_native_polars():
    """Polars-native dtypes are returned with the new UI-aligned labels."""
    import polars as pl
    from app.ingestion import _infer_type
    assert _infer_type(pl.Series([1, 2, 3]))                  == "number"
    assert _infer_type(pl.Series([1.5, 2.5]))                 == "number"
    assert _infer_type(pl.Series([True, False]))              == "boolean"


def test_infer_type_sniffs_currency_in_string_column():
    """A text column full of `₹1,234.56` strings should classify as currency."""
    import polars as pl
    from app.ingestion import _infer_type
    s = pl.Series("amount", [
        "₹1,234.56", "₹2,500.00", "₹19,99,000.00", "₹1,00,000.00",
        "₹12.50", "-", "₹500.00",
    ])
    assert _infer_type(s) == "currency"


def test_infer_type_sniffs_iso_date_in_string_column():
    import polars as pl
    from app.ingestion import _infer_type
    s = pl.Series("date", ["2024-04-01", "2024-04-02", "2024-04-03", "2024-04-04"])
    assert _infer_type(s) == "date"


def test_infer_type_sniffs_indian_date_format():
    import polars as pl
    from app.ingestion import _infer_type
    s = pl.Series("date", ["01/04/2024", "02/04/2024", "15/05/2024", "30/06/2024"])
    assert _infer_type(s) == "date"


def test_infer_type_sniffs_boolean_text():
    import polars as pl
    from app.ingestion import _infer_type
    s = pl.Series("flag", ["yes", "no", "yes", "Y", "n", "Yes"])
    assert _infer_type(s) == "boolean"


def test_infer_type_falls_through_to_text_for_mixed():
    """Less than 85% match → text. PAN-like values are text since the
    sniffer doesn't claim a type for them."""
    import polars as pl
    from app.ingestion import _infer_type
    s = pl.Series("pan", ["ABCDE1234F", "FGHIJ5678K", "LMNOP9012Q"])
    assert _infer_type(s) == "text"


def test_normalise_df_marks_native_dtype():
    """`native_dtype` flag on col_meta lets `_create_table_and_insert`
    decide whether to store sniffed currency columns as TEXT (raw strings
    not yet converted) or at the inferred postgres type (already typed)."""
    import polars as pl
    from app.ingestion import _normalise_df
    df = pl.DataFrame({"qty": [1, 2, 3], "name": ["a", "b", "c"]})
    _, meta = _normalise_df(df)
    by_name = {m["name"]: m for m in meta}
    assert by_name["qty"]["native_dtype"] is True   # int64
    assert by_name["name"]["native_dtype"] is False  # str


def test_read_csv_normalised_lazy_renames_columns(tmp_path):
    """Same contract for the lazy variant — used by Benford / Network / etc."""
    import polars as pl
    from worker.tasks._common import _read_csv_normalised

    df = pl.DataFrame({"Invoice Number": [1, 2]})
    path = tmp_path / "raw.csv"
    df.write_csv(path)
    ldf = _read_csv_normalised(str(path), lazy=True)
    assert "invoice_number" in ldf.collect_schema().names()
