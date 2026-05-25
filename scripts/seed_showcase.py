"""Seed the DataSense partner showcase: demo client + engagement +
synthetic Trial Balance + 5 Saved Views.

Idempotent: re-running deletes the previous showcase artefacts (by their
well-known UUIDs) before re-creating them. Safe to iterate on.

Run from inside the data_analytics container:
    docker exec data_analytics python /app/scripts/seed_showcase.py

Or from the host (script reads DATABASE_URL from env or uses the default
container connection string when run inside data_analytics).
"""
from __future__ import annotations

import json
import os
import random
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import asyncio
import asyncpg


# ─── Well-known IDs (idempotent seeding) ─────────────────────────────────────
DEMO_CLIENT_ID     = uuid.UUID("11111111-1111-1111-1111-111111111111")
DEMO_ENGAGEMENT_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
DEMO_DATASET_ID    = uuid.UUID("33333333-3333-3333-3333-333333333333")
DEMO_TABLE_NAME    = "datasets.ds_33333333333333333333333333333333"
DEMO_OWNER         = None  # owner=NULL marks this as a shared/showcase row;
                            # any authenticated user can read AND edit it
                            # (see migration 013).

DEMO_CLIENT_CODE   = "VV-DEMO-0001"
DEMO_ENG_CODE      = "VV-DEMO-0001/SA/26"

# Materiality thresholds for the demo (so the SA320 quick-fill shortcuts
# render meaningful values).
OM_RUPEES = 1_000_000   # ₹10,00,000
PM_RUPEES =   750_000   # ₹7,50,000

# Period covered by the demo TB.
PERIOD_START = date(2025, 4, 1)
PERIOD_END   = date(2026, 3, 31)


# ─── Synthetic TB row generator ──────────────────────────────────────────────
# 100-200 rows, realistic Indian-CA shape. Anomalies seeded so views surface
# them. All amounts in INR.

random.seed(42)  # reproducible

