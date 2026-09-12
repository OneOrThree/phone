#!/usr/bin/env python3
"""위성 배포의 «준비»만 수행한다 — 파일을 만들고 검증하고 절차를 출력한다.

이 도구는 배포하지 않는다. compose up·DNS 변경·Secrets Manager 호출·nginx 재적재를 하지 않고,
발송 gate 를 켜지도 않는다. 하는 일은 셋이다.

1. 공유 SecretString(stdin) 에서 «서비스별» env 파일을 만든다. 생성은 기존
   ``.github/scripts/write-compose-env.py`` 의 허용목록을 그대로 쓴다 — 허용목록이 두 벌이 되면
   한쪽만 고쳐진 채 자격이 새기 때문이다.
2. compose 가 보간할 «비밀이 아닌» 입력(digest 고정 이미지·env 파일 경로·프로젝트 환경)을
   별도 파일에 쓴다. 이미지가 digest 로 고정돼 있지 않으면 실패한다.
3. 실제 compose 파일들이 요구하는 변수가 실제로 채워졌는지 대조하고, 적용·실패 복구 순서를
   출력한다. 예시 값으로 빈자리를 메우지 않는다 — 빠진 게 있으면 성공하지 않는다.

출력 규율: env 파일의 «내용»을 표준출력·표준오류·plan 파일 어디에도 쓰지 않는다. 키 이름과
경로와 개수만 보고한다. 실패 메시지도 누락된 키의 «이름»까지만 말한다.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
WRITER = ROOT / ".github" / "scripts" / "write-compose-env.py"
SATELLITES_COMPOSE = Path(__file__).resolve().with_name("docker-compose.satellites.yml")
DATA_OVERLAY_COMPOSE = Path(__file__).resolve().with_name("docker-compose.satellites.data.yml")
NGINX_EXAMPLE = Path(__file__).resolve().with_name("nginx-satellites.include.conf.example")


class PrepareError(Exception):
    """운영자가 고칠 수 있는 실패. 값이 아니라 이름·경로만 담는다."""


def load_writer() -> Any:
    spec = importlib.util.spec_from_file_location("write_compose_env", WRITER)
    if spec is None or spec.loader is None:
        raise PrepareError(f"env writer 를 찾을 수 없습니다: {WRITER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# 레지스트리 호스트/경로@sha256:64hex 만 통과시킨다. 태그는 «움직인다» — 태그로 올린 배포는
# 다음 push 가 같은 이름 아래 다른 바이트를 놓아 롤백 대상이 사라진다.
_SEGMENT = r"[a-z0-9]+(?:[._-][a-z0-9]+)*"
DIGEST_REF = re.compile(rf"^{_SEGMENT}(?:\.{_SEGMENT})*(?::\d+)?(?:/{_SEGMENT})+@sha256:[0-9a-f]{{64}}$")

# compose 파일의 ${NAME} · ${NAME:?...} · ${NAME:-기본값} 참조.
COMPOSE_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?+])?")

SERVICES = ("business-api", "notification", "data-api")
ENV_FILENAMES = {"business-api": "business-api.env", "notification": "notification.env",
                 "data-api": "data-api.env"}
COMPOSE_FILE_KEYS = {"business-api": "BUSINESS_API_ENV_FILE", "notification": "NOTIFICATION_ENV_FILE",
                     "data-api": "DATA_API_ENV_FILE"}

# 기존 환경의 «공유» env 파일 이름. 여기에 서비스 파일을 쓰면 분리가 그 순간 사라진다.
SHARED_ENV_NAMES = {".env", ".env.prod", ".env.dev", ".env.local"}

# 서비스별로 «절대 들어오면 안 되는» 키. writer 의 허용목록이 1차 방어이고 이건 회귀 감지용이다.
FORBIDDEN_KEYS = {
    "business-api": ("API_DB_URL", "API_DB_USERNAME", "API_DB_PASSWORD",
                     "NOTI_DB_URL", "NOTI_DB_USERNAME", "NOTI_DB_PASSWORD",
                     "FCM_SERVICE_ACCOUNT_JSON", "OPENAI_API_KEY", "LINK_CAPABILITY_KEY",
                     "POSTGRES_PASSWORD", "LINK_MIGRATION_TOKEN"),
    "notification": ("API_DB_URL", "API_DB_USERNAME", "API_DB_PASSWORD", "JWT_SECRET",
                     "OPENAI_API_KEY", "LINK_CAPABILITY_KEY", "POSTGRES_PASSWORD"),
    "data-api": ("NOTI_DB_URL", "NOTI_DB_USERNAME", "NOTI_DB_PASSWORD"),
}
# 어느 서비스에도 가지 않는 자격 — 관측 백엔드 키와 사람이 쓰는 콘솔 비밀번호.
FORBIDDEN_EVERYWHERE = ("DD_API_KEY", "GRAFANA_ADMIN_PASSWORD", "CONSOLE_ADMIN_PASSWORD",
                        "CONSOLE_BASIC_PASSWORD", "SUDO_PASSWORD")


def parse_dotenv_keys(text: str) -> list[str]:
    """dotenv 의 «키 이름만» 뽑는다. 값은 읽지도 돌려주지도 않는다."""
    keys: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        keys.append(stripped.split("=", 1)[0].strip())
    return keys


def dotenv_value(text: str, key: str) -> str | None:
    """single-quoted dotenv 한 줄의 값을 복원한다. 반환값을 로그에 쓰지 않는다."""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith(f"{key}="):
            continue
        raw = stripped.split("=", 1)[1]
        if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
            return raw[1:-1].replace("\\'", "'")
        return raw
    return None


def compose_variables(path: Path) -> tuple[set[str], set[str]]:
    """(하드 필수, 기본값이 있어 생략 가능) 변수 이름을 돌려준다."""
    if not path.is_file():
        raise PrepareError(f"compose 파일이 없습니다: {path}")
    text = path.read_text(encoding="utf-8")
    required: set[str] = set()
    optional: set[str] = set()
    for name, modifier in COMPOSE_VAR.findall(text):
        # ':?' 는 미설정 시 compose 가 스스로 실패하는 자리. 수식어가 없는 ${NAME} 은 조용히 빈
        # 문자열이 되므로 «그게 더 위험하다» — 같은 등급으로 필수 취급한다.
        if modifier in ("", ":?", "?"):
            required.add(name)
        else:
            optional.add(name)
    return required, optional - required


def empty_compose_values(required: set[str], shared_env: Path, generated_env: str, project: str) -> list[str]:
    """실제 Compose 문법·shell > generated > shared 우선순위로 필수값만 해석한다. 값은 반환하지 않는다."""
    with tempfile.TemporaryDirectory(prefix="gromo-compose-check-") as directory:
        probe = Path(directory) / "probe.json"
        generated = Path(directory) / "compose.env"
        # 임시파일에는 변수 이름과 비밀 없는 생성 입력만 쓴다. 공유 env는 원본을 읽기만 한다.
        probe.write_text(json.dumps({"services": {"probe": {"image": "scratch", "environment": {
            key: "${" + key + "}" for key in sorted(required)
        }}}}), encoding="utf-8")
        generated.write_text(generated_env, encoding="utf-8")
        try:
            result = subprocess.run(
                ["docker", "compose", "-p", project, "-f", str(probe),
                 "--env-file", str(shared_env), "--env-file", str(generated), "config", "--format", "json"],
                text=True, capture_output=True, timeout=30,
            )
        except (OSError, subprocess.SubprocessError, UnicodeError):
            raise PrepareError("필수 보간 검사에 Docker Compose CLI가 필요합니다. 읽기 전용 config 실행에 실패했습니다") from None
        if result.returncode != 0:
            # dotenv 오류 메시지는 값까지 담을 수 있으므로 stdout/stderr를 전달하지 않는다.
            raise PrepareError("공유 env의 필수 보간을 Compose로 해석하지 못했습니다. env 문법을 확인하세요")
        try:
            values = json.loads(result.stdout)["services"]["probe"]["environment"]
            return sorted(key for key in required
                          if not isinstance(values.get(key), str) or not values[key].strip())
        except (ValueError, KeyError, TypeError, AttributeError):
            raise PrepareError("Compose 필수 보간 검사 결과를 읽지 못했습니다") from None


def check_digest(label: str, reference: str) -> str:
    reference = reference.strip()
    if not reference:
        raise PrepareError(f"{label}: 이미지 참조가 비었습니다")
    if not DIGEST_REF.match(reference):
        raise PrepareError(
            f"{label}: digest 고정 참조가 아닙니다(REPOSITORY@sha256:<64hex> 형식 필요). "
            "태그는 같은 이름 아래 내용이 바뀌어 롤백 대상이 사라집니다")
    return reference


def guard_output_path(path: Path, shared_env: Path) -> None:
    if path.name in SHARED_ENV_NAMES:
        raise PrepareError(f"{path}: 공유 env 이름으로는 서비스 파일을 쓰지 않습니다")
    if path.resolve() == shared_env.resolve():
        raise PrepareError(f"{path}: 기존 공유 env 파일을 덮어쓰려 합니다")


def guard_service_env(service: str, text: str) -> None:
    keys = set(parse_dotenv_keys(text))
    intruders = sorted(keys & set(FORBIDDEN_KEYS.get(service, ()) + FORBIDDEN_EVERYWHERE))
    if intruders:
        raise PrepareError(f"{service}: 경계를 넘는 키가 env 에 들어갔습니다 — {', '.join(intruders)}")


def guard_compose_env(values: dict[str, str], secret: dict[str, Any]) -> None:
    """compose 보간 파일에 비밀이 섞이지 않았는지 확인한다. 위반 시 «키 이름만» 말한다."""
    secrets = [v for v in secret.values() if isinstance(v, str) and v.strip()]
    leaked = []
    for key, value in values.items():
        for candidate in secrets:
            if candidate == value or (len(candidate) >= 8 and candidate in value):
                leaked.append(key)
                break
    if leaked:
        raise PrepareError(
            f"compose 보간 파일에 시크릿 값이 들어갔습니다 — {', '.join(sorted(set(leaked)))}. "
            "비밀은 서비스별 env 파일에만 둡니다")


def build_plan(args: argparse.Namespace, compose_env: Path, with_data: bool) -> str:
    argv = ["docker", "compose", "-p", args.project_name, "-f", str(args.base_compose),
            "-f", str(SATELLITES_COMPOSE)]
    if with_data:
        argv += ["-f", str(DATA_OVERLAY_COMPOSE)]
    argv += ["--env-file", str(args.shared_env_file), "--env-file", str(compose_env)]
    base = shlex.join(argv)
    lines = [
        "# 적용 준비 — 이 도구는 배포나 트래픽 전환을 실행하지 않았다",
        "1. !override 지원과 서비스별 env 교체를 실제 Compose로 확인한다.",
        f"   {base} config --quiet",
        "   config 전체 출력은 비밀값을 포함하므로 로그에 남기지 않는다.",
        "2. 위성만 기동한다. Data(app)는 아직 재생성하지 않는다.",
        f"   {base} up -d business-api notification",
        "3. 같은 구성으로 상태를 확인하고 서비스 인증·DB 권한을 검증한다.",
        f"   {base} ps business-api notification",
    ]
    if with_data:
        lines += ["4. 제공자 준비 뒤 Data를 전용 env와 지정 digest로 재생성한다.",
                  f"   {base} up -d app"]
    else:
        lines += ["4. --data-image 미지정: Data 전환은 이 산출물에 포함되지 않았다."]
    lines += [
        "5. runtime.md 및 정본 서비스 §7의 drain·최종 검증을 마친 단계만 라우팅한다.",
        f"   인프라 인도물: {NGINX_EXAMPLE}",
        "   /internal/admin/만 Notification에 공개하며 콘솔 전용 Bearer 인증을 유지한다.",
        "# 실패 복구 순서",
        "- 트래픽/신규 쓰기 전이라면 실패한 서비스만 같은 env와 직전 검증 digest로 재기동한다.",
        "- Link §7.2 3단계 이후에는 Neon이 정본이다. 구 Data 라우팅으로 자동 복귀하지 않는다.",
        "- Notification 최초 gate 개방 이후에는 close/drain 후 새 경로를 수정·검증·재개한다.",
        "- 호환 라우팅은 새 Link 경로로 교체한 뒤 인플라이트를 drain하고 Business 핸들러를 끈다.",
        "- 검증 실패 때 토큰·DB·이관 원장과 서비스별 env 파일을 보존한다.",
        "- 이 도구는 발송 gate나 relay 설정을 변경하지 않는다. 입력 SecretString의 값을 전달한다.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="위성 배포 준비 산출물 생성(배포는 하지 않음)")
    parser.add_argument("--environment", required=True, choices=("dev", "prod"))
    parser.add_argument("--phase", default="transition", choices=("transition", "final"))
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="서비스별 env 와 compose 보간 파일을 둘 디렉터리(0700 으로 만든다)")
    parser.add_argument("--base-compose", required=True, type=Path,
                        help="기존 환경 compose 경로(dev: docker-compose.dev.yml, prod: docker-compose.prod.yml)")
    parser.add_argument("--shared-env-file", required=True, type=Path,
                        help="기존 환경이 이미 쓰는 compose 보간 파일(.env / .env.prod). 키 이름만 읽는다")
    parser.add_argument("--business-image", required=True, help="REPOSITORY@sha256:<64hex>")
    parser.add_argument("--notification-image", required=True, help="REPOSITORY@sha256:<64hex>")
    parser.add_argument("--data-image", default=None,
                        help="지정하면 Data 전용 env 와 오버레이까지 준비한다. 생략하면 Data 는 기존 구성 유지")
    parser.add_argument("--data-profiles", default=None,
                        help="Data 오버레이가 넘길 SPRING_PROFILES_ACTIVE. 기본값은 '<environment>,satellites'")
    parser.add_argument("--project-name", default=None,
                        help="compose 프로젝트명. prod 는 필수 — satellites 파일의 name 이 기존 프로젝트를 갈아치우기 때문")
    args = parser.parse_args()
    # env_file 상대 경로는 첫 compose 파일 기준으로 해석되므로 절대 경로를 기록한다.
    args.output_dir = args.output_dir.resolve()
    args.base_compose = args.base_compose.resolve()
    args.shared_env_file = args.shared_env_file.resolve()

    if args.project_name is None:
        if args.environment == "prod":
            raise PrepareError(
                "prod 는 --project-name 이 필요합니다. docker-compose.satellites.yml 이 name: phone 을 "
                "선언하므로, 프로젝트명을 명시하지 않으면 기존 prod 스택과 «다른» 프로젝트에 컨테이너가 "
                "생기고 기존 컨테이너는 고아가 됩니다(docker compose ls 로 현재 이름을 확인하세요)")
        args.project_name = "phone"
    profiles = args.data_profiles or f"{args.environment},satellites"

    if not args.base_compose.is_file():
        raise PrepareError(f"기존 환경 compose 를 찾을 수 없습니다: {args.base_compose}")
    if not args.shared_env_file.is_file():
        raise PrepareError(
            f"기존 공유 env 파일이 없습니다: {args.shared_env_file}. 이 준비는 기존 배포가 쓰는 보간 "
            "값(DB·이미지 태그 등)이 실재하는 창에서 실행해야 합니다 — 예시 값으로 대신하지 않습니다")

    images = {"business-api": check_digest("--business-image", args.business_image),
              "notification": check_digest("--notification-image", args.notification_image)}
    if args.data_image is not None:
        images["data-api"] = check_digest("--data-image", args.data_image)

    raw = sys.stdin.read()
    if not raw.strip():
        raise PrepareError("stdin 이 비었습니다. 공유 SecretString JSON 을 파이프로 넘기세요")
    try:
        secret = json.loads(raw)
    except json.JSONDecodeError as error:
        # 예외에 원문 조각이 실리지 않도록 위치만 옮겨 담는다.
        raise PrepareError(f"SecretString JSON 파싱 실패: line {error.lineno} column {error.colno}") from None
    if not isinstance(secret, dict):
        raise PrepareError("SecretString 은 JSON object 여야 합니다")

    writer = load_writer()
    output_dir = args.output_dir
    output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)

    written: dict[str, Path] = {}
    key_counts: dict[str, int] = {}
    rendered: dict[str, str] = {}
    for service in SERVICES:
        if service not in images:
            continue
        target = output_dir / ENV_FILENAMES[service]
        guard_output_path(target, args.shared_env_file)
        text = writer.render(secret, images[service], service, args.phase, args.environment)
        guard_service_env(service, text)
        rendered[service] = text
        written[service] = target
        key_counts[service] = len(parse_dotenv_keys(text))

    if "data-api" in rendered:
        active = dotenv_value(rendered["data-api"], "SPRING_PROFILES_ACTIVE")
        if active != profiles:
            raise PrepareError(
                f"Data 프로파일 불일치: env 파일은 '{active}', 오버레이가 넘길 값은 '{profiles}'. "
                "기존 compose 의 app.environment 가 env_file 을 «이깁니다» — 두 값이 갈라지면 "
                "satellites 프로파일이 조용히 빠진 채로 뜹니다")
        if "satellites" not in (active or ""):
            raise PrepareError("Data 프로파일에 satellites 가 없습니다")

    # compose 가 보간할 값. 여기에는 비밀이 없다.
    compose_values: dict[str, str] = {"DEPLOY_ENV": args.environment}
    redis_acl = output_dir / "business-redis.acl"
    guard_output_path(redis_acl, args.shared_env_file)
    acl_text = writer.business_redis_acl(secret)
    compose_values["BUSINESS_REDIS_ACL_FILE"] = str(redis_acl)
    for service, path in written.items():
        compose_values[COMPOSE_FILE_KEYS[service]] = str(path)
        compose_values[writer.IMAGE_KEYS[service]] = images[service]
    if "data-api" in written:
        compose_values["DATA_API_PROFILES"] = profiles
        compose_values["DATA_API_JAVA_OPTS"] = "-Djava.security.egd=file:/dev/./urandom"
        if args.environment == "prod":
            compose_values["DATA_API_JAVA_OPTS"] += " -javaagent:/opt/datadog/dd-java-agent.jar"
    guard_compose_env(compose_values, secret)

    compose_env = output_dir / "compose.env"
    guard_output_path(compose_env, args.shared_env_file)

    # 필수 보간 변수 대조 — 실제 최종값만 검사하며 값은 로그·오류로 내보내지 않는다.
    checked = [args.base_compose, SATELLITES_COMPOSE]
    if "data-api" in written:
        checked.append(DATA_OVERLAY_COMPOSE)
    required: set[str] = set()
    for path in checked:
        required |= compose_variables(path)[0]
    compose_text = "".join(f"{key}={writer.dotenv_quote(value)}\n" for key, value in sorted(compose_values.items()))
    missing = empty_compose_values(required, args.shared_env_file, compose_text, args.project_name)
    if missing:
        raise PrepareError(
            "compose 보간에 필요한 값이 없습니다 — " + ", ".join(missing)
            + f". 대조 대상: {', '.join(str(p) for p in checked)}")

    for service, path in written.items():
        writer.write_atomic(path, rendered[service])
    writer.write_atomic(redis_acl, acl_text, mode=0o644)
    writer.write_atomic(compose_env, compose_text)

    plan = build_plan(args, compose_env, with_data="data-api" in written)
    plan_path = output_dir / "deploy-plan.txt"
    writer.write_atomic(plan_path, plan)

    # 여기서부터가 유일한 표준출력. 값은 한 글자도 나오지 않는다.
    print(f"준비 완료 (환경 {args.environment} · 단계 {args.phase} · 프로젝트 {args.project_name})")
    for service, path in written.items():
        print(f"  {service}: {path} (키 {key_counts[service]}개, 0600)")
    print(f"  compose 보간: {compose_env} (키 {len(compose_values)}개)")
    print(f"  절차: {plan_path}")
    print("배포하지 않았다 — up·DNS·gate 는 아래 절차대로 사람이 수행한다.")
    print()
    print(plan, end="")


if __name__ == "__main__":
    try:
        main()
    except PrepareError as error:
        print(f"준비 실패: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    except ValueError as error:
        # writer 의 검증 실패. 메시지는 키 «이름»까지만 담는다.
        print(f"준비 실패: {error}", file=sys.stderr)
        raise SystemExit(1) from None
