#!/usr/bin/env python3
"""GitHub 승인 잡에서 Catus의 고정 SSM 문서만 호출하고 최종 상태를 기다린다."""
import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path


def aws(*arguments):
    result = subprocess.run(["aws", "--region", "ap-northeast-2", *arguments, "--output", "json"],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("AWS 요청 실패")
    return json.loads(result.stdout)


def prepare(release_id, operation, recover=False):
    version_input = re.fullmatch(r"catus-v[0-9]+\.[0-9]+\.[0-9]+", release_id)
    if not version_input and not re.fullmatch(r"[0-9a-f]{40}-[0-9]+-[0-9]+", release_id):
        raise ValueError("릴리스 ID 형식 오류")
    config = json.loads(aws("secretsmanager", "get-secret-value", "--secret-id", "catus/prod/cicd")["SecretString"])
    if config.get("PRODUCT") != "catus" or config.get("SSM_DOC") != "catus-prod-deploy" or not config["DEPLOY_BUCKET"].startswith("catus-prod-deploy-artifacts-"):
        raise ValueError("Catus 배포 설정 불일치")
    # 입력·시크릿 값이 shell 명령 문자열에 들어가지 않음.
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "release.json"
        key = f"versions/{release_id}.json" if version_input else f"releases/{release_id}/release.json"
        subprocess.run(["aws", "s3api", "get-object", "--region", "ap-northeast-2", "--bucket", config["DEPLOY_BUCKET"],
            "--key", key, str(path)], check=True, stdout=subprocess.DEVNULL)
        envelope = json.loads(path.read_text())
    if version_input:
        if envelope.get("version") != release_id:
            raise ValueError("버전 참조 불일치")
        release_id = envelope["release_id"]
    if not re.fullmatch(r"[0-9a-f]{40}-[0-9]+-[0-9]+", release_id):
        raise ValueError("버전 참조의 릴리스 ID 오류")
    if not re.fullmatch(r"catus-v[0-9]+\.[0-9]+\.[0-9]+", envelope.get("version", "")):
        raise ValueError("버전 메타데이터 오류")
    if envelope.get("release_id") != release_id or not re.fullmatch(r"[0-9a-f]{64}", envelope.get("bundle_sha256", "")):
        raise ValueError("릴리스 checksum 메타데이터 오류")
    parameters = {"ReleaseId": [release_id], "BundleSha256": [envelope["bundle_sha256"]], "Operation": [operation]}
    request = {"document": config["SSM_DOC"], "instance_id": config["INSTANCE_ID"],
        "parameters": parameters, "envelope": {key: envelope[key] for key in
            ["release_id", "version", "source_revision", "infra_revision", "bundle_sha256"]},
        "marker": "catus:" + os.environ["GITHUB_REPOSITORY_ID"] + ":" + os.environ["GITHUB_RUN_ID"]}

    if not recover:
        deadline = time.monotonic() + 120
        while True:
            try:
                found = existing_command(request)
                break
            except (RuntimeError, subprocess.TimeoutExpired):
                if time.monotonic() >= deadline:
                    raise RuntimeError("SSM 사전 조회 실패 — 전송 의도 기록 전 중단")
                time.sleep(5)
        if found:
            raise ValueError("전송 의도 산출물 없이 기존 SSM 명령이 존재한다 — 운영자 확인 필요")
    return request


def existing_command(request):
    marker, parameters = request["marker"], request["parameters"]
    commands = aws("ssm", "list-commands", "--instance-id", request["instance_id"],
        "--filters", "key=DocumentName,value=" + request["document"])["Commands"]
    matches = [command for command in commands if command.get("Comment") == marker]
    if len(matches) > 1:
        raise ValueError("동일 실행의 SSM 명령이 여러 개다 — 운영자 확인 필요")
    if not matches:
        return None
    command = matches[0]
    if command.get("Parameters") != parameters or command.get("InstanceIds") != [request["instance_id"]]:
        raise ValueError("기존 SSM 명령의 배포 입력 불일치")
    return command["CommandId"]


def execute(request, already_submitted=False):
    parameters, envelope = request["parameters"], request["envelope"]
    operation = parameters["Operation"][0]
    # 같은 Actions 실행의 재시도도 기존 명령을 복구한다. 응답 유실 시 재전송하지 않는다.
    marker = request["marker"]
    print("Catus SSM 상관관계: " + marker, flush=True)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("Catus SSM 상관관계: " + marker + "\n")
    identifier = None
    submitted = already_submitted
    deadline = time.monotonic() + 2500
    if not submitted:
        submitted = True
        try:
            response = aws("ssm", "send-command", "--document-name", request["document"], "--instance-ids", request["instance_id"],
                "--comment", marker, "--parameters", json.dumps(parameters))
            identifier = response["Command"]["CommandId"]
        except (RuntimeError, subprocess.TimeoutExpired):
            print("SSM 전송 응답 유실 — 기존 명령만 조회", flush=True)
    while time.monotonic() < deadline:
        try:
            if identifier is None:
                identifier = existing_command(request)
                if identifier is None:
                    time.sleep(5)
                    continue
            print("Catus SSM command: " + identifier, flush=True)
            result = aws("ssm", "get-command-invocation", "--command-id", identifier, "--instance-id", request["instance_id"])
        except (RuntimeError, subprocess.TimeoutExpired):
            print("SSM 상태 확인 재시도 — 명령 중복 전송 없음", flush=True)
            time.sleep(5)
            continue
        if result["Status"] == "Success":
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            record = {"environment": "prod", "service": "catus", "result": "success",
                "version": envelope["version"], "release_id": envelope["release_id"],
                "revision": envelope["source_revision"], "infra_revision": envelope["infra_revision"], "finished_at": now}
            Path("deployment-status-prod.json").write_text(json.dumps([record]))
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write(f"Catus {operation} 완료: {envelope['version']} / {envelope['release_id']}\n")
            print("Catus 배포 완료")
            return
        if result["Status"] not in {"Pending", "InProgress", "Delayed"}:
            raise RuntimeError("SSM 배포 실패: " + result["Status"])
        time.sleep(10)
    raise RuntimeError("SSM 대기 시간 초과. 새 배포 전에 기존 command 상태를 확인한다.")


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("prepare")
    build.add_argument("--release-id", required=True)
    build.add_argument("--operation", choices=["deploy", "bootstrap", "rollback"], required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--recover", action="store_true")
    run = commands.add_parser("execute")
    run.add_argument("--request", type=Path, required=True)
    run.add_argument("--previous-intent", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        args.output.write_text(json.dumps(prepare(args.release_id, args.operation, args.recover)))
        return
    request = json.loads(args.request.read_text())
    if args.previous_intent and json.loads(args.previous_intent.read_text()) != request:
        raise ValueError("기존 SSM 전송 의도와 현재 배포 요청 불일치")
    execute(request, args.previous_intent is not None)


if __name__ == "__main__":
    main()