# (account_code, account_name, fs_group, normal_dr_or_cr) tuples
# fs_group maps to the workpaper letter scheme (F-PPE, G-TradeReceivables, ...)
ACCOUNT_TEMPLATES = [
    # Fixed Assets (F-PPE) — debit-natured
    ("1101", "Land — Freehold", "F-PPE", "DR"),
    ("1102", "Buildings — Factory", "F-PPE", "DR"),
    ("1103", "Buildings — Office", "F-PPE", "DR"),
    ("1104", "Plant & Machinery", "F-PPE", "DR"),
    ("1105", "Electrical Fittings", "F-PPE", "DR"),
    ("1106", "Furniture & Fixtures", "F-PPE", "DR"),
    ("1107", "Vehicles — Commercial", "F-PPE", "DR"),
    ("1108", "Computer Equipment", "F-PPE", "DR"),
    ("1109", "Capital Work in Progress", "F-PPE", "DR"),
    ("1190", "Accumulated Depreciation — P&M", "V-Depreciation", "CR"),
    ("1191", "Accumulated Depreciation — Buildings", "V-Depreciation", "CR"),
    ("1192", "Accumulated Depreciation — Vehicles", "V-Depreciation", "CR"),
    # Investments (X-Investments)
    ("1201", "Investment in Subsidiary — Demo Logistics Pvt Ltd", "X-Investments", "DR"),
    ("1202", "Mutual Funds — Liquid", "X-Investments", "DR"),
    ("1203", "Fixed Deposits — Lien Marked", "X-Investments", "DR"),
    # Inventory (J-Inventories)
    ("1301", "Raw Materials", "J-Inventories", "DR"),
    ("1302", "Work in Progress", "J-Inventories", "DR"),
    ("1303", "Finished Goods", "J-Inventories", "DR"),
    ("1304", "Stores & Spares", "J-Inventories", "DR"),
    ("1305", "Goods in Transit", "J-Inventories", "DR"),
    # Trade Receivables (G-TradeReceivables)
    ("1401", "Trade Receivables — Customer A Ltd", "G-TradeReceivables", "DR"),
    ("1402", "Trade Receivables — Customer B Pvt Ltd", "G-TradeReceivables", "DR"),
    ("1403", "Trade Receivables — Customer C Co", "G-TradeReceivables", "DR"),
    ("1404", "Trade Receivables — Customer D LLP", "G-TradeReceivables", "DR"),
    ("1405", "Trade Receivables — Customer E", "G-TradeReceivables", "DR"),
    ("1406", "Trade Receivables — Customer F (>365 days)", "G-TradeReceivables", "DR"),
    ("1407", "Provision for Doubtful Debts", "G-TradeReceivables", "CR"),
    # Cash & Bank (K-CashBank)
    ("1501", "Cash in Hand", "K-CashBank", "DR"),
    ("1502", "HDFC Bank — Current 0001", "K-CashBank", "DR"),
    ("1503", "ICICI Bank — Current 0002", "K-CashBank", "DR"),
    ("1504", "SBI Bank — Current 0003", "K-CashBank", "DR"),
    ("1505", "Axis Bank — FCRA Account", "K-CashBank", "DR"),
    # Loans & Advances (H-LoansAdvances)
    ("1601", "Advance to Suppliers", "H-LoansAdvances", "DR"),
    ("1602", "Loans to Employees", "H-LoansAdvances", "DR"),
    ("1603", "Security Deposits — Rented Premises", "H-LoansAdvances", "DR"),
    ("1604", "GST Input Credit", "H-LoansAdvances", "DR"),
    ("1605", "TDS Receivable", "H-LoansAdvances", "DR"),
    # Other Current Assets (I-OtherCurrentAssets)
    ("1701", "Prepaid Expenses — Insurance", "I-OtherCurrentAssets", "DR"),
    ("1702", "Prepaid Expenses — Rent", "I-OtherCurrentAssets", "DR"),
    ("1703", "Interest Accrued — FDs", "I-OtherCurrentAssets", "DR"),
    # Share Capital + Reserves (L-ShareCapital_Reserves)
    ("2101", "Equity Share Capital", "L-ShareCapital_Reserves", "CR"),
    ("2102", "Securities Premium", "L-ShareCapital_Reserves", "CR"),
    ("2103", "General Reserve", "L-ShareCapital_Reserves", "CR"),
    ("2104", "Retained Earnings", "L-ShareCapital_Reserves", "CR"),
    # Borrowings (M-Borrowings_GovtGrants)
    ("2201", "Term Loan — HDFC Bank", "M-Borrowings_GovtGrants", "CR"),
    ("2202", "Working Capital Loan — ICICI", "M-Borrowings_GovtGrants", "CR"),
    ("2203", "Vehicle Loans", "M-Borrowings_GovtGrants", "CR"),
    # Trade Payables (O-TradePayables)
    ("2301", "Trade Payables — Vendor X Ltd", "O-TradePayables", "CR"),
    ("2302", "Trade Payables — Vendor Y Pvt Ltd", "O-TradePayables", "CR"),
    ("2303", "Trade Payables — MSME Vendors", "O-TradePayables", "CR"),
    ("2304", "Trade Payables — Vendor Z", "O-TradePayables", "CR"),
    ("2305", "Trade Payables — Capital Goods", "O-TradePayables", "CR"),
    # Other Liabilities (P-OtherLiabilities)
    ("2401", "TDS Payable", "P-OtherLiabilities", "CR"),
    ("2402", "GST Output Liability", "P-OtherLiabilities", "CR"),
    ("2403", "PF & ESI Payable", "P-OtherLiabilities", "CR"),
    ("2404", "Salaries Payable", "P-OtherLiabilities", "CR"),
    ("2405", "Audit Fee Payable", "P-OtherLiabilities", "CR"),
    # Provisions (Q-Provisions)
    ("2501", "Provision for Gratuity", "Q-Provisions", "CR"),
    ("2502", "Provision for Leave Encashment", "Q-Provisions", "CR"),
    ("2503", "Provision for Income Tax", "Q-Provisions", "CR"),
    # Revenue (R-Revenue)
    ("4101", "Sales — Domestic", "R-Revenue", "CR"),
    ("4102", "Sales — Exports", "R-Revenue", "CR"),
    ("4103", "Sales — Services", "R-Revenue", "CR"),
    ("4104", "Sales Returns", "R-Revenue", "DR"),
    # Other Income (S-OtherIncome)
    ("4201", "Interest Income — FDs", "S-OtherIncome", "CR"),
    ("4202", "Dividend Income", "S-OtherIncome", "CR"),
    ("4203", "Foreign Exchange Gain", "S-OtherIncome", "CR"),
    ("4204", "Profit on Sale of Asset", "S-OtherIncome", "CR"),
    # Cost of Sales (U-Cost / COS)
    ("5101", "Raw Material Consumed", "U-FinanceCosts", "DR"),
    ("5102", "Power & Fuel", "U-FinanceCosts", "DR"),
    ("5103", "Freight Inwards", "U-FinanceCosts", "DR"),
    # Employee Benefits (T-EmployeeBenefits)
    ("5201", "Salaries & Wages", "T-EmployeeBenefits", "DR"),
    ("5202", "PF & ESI Contribution", "T-EmployeeBenefits", "DR"),
    ("5203", "Bonus", "T-EmployeeBenefits", "DR"),
    ("5204", "Gratuity", "T-EmployeeBenefits", "DR"),
    ("5205", "Staff Welfare", "T-EmployeeBenefits", "DR"),
    # Operating Expenses (Y-OtherExpenses)
    ("5301", "Rent — Office", "Y-OtherExpenses", "DR"),
    ("5302", "Rent — Factory", "Y-OtherExpenses", "DR"),
    ("5303", "Repairs & Maintenance — Plant", "Y-OtherExpenses", "DR"),
    ("5304", "Repairs & Maintenance — Buildings", "Y-OtherExpenses", "DR"),
    ("5305", "Insurance", "Y-OtherExpenses", "DR"),
    ("5306", "Travel & Conveyance", "Y-OtherExpenses", "DR"),
    ("5307", "Legal & Professional Fees", "Y-OtherExpenses", "DR"),
    ("5308", "Audit Fee", "Y-OtherExpenses", "DR"),
    ("5309", "Bank Charges", "Y-OtherExpenses", "DR"),
    ("5310", "Office Expenses", "Y-OtherExpenses", "DR"),
    ("5311", "Communication Expenses", "Y-OtherExpenses", "DR"),
    ("5312", "Printing & Stationery", "Y-OtherExpenses", "DR"),
    ("5313", "Advertising & Promotion", "Y-OtherExpenses", "DR"),
    ("5314", "Bad Debts Written Off", "Y-OtherExpenses", "DR"),
    ("5315", "Donations & CSR", "Y-OtherExpenses", "DR"),
    # Finance Costs (U-FinanceCosts)
    ("5401", "Interest on Term Loan", "U-FinanceCosts", "DR"),
    ("5402", "Interest on Working Capital", "U-FinanceCosts", "DR"),
    ("5403", "Interest on Vehicle Loans", "U-FinanceCosts", "DR"),
    # Income Tax (W-IncomeTax)
    ("5501", "Current Tax Expense", "W-IncomeTax", "DR"),
    ("5502", "Deferred Tax Expense", "W-IncomeTax", "DR"),
    # Depreciation (V-Depreciation) — P&L side
    ("5601", "Depreciation Expense", "V-Depreciation", "DR"),
]


