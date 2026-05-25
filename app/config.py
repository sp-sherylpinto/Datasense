# app/config.py
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings."""

    DATABASE_URL: str = Field(..., env="DATABASE_URL")
    REDIS_URL: str = Field("redis://localhost:6379", env="REDIS_URL")
    DATA_DIR: str = Field("/data", env="DATA_DIR")
    UPLOAD_DIR: str = Field("/data/uploads", env="UPLOAD_DIR")
    LOG_LEVEL: str = Field("info", env="LOG_LEVEL")
    SECRET_KEY: str = Field("change-me-in-production", env="SECRET_KEY")
    API_AUTH_TOKEN: str = Field("dev-token", env="API_AUTH_TOKEN")
    APP_DB_USER: str = Field("analytics_app", env="APP_DB_USER")
    APP_DB_PASSWORD: str = Field("analytics_app_rls", env="APP_DB_PASSWORD")
    OLLAMA_URL: str = Field(
        "http://data_analytics-ollama:11434", env="OLLAMA_URL"
    )

    AZURE_OPENAI_API_KEY: str = Field("", env="AZURE_OPENAI_API_KEY")
    AZURE_OPENAI_ENDPOINT: str = Field("", env="AZURE_OPENAI_ENDPOINT")
    AZURE_OPENAI_MODEL: str = Field("gpt-5.2-chat", env="AZURE_OPENAI_MODEL")
    AZURE_OPENAI_API_VERSION: str = Field(
        "2025-04-01-preview", env="AZURE_OPENAI_API_VERSION"
    )

    AUDIT_ADMINS: str = Field("", env="AUDIT_ADMINS")

    SMTP_HOST: str = Field("", env="SMTP_HOST")
    SMTP_PORT: int = Field(587, env="SMTP_PORT")
    SMTP_USER: str = Field("", env="SMTP_USER")
    SMTP_PASS: str = Field("", env="SMTP_PASS")
    SMTP_FROM: str = Field("", env="SMTP_FROM")
    SMTP_USE_TLS: bool = Field(False, env="SMTP_USE_TLS")
    SMTP_USE_SSL: bool = Field(False, env="SMTP_USE_SSL")
    APP_URL: str = Field("https://datasense.varma.ai", env="APP_URL")

    @property
    def audit_admin_set(self) -> set[str]:
        return {
            e.strip().lower()
            for e in (self.AUDIT_ADMINS or "").split(",")
            if e.strip()
        }

    @property
    def auth_token(self) -> str:
        t = self.API_AUTH_TOKEN or "dev-token"
        return t.strip()

    @property
    def use_azure(self) -> bool:
        return bool(self.AZURE_OPENAI_API_KEY and self.AZURE_OPENAI_ENDPOINT)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
