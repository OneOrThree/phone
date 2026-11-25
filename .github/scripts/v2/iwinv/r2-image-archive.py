#!/usr/bin/env python3
"""Publish, retrieve, and assemble checksum-pinned linux/amd64 cattus images in Cloudflare R2."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

SERVICES = ("data-api", "realtime", "business-api", "notification", "backoffice")
SLOTS = ("a", "b")
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
EXPECTED_PLATFORM = "linux/amd64"
R2_ENDPOINT_RE = re.compile(r"^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")


def checksum(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as archive:
        for chunk in iter(lambda: archive.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def object_key(slot: str, service: str) -> str:
    if slot not in SLOTS or service not in SERVICES:
        raise ValueError(f"Invalid R2 image slot or service: slot={slot}, service={service}")
    return f"images/{slot}/{service}.tar.gz"


def validate_endpoint(endpoint: str) -> str:
    parsed = urlsplit(endpoint.strip().rstrip("/"))
    if (
        parsed.scheme != "https"
        or not R2_ENDPOINT_RE.fullmatch(parsed.netloc)
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"Invalid Cloudflare R2 endpoint: {endpoint}")
    return f"https://{parsed.netloc}"


def validate_bucket(bucket: str) -> str:
    if not BUCKET_RE.fullmatch(bucket):
        raise ValueError(f"Invalid R2 bucket name: {bucket}")
    return bucket


def r2_env(access_key_var: str, secret_key_var: str) -> dict[str, str]:
    access_key = os.environ.get(access_key_var, "").strip()
    secret_key = os.environ.get(secret_key_var, "").strip()
    if not access_key or not secret_key:
        raise ValueError(f"Missing R2 credentials in {access_key_var}/{secret_key_var}")
    return {
        **os.environ,
        "AWS_ACCESS_KEY_ID": access_key,
        "AWS_SECRET_ACCESS_KEY": secret_key,
        "AWS_DEFAULT_REGION": "auto",
    }


def s3_transfer(direction: str, endpoint: str, bucket: str, key: str, local_path: Path, env: dict[str, str]) -> None:
    uri = f"s3://{validate_bucket(bucket)}/{key}"
    src, dst = (str(local_path), uri) if direction == "PUT" else (uri, str(local_path))
    subprocess.run(
        ["aws", "s3", "cp", src, dst, "--endpoint-url", validate_endpoint(endpoint), "--only-show-errors"],
        env=env,
        check=True,
        timeout=600,
    )


def fetch_and_verify(manifest: dict, destination: Path, endpoint: str, bucket: str, env: dict[str, str]) -> None:
    key = object_key(manifest["slot"], manifest["service"])
    if manifest.get("key") and manifest["key"] != key:
        raise ValueError(f"Manifest key mismatch: {manifest['key']} != {key}")
    digest = manifest["sha256"]
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Invalid archive checksum format")
    s3_transfer("GET", endpoint, bucket, key, destination, env)
    size = destination.stat().st_size
    if not 0 < size <= MAX_ARCHIVE_BYTES:
        raise ValueError(f"Downloaded archive exceeds limit: {size}")
    if checksum(destination) != digest:
        raise ValueError("R2 image archive checksum mismatch")


def load_and_inspect(manifest: dict, archive: Path) -> None:
    subprocess.run(["docker", "load", "--input", str(archive)], check=True, timeout=600)
    actual = subprocess.check_output(
        ["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", manifest["image"]],
        text=True,
        timeout=60,
    ).strip()
    if actual != EXPECTED_PLATFORM:
        raise ValueError(f"Expected {EXPECTED_PLATFORM}, got {actual}")


def merge_manifests(manifest_paths: list[Path], version: str, release_id: str, slot: str, revision: str) -> dict:
    if slot not in SLOTS:
        raise ValueError(f"Invalid slot: {slot}")
    archives: dict[str, dict] = {}
    for path in sorted(manifest_paths):
        item = json.loads(path.read_text(encoding="utf-8"))
        svc = item["service"]
        if svc not in SERVICES:
            raise ValueError(f"Unknown service in manifest: {svc}")
        if item["slot"] != slot or item["revision"] != revision:
            raise ValueError(f"Manifest metadata mismatch for {svc}")
        archives[svc] = {
            "key": item["key"],
            "image": item["image"],
            "sha256": item["sha256"],
            "bytes": item["bytes"],
        }
    return {
        "stack": "iwinv-v1",
        "platform": EXPECTED_PLATFORM,
        "version": version,
        "release_id": release_id,
        "slot": slot,
        "revision": revision,
        "archives": archives,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Cloudflare R2 linux/amd64 image archive publisher/loader")
    commands = parser.add_subparsers(dest="command", required=True)

    pub = commands.add_parser("publish")
    pub.add_argument("--service", required=True, choices=SERVICES)
    pub.add_argument("--slot", required=True, choices=SLOTS)
    pub.add_argument("--revision", required=True)
    pub.add_argument("--image", required=True)
    pub.add_argument("--archive", required=True, type=Path)
    pub.add_argument("--manifest", required=True, type=Path)
    pub.add_argument("--endpoint", default=os.environ.get("R2_ENDPOINT", ""))
    pub.add_argument("--bucket", default=os.environ.get("R2_RELEASES_BUCKET", "cattus-releases"))

    ld = commands.add_parser("load")
    ld.add_argument("--manifest", required=True, type=Path)
    ld.add_argument("--endpoint", default=os.environ.get("R2_ENDPOINT", ""))
    ld.add_argument("--bucket", default=os.environ.get("R2_RELEASES_BUCKET", "cattus-releases"))

    mg = commands.add_parser("merge-manifest")
    mg.add_argument("--inputs", nargs="+", required=True, type=Path)
    mg.add_argument("--version", required=True)
    mg.add_argument("--release-id", required=True)
    mg.add_argument("--slot", required=True, choices=SLOTS)
    mg.add_argument("--revision", required=True)
    mg.add_argument("--output", required=True, type=Path)
    mg.add_argument("--upload", action="store_true")
    mg.add_argument("--endpoint", default=os.environ.get("R2_ENDPOINT", ""))
    mg.add_argument("--bucket", default=os.environ.get("R2_RELEASES_BUCKET", "cattus-releases"))

    args = parser.parse_args()

    if args.command == "merge-manifest":
        combined = merge_manifests(args.inputs, args.version, args.release_id, args.slot, args.revision)
        args.output.write_text(json.dumps(combined, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.upload:
            env = r2_env("R2_WRITE_ACCESS_KEY_ID", "R2_WRITE_SECRET_ACCESS_KEY")
            s3_transfer("PUT", args.endpoint, args.bucket, f"manifests/{args.slot}/release-iwinv.json", args.output, env)
        return

    with tempfile.TemporaryDirectory() as temp:
        destination = Path(temp) / "image.tar.gz"
        if args.command == "publish":
            size = args.archive.stat().st_size
            if not 0 < size <= MAX_ARCHIVE_BYTES:
                raise ValueError(f"Archive exceeds 512 MiB limit: {size}")
            key = object_key(args.slot, args.service)
            manifest = {
                "service": args.service,
                "slot": args.slot,
                "key": key,
                "revision": args.revision,
                "image": args.image,
                "platform": EXPECTED_PLATFORM,
                "sha256": checksum(args.archive),
                "bytes": size,
            }
            write_env = r2_env("R2_WRITE_ACCESS_KEY_ID", "R2_WRITE_SECRET_ACCESS_KEY")
            read_env = r2_env("R2_READ_ACCESS_KEY_ID", "R2_READ_SECRET_ACCESS_KEY")
            s3_transfer("PUT", args.endpoint, args.bucket, key, args.archive, write_env)
            fetch_and_verify(manifest, destination, args.endpoint, args.bucket, read_env)
            load_and_inspect(manifest, destination)
            args.manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        else:
            manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
            read_env = r2_env("R2_READ_ACCESS_KEY_ID", "R2_READ_SECRET_ACCESS_KEY")
            fetch_and_verify(manifest, destination, args.endpoint, args.bucket, read_env)
            load_and_inspect(manifest, destination)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"R2 image archive transfer failed: {error}", file=sys.stderr)
        raise SystemExit(1)
