"""PNG를 무손실 압축한다. 기본은 조사이며 --apply에서만 파일을 바꾼다.

Pillow와 pngcrush가 필요하다. --pngcrush로 실행 파일을 지정할 수 있다.
생성 아틀라스·CDN 계약 이미지는 제외하며 픽셀, 크기, 부가 청크가 같을 때만 채택한다.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "src/assets"
EXCLUDED = ("village-world/", "backgrounds/island/ocean/", "ota/interiors/", "map-packs/")


def metadata(data):
    chunks = []
    offset = 8
    while offset < len(data):
        size = int.from_bytes(data[offset:offset + 4], "big")
        kind = data[offset + 4:offset + 8]
        if kind not in (b"IDAT", b"IHDR", b"PLTE", b"tRNS"):
            chunks.append((kind, data[offset + 8:offset + 8 + size]))
        offset += size + 12
    return chunks


def optimize(path, output, executable, apply):
    original = path.read_bytes()
    output.unlink(missing_ok=True)
    subprocess.run([executable, "-q", str(path), str(output)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    result = output.read_bytes()
    with Image.open(path) as before, Image.open(output) as after:
        identical = before.size == after.size and before.convert("RGBA").tobytes() == after.convert("RGBA").tobytes()
        size = before.size
    same_metadata = metadata(original) == metadata(result)
    adopted = identical and same_metadata and len(result) < len(original)
    row = dict(file=str(path.relative_to(ROOT)), before=len(original), after=len(result),
               saved=len(original) - len(result) if adopted else 0, width=size[0], height=size[1],
               rgbaEqual=identical, metadataEqual=same_metadata, adopted=adopted,
               shaBefore=hashlib.sha256(original).hexdigest(), shaAfter=hashlib.sha256(result).hexdigest())
    if apply and adopted:
        path.write_bytes(result)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--pngcrush", default=shutil.which("pngcrush"))
    parser.add_argument("--min-bytes", type=int, default=100_000)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not args.pngcrush:
        parser.error("pngcrush가 없습니다. --pngcrush로 실행 파일을 지정하세요.")
    # Git 추적 파일만 다룬다. 로컬 실험·출력 파일은 압축 대상에 섞지 않는다.
    tracked = subprocess.check_output(["git", "ls-files", "-z", "src/assets"], cwd=ROOT).decode().split("\0")
    files = sorted(ROOT / name for name in tracked if name.endswith(".png"))
    files = [p for p in files if p.stat().st_size >= args.min_bytes
             and not str(p.relative_to(ASSETS)).startswith(EXCLUDED)]
    rows = []
    with tempfile.TemporaryDirectory(prefix="cattus-png-") as folder:
        for path in files:
            rows.append(optimize(path, Path(folder) / "output.png", args.pngcrush, args.apply))
    args.report.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    print(f"조사 {len(rows)}개, 채택 {sum(r['adopted'] for r in rows)}개, 절감 {sum(r['saved'] for r in rows):,}바이트")


if __name__ == "__main__":
    main()