def amount_for(code: str) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]:
    """Generate (opening_dr, opening_cr, debit_total, credit_total, closing_dr, closing_cr).

    Realistic amounts seeded so the showcase views surface anomalies.
    """
    n = int(code)
    # Magnitude band by account class
    if 1100 <= n < 1200:        # Fixed Assets — large
        base = random.randint(500_000, 50_000_000)
    elif 1190 <= n < 1200:      # Accumulated dep — large CR
        base = random.randint(200_000, 10_000_000)
    elif 1200 <= n < 1300:      # Investments
        base = random.randint(100_000, 20_000_000)
    elif 1300 <= n < 1400:      # Inventory
        base = random.randint(500_000, 30_000_000)
    elif 1400 <= n < 1500:      # Receivables
        base = random.randint(100_000, 8_000_000)
    elif 1500 <= n < 1600:      # Cash & Bank
        base = random.randint(50_000, 5_000_000)
    elif 1600 <= n < 1700:      # Loans & Advances
        base = random.randint(20_000, 2_000_000)
    elif 1700 <= n < 1800:      # Other CA
        base = random.randint(10_000, 500_000)
    elif 2100 <= n < 2200:      # Share capital + reserves
        base = random.randint(1_000_000, 100_000_000)
    elif 2200 <= n < 2300:      # Borrowings
        base = random.randint(500_000, 50_000_000)
    elif 2300 <= n < 2400:      # Trade Payables
        base = random.randint(100_000, 10_000_000)
    elif 2400 <= n < 2500:      # Other liab
        base = random.randint(20_000, 1_000_000)
    elif 2500 <= n < 2600:      # Provisions
        base = random.randint(50_000, 2_000_000)
    elif 4100 <= n < 4200:      # Revenue
        base = random.randint(5_000_000, 200_000_000)
    elif 4200 <= n < 4300:      # Other income
        base = random.randint(100_000, 5_000_000)
    elif 5100 <= n < 5200:      # COS
        base = random.randint(2_000_000, 100_000_000)
    elif 5200 <= n < 5300:      # Employee
        base = random.randint(500_000, 30_000_000)
    elif 5300 <= n < 5400:      # Opex
        base = random.randint(50_000, 8_000_000)
    elif 5400 <= n < 5500:      # Finance costs
        base = random.randint(100_000, 4_000_000)
    elif 5500 <= n < 5600:      # Income tax
        base = random.randint(500_000, 5_000_000)
    elif 5600 <= n < 5700:      # Depreciation P&L
        base = random.randint(500_000, 10_000_000)
    else:
        base = random.randint(10_000, 500_000)

    # Movements during period
    debit_total = Decimal(str(base * random.uniform(0.4, 1.5))).quantize(Decimal("0.01"))
    credit_total = Decimal(str(base * random.uniform(0.4, 1.5))).quantize(Decimal("0.01"))
    opening_dr = opening_cr = Decimal("0.00")
    return (opening_dr, opening_cr, debit_total, credit_total, Decimal("0.00"), Decimal("0.00"))


