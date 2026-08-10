from io import BytesIO
from urllib.parse import urlparse
from uuid import UUID, uuid4

import boto3
from botocore.client import Config

from app.core.config import settings


def _is_externally_accessible(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not url.startswith("https://"):
        return False
    return host not in {"localhost", "127.0.0.1", "minio", "host.docker.internal"}


class ObjectStorage:
    def __init__(self) -> None:
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
        )
        self.bucket = settings.s3_bucket

    def bucket_exists(self) -> bool:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True
        except Exception:
            return False

    def ensure_bucket(self) -> None:
        if not self.bucket_exists():
            self.client.create_bucket(Bucket=self.bucket)
        self._ensure_public_read_policy()

    def _ensure_public_read_policy(self) -> None:
        """Meta must fetch template media URLs without auth."""
        import json

        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{self.bucket}/*"],
                }
            ],
        }
        try:
            self.client.put_bucket_policy(Bucket=self.bucket, Policy=json.dumps(policy))
        except Exception:
            pass

    def build_public_url(self, key: str) -> str:
        base = settings.s3_public_base_url.strip().rstrip("/")
        if not base:
            return ""
        return f"{base}/{key.lstrip('/')}"

    def key_from_public_url(self, url: str) -> str | None:
        if not url:
            return None
        public_base = settings.s3_public_base_url.strip().rstrip("/")
        normalized = url.strip()
        if public_base and normalized.startswith(f"{public_base}/"):
            return normalized[len(public_base) + 1 :]
        parsed = urlparse(normalized)
        bucket_prefix = f"/{self.bucket}/"
        if parsed.path.startswith(bucket_prefix):
            return parsed.path[len(bucket_prefix) :]
        return None

    def create_presigned_download_url(self, key: str, expires_seconds: int = 900) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_seconds,
        )

    def resolve_accessible_url(
        self,
        key: str,
        *,
        for_meta: bool = False,
        expires_seconds: int = 604_800,
    ) -> str:
        public_url = self.build_public_url(key)
        if public_url and _is_externally_accessible(public_url):
            return public_url
        return self.create_presigned_download_url(key, expires_seconds=expires_seconds)

    def upload_fileobj(
        self,
        *,
        account_id: UUID,
        filename: str,
        content_type: str | None,
        fileobj,
    ) -> tuple[str, str]:
        self.ensure_bucket()
        safe = filename.replace("/", "_").replace("\\", "_")
        key = f"accounts/{account_id}/{uuid4()}-{safe}"
        self.client.upload_fileobj(
            fileobj,
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type or "application/octet-stream"},
        )
        return key, self.resolve_accessible_url(key, for_meta=True)

    def upload_bytes(
        self,
        *,
        account_id: UUID,
        filename: str,
        content_type: str | None,
        content: bytes,
    ) -> tuple[str, str]:
        return self.upload_fileobj(
            account_id=account_id,
            filename=filename,
            content_type=content_type,
            fileobj=BytesIO(content),
        )

    def delete_object(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def download_bytes(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response["Body"].read()
        if not body:
            raise ValueError("EMPTY_OBJECT")
        return body

    def upload_platform_fileobj(
        self,
        *,
        filename: str,
        content_type: str | None,
        fileobj,
    ) -> tuple[str, str]:
        self.ensure_bucket()
        safe = filename.replace("/", "_").replace("\\", "_")
        key = f"platform/site/{uuid4()}-{safe}"
        self.client.upload_fileobj(
            fileobj,
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type or "application/octet-stream"},
        )
        return key, self.resolve_accessible_url(key)


storage = ObjectStorage()
