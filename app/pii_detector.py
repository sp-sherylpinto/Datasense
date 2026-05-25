"""PII / sensitive-data detection for uploaded datasets.

Scans text columns for Indian regulatory identifiers and common sensitive
patterns. Returns a structured summary suitable for `datasets.pii_summary`.

Patterns:
- PAN      : ABCDE1234F
- GSTIN    : 22ABCDE1234F1Z5
- Aadhaar  : 1234 5678 9012 (12 digits, optional spaces)
- Bank AC  : 9–18 digit sequences (high false-positive rate; flagged loosely)
- Phone    : +91-1234567890 or 10-digit Indian mobile
- Email    : standard RFC-ish pattern
- CreditCard: 4 groups of 4 digits
"""
from __future__ import annotations

import re
from typing import Any

import polars as pl

# ─── Regexes ───────────────────────────────────────────────────────────────

_PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b")
_GSTIN_RE = re.compile(r"\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][Z][0-9A-Z]\b")
_AADHAAR_RE = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")
_BANK_AC_RE = re.compile(r"\b\d{9,18}\b")  # loose — only flagged if column name hints
_PHONE_RE = re.compile(r"(?:\+91[-\s]?)?[6-9]\d{9}\b")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_CC_RE = re.compile(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b")

_BANK_HINTS = {"account", "ac", "acno", "account_no", "account_number", "bank", "ifsc"}


_PATTERNS: list[tuple[str, re.Pattern, set[str] | None]] = [
    ("pan", _PAN_RE, None),
    ("gstin", _GSTIN_RE, None),
    ("aadhaar", _AADHAAR_RE, None),
    ("bank_account", _BANK_AC_RE, _BANK_HINTS),
    ("phone", _PHONE_RE, None),
    ("email", _EMAIL_RE, None),
    ("credit_card", _CC_RE, None),
]


def _sample_column(series: pl.Series, limit: int = 5000) -> list[str]:
    """Return up to *limit* non-null string values from a column."""
    try:
        vals = series.drop_nulls().cast(pl.String).head(limit).to_list()
    except Exception:
        return []
    return [str(v).strip() for v in vals if v is not None and str(v).strip()]


def scan_dataframe(df: pl.DataFrame) -> dict[str, Any]:
    """Scan every text-ish column for PII patterns.

    Returns:
        {
            "pii_detected": bool,
            "patterns": [
                {"type": "pan", "column": "pan_no", "sample_count": 3},
                ...
            ],
            "columns_scanned": int,
            "total_cells_checked": int,
        }
    """
    findings: list[dict] = []
    columns_scanned = 0
    total_cells = 0

    for col_name in df.columns:
        series = df[col_name]
        # Only scan string columns (or columns we can cast to string)
        try:
            sample = _sample_column(series, limit=2000)
        except Exception:
            continue

        if not sample:
            continue

        columns_scanned += 1
        total_cells += len(sample)
        col_lower = col_name.lower()

        for ptype, pattern, hints in _PATTERNS:
            if hints and not any(h in col_lower for h in hints):
                continue  # skip loose patterns on unrelated columns

            matches = 0
            for val in sample:
                if pattern.search(val):
                    matches += 1
                    if matches >= 3:
                        break  # enough evidence

            if matches >= 1:
                findings.append({
                    "type": ptype,
                    "column": col_name,
                    "sample_count": matches,
                })
                # Don't re-scan this column for the same pattern
                break

    return {
        "pii_detected": len(findings) > 0,
        "patterns": findings,
        "columns_scanned": columns_scanned,
        "total_cells_checked": total_cells,
    }
