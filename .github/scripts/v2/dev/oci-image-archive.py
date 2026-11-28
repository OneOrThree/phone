"""Publish and retrieve checksum-pinned cattus dev images in Object Storage."""
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

SERVICES = ("data-api", "realtime", "business-api", "notification")
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def checksum(path):
    with path.open("rb") as archive:
        return hashlib.file_digest(archive, "sha256").hexdigest()


def object_name(slot, service):
    if slot not in ("a", "b") or service not in SERVICES:
        raise ValueError("Invalid OCI dev image slot or service")
    return f"images/{slot}/{service}.tar.gz"


def transfer(method, credential, key, path):
    base = os.environ.get(credential, "")
    url = urlsplit(base)
    if (
        url.scheme != "https"
        or url.netloc != "objectstorage.ap-tokyo-1.oraclecloud.com"
        or not re.fullmatch(r"/p/[-_A-Za-z0-9]+/n/[a-z0-9]+/b/cattus-oci-dev-images/o/", url.path)
        or url.query
        or url.fragment
    ):
        raise ValueError(f"Missing or invalid {credential}")
    args = ["curl", "--disable", "--silent", "--show-error", "--fail",
            "--max-time", "600", "--config", "-"]
    if method == "PUT":
        args += ["--upload-file", str(path)]
    else:
        args += ["--max-filesize", str(MAX_ARCHIVE_BYTES), "--output", str(path)]
    subprocess.run(args, input=f'url = "{base}{key}"\n', text=True, check=True)


def fetch(manifest, destination):
    key = object_name(manifest["slot"], manifest["service"])
    digest = manifest["sha256"]
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Invalid archive checksum")
    transfer("GET", "OCI_DEV_IMAGE_READ_URL", key, destination)
    if checksum(destination) != digest:
        raise ValueError("OCI dev image archive checksum mismatch")


def load(manifest, archive):
    subprocess.run(["docker", "load", "--input", str(archive)], check=True)
    result = subprocess.check_output(
        ["docker", "image", "inspect", "--format",
         "{{.Os}}/{{.Architecture}}", manifest["image"]], text=True,
    ).strip()
    if result != "linux/arm64":
        raise ValueError("Expected a linux/arm64 dev image")


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("--service", required=True, choices=SERVICES)
    publish.add_argument("--slot", required=True, choices=("a", "b"))
    publish.add_argument("--revision", required=True)
    publish.add_argument("--image", required=True)
    publish.add_argument("--archive", required=True, type=Path)
    publish.add_argument("--manifest", required=True, type=Path)
    retrieve = commands.add_parser("load")
    retrieve.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as temp:
        destination = Path(temp) / "image.tar.gz"
        if args.command == "publish":
            size = args.archive.stat().st_size
            if not 0 < size <= MAX_ARCHIVE_BYTES:
                raise ValueError("OCI dev image archive exceeds the 512 MiB per-slot limit")
            manifest = {
                "service": args.service,
                "slot": args.slot,
                "revision": args.revision,
                "image": args.image,
                "sha256": checksum(args.archive),
            }
            transfer("PUT", "OCI_DEV_IMAGE_WRITE_URL",
                     object_name(args.slot, args.service), args.archive)
        else:
            manifest = json.loads(args.manifest.read_text())
        fetch(manifest, destination)
        load(manifest, destination)
        if args.command == "publish":
            args.manifest.write_text(json.dumps(manifest) + "\n")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"OCI dev image archive transfer failed: {error}", file=sys.stderr)
        raise SystemExit(1)
