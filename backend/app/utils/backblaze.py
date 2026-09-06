import logging

import boto3
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


def get_b2_client():
    if not settings.B2_KEY_ID or not settings.B2_APPLICATION_KEY or not settings.B2_BUCKET_NAME:
        logger.warning("Backblaze B2 credentials are not fully configured. Recording upload will run in SIMULATION mode.")
        return None
    try:
        return boto3.client(
            "s3",
            endpoint_url=settings.B2_ENDPOINT,
            region_name=settings.B2_REGION,
            aws_access_key_id=settings.B2_KEY_ID,
            aws_secret_access_key=settings.B2_APPLICATION_KEY,
        )
    except Exception as e:
        logger.error(f"Error creating Backblaze B2 client: {e}")
        return None


def upload_recording_to_b2(file_path: str, key: str, mime_type: str = "video/webm") -> str | None:
    """Upload a local file to the recordings bucket under `key`. Returns the
    object key on success (the caller persists this, not a URL — B2 is a
    private bucket, so playback needs a freshly presigned URL per read, see
    get_presigned_recording_url below)."""
    client = get_b2_client()
    if not client:
        logger.info(f"[SIMULATION] Would upload recording to B2 key '{key}'.")
        return None
    try:
        client.upload_file(
            file_path,
            settings.B2_BUCKET_NAME,
            key,
            ExtraArgs={"ContentType": mime_type},
        )
        logger.info(f"Uploaded recording to B2: {key}")
        return key
    except ClientError as e:
        logger.error(f"Error uploading recording '{key}' to B2: {e}")
        return None


def get_presigned_recording_url(key: str | None) -> str | None:
    """Mint a short-lived signed GET URL for a private-bucket object — call
    this fresh on every report read, never cache/store the result (it expires
    after B2_PRESIGNED_URL_TTL_SECONDS)."""
    if not key:
        return None
    client = get_b2_client()
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.B2_BUCKET_NAME, "Key": key},
            ExpiresIn=settings.B2_PRESIGNED_URL_TTL_SECONDS,
        )
    except ClientError as e:
        logger.error(f"Error presigning B2 recording URL for '{key}': {e}")
        return None
