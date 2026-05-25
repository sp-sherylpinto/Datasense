# tests/test_ratios.py
import pytest
import polars as pl
from worker.tasks import _compute_ratios


def test_current_ratio(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df,
        period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
    )
    assert abs(result[0]["current_ratio"] - 2.0) < 0.01


def test_quick_ratio_with_inventory(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df,
        period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
        inventory_col="inventory",
    )
    # (500000 - 50000) / 250000 = 1.8
    assert abs(result[0]["quick_ratio"] - 1.8) < 0.01


def test_gross_margin(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        revenue_col="revenue", gross_profit_col="gross_profit",
    )
    assert abs(result[0]["gross_margin_pct"] - 40.0) < 0.01


def test_debt_to_equity(sample_ratio_df):
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        total_debt_col="total_debt", equity_col="equity",
    )
    # 300000 / 700000 ≈ 0.4286
    assert abs(result[0]["debt_to_equity"] - 300_000/700_000) < 0.001


def test_missing_columns_skipped(sample_ratio_df):
    # Only provide current ratio cols — others should be None not error
    result = _compute_ratios(
        sample_ratio_df, period_col="period",
        current_assets_col="current_assets",
        current_liabilities_col="current_liabilities",
    )
    assert result[0]["gross_margin_pct"] is None
    assert result[0]["current_ratio"] is not None


def test_division_by_zero_returns_null(sample_ratio_df):
    df = sample_ratio_df.with_columns(pl.lit(0.0).alias("equity"))
    result = _compute_ratios(
        df, period_col="period",
        net_income_col="net_income", equity_col="equity",
    )
    assert result[0]["return_on_equity"] is None
