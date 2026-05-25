# tests/test_je_test.py
import pytest
import polars as pl
from worker.tasks import _check_je_flags


def test_weekend_posting_flagged():
    # 2026-03-21 is a Saturday
    df = pl.DataFrame({
        "date": ["2026-03-21"], "amount": [999.0],
        "account": ["Cash"], "preparer": ["alice"], "narration": ["test"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert result["flags"][0] == "weekend_posting"
    assert result["is_flagged"][0] == True


def test_end_of_period_flagged():
    # 2026-03-31 is last day of March
    df = pl.DataFrame({
        "date": ["2026-03-31"], "amount": [500.0],
        "account": ["Sales"], "preparer": ["bob"], "narration": ["adj"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert "end_of_period" in result["flags"][0]


def test_round_number_flagged():
    df = pl.DataFrame({
        "date": ["2026-03-10"], "amount": [50000.0],
        "account": ["Cash"], "preparer": ["alice"], "narration": ["transfer"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert "round_number" in result["flags"][0]


def test_same_day_reversal_flagged():
    df = pl.DataFrame({
        "date": ["2026-03-10", "2026-03-10"],
        "amount": [5000.0, -5000.0],
        "account": ["Sales", "Sales"],
        "preparer": ["alice", "alice"],
        "narration": ["Invoice", "Reversal"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    flags_list = [r for r in result["flags"].to_list() if "same_day_reversal" in r]
    assert len(flags_list) == 2  # both the entry and its reversal are flagged


def test_zero_amount_not_flagged_as_reversal():
    df = pl.DataFrame({
        "date": ["2026-03-10", "2026-03-10"],
        "amount": [0.0, 0.0],
        "account": ["Cash", "Cash"],
        "preparer": ["alice", "alice"],
        "narration": ["memo", "memo"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    for flags in result["flags"].to_list():
        assert "same_day_reversal" not in (flags or "")


def test_no_flags_for_normal_entry():
    df = pl.DataFrame({
        "date": ["2026-03-10"], "amount": [1234.56],
        "account": ["Expenses"], "preparer": ["alice"], "narration": ["routine"],
    })
    result = _check_je_flags(
        df, date_col="date", amount_col="amount",
        account_col="account", preparer_col="preparer",
        narration_col="narration", large_amount_threshold=100000,
    )
    assert result["flags"][0] == ""
    assert result["is_flagged"][0] == False
