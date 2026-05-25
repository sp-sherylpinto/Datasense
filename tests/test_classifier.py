# tests/test_classifier.py
import pytest
from app.ai import _classify_heuristic


def test_classify_journal_entries():
    cols = ["date", "amount", "account", "narration", "preparer"]
    label, _conf = _classify_heuristic(cols)
    assert label == "journal_entries"


def test_classify_financial_statements():
    cols = ["period", "revenue", "cogs", "net_income", "total_assets", "equity"]
    label, _conf = _classify_heuristic(cols)
    assert label == "financial_statements"


def test_classify_debtors_creditors():
    cols = ["party_name", "outstanding_amount", "due_date", "invoice_date"]
    label, _conf = _classify_heuristic(cols)
    assert label == "debtors_creditors"


def test_classify_general_fallback():
    cols = ["product", "quantity", "price", "region"]
    label, conf = _classify_heuristic(cols)
    assert label == "general"
    # Heuristic is unsure here — caller should escalate to AI in this case.
    assert conf == "low"


def test_classify_je_partial_match():
    # Has date + amount + ledger — enough for JE high confidence
    cols = ["voucher_date", "debit_amount", "ledger"]
    label, _conf = _classify_heuristic(cols)
    assert label == "journal_entries"


def test_classify_returns_tuple():
    """Tier-7 contract: heuristic returns (label, confidence) so callers
    can decide whether to escalate to AI. Don't change without updating
    `classify_dataset`."""
    result = _classify_heuristic(["a", "b"])
    assert isinstance(result, tuple)
    assert len(result) == 2
    assert result[1] in ("high", "medium", "low")
