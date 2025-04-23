import os
import sys
import json
import boto3
import argparse
from pathlib import Path
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Dict, Optional
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor

load_dotenv()


@dataclass
class S3Config:
    """Configuration for S3 connection."""

    bucket_name: str
    region: Optional[str]
    access_key: str = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key: str = os.getenv("AWS_SECRET_ACCESS_KEY")
    endpoint_url: Optional[str] = os.getenv("AWS_ENDPOINT_URL")


class S3Uploader:
    """Handles S3 upload operations with manifest tracking."""

    def __init__(self, config: S3Config, manifest_enabled: bool = True):
        self.config = config
        self.manifest_enabled = manifest_enabled
        self.manifest_file = Path("upload_manifest.json")
        self.manifest: Dict = self._load_manifest() if manifest_enabled else {}
        self.s3_client = self._create_s3_client()

    def _create_s3_client(self):
        """Create and return an S3 client."""
        return boto3.client(
            "s3",
            region_name=self.config.region,
            aws_access_key_id=self.config.access_key,
            aws_secret_access_key=self.config.secret_key,
            endpoint_url=self.config.endpoint_url,
        )

    def _load_manifest(self) -> Dict:
        """Load the upload manifest from file."""
        if self.manifest_file.exists():
            return json.loads(self.manifest_file.read_text())
        return {}

    def _save_manifest(self):
        """Save the current manifest to file."""
        if self.manifest_enabled:
            self.manifest_file.write_text(json.dumps(self.manifest, indent=4))

    def create_bucket(self):
        """Create an S3 bucket if it doesn't exist."""
        try:
            if self.config.region:
                self.s3_client.create_bucket(
                    Bucket=self.config.bucket_name,
                    CreateBucketConfiguration={
                        "LocationConstraint": self.config.region
                    },
                )
            else:
                self.s3_client.create_bucket(Bucket=self.config.bucket_name)
            print(f"Bucket '{self.config.bucket_name}' created successfully.")
        except ClientError as e:
            if e.response["Error"]["Code"] == "BucketAlreadyOwnedByYou":
                print(f"Bucket '{self.config.bucket_name}' already exists.")
            else:
                raise

    def upload_file(self, file_path: Path, s3_key: str) -> bool:
        """Upload a single file to S3."""
        try:
            self.s3_client.upload_file(str(file_path), self.config.bucket_name, s3_key)
            print(f"Uploaded: {file_path} -> s3://{self.config.bucket_name}/{s3_key}")
            return True
        except ClientError as e:
            print(f"Error uploading {file_path}: {e}")
            return False

    def _should_upload_file(self, file_path: Path, relative_path: str) -> bool:
        """Determine if a file should be uploaded based on manifest."""
        if not self.manifest_enabled:
            return True

        last_modified = file_path.stat().st_mtime
        return (
            relative_path not in self.manifest
            or self.manifest[relative_path]["last_modified"] < last_modified
        )

    def upload_folder(self, folder_path: str, prefix: str = "") -> int:
        """Upload a folder and its contents to S3 with parallel processing."""
        folder_path = Path(folder_path)
        if not folder_path.is_dir():
            raise ValueError(f"'{folder_path}' is not a valid directory")

        upload_tasks = []

        # Prepare upload tasks
        for file_path in folder_path.rglob("*"):
            if file_path.is_file():
                relative_path = str(file_path.relative_to(folder_path))
                s3_key = str(Path(prefix) / relative_path)

                if self._should_upload_file(file_path, relative_path):
                    upload_tasks.append((file_path, s3_key, relative_path))
                else:
                    print(f"Skipped '{file_path}' (not modified)")

        uploaded_count = 0
        # Use ThreadPoolExecutor for parallel uploads
        with ThreadPoolExecutor(max_workers=min(10, len(upload_tasks))) as executor:
            for file_path, s3_key, relative_path in upload_tasks:
                future = executor.submit(self.upload_file, file_path, s3_key)
                if future.result():
                    uploaded_count += 1
                    if self.manifest_enabled:
                        self.manifest[relative_path] = {
                            "last_modified": file_path.stat().st_mtime
                        }

        self._save_manifest()
        print(
            f"\nFolder upload complete. Successfully uploaded {uploaded_count} files."
        )
        return uploaded_count


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Upload files or folders to S3 with manifest tracking."
    )
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--region", help="AWS region (e.g., us-east-1)")
    parser.add_argument("--file", type=Path, help="Path to file to upload")
    parser.add_argument("--folder", type=Path, help="Path to folder to upload")
    parser.add_argument("--prefix", default="", help="Prefix for uploaded contents")
    parser.add_argument(
        "--disable-manifest", action="store_true", help="Disable manifest tracking"
    )
    return parser.parse_args()


def main():
    args = parse_arguments()

    config = S3Config(
        bucket_name=args.bucket,
        region=args.region,
    )

    uploader = S3Uploader(config, manifest_enabled=not args.disable_manifest)

    try:
        uploader.create_bucket()

        if args.folder:
            uploader.upload_folder(args.folder, args.prefix)
        elif args.file:
            s3_key = str(Path(args.prefix) / args.file.name)
            uploader.upload_file(args.file, s3_key)
        else:
            print("Error: Either --file or --folder must be specified.")
            sys.exit(1)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
