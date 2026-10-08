"""서버 설정(yml)이 기본값 없이 요구하는 키와 write-compose-env.py 허용목록이 어긋나지 않는지 검사. GROMO-2224.

새 키를 application-*.yml 에만 넣고 필터 목록을 안 고치면, 배포 전 검사는 통과하고 서버는 뜨다가 죽는다.
SM 없이 저장소 파일끼리만 비교하므로 PR 단계에서 돈다.
"""
from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("write_compose_env", ROOT / ".github/scripts/write-compose-env.py")
WRITER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRITER)

PLACEHOLDER = re.compile(r"\$\{([A-Z][A-Z0-9_]*)(:[^}]*)?\}")
RESOURCES = str(ROOT / "server/{}/src/main/resources")
# dev 에서 실제로 켜지는 프로파일의 설정 파일
SERVICE_CONFIG = {
    "data-api": ("application-dev.yml", "application-satellites.yml", "application-realtime-authorization.yml"),
    "business-api": ("application.yml", "application-dev.yml"),
    "notification": ("application.yml", "application-dev.yml"),
    "realtime": ("application.yml", "application-dev.yml"),
}
# 기본값은 없지만 일부러 «선택»으로 둔 키와 그 이유. 새 예외는 이유와 함께만 추가한다.
OPTIONAL_BY_DESIGN = {
    "data-api": {
        # outbox relay 를 켤 때만 읽힘. 꺼진 dev 에서 필수로 올리면 값 넣기 전 배포가 막힘 (GROMO-1954)
        "REALTIME_BASE_URL", "SVC_TOKEN_DATA_TO_REALTIME",
        # realtime-authorization 프로필이 켜진 배포에서만 읽힘 (GROMO-2182)
        "SVC_TOKEN_REALTIME_TO_DATA",
    },
}


def required_by_config(service: str) -> dict[str, str]:
    """yml 에서 기본값 없는 ${KEY} → 처음 나온 파일 이름. 주석 줄은 건너뜀."""
    found: dict[str, str] = {}
    for name in SERVICE_CONFIG[service]:
        for line in (Path(RESOURCES.format(service)) / name).read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("#"):
                continue
            for key, default in PLACEHOLDER.findall(line):
                if not default:
                    found.setdefault(key, name)
    return found


class _Loader(yaml.SafeLoader):
    """compose 의 !override 같은 커스텀 태그를 무시하고 읽음."""


def _construct_any(loader: _Loader, _suffix: str, node: Any) -> Any:
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_scalar(node)


_Loader.add_multi_constructor("!", _construct_any)


def compose_environment(service: str) -> set[str]:
    """compose 파일들이 그 서비스 environment: 에 직접 넣는 키."""
    keys: set[str] = set()
    for path in (ROOT / "server/scripts").glob("docker-compose.*.yml"):
        services = (yaml.load(path.read_text(encoding="utf-8"), _Loader) or {}).get("services") or {}
        env = (services.get(service) or {}).get("environment") or {}
        if isinstance(env, list):
            env = {item.split("=", 1)[0]: None for item in env}
        keys |= set(env)
    return keys


class ConfigContractTest(unittest.TestCase):
    def test_설정이_기본값_없이_요구하는_키는_필터나_compose_가_준다(self) -> None:
        for service in SERVICE_CONFIG:
            with self.subTest(service=service):
                given = compose_environment(service)
                if service in WRITER.SERVICE_REQUIRED_KEYS:
                    given |= WRITER.allowed_keys(service)
                missing = {key: f for key, f in required_by_config(service).items() if key not in given}
                self.assertEqual(missing, {}, f"{service}: 아무도 안 주는 필수 설정 키 (yml 파일)")

    def test_필수인데_선택으로만_주는_키는_이유가_적힌_예외뿐이다(self) -> None:
        for service in WRITER.SERVICE_REQUIRED_KEYS:
            with self.subTest(service=service):
                must = set(WRITER.SERVICE_REQUIRED_KEYS[service]) | compose_environment(service)
                if service == "data-api":
                    must |= set(WRITER.TRANSITION_KEYS)
                optional_only = set(required_by_config(service)) - must
                self.assertEqual(optional_only - OPTIONAL_BY_DESIGN.get(service, set()), set(),
                                 f"{service}: 비면 기동이 깨질 키가 선택으로만 들어감 — 필수로 올리거나 이유와 함께 예외 추가")

    def test_예외_목록에_더는_필요없는_키가_남지_않는다(self) -> None:
        for service, keys in OPTIONAL_BY_DESIGN.items():
            with self.subTest(service=service):
                self.assertEqual(keys - set(required_by_config(service)), set(), "설정에서 사라진 예외 키는 지운다")

    def test_허용목록과_금지목록은_겹치지_않는다(self) -> None:
        for service, forbidden in WRITER.SERVICE_FORBIDDEN_KEYS.items():
            with self.subTest(service=service):
                self.assertEqual(WRITER.allowed_keys(service) & set(forbidden + WRITER.FORBIDDEN_EVERYWHERE), set())


if __name__ == "__main__":
    unittest.main()
