# app/duckdb_helper.py
import duckdb
import polars as pl


def query_parquet(path: str, sql: str) -> pl.DataFrame:
    """Query a Parquet file using DuckDB and return a Polars DataFrame."""
    # DuckDB's read_parquet() can be used directly in SQL
    # We use an ephemeral in-memory connection
    with duckdb.connect(database=":memory:") as conn:
        # Register the parquet file as a view or just use read_parquet
        # For simplicity, we'll assume the SQL uses the path correctly
        # or we can replace a placeholder in the SQL.
        # Example: SELECT * FROM read_parquet('path/to/file.parquet')
        query = sql.replace("{path}", f"'{path}'")
        return conn.execute(query).pl()


def get_duckdb_conn():
    """Dependency for getting a read-only DuckDB connection."""
    # DuckDB connection is ephemeral and read-only by default in-memory
    conn = duckdb.connect(database=":memory:", read_only=False)
    try:
        yield conn
    finally:
        conn.close()