def build_rows() -> list[dict]:
    """Materialise the synthetic TB. Adds a handful of seeded anomalies on top
    of the random per-account amounts."""
    rows = []
    for (code, name, fs_group, normal_side) in ACCOUNT_TEMPLATES:
        op_dr, op_cr, dr, cr, _cl_dr, _cl_cr = amount_for(code)

        # Establish opening balance (prior-year closing)
        if normal_side == "DR":
            op_dr = (Decimal(str(int(dr) + int(cr))) // 2).quantize(Decimal("0.01"))
        else:
            op_cr = (Decimal(str(int(dr) + int(cr))) // 2).quantize(Decimal("0.01"))

        # Closing = opening + movements
        closing_dr = op_dr + dr - cr if normal_side == "DR" else Decimal("0.00")
        closing_cr = op_cr + cr - dr if normal_side == "CR" else Decimal("0.00")
        if closing_dr < 0:
            closing_cr = -closing_dr; closing_dr = Decimal("0.00")
        if closing_cr < 0:
            closing_dr = -closing_cr; closing_cr = Decimal("0.00")

        rows.append({
            "account_code": code,
            "account_name": name,
            "fs_group":     fs_group,
            "opening_dr":   op_dr,
            "opening_cr":   op_cr,
            "debit_total":  dr,
            "credit_total": cr,
            "closing_dr":   closing_dr.quantize(Decimal("0.01")),
            "closing_cr":   closing_cr.quantize(Decimal("0.01")),
        })

    # ─── Seeded anomalies ─────────────────────────────────────────────────
    # Helper to find a row by code
    by_code = {r["account_code"]: r for r in rows}

    # Anomaly 1: Customer F (>365 days) carries a large unmoving balance
    f = by_code.get("1406")
    if f:
        f["opening_dr"]   = Decimal("4500000.00")  # ₹45 lakhs
        f["debit_total"]  = Decimal("0.00")
        f["credit_total"] = Decimal("0.00")
        f["closing_dr"]   = Decimal("4500000.00")
        f["closing_cr"]   = Decimal("0.00")

    # Anomaly 2: One opex item with round-numbered closing > PM (₹7.5L)
    r = by_code.get("5307")  # Legal & Professional Fees
    if r:
        r["opening_dr"]   = Decimal("0.00")
        r["debit_total"]  = Decimal("1500000.00")  # exact ₹15L
        r["credit_total"] = Decimal("0.00")
        r["closing_dr"]   = Decimal("1500000.00")

    # Anomaly 3: Round-numbered Donations entry > PM
    r = by_code.get("5315")  # Donations & CSR
    if r:
        r["debit_total"]  = Decimal("1000000.00")  # exact ₹10L (hits OM exactly)
        r["closing_dr"]   = (r["opening_dr"] + r["debit_total"] - r["credit_total"]).quantize(Decimal("0.01"))

    # Anomaly 4: Audit Fee Payable round number
    r = by_code.get("2405")
    if r:
        r["closing_cr"]   = Decimal("500000.00")

    # Anomaly 5: Movement diverges from opening — Plant & Machinery
    r = by_code.get("1104")
    if r:
        # Set a clear divergence: large additions, small disposals
        r["opening_dr"]   = Decimal("25000000.00")
        r["debit_total"]  = Decimal("8500000.00")  # additions
        r["credit_total"] = Decimal("250000.00")   # disposals
        r["closing_dr"]   = (r["opening_dr"] + r["debit_total"] - r["credit_total"]).quantize(Decimal("0.01"))

    return rows


# ─── DB plumbing ─────────────────────────────────────────────────────────────

DEFAULT_DB_URL = "postgresql://postgres:postgres@data_analytics-postgres:5432/analytics"


async def _connect() -> asyncpg.Connection:
    url = os.environ.get("DATABASE_URL") or DEFAULT_DB_URL
    return await asyncpg.connect(url)


async def upsert_demo_client(conn: asyncpg.Connection):
    """Idempotently create the demo client at the well-known UUID."""
    await conn.execute(
        """
        INSERT INTO core.clients (
            id, code, legal_name, display_name, entity_type,
            registered_address, contact, branch,
            status, notes, created_by, updated_by
        )
        VALUES (
            $1, $2, $3, $4, 'private_limited',
            '{}'::jsonb, '{}'::jsonb, 'Bangalore',
            'active',
            'DataSense partner-showcase demo client. Synthetic data; safe to share.',
            'showcase-seed', 'showcase-seed'
        )
        ON CONFLICT (id) DO UPDATE SET
            legal_name   = EXCLUDED.legal_name,
            display_name = EXCLUDED.display_name,
            updated_at   = now(),
            updated_by   = 'showcase-seed'
        """,
        DEMO_CLIENT_ID,
        DEMO_CLIENT_CODE,
        "DataSense Showcase Demo Pvt Ltd",
        "Demo Co (Showcase)",
    )


async def upsert_demo_engagement(conn: asyncpg.Connection):
    """Idempotently create the demo engagement with vertical/framework/materiality
    set so the SA320 quick-fill shortcuts render."""
    notes = (
        "DataSense partner-showcase engagement — synthetic Trial Balance "
        "demonstrating discovery-tier features.\n\n"
        "WALKTHROUGH:\n"
        "1. Open the Showcase TB dataset.\n"
        "2. Open the Filters panel — note the SA320 quick-fill badges "
        "(PM ₹7,50,000 / OM ₹10,00,000) which use this engagement's materiality.\n"
        "3. Cycle through the 5 Saved Views to see the discovery verbs:\n"
        "   • Above PM — items above performance materiality\n"
        "   • Top 10 by closing — sort + columns persistence\n"
        "   • Round-numbered closings — regex filter (fraud-risk pattern)\n"
        "   • Movement diverges from opening — multi-filter (significant change)\n"
        "   • Receivables only — column-filter slice ready to drill into ageing"
    )
    await conn.execute(
        """
        INSERT INTO core.engagements (
            id, client_id, code, name, engagement_type,
            period_start, period_end, status,
            materiality_planning, materiality_performance,
            vertical, framework,
            lead_manager, notes,
            created_by, updated_by
        )
        VALUES (
            $1, $2, $3, $4, 'statutory_audit'::core.engagement_type,
            $5, $6, 'in_progress'::core.engagement_status,
            $7, $8,
            'general'::core.audit_vertical, 'ind_as'::core.accounting_framework,
            'showcase-seed', $9,
            'showcase-seed', 'showcase-seed'
        )
        ON CONFLICT (id) DO UPDATE SET
            name                    = EXCLUDED.name,
            period_start            = EXCLUDED.period_start,
            period_end              = EXCLUDED.period_end,
            materiality_planning    = EXCLUDED.materiality_planning,
            materiality_performance = EXCLUDED.materiality_performance,
            vertical                = EXCLUDED.vertical,
            framework               = EXCLUDED.framework,
            notes                   = EXCLUDED.notes,
            updated_at              = now(),
            updated_by              = 'showcase-seed'
        """,
        DEMO_ENGAGEMENT_ID,
        DEMO_CLIENT_ID,
        DEMO_ENG_CODE,
        "Statutory Audit FY 2025-26 — Showcase",
        PERIOD_START,
        PERIOD_END,
        OM_RUPEES,
        PM_RUPEES,
        notes,
    )


async def reseed_dataset(conn: asyncpg.Connection, rows: list[dict]):
    """Drop + recreate the dataset table and metadata. Saved views are
    cascade-deleted via FK on `dataset_id`."""
    # Drop the per-dataset table and metadata. CASCADE on saved_views is via
    # public.datasets FK ON DELETE CASCADE.
    await conn.execute("DELETE FROM public.datasets WHERE id = $1", DEMO_DATASET_ID)
    await conn.execute(f"DROP TABLE IF EXISTS {DEMO_TABLE_NAME}")

    # Create the per-dataset table with TB column shape
    await conn.execute(f"""
        CREATE TABLE {DEMO_TABLE_NAME} (
            id            integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
            account_code  text,
            account_name  text,
            fs_group      text,
            opening_dr    numeric,
            opening_cr    numeric,
            debit_total   numeric,
            credit_total  numeric,
            closing_dr    numeric,
            closing_cr    numeric
        )
    """)

    # Insert the synthetic rows
    for r in rows:
        await conn.execute(
            f"""
            INSERT INTO {DEMO_TABLE_NAME}
                (account_code, account_name, fs_group,
                 opening_dr, opening_cr, debit_total, credit_total,
                 closing_dr, closing_cr)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            r["account_code"], r["account_name"], r["fs_group"],
            r["opening_dr"], r["opening_cr"], r["debit_total"], r["credit_total"],
            r["closing_dr"], r["closing_cr"],
        )

    # Columns metadata for the SPA's type system.
    columns_meta = [
        {"name": "account_code", "original_name": "Account Code", "inferred_type": "text",     "native_dtype": False},
        {"name": "account_name", "original_name": "Account Name", "inferred_type": "text",     "native_dtype": False},
        {"name": "fs_group",     "original_name": "FS Group",     "inferred_type": "text",     "native_dtype": False},
        {"name": "opening_dr",   "original_name": "Opening Dr",   "inferred_type": "currency", "native_dtype": True},
        {"name": "opening_cr",   "original_name": "Opening Cr",   "inferred_type": "currency", "native_dtype": True},
        {"name": "debit_total",  "original_name": "Debit Total",  "inferred_type": "currency", "native_dtype": True},
        {"name": "credit_total", "original_name": "Credit Total", "inferred_type": "currency", "native_dtype": True},
        {"name": "closing_dr",   "original_name": "Closing Dr",   "inferred_type": "currency", "native_dtype": True},
        {"name": "closing_cr",   "original_name": "Closing Cr",   "inferred_type": "currency", "native_dtype": True},
    ]

    await conn.execute(
        """
        INSERT INTO public.datasets (
            id, client_id, engagement_id, original_filename, file_type,
            table_name, row_count, columns, owner, dataset_type,
            audit_area_code, summary_memo
        )
        VALUES (
            $1, $2, $3, $4, 'csv',
            $5, $6, $7::jsonb, $8, 'general',
            NULL, $9
        )
        """,
        DEMO_DATASET_ID,
        DEMO_CLIENT_ID,
        DEMO_ENGAGEMENT_ID,
        "TB_Showcase_FY2025-26.csv",
        DEMO_TABLE_NAME,
        len(rows),
        json.dumps(columns_meta),
        DEMO_OWNER,
        "Synthetic Trial Balance for FY 2025-26 (87 GL accounts; PM ₹7.5L / OM ₹10L). "
        "Seeded anomalies surface in the pre-built Saved Views.",
    )


async def reseed_views(conn: asyncpg.Connection):
    """Replace the showcase Saved Views with a curated set of 5 demonstrating
    the Move 2/3 features. Drops any prior showcase views (by FK on dataset)."""
    # Cascade-delete from dataset replacement already removed views; explicit
    # safety net here for re-runs that don't re-drop the dataset.
    await conn.execute("DELETE FROM public.saved_views WHERE dataset_id = $1", DEMO_DATASET_ID)

    views = [
        {
            "name": "1. Above Performance Materiality",
            "description": "GL accounts with closing balance above PM (₹7.5L) — items "
                           "where every individual misstatement matters.",
            "audit_area_code": "general:SA320",
            "filters": [
                {"column": "closing_dr", "op": "gt", "value": str(PM_RUPEES)},
            ],
            "sort": {"column": "closing_dr", "direction": "desc"},
            "columns": ["account_code", "account_name", "fs_group", "closing_dr", "closing_cr"],
        },
        {
            "name": "2. Top 10 by closing balance",
            "description": "Largest 10 accounts by closing Dr — the auditor's first-pass "
                           "view on every engagement.",
            "audit_area_code": None,
            "filters": [
                {"column": "closing_dr", "op": "gt", "value": "0"},
            ],
            "sort": {"column": "closing_dr", "direction": "desc"},
            "columns": ["account_code", "account_name", "fs_group", "closing_dr"],
        },
        {
            "name": "3. Round-numbered closings (fraud-risk pattern)",
            "description": "Closing balances ending in '00000' — round numbers per SA240 "
                           "fraud-risk scanning.",
            "audit_area_code": "general:SA240",
            "filters": [
                {"column": "closing_dr", "op": "regex", "value": "00000\\.00$"},
                {"column": "closing_dr", "op": "gt",    "value": "100000"},
            ],
            "sort": {"column": "closing_dr", "direction": "desc"},
            "columns": ["account_code", "account_name", "fs_group", "debit_total", "credit_total", "closing_dr"],
        },
        {
            "name": "4. Movement diverges from opening",
            "description": "Accounts where total debits exceed ₹50L AND credits are under ₹5L "
                           "— directional growth without offset (additions, accruals, growing receivables).",
            "audit_area_code": None,
            "filters": [
                {"column": "debit_total",  "op": "gt", "value": "5000000"},
                {"column": "credit_total", "op": "lt", "value": "500000"},
            ],
            "sort": {"column": "debit_total", "direction": "desc"},
            "columns": ["account_code", "account_name", "fs_group", "opening_dr", "debit_total", "credit_total", "closing_dr"],
        },
        {
            "name": "5. Trade Receivables only",
            "description": "Slice to G-TradeReceivables — ready to drill into customer ageing "
                           "(>365 days indicator seeded on Customer F).",
            "audit_area_code": "general:G-TradeReceivables",
            "filters": [
                {"column": "fs_group", "op": "equals", "value": "G-TradeReceivables"},
            ],
            "sort": {"column": "closing_dr", "direction": "desc"},
            "columns": ["account_code", "account_name", "opening_dr", "debit_total", "credit_total", "closing_dr"],
        },
    ]

    for v in views:
        await conn.execute(
            """
            INSERT INTO public.saved_views (
                dataset_id, name, description, audit_area_code,
                filters, sort, columns, owner
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
            """,
            DEMO_DATASET_ID, v["name"], v["description"], v["audit_area_code"],
            json.dumps(v["filters"]),
            json.dumps(v["sort"]),
            json.dumps(v["columns"]),
            DEMO_OWNER,
        )


async def main():
    rows = build_rows()
    print(f"Generated {len(rows)} TB rows.")

    conn = await _connect()
    try:
        async with conn.transaction():
            await upsert_demo_client(conn)
            await upsert_demo_engagement(conn)
            await reseed_dataset(conn, rows)
            await reseed_views(conn)
        print("Showcase seeded successfully.")
        print(f"  Client      : {DEMO_CLIENT_CODE}  (id {DEMO_CLIENT_ID})")
        print(f"  Engagement  : {DEMO_ENG_CODE}  (id {DEMO_ENGAGEMENT_ID})")
        print(f"  Dataset     : id {DEMO_DATASET_ID}")
        print(f"  TB rows     : {len(rows)}")
        print(f"  Saved views : 5")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
