#!/usr/bin/env python3
"""외부 이미지 태그가 움직이지 않게 막는다 (GROMO-2224).

compose `image:` · Dockerfile `FROM` 의 외부 이미지는 최소 «메이저.마이너» 이상 숫자 또는 @sha256 digest.
`16-alpine`·`7`·`latest` 처럼 메이저만인 태그는 받는 시점마다 내용이 바뀌어 dev·CI·로컬이 조용히 갈림.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILES = sorted((ROOT / "server" / "scripts").glob("docker-compose*.yml"))
DOCKERFILES = sorted((ROOT / "server").glob("*/Dockerfile"))

# 숫자.숫자 이상 (v 접두사 허용) — 16.14-alpine · 7.4.11-alpine · 17.0.20.1_1-jre-jammy · v2.55.1 · 1.28-alpine
VERSIONED_TAG = re.compile(r"^v?\d+\.\d+")

# 의도적 예외. 키 = (파일 이름, 이미지), 값 = 이유
ALLOWED = {
    # Datadog agent 는 메이저만 따라감 — 고정 범위 밖으로 결정
    ("docker-compose.datadog.yml", "gcr.io/datadoghq/agent:7"): "agent 는 메이저 추종 (고정 제외)",
    ("docker-compose.prod.yml", "gcr.io/datadoghq/agent:7"): "agent 는 메이저 추종 (고정 제외)",
}


def compose_images(path: Path) -> list[str]:
    images = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*image:\s*(\S+)", line)
        if match:
            images.append(match.group(1))
    return images


def dockerfile_images(path: Path) -> list[str]:
    images = []
    for line in path.read_text(encoding="utf-8").splitlines():
        tokens = line.split()
        if not tokens or tokens[0].upper() != "FROM":
            continue
        # --platform=… 같은 플래그 건너뜀
        image = next(token for token in tokens[1:] if not token.startswith("--"))
        images.append(image)
    return images


def problem(image: str, stages: set[str]) -> str | None:
    if image.startswith("${") or image == "scratch" or image in stages:
        return None  # 변수(우리 앱 이미지 digest)·빈 베이스·앞 단계 참조
    if "@sha256:" in image:
        return None
    last = image.split("/")[-1]  # registry:5000/... 포트 콜론 제외
    tag = last.split(":", 1)[1] if ":" in last else ""
    if not tag:
        return "태그 없음(= latest)"
    if tag == "latest":
        return "latest"
    if not VERSIONED_TAG.match(tag):
        return f"메이저만 지정({tag}) — 메이저.마이너 이상 또는 digest 로"
    return None


class ImageVersionTest(unittest.TestCase):
    def test_검사_대상이_비어_있지_않다(self) -> None:
        self.assertTrue(COMPOSE_FILES)
        self.assertTrue(DOCKERFILES)

    def test_외부_이미지는_메이저만인_태그나_latest를_쓰지_않는다(self) -> None:
        found = []
        for path in COMPOSE_FILES:
            for image in compose_images(path):
                if (path.name, image) not in ALLOWED and (reason := problem(image, set())):
                    found.append(f"{path.relative_to(ROOT)}: {image} — {reason}")
        for path in DOCKERFILES:
            text = path.read_text(encoding="utf-8")
            stages = set(re.findall(r"(?im)^FROM\s.*\sAS\s+(\S+)", text))
            for image in dockerfile_images(path):
                if (path.name, image) not in ALLOWED and (reason := problem(image, stages)):
                    found.append(f"{path.relative_to(ROOT)}: {image} — {reason}")
        self.assertEqual(found, [])

    def test_예외_목록은_실제로_쓰이는_이미지만_남긴다(self) -> None:
        # 고정 끝난 예외가 남아 새 느슨한 태그를 숨기지 않게
        used = {(path.name, image) for path in COMPOSE_FILES for image in compose_images(path)}
        used |= {(path.name, image) for path in DOCKERFILES for image in dockerfile_images(path)}
        self.assertEqual(set(ALLOWED) - used, set())

    def test_판정_규칙(self) -> None:
        for image in ("postgres:16-alpine", "redis:7", "gcr.io/datadoghq/agent:7", "nginx", "nginx:latest",
                      "eclipse-temurin:17-jre-jammy"):
            with self.subTest(image=image):
                self.assertIsNotNone(problem(image, set()))
        for image in ("postgres:16.14-alpine", "redis:7.4.11-alpine", "prom/prometheus:v2.55.1",
                      "nginx:1.28-alpine", "eclipse-temurin:17.0.20.1_1-jre-jammy",
                      "bitnami/jmx-exporter@sha256:652a", "${APP_IMAGE:?x}", "scratch",
                      "registry.example:5000/app:1.2.3"):
            with self.subTest(image=image):
                self.assertIsNone(problem(image, set()))


if __name__ == "__main__":
    unittest.main()
