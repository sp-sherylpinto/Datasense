"""Financial ratio analysis task.

Computes common audit-relevant financial ratios from a period-based
financial dataset. All ratios are optional — only those for which the
required columns are supplied are calculated; missing ones return None.

Supported ratios
----------------
Liquidity    : current_ratio, quick_ratio
Profitability: gross_margin_pct, net_margin_pct, return_on_assets,
               return_on_equity
Leverage     : debt_to_equity, interest_coverage
"""
import asyncio
import os
import traceback

import polars as pl

from worker.celery_app import celery_app
from worker.tasks._common import _load_dataset_df, update_job_status
from app.config import settings


def _safe_div(numerator: float | None, denominator: float | None) -> float | None:
    """Return numerator / denominator, or None if denominator is zero / missing."""
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    return numerator / denominator


def _compute_ratios(
    df: pl.DataFrame,
    *,
    period_col: str,
    # Liquidity
    current_assets_col: str | None = None,
    current_liabilities_col: str | None = None,
    inventory_col: str | None = None,
    # Profitability
    revenue_col: str | None = None,
    gross_profit_col: str | None = None,
    net_income_col: str | None = None,
    total_assets_col: str | None = None,
    equity_col: str | None = None,
    # Leverage
    total_debt_col: str | None = None,
    ebit_col: str | None = None,
    interest_expense_col: str | None = None,
) -> list[dict]:
    """Return one dict per row in *df* with all computable ratios.

    Each dict always contains the ``period`` key plus every ratio key
    listed below. Ratios that cannot be computed return ``None``.

    Ratio keys
    ----------
    ``current_ratio``, ``quick_ratio``,
    ``gross_margin_pct``, ``net_margin_pct``,
    ``return_on_assets``, ``return_on_equity``,
    ``debt_to_equity``, ``interest_coverage``
    """
    results: list[dict] = []

    for row in df.iter_rows(named=True):
        def _get(col: str | None) -> float | None:
            if col is None or col not in row:
                return None
            v = row[col]
            return float(v) if v is not None else None

        ca  = _get(current_assets_col)
        cl  = _get(current_liabilities_col)
        inv = _get(inventory_col)
        rev = _get(revenue_col)
        gp  = _get(gross_profit_col)
        ni  = _get(net_income_col)
        ta  = _get(total_assets_col)
        eq  = _get(equity_col)
        td  = _get(total_debt_col)
        ebit = _get(ebit_col)
        ie  = _get(interest_expense_col)

        # Liquidity
        current_ratio = _safe_div(ca, cl)

        if inv is not None and ca is not None:
            quick_ratio = _safe_div(ca - inv, cl)
        else:
            quick_ratio = _safe_div(ca, cl) if inv is None else None

        # Profitability
        gross_margin_pct = (
            _safe_div(gp, rev) * 100 if _safe_div(gp, rev) is not None else None
        )
        net_margin_pct = (
            _safe_div(ni, rev) * 100 if _safe_div(ni, rev) is not None else None
        )
        return_on_assets = (
            _safe_div(ni, ta) * 100 if _safe_div(ni, ta) is not None else None
        )
        return_on_equity = (
            _safe_div(ni, eq) * 100 if _safe_div(ni, eq) is not None else None
        )

        # Leverage
        debt_to_equity    = _safe_div(td, eq)
        interest_coverage = _safe_div(ebit, ie)

        results.append({
            "period":             row[period_col],
            "current_ratio":      current_ratio,
            "quick_ratio":        quick_ratio,
            "gross_margin_pct":   gross_margin_pct,
            "net_margin_pct":     net_margin_pct,
            "return_on_assets":   return_on_assets,
            "return_on_equity":   return_on_equity,
            "debt_to_equity":     debt_to_equity,
            "interest_coverage":  interest_coverage,
        })

    return results


@celery_app.task(bind=True, name="worker.tasks.run_ratios")
def run_ratios(
    self,
    file_path: str,
    job_id: str,
    period_col: str,
    current_assets_col: str | None = None,
    current_liabilities_col: str | None = None,
    inventory_col: str | None = None,
    revenue_col: str | None = None,
    gross_profit_col: str | None = None,
    net_income_col: str | None = None,
    total_assets_col: str | None = None,
    equity_col: str | None = None,
    total_debt_col: str | None = None,
    ebit_col: str | None = None,
    interest_expense_col: str | None = None,
    dataset_id: str | None = None,
) -> None:
    """Celery task: compute financial ratios and save results as Parquet."""
    asyncio.run(update_job_status(job_id, "running"))
    try:
        df = _load_dataset_df(file_path, dataset_id)
        rows = _compute_ratios(
            df,
            period_col=period_col,
            current_assets_col=current_assets_col,
            current_liabilities_col=current_liabilities_col,
            inventory_col=inventory_col,
            revenue_col=revenue_col,
            gross_profit_col=gross_profit_col,
            net_income_col=net_income_col,
            total_assets_col=total_assets_col,
            equity_col=equity_col,
            total_debt_col=total_debt_col,
            ebit_col=ebit_col,
            interest_expense_col=interest_expense_col,
        )
        result = pl.DataFrame(rows)
        result_path = os.path.join(settings.DATA_DIR, "results", f"{job_id}.parquet")
        os.makedirs(os.path.dirname(result_path), exist_ok=True)
        result.write_parquet(result_path)
        asyncio.run(update_job_status(job_id, "completed", result_path))
    except Exception:
        asyncio.run(
            update_job_status(job_id, "failed", error_message=traceback.format_exc())
        )
        raise