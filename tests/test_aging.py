# tests/test_aging.py
import pytest
import polars as pl
from worker.tasks import _compute_aging


def test_current_bucket(sample_aging_df):
    # due_date 2026-03-20, reference 2026-03-23 → 3 days overdue → 1-90 bucket
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    delta = [r for r in detail if r["party"] == "Delta Co"][0]
    assert delta["bucket"] == "1–90 days"
    assert delta["days_overdue"] == 3


def test_current_not_overdue(sample_aging_df):
    # due_date 2026-03-20 when reference is 2026-03-19 → current
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-19",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    delta = [r for r in detail if r["party"] == "Delta Co"][0]
    assert delta["bucket"] == "Current"


def test_long_overdue_bucket(sample_aging_df):
    # Gamma due 2025-06-01, reference 2026-03-23 → 295 days → 181–365 bucket
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    detail = [r for r in result if r["result_type"] == "detail"]
    gamma = [r for r in detail if r["party"] == "Gamma Inc"][0]
    assert gamma["bucket"] == "181–365 days"


def test_summary_rows_present(sample_aging_df):
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    summary = [r for r in result if r["result_type"] == "summary"]
    assert len(summary) > 0
    buckets = {r["bucket"] for r in summary}
    assert "Current" in buckets or any("days" in b for b in buckets)


def test_pct_sums_to_100(sample_aging_df):
    result = _compute_aging(
        sample_aging_df,
        party_col="party", amount_col="amount", due_date_col="due_date",
        reference_date="2026-03-23",
    )
    summary = [r for r in result if r["result_type"] == "summary"]
    total_pct = sum(r["pct_of_total"] for r in summary)
    assert abs(total_pct - 100.0) < 0.1
