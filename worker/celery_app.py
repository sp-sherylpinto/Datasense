# worker/celery_app.py
from celery import Celery
from app.config import settings

celery_app = Celery(
    "worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "worker.tasks.summarise",
        "worker.tasks.benford",
        "worker.tasks.outliers",
        "worker.tasks.timeseries",
        "worker.tasks.clustering",
        "worker.tasks.network",
        "worker.tasks.profile",
        "worker.tasks.cleaning",
        "worker.tasks.je",
        "worker.tasks.ratios",
        "worker.tasks.aging",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
