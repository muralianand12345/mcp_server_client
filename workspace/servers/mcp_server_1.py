import os
import boto3
from dotenv import load_dotenv
from typing import List, Optional
from pydantic import BaseModel, Field
from mcp.server.fastmcp import FastMCP

load_dotenv()

mcp = FastMCP(
    "AWS S3 Search Service",
    instructions="Search and retrieve information from AWS S3 buckets.",
    debug=False,
    log_level="INFO",
    port=8001,
)

s3_client = boto3.client(
    "s3",
    region_name=os.getenv("AWS_REGION", "us-east-1"),
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    endpoint_url=os.getenv("AWS_ENDPOINT_URL", None),
)

MAX_BUCKETS = int(os.getenv("S3_MAX_BUCKETS", "10"))


class S3Bucket(BaseModel):
    name: str = Field(..., description="Bucket name")
    creation_date: str = Field(..., description="Bucket creation date")


class ResponseListBuckets(BaseModel):
    buckets: List[S3Bucket] = Field(..., description="List of S3 buckets")
    count: int = Field(..., description="Number of buckets")


@mcp.tool()
def list_buckets() -> ResponseListBuckets:
    """List all available S3 buckets."""
    try:
        response = s3_client.list_buckets()
        buckets = []

        for bucket in response["Buckets"][:MAX_BUCKETS]:
            buckets.append(
                S3Bucket(
                    name=bucket["Name"],
                    creation_date=bucket["CreationDate"].isoformat(),
                )
            )

        return ResponseListBuckets(buckets=buckets, count=len(buckets))
    except Exception as e:
        raise Exception(f"Error listing buckets: {str(e)}")


class S3Object(BaseModel):
    key: str = Field(..., description="Object key (file path)")
    size: int = Field(..., description="Object size in bytes")
    last_modified: str = Field(..., description="Last modified date")
    storage_class: str = Field(..., description="Storage class")


class ResponseListObjects(BaseModel):
    bucket: str = Field(..., description="Bucket name")
    objects: List[S3Object] = Field(..., description="List of objects in bucket")
    count: int = Field(..., description="Number of objects")
    prefix: Optional[str] = Field(None, description="Prefix filter used")


@mcp.tool()
def list_objects(
    bucket: str, prefix: Optional[str] = None, max_keys: int = 100
) -> ResponseListObjects:
    """
    List objects in an S3 bucket.

    Args:
        bucket: S3 bucket name
        prefix: Filter objects by prefix
        max_keys: Maximum number of objects to return (1-1000)
    """
    try:
        params = {
            "Bucket": bucket,
            "MaxKeys": max(1, min(1000, max_keys)),
        }

        if prefix:
            params["Prefix"] = prefix

        response = s3_client.list_objects_v2(**params)
        objects = []

        if "Contents" in response:
            for obj in response["Contents"]:
                objects.append(
                    S3Object(
                        key=obj["Key"],
                        size=obj["Size"],
                        last_modified=obj["LastModified"].isoformat(),
                        storage_class=obj["StorageClass"],
                    )
                )

        return ResponseListObjects(
            bucket=bucket, objects=objects, count=len(objects), prefix=prefix
        )
    except Exception as e:
        raise Exception(f"Error listing objects in bucket '{bucket}': {str(e)}")


class ObjectMetadata(BaseModel):
    content_type: str = Field(..., description="Content type of the object")
    content_length: int = Field(..., description="Size of the object in bytes")
    last_modified: str = Field(..., description="Last modified date")
    etag: str = Field(..., description="ETag of the object")


class ResponseGetObjectMetadata(BaseModel):
    bucket: str = Field(..., description="Bucket name")
    key: str = Field(..., description="Object key")
    metadata: ObjectMetadata = Field(..., description="Object metadata")


