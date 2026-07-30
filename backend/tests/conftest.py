import os

DEFAULTS = {
    "APP_SECRET_KEY": "test-secret-key-at-least-32-characters-long",
    "DATABASE_URL": "postgresql+asyncpg://mywat:mywat@localhost:5432/mywat_test",
    "REDIS_URL": "redis://localhost:6379/15",
    "CELERY_BROKER_URL": "redis://localhost:6379/15",
    "CELERY_RESULT_BACKEND": "redis://localhost:6379/15",
    "CREDENTIAL_ENCRYPTION_KEY": "4XH2gZKuwoDy5UB0NtZJ6vGKnMl0oEvh9jlqHFq1rHs=",
    "DATA_KEY_ENCRYPTION_KEY": "71A3ZiF_LAY7vTIR5ksA9nxqbdOUoP2QmfP4zls9nKA=",
    "META_APP_SECRET": "test-meta-secret",
    "META_WEBHOOK_VERIFY_TOKEN": "test-verify-token",
    "META_GRAPH_API_VERSION": "v23.0",
    "S3_ENDPOINT_URL": "http://localhost:9000",
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test-secret",
    "S3_BUCKET": "test-bucket",
    "S3_PUBLIC_BASE_URL": "http://localhost:9000/test-bucket",
}
for key, value in DEFAULTS.items():
    os.environ.setdefault(key, value)
