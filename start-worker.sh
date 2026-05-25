#!/bin/bash
# Install celery
pip install celery redis

# Run the celery worker
celery -A worker.celery_app worker --loglevel=info
