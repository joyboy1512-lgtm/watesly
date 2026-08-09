from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Watesly"
    app_env: str = "development"
    app_debug: bool = False
    app_secret_key: SecretStr
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    refresh_cookie_name: str = "watesly_refresh_token"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: str = "lax"
    refresh_cookie_domain: str | None = None
    invitation_token_expire_hours: int = 72
    app_public_url: str = "http://localhost:5173"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "Watesly"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 20
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    max_upload_bytes: int = 26214400
    app_version: str = "0.28.0"
    automation_max_steps: int = 200
    automation_max_runtime_seconds: int = 900
    database_url: str
    redis_url: str
    celery_broker_url: str
    celery_result_backend: str

    credential_encryption_key: SecretStr
    data_key_encryption_key: SecretStr
    support_access_max_hours: int = 24
    meta_app_secret: SecretStr
    meta_app_id: str | None = None
    meta_embedded_signup_config_id: str | None = None
    meta_webhook_verify_token: SecretStr
    meta_graph_api_base_url: str = "https://graph.facebook.com"
    meta_graph_api_version: str
    cors_origins: str = "http://localhost:5173"
    s3_endpoint_url: str
    s3_access_key: SecretStr
    s3_secret_key: SecretStr
    s3_bucket: str
    s3_region: str = "us-east-1"
    s3_public_base_url: str

    ai_api_key: SecretStr | None = None
    ai_api_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-4o-mini"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
