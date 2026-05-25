# tests/conftest.py
import pytest
import polars as pl


@pytest.fixture
def benford_csv(tmp_path):
    """A small dataset whose `amount` column should pass Benford's Law.
    Log-uniform sampling produces a roughly Benford-conforming digit spread."""
    import random
    random.seed(42)
    amounts = [round(10 ** random.uniform(0, 5), 2) for _ in range(200)]
    df = pl.DataFrame({"vendor": [f"V{i % 20}" for i in range(200)], "amount": amounts})
    path = tmp_path / "benford.csv"
    df.write_csv(path)
    return str(path)


@pytest.fixture
def outlier_csv(tmp_path):
    """Most values cluster around 100; three are extreme."""
    values = [100.0] * 50 + [105.0] * 30 + [10_000.0, -5_000.0, 50_000.0]
    df = pl.DataFrame({"txn_id": list(range(len(values))), "amount": values})
    path = tmp_path / "outliers.csv"
    df.write_csv(path)
    return str(path)


@pytest.fixture
def cluster_csv(tmp_path):
    """Two well-separated 2D blobs — KMeans must find them."""
    import random
    random.seed(7)
    points = (
        [(random.gauss(0, 1), random.gauss(0, 1)) for _ in range(40)]
        + [(random.gauss(10, 1), random.gauss(10, 1)) for _ in range(40)]
    )
    df = pl.DataFrame({"x": [p[0] for p in points], "y": [p[1] for p in points]})
    path = tmp_path / "clusters.csv"
    df.write_csv(path)
    return str(path)


@pytest.fixture
def network_csv(tmp_path):
    """Source → target edges with repeats so groupby produces distinct counts."""
    df = pl.DataFrame({
        "src": ["A", "A", "B", "B", "C", "A", "D"],
        "tgt": ["X", "Y", "X", "Z", "Z", "X", "X"],
    })
    path = tmp_path / "network.csv"
    df.write_csv(path)
    return str(path)


@pytest.fixture
def ts_csv(tmp_path):
    """Daily values with a clear linear trend — forecast should extrapolate."""
    df = pl.DataFrame({
        "date": [f"2026-01-{i:02d}" for i in range(1, 21)],
        "amount": [100.0 + i * 5 for i in range(1, 21)],
    })
    path = tmp_path / "ts.csv"
    df.write_csv(path)
    return str(path)


@pytest.fixture
def sample_je_df():
    """A minimal journal entries DataFrame for testing."""
    return pl.DataFrame({
        "date":     ["2026-03-21", "2026-03-22", "2026-03-31", "2026-03-15"],
        "amount":   [5000.0, -5000.0, 100000.0, 1234.56],
        "account":  ["Sales", "Sales", "Cash", "Expenses"],
        "preparer": ["alice", "alice", "bob", "alice"],
        "narration":["Invoice #1", "Invoice #1", "Year end adj", "Travel"],
    })


@pytest.fixture
def sample_ratio_df():
    """Single-period financial statement data."""
    return pl.DataFrame({
        "period":              ["Q1 2026"],
        "revenue":             [1_000_000.0],
        "cogs":                [600_000.0],
        "gross_profit":        [400_000.0],
        "net_income":          [100_000.0],
        "current_assets":      [500_000.0],
        "current_liabilities": [250_000.0],
        "inventory":           [50_000.0],
        "total_assets":        [1_200_000.0],
        "total_debt":          [300_000.0],
        "equity":              [700_000.0],
        "ebit":                [150_000.0],
        "interest_expense":    [30_000.0],
    })


@pytest.fixture
def sample_aging_df():
    """Debtors listing with due dates. Covers all aging buckets."""
    return pl.DataFrame({
        "party":    ["Acme Ltd", "Beta Corp", "Gamma Inc", "Delta Co", "Epsilon Ltd", "Zeta Corp"],
        "amount":   [10000.0, 5000.0, 75000.0, 2000.0, 50000.0, 30000.0],
        "due_date": [
            "2026-02-01",   # Acme:   50 days overdue at 2026-03-23 → 1–90 days
            "2025-12-01",   # Beta:   112 days overdue → 91–180 days
            "2025-06-01",   # Gamma:  295 days overdue → 181–365 days
            "2026-03-20",   # Delta:  3 days overdue → 1–90 days (or Current if ref < 2026-03-20)
            "2026-04-30",   # Epsilon: not yet due → Current
            "2024-01-01",   # Zeta:   2+ years overdue → 731–1095 days
        ],
    })
