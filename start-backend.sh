#!/bin/bash
# Install python dependencies if needed
pip install fastapi uvicorn asyncpg pydantic-settings celery redis polars duckdb pyarrow

# Run the FastAPI app on port 8000
uvicorn app.main:app --host 0.0.0.0 --port 8000