@mcp.tool()
def get_object_metadata(bucket: str, key: str) -> ResponseGetObjectMetadata:
    """
    Get metadata for an S3 object without downloading its contents.

    Args:
        bucket: S3 bucket name
        key: Object key (file path)
    """
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)

        metadata = ObjectMetadata(
            content_type=response.get("ContentType", "application/octet-stream"),
            content_length=response.get("ContentLength", 0),
            last_modified=response.get("LastModified").isoformat(),
            etag=response.get("ETag", "").strip('"'),
        )

        return ResponseGetObjectMetadata(bucket=bucket, key=key, metadata=metadata)
    except Exception as e:
        raise Exception(
            f"Error getting metadata for object '{key}' in bucket '{bucket}': {str(e)}"
        )


class ResponseSearchObjects(BaseModel):
    bucket: str = Field(..., description="Bucket name")
    query: str = Field(..., description="Search query")
    objects: List[S3Object] = Field(..., description="List of matching objects")
    count: int = Field(..., description="Number of matching objects")


@mcp.tool()
def search_objects(
    bucket: str, query: str, max_results: int = 100
) -> ResponseSearchObjects:
    """
    Search for objects in an S3 bucket by prefix and filename.

    Args:
        bucket: S3 bucket name
        query: Search query (will be used as prefix and checked within filenames)
        max_results: Maximum number of results to return
    """
    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix=query,
            MaxKeys=1000,
        )

        matching_objects = []

        if "Contents" in response:
            for obj in response["Contents"]:
                key = obj["Key"]
                if query.lower() in key.lower():
                    matching_objects.append(
                        S3Object(
                            key=key,
                            size=obj["Size"],
                            last_modified=obj["LastModified"].isoformat(),
                            storage_class=obj["StorageClass"],
                        )
                    )

                    if len(matching_objects) >= max_results:
                        break

        return ResponseSearchObjects(
            bucket=bucket,
            query=query,
            objects=matching_objects,
            count=len(matching_objects),
        )
    except Exception as e:
        raise Exception(f"Error searching for objects in bucket '{bucket}': {str(e)}")


class ResponseGetObjectContent(BaseModel):
    bucket: str = Field(..., description="Bucket name")
    key: str = Field(..., description="Object key")
    content_type: str = Field(..., description="Content type")
    content: str = Field(..., description="Object content (text files only)")
    size: int = Field(..., description="Content size in bytes")


@mcp.tool()
def get_object_content(
    bucket: str, key: str, max_size: int = 1024 * 1024  # 1MB default max size
) -> ResponseGetObjectContent:
    """
    Get the content of a text file from S3.
    Only works for text files (will fail for binary files).

    Args:
        bucket: S3 bucket name
        key: Object key (file path)
        max_size: Maximum file size to download (bytes)
    """
    try:
        head_response = s3_client.head_object(Bucket=bucket, Key=key)
        content_length = head_response.get("ContentLength", 0)
        content_type = head_response.get("ContentType", "application/octet-stream")

        if content_length > max_size:
            raise Exception(
                f"File is too large ({content_length} bytes). Maximum size is {max_size} bytes."
            )

        is_text = False
        text_content_types = [
            "text/",
            "application/json",
            "application/xml",
            "application/csv",
            "application/javascript",
            "application/typescript",
        ]

        for text_type in text_content_types:
            if text_type in content_type:
                is_text = True
                break

        if not is_text and not key.lower().endswith(
            (
                ".txt",
                ".csv",
                ".json",
                ".xml",
                ".md",
                ".py",
                ".js",
                ".ts",
                ".html",
                ".css",
            )
        ):
            raise Exception(
                f"File doesn't appear to be a text file (content type: {content_type})"
            )

        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read().decode("utf-8")

        return ResponseGetObjectContent(
            bucket=bucket,
            key=key,
            content_type=content_type,
            content=content,
            size=len(content),
        )
    except UnicodeDecodeError:
        raise Exception(
            f"Error decoding file content: The file appears to be a binary file, not a text file."
        )
    except Exception as e:
        raise Exception(
            f"Error getting content for object '{key}' in bucket '{bucket}': {str(e)}"
        )


if __name__ == "__main__":
    mcp.run(transport="sse")
