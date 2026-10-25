#!/usr/bin/env python3
"""GROMO-2417: 격리 Docker 안에서 연결/동시 종료/회복을 반복한다. 외부 URL은 받지 않는다."""
import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import time
import urllib.request
import uuid

import websockets

# 매 실행의 로컬 컨테이너에서만 사용하는 자격이다. 운영 자격/fixture는 읽지 않는다.
SECRET = "local-close-probe-only-not-a-production-secret-0123456789"
LABEL = "com.oneorthree.local-close-probe"


def command(*args, check=True, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        # 환경변수가 담길 수 있는 argv 및 프로세스 stderr를 예외에 싣지 않는다.
        raise RuntimeError(f"local command failed: {args[0]} (exit={result.returncode})")
    return result.stdout.strip()


def docker(*args, **kwargs):
    return command("docker", *args, **kwargs)


def access_token():
    def encode(value):
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    now = int(time.time())
    content = encode({"alg": "HS256"}) + "." + encode({
        "sub": str(uuid.uuid4()), "type": "access", "guest": True,
        "sid": str(uuid.uuid4()), "gen": 0, "iat": now, "exp": now + 3600,
    })
    signature = hmac.new(SECRET.encode(), content.encode(), hashlib.sha256).digest()
    return content + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def get_local(port, path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
            return response.read().decode()
    except (OSError, TimeoutError):
        return None


def metric_sum(lines, prefix):
    values = [float(line.rsplit(" ", 1)[1]) for line in lines
              if line.startswith(prefix + " ") or line.startswith(prefix + "{")]
    return sum(values) if values else None


def server_sample(name, port, started):
    state = json.loads(docker("inspect", "--format", "{{json .State}}", name))
    restarts = int(docker("inspect", "--format", "{{.RestartCount}}", name))
    health_raw = get_local(port, "/actuator/health/readiness")
    health = json.loads(health_raw).get("status") if health_raw else "UNAVAILABLE"
    prometheus = get_local(port, "/actuator/prometheus")
    prefixes = ("jvm_memory_", "jvm_threads_live_", "jvm_buffer_", "jvm_gc_", "tomcat_threads_",
                "realtime_websocket_sessions", "realtime_stomp_sessions", "executor_queued_tasks")
    lines = [line for line in (prometheus or "").splitlines() if line.startswith(prefixes)]
    # 파일/필드가 없는 경우도 원문을 보존한다. memory.current는 RSS와 별개의 cgroup 총량이다.
    proc = docker("exec", name, "sh", "-c",
                  "cat /sys/fs/cgroup/memory.current; cat /sys/fs/cgroup/memory.events; "
                  "sed -n '/^VmRSS:/p;/^Threads:/p' /proc/1/status", check=False)
    return {"elapsedSeconds": round(time.monotonic() - started, 3),
            "running": state["Running"], "oomKilled": state["OOMKilled"],
            "restartCount": restarts, "health": health, "metrics": lines, "memory": proc}


async def connection_round(port, count, rate, hold_seconds, mode, compression):
    clients = []
    unexpected = []
    started = time.monotonic()

    async def connect(index):
        await asyncio.sleep(index / rate)
        socket = await websockets.connect(
            f"ws://127.0.0.1:{port}/ws/realtime", proxy=None, ping_interval=None,
            open_timeout=15, close_timeout=5, compression=None if compression == "none" else "deflate")
        clients.append(socket)  # 인증 실패/취소 경로에서도 finally가 닫는다.
        await socket.send("CONNECT\naccept-version:1.2\nheart-beat:0,0\nAuthorization:Bearer "
                          + access_token() + "\n\n\x00")
        message = await asyncio.wait_for(socket.recv(), 15)
        if not message.startswith("CONNECTED"):
            raise RuntimeError("local STOMP CONNECT rejected")

    tasks = [asyncio.create_task(connect(index)) for index in range(count)]
    try:
        await asyncio.gather(*tasks)
        connected_seconds = time.monotonic() - started
        # recv를 소비해 ERROR/조기 종료를 확인한다. idle 서버가 남는 연결 수만 유지해도 PASS 하지 않는다.
        async def watch(socket):
            try:
                async for message in socket:
                    if message.strip("\n\x00").startswith("ERROR"):
                        unexpected.append("STOMP_ERROR")
            except websockets.ConnectionClosed:
                pass
            unexpected.append("EARLY_CLOSE")
        watchers = [asyncio.create_task(watch(socket)) for socket in clients]
        try:
            await asyncio.sleep(hold_seconds)
        finally:
            for watcher in watchers:
                watcher.cancel()
            await asyncio.gather(*watchers, return_exceptions=True)
        if unexpected:
            raise RuntimeError("connection did not survive idle phase")
        close_started = time.monotonic()
        if mode == "forced":
            for socket in clients:
                socket.transport.abort()
        else:
            await asyncio.gather(*(socket.close(1000, "local-probe-complete") for socket in clients))
        closure = close_result(clients, mode)
        return {"connected": len(clients), "earlyCloseCount": len(unexpected), **closure,
                "connectSeconds": round(connected_seconds, 3),
                "closeSeconds": round(time.monotonic() - close_started, 3), "mode": mode,
                "negotiatedExtensions": sorted({socket.response.headers.get("Sec-WebSocket-Extensions", "")
                                                 for socket in clients})}
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*(socket.close() for socket in clients), return_exceptions=True)


def close_result(clients, mode):
    codes = {}
    for socket in clients:
        key = str(socket.close_code)
        codes[key] = codes.get(key, 0) + 1
    # close()는 handshake timeout 뒤에도 반환할 수 있으므로 1006/미확인 종료는 실패다.
    completed = sum(socket.close_code == 1000 and socket.protocol.close_rcvd is not None
                    for socket in clients)
    return {"passed": mode == "forced" or completed == len(clients),
            "closeCodes": codes, "normalCloseHandshakes": completed}


def cleanup_resources(containers, network_created, prefix, run_id):
    errors = []
    for name in reversed(containers):
        try:
            label = docker("inspect", "--format", '{{index .Config.Labels "' + LABEL + '"}}', name)
            if label != run_id:
                errors.append(name + ":label_mismatch")
                continue
            docker("rm", "-f", "-v", name)
            if docker("ps", "-aq", "--filter", "name=^/" + name + "$"):
                errors.append(name + ":remaining")
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            errors.append(name + ":cleanup_unverified")
    if network_created:
        try:
            label = docker("network", "inspect", "--format", '{{index .Labels "' + LABEL + '"}}', prefix)
            if label != run_id:
                errors.append(prefix + ":label_mismatch")
            else:
                docker("network", "rm", prefix)
                if docker("network", "ls", "-q", "--filter", "name=^" + prefix + "$"):
                    errors.append(prefix + ":remaining")
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            errors.append(prefix + ":cleanup_unverified")
    return errors


def memory_observed_without_oom(raw):
    lines = raw.splitlines()
    if not lines or not lines[0].isdigit() or int(lines[0]) <= 0:
        return False
    events = {}
    for line in lines[1:]:
        fields = line.split()
        if len(fields) == 2 and fields[0] in {"oom", "oom_kill"} and fields[1].isdigit():
            events[fields[0]] = int(fields[1])
    return events == {"oom": 0, "oom_kill": 0}


def recovered(sample):
    # inbound scheduler의 주기 작업 1개는 baseline에도 존재한다. 완전 drain 판정은 송신 큐에서 한다.
    outbound = [line for line in sample["metrics"] if line.startswith("executor_queued_tasks{")
                and ('name="clientOutboundChannelExecutor"' in line or 'name="realtime-outbound"' in line)]
    return (memory_observed_without_oom(sample["memory"]) and sample["running"] and not sample["oomKilled"] and sample["restartCount"] == 0
            and sample["health"] == "UP"
            and metric_sum(sample["metrics"], "realtime_websocket_sessions") == 0
            and metric_sum(sample["metrics"], "realtime_stomp_sessions") == 0
            and bool(outbound) and all(float(line.rsplit(" ", 1)[1]) == 0 for line in outbound))


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Java 17 및 /opt/dd-java-agent.jar를 포함한 로컬 이미지")
    parser.add_argument("--jar", required=True, type=Path, help="이번 변경에서 빌드한 bootJar")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--connections", type=int, default=1000)
    parser.add_argument("--connect-rate", type=int, default=40)
    parser.add_argument("--hold-seconds", type=int, default=60)
    parser.add_argument("--observe-seconds", type=int, default=60)
    parser.add_argument("--close-modes", default="normal,forced,normal")
    parser.add_argument("--max-ram-percentage", type=float, default=65.0, help="동일 768MiB에서 JVM 힙 비율만 비교")
    parser.add_argument("--expect-no-compression", action="store_true", help="서버가 압축 제안을 거부했는지도 성공 조건으로 검증")
    parser.add_argument("--compression", choices=["none", "deflate"], default="deflate")
    parser.add_argument("--malloc-arena-max", type=int, help="glibc arena 개수만 비교(1~8), 생략하면 이미지 기본값")
    parser.add_argument("--tomcat-max", type=int, help="생략하면 jar의 기본값. 이전 동작 비교는 200")
    parser.add_argument("--deny-sea", action="store_true", help="운영 사고 당시 sea:* ACL 누락도 재현")
    args = parser.parse_args()
    if not 20 <= args.max_ram_percentage <= 65:
        parser.error("max-ram-percentage는 20~65입니다")
    if not args.jar.is_file() or not 1 <= args.connections <= 2000 or not 1 <= args.connect_rate <= 100:
        parser.error("jar 또는 로컬 부하 범위가 올바르지 않습니다")
    if args.hold_seconds < 1 or args.observe_seconds < 1:
        parser.error("유지/관측 시간은 양수여야 합니다")
    if not 1 <= len(args.close_modes.split(",")) <= 10 or any(
            mode not in {"normal", "forced"} for mode in args.close_modes.split(",")):
        parser.error("close-modes는 normal/forced의 쉼표 목록(최대 10회)입니다")
    if args.malloc_arena_max is not None and not 1 <= args.malloc_arena_max <= 8:
        parser.error("malloc-arena-max는 1~8입니다")
    if args.tomcat_max is not None and not 1 <= args.tomcat_max <= 200:
        parser.error("tomcat-max는 1~200입니다")
    return args


def main():
    args = parse_args()
    endpoint = None if os.environ.get("DOCKER_CONTEXT") else os.environ.get("DOCKER_HOST")
    if not endpoint:
        endpoint = json.loads(docker("context", "inspect"))[0]["Endpoints"]["docker"]["Host"]
    if not endpoint.startswith("unix://"):
        raise RuntimeError("로컬 unix socket Docker만 허용합니다")
    image_id = docker("image", "inspect", "--format", "{{.Id}}", args.image)
    version = subprocess.run(["docker", "run", "--rm", "--entrypoint", "java", args.image, "-version"],
                             capture_output=True, text=True, timeout=30)
    if version.returncode:
        raise RuntimeError("local Java version probe failed")
    java_version = (version.stdout + version.stderr).strip()
    run_id = uuid.uuid4().hex[:12]
    prefix = "gromo-2417-" + run_id
    containers = []
    network_created = False
    samples = []
    rounds = []
    stop = threading.Event()
    monitor = None
    failures = []
    args.output.mkdir(parents=True, exist_ok=False)
    result = {"runId": run_id, "imageId": image_id,
              "probeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "jarSha256": hashlib.sha256(args.jar.read_bytes()).hexdigest(),
              "javaVersion": java_version, "memoryLimitMiB": 768, "cpuCount": 2,
              "connections": args.connections, "connectRate": args.connect_rate,
              "holdSeconds": args.hold_seconds, "observeSeconds": args.observe_seconds,
              "tomcatMaxOverride": args.tomcat_max, "maxRamPercentage": args.max_ram_percentage,
              "mallocArenaMax": args.malloc_arena_max, "compression": args.compression,
              "expectNoCompression": args.expect_no_compression, "denySea": args.deny_sea, "rounds": rounds}

    def create(name, image, options, application_args=()):
        containers.append(name)
        docker("run", "-d", "--name", name, "--network", prefix,
               "--label", LABEL + "=" + run_id, *options, image, *application_args)

    try:
        network_created = True  # 생성 CLI timeout 뒤에도 정확한 이름·label로 회수를 시도한다.
        docker("network", "create", "--label", LABEL + "=" + run_id, prefix)
        create(prefix + "-db", "postgres:16.14-alpine",
               ["-e", "POSTGRES_PASSWORD=local-probe-only", "-e", "POSTGRES_DB=chat"])
        create(prefix + "-redis", "redis:7.4.11-alpine", [])
        for _ in range(100):
            if "accepting" in docker("exec", prefix + "-db", "pg_isready", "-U", "postgres", check=False):
                break
            time.sleep(.2)
        else:
            raise RuntimeError("local PostgreSQL startup timeout")
        acl = ["%R~presence:*", "~cache:chat:*", "~lock:chat:*", "&chat:*"] if args.deny_sea else ["~*", "&*"]
        docker("exec", prefix + "-redis", "redis-cli", "ACL", "SETUSER", "realtime", "on", "nopass", "+@all", *acl)
        env = {"SPRING_PROFILES_ACTIVE": "prod", "CHAT_DB_URL": f"jdbc:postgresql://{prefix}-db:5432/chat",
               "CHAT_DB_USERNAME": "postgres", "CHAT_DB_PASSWORD": "local-probe-only",
               "REDIS_HOST": prefix + "-redis", "REDIS_USERNAME": "realtime", "JWT_SECRET": SECRET,
               "DATA_API_BASE_URL": "http://127.0.0.1:1", "DD_TRACE_ENABLED": "true",
               "DD_INSTRUMENTATION_TELEMETRY_ENABLED": "false", "DD_REMOTE_CONFIG_ENABLED": "false",
               "DD_AGENT_HOST": "127.0.0.1", "DD_TRACE_AGENT_URL": "http://127.0.0.1:8126", "DD_SERVICE": "local-close-probe", "DD_ENV": "local"}
        if args.malloc_arena_max:
            env["MALLOC_ARENA_MAX"] = str(args.malloc_arena_max)
        if args.tomcat_max:
            env["SERVER_TOMCAT_THREADS_MAX"] = str(args.tomcat_max)
        options = ["--memory", "768m", "--memory-swap", "768m", "--cpus", "2",
                   "-p", "127.0.0.1::8081", "-p", "127.0.0.1::9091",
                   "-v", str(args.jar.resolve()) + ":/probe/app.jar:ro", "--entrypoint", "java"]
        for key, value in env.items():
            options.extend(["-e", key + "=" + value])
        app = prefix + "-app"
        create(app, args.image, options,
               ["-XX:ActiveProcessorCount=2", "-XX:MaxRAMPercentage=" + str(args.max_ram_percentage), "-XX:NativeMemoryTracking=summary",
                "-javaagent:/opt/dd-java-agent.jar", "-jar", "/probe/app.jar"])
        result["glibcOnlineCpus"] = int(docker("exec", app, "getconf", "_NPROCESSORS_ONLN"))
        port = int(docker("port", app, "8081").split(":")[-1])
        management = int(docker("port", app, "9091").split(":")[-1])
        started = time.monotonic()
        for _ in range(180):
            if '"UP"' in (get_local(management, "/actuator/health/readiness") or ""):
                break
            if not json.loads(docker("inspect", "--format", "{{json .State}}", app))["Running"]:
                raise RuntimeError("local application startup exited")
            time.sleep(.5)
        else:
            raise RuntimeError("local application startup timeout")

        def collect():
            while not stop.is_set():
                try:
                    samples.append(server_sample(app, management, started))
                except Exception as error:
                    failures.append("sampler:" + type(error).__name__)
                stop.wait(.5)
        monitor = threading.Thread(target=collect, name="local-close-probe-observer", daemon=True)
        monitor.start()
        for index, mode in enumerate(args.close_modes.split(","), 1):
            start_index = len(samples)
            round_result = {"round": index, "mode": mode}
            rounds.append(round_result)
            try:
                round_result["client"] = asyncio.run(connection_round(
                    port, args.connections, args.connect_rate, args.hold_seconds, mode, args.compression))
                round_result["compressionExpectationMet"] = (not args.expect_no_compression
                    or round_result["client"]["negotiatedExtensions"] == [""])
                round_result["clientPassed"] = (round_result["client"].pop("passed")
                    and round_result["compressionExpectationMet"])
            except Exception as error:
                round_result["clientPassed"] = False
                round_result["clientFailure"] = type(error).__name__
            close_time = time.monotonic()
            close_elapsed = close_time - started
            time.sleep(args.observe_seconds)
            final = server_sample(app, management, started)
            samples.append(final)
            window = samples[start_index:]
            alive = all(sample["running"] and not sample["oomKilled"]
                        and sample["restartCount"] == 0 and sample["health"] == "UP"
                        and memory_observed_without_oom(sample["memory"]) for sample in window)
            round_result["serverPassed"] = alive and recovered(final) and not failures
            round_result["observedSecondsAfterClose"] = round(time.monotonic() - close_time, 3)
            rss = [int(match.group(1)) / 1024 for sample in window
                   if (match := re.search(r"^VmRSS:\s+(\d+)", sample["memory"], re.MULTILINE))]
            cgroup = [int(sample["memory"].splitlines()[0]) / 1048576 for sample in window
                      if sample["memory"] and sample["memory"].splitlines()[0].isdigit()]
            round_result["peakRssMiB"] = round(max(rss), 2) if rss else None
            round_result["peakCgroupMiB"] = round(max(cgroup), 2) if cgroup else None
            round_result["peakJvmThreads"] = max((metric_sum(s["metrics"], "jvm_threads_live_threads") or 0)
                                                  for s in window)
            round_result["peakTomcatThreads"] = max((metric_sum(s["metrics"], "tomcat_threads_current_threads") or 0)
                                                     for s in window)
            round_result["peakServerSessions"] = max((metric_sum(s["metrics"], "realtime_websocket_sessions") or 0)
                                                     for s in window)
            round_result["serverPassed"] = round_result["serverPassed"] and round_result["peakServerSessions"] == args.connections
            drained = [s["elapsedSeconds"] - close_elapsed for s in window
                       if s["elapsedSeconds"] >= close_elapsed and recovered(s)]
            round_result["serverDrainSeconds"] = round(min(drained), 3) if drained else None
            round_result["finalSessions"] = metric_sum(final["metrics"], "realtime_websocket_sessions")
            round_result["finalStompSessions"] = metric_sum(final["metrics"], "realtime_stomp_sessions")
            print(json.dumps(round_result), flush=True)
            if not round_result["clientPassed"] or not round_result["serverPassed"]:
                failures.append("round_failed")
                break  # OOM/재시작/회복 실패 뒤 다음 부하를 만들지 않는다.
    except Exception as error:
        failures.append(type(error).__name__)
    finally:
        stop.set()
        if monitor:
            monitor.join(timeout=15)
        # Docker 로그는 테스트용 UUID를 포함할 수 있다. 출력하지 않고 로컬 진단 파일에만 남긴다.
        app_names = [name for name in containers if name.endswith("-app")]
        if app_names:
            try:
                logs = subprocess.run(["docker", "logs", app_names[0]], capture_output=True, text=True, timeout=30)
                (args.output / "application.log").write_text(logs.stdout + logs.stderr)
            except (OSError, subprocess.TimeoutExpired):
                failures.append("application_log_unavailable")  # 로그 실패도 자원 회수를 막지 않는다.
        cleanup_errors = cleanup_resources(containers, network_created, prefix, run_id)
        result.update({"passed": not failures and not cleanup_errors
                       and len(rounds) == len(args.close_modes.split(","))
                       and all(item.get("clientPassed") and item.get("serverPassed") for item in rounds),
                       "failures": failures, "cleanupRemaining": cleanup_errors})
        (args.output / "samples.json").write_text(json.dumps(samples, indent=2))
        (args.output / "summary.json").write_text(json.dumps(result, indent=2))
        print(json.dumps({"passed": result["passed"], "failures": failures,
                          "cleanupRemaining": cleanup_errors, "summary": str(args.output / "summary.json")}), flush=True)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
