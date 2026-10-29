# Kafka 연결 실패와 Datadog profiler 오류 — 영향 범위 조사 (2026-10-29)

> GROMO-2574. 조사 시각 2026-10-29 10:49~11:20Z(19:49~20:20 KST). 대상은 GCP dev VM `gromo-dev-app`(asia-northeast3-a)이다.
> GCP SSH는 `docker inspect`·`docker logs`(과거 범위)·`journalctl`·`last`·`uptime`만 실행했다. GitHub은 `gh run list`·`gh run view`·`gh api` GET만, Datadog은 MCP 읽기만 썼다.
> 서버·Datadog Agent·앱의 시작·중지·재시작, 배포, workflow dispatch, AWS 요청, 부하·시험 데이터 생성은 하지 않았다. 앱 컨테이너가 조사 시점에 이미 정지되어 있어 `docker exec` 읽기 명령은 실행하지 못했다(§2.3).
> 원인은 직접 증거가 있는 것만 확정한다. 나머지는 «미확정»으로 표시한다.

## 결론

| 항목 | 판정 |
| --- | --- |
| Exporter F 20건(12:53:59~12:57:15 KST) | 두 «브로커 9092 미개방 구간»에 모두 들어간다. 첫째 구간은 호스트 비정상 재부팅 직후 브로커가 복구하던 때다. 둘째 구간은 12:55:34 dockerd 재기동 뒤 브로커를 다시 띄우던 때다. 배포 실행 구간과는 겹치지 않는다. 재부팅의 원인과 dockerd 재기동 주체는 **미확정**이다. |
| Exporter E 2건(09:51:27·14:04:37 KST) | 브로커 미가동 구간·배포 구간과 겹치지 않는다. 같은 유형이 10-22부터 7일간 28건 나왔다. 평시에 반복되는 패턴이고, 원인은 **미확정**이다. |
| profiler `UnsatisfiedLinkError`·crash tracking NPE(Business) | **확정·재현.** read-only 컨테이너의 `/tmp` tmpfs가 Docker 기본값 `noexec`로 붙는다. 그래서 dd-java-agent가 `/tmp`에 푼 `libjavaProfiler.so`를 실행 매핑하지 못한다. 로컬 amd64·arm64에서 같은 건수로 재현했고, 수정안을 적용하면 0건이 된다. |
| telemetry·trace·profile 전송 실패 | 18:43:16 KST 이후 실패는 같은 시각 공동 배포 quiesce 단계가 Agent를 `docker stop`한 시각과 겹친다. 18:38:57 KST profile 업로드 broken pipe 1건만 Agent가 실행 중일 때 났고, 원인은 **미확정**이다. |
| 업무 영향 | profiler·telemetry 오류가 요청 실패로 이어졌다는 증거는 **없다**(§3). Kafka 연결 실패로 인한 업무 실패 증거도 **없다**. 다만 브로커 비정상 종료 복구 중 세그먼트 2개가 잘렸다. 이벤트 유실·재처리 여부는 **미확정**이다. |
| 수정 | Business compose에 프로파일러 전용 exec tmpfs `/ddprof`를 추가하고 `DD_PROFILING_TEMPDIR=/ddprof`를 설정했다(§5). 이것은 **보안 절충**이다. `/tmp`의 noexec는 유지하지만 쓰기와 실행이 함께 되는 자리가 하나 생긴다. 서버 반영은 하지 않았다. |

## 1. Kafka 타임라인

브로커 `phone-kafka`의 현재 StartedAt은 03:55:47.398Z, RestartCount 0이다. Exporter `gromo-kafka-exporter`는 StartedAt 03:58:06.877Z, RestartCount 10이다. 호스트 부팅 기록은 `journalctl --list-boots`가 `-1 … 2026-09-24 14:29:49 — 2026-10-29 03:51:43`, `0 … 2026-10-29 03:53:36 —`이다. `last -x -F`에는 09-24 부팅에 대한 shutdown 기록이 없다(비정상 종료).

| UTC | KST | 사건 | 근거 |
| --- | --- | --- | --- |
| 10-22 03:33 ~ 10-28 23:38 | 10-22 12:33 ~ 10-29 08:38 | Exporter E 28건: `Cannot get current offset … 2 errors occurred` 25건, `write: broken pipe` 2건, `Cannot get leader` 1건. 하루 2~6건이고 시각은 불규칙하다. | `docker logs gromo-kafka-exporter`(보존본 전체) |
| 10-28 23:52:33 ~ 00:01:06 | 08:52 ~ 09:01 | Data·Realtime 공동 배포 성공(run 40788746756) | `gh api …/jobs` |
| **00:51:27** | **09:51:27** | Exporter **E**: `realtime-events.DLT` p0 current offset 조회 실패. 상세 2줄은 `kafka: broker not connected`, `write tcp 172.18.0.6:48916->172.18.0.9:9092: write: broken pipe`이다. | Exporter 원문 |
| 00:45 ~ 00:56 | 09:45 ~ 09:56 | 브로커 로그 0줄. 배포·ops 실행 없음. 앱 Kafka WARN/ERROR 0건(Datadog). APM error span 0건 | `docker logs phone-kafka`, `gh run list`, Datadog |
| 02:36:02 ~ 02:38:04 | 11:36 ~ 11:38 | 공동 배포 1차 실패. `nginx.service: Stopping timed out` 02:36:42 | journal, run 40805894045 a1 |
| 02:55:29 ~ 03:03:02 | 11:55 ~ 12:03 | 공동 배포 재실행 성공. data-api·realtime 컨테이너는 02:56:04에 재생성됐다. 브로커는 quiesce 대상이 아니어서 재시작되지 않았다. | run a2, `deploy-core-dev.py` `QUIESCE_SERVICES` |
| 03:37 ~ 03:51:43 | 12:37 ~ 12:51 | 이전 부팅의 마지막 기록: rsyslog `omfile suspended` 반복, 03:47:05 sshd `kex_exchange_identification` 실패. 정상 종료 기록은 없다. | `journalctl -b -1 -p warning` |
| 03:53:36 | 12:53:36 | 호스트 부팅(커널 6.8.0-1070-gcp) | `uptime -s`, `--list-boots` |
| 03:53:59 | 12:53:59 | 브로커 1차 기동(`===> Launching`) | 브로커 원문 |
| **03:53:59 ~ 03:55:23** | **12:53:59 ~ 12:55:23** | Exporter **F 10건**: `dial tcp 172.18.0.10:9092: connect: connection refused`. F가 나면 프로세스가 끝나고 restart policy로 다시 뜬다. | Exporter 원문 |
| 03:55:15 ~ 03:55:27 | 12:55:15 ~ 12:55:27 | 브로커에 clean shutdown 파일이 없어 로그 62개를 복구했다. 이 과정에서 `realtime-events-0` 세그먼트 1571을 오프셋 1786으로, `__consumer_offsets-21` 세그먼트 1998을 2455로 **절단**했다. | 브로커 WARN 4줄 |
| 03:55:33.8 | 12:55:33 | 브로커 9092 수신 시작, `Kafka Server started` | 브로커 원문 |
| 03:55:34 | 12:55:34 | systemd `Stopping Docker Application Container Engine` → 모든 컨테이너 정지. 브로커는 03:55:35~39에 정상 종료했다. 같은 구간에 sudo·apt 기록은 없다. | `journalctl -u docker`, `_COMM=sudo`, apt history |
| 03:55:47 | 12:55:47 | dockerd가 컨테이너를 일괄 시작했다(broker·db·redis·data·realtime·Agent 등 StartedAt 03:55:47). 브로커는 새 IP 172.18.0.6을 받았다. | `docker inspect` |
| **03:55:52 ~ 03:57:15** | **12:55:52 ~ 12:57:15** | Exporter **F 10건**: `dial tcp 172.18.0.6:9092: connect: connection refused` | Exporter 원문 |
| 03:57:18.5 | 12:57:18 | 브로커 9092 수신 시작. 2차 기동은 clean shutdown 파일이 있어 복구를 건너뛰었다. | 브로커 원문 |
| 03:58:06 | 12:58:06 | Exporter 정상 기동 후 계속 실행 | `docker inspect` |
| 04:03:22 / 04:04:05 | 13:03 / 13:04 | realtime·data-api가 Kafka 클라이언트를 생성했다(브로커 준비 뒤). | 앱 원문 |
| **05:04:37** | **14:04:37** | Exporter **E**: `__consumer_offsets` p2 oldest offset 조회 실패, `write tcp 172.18.0.12:58968->172.18.0.6:9092: write: broken pipe` | Exporter 원문 |
| 05:00 ~ 05:08 | 14:00 ~ 14:08 | 브로커 로그 0줄. 브로커 StartedAt 변동 없음. 배포 실행 없음(가장 가까운 ops-smoke는 04:37~04:42에 끝남) | 원문, `gh run list` |

판정:

- **F 20건**은 브로커 9092가 열리기 전의 두 구간(03:53:59~03:55:33, 03:55:47~03:57:18)에 모두 들어간다. 브로커가 늦게 열린 직접 원인은 «비정상 종료 후 로그 복구(11.7초)»와 «dockerd 재기동에 따른 2차 기동»이다. 호스트가 비정상 종료된 원인, 그리고 dockerd를 재기동한 주체(사람·스크립트·에이전트)는 **미확정**이다. sudo·apt 기록이 없다는 것만 확인했다.
- **E 2건**은 브로커 재기동·배포 구간과 겹치지 않는다. 10-22부터 같은 문구가 반복된다. 이번 날에만 생긴 장애로 보지 않는다. 원인은 **미확정**이다. 후보는 브로커나 커널이 닫은 연결을 Exporter가 재사용한 경우다.

## 2. profiler 오류 분류

### 2.1 Datadog error 20건 전수 분해 (18:09:28~19:09:28 KST)

`host:gromo-dev status:error -service:gromo-kafka-dev -service:gromo-db-dev`, `09:09:28Z~10:09:28Z`를 `LogsApi.listLogs`로 전부 읽었다(잘림 없음). 결과는 Business 14·Notification 5·Realtime 1이며, 검증 보고서의 건수와 같다. 20건 모두 JVM·dd-java-agent가 stderr로 쓴 줄이다. 앱 업무 로그는 0건이다.

| 원문(요약) | B | N | R | 분류 | 근거 |
| --- | ---: | ---: | ---: | --- | --- |
| `Picked up JAVA_TOOL_OPTIONS: … -javaagent:/opt/dd-java-agent.jar` | 1 | | | (b) JVM 옵션 안내, stderr → error 오분류 | Business Dockerfile `ENV JAVA_TOOL_OPTIONS` |
| `OpenJDK … Sharing is only supported for boot loader classes because bootstrap classpath has been appended` | 1 | 1 | | (b) `-javaagent`가 bootstrap classpath를 늘려 CDS가 일부만 적용된다는 경고. 기능 실패 아님 | 4개 서비스 공통 |
| `[main] INFO …ProcessContext - Registering process context for OTel profiler` | 2 | 2 | | INFO 오분류 | |
| `[dd-task-scheduler] INFO …StatusLogger - DATADOG TRACER CONFIGURATION` | 1 | 1 | | INFO 오분류 | |
| `WARN …ProcessContext - Failed to register process context … UnsatisfiedLinkError: /tmp/ddprof_business/pid_1/scratch/libjavaProfiler-dd-tmp….so: failed to map segment from shared object` | 2 | | | **(a)+(c)** noexec `/tmp`에서 `.so` 실행 매핑 거부 | §2.3, 재현 A |
| `WARN …ProfilerFlareLogger - Failed to instantiate Datadog profiler on Linux X64 … Failed to load Datadog Java profiler library` | 1 | | | **(a)+(c)** 같은 원인 | 재현 A |
| `crashtracking.Initializer - Unexpected exception while creating custom crash upload script` / `… initializing OOME notifier` — `NullPointerException: … JVMAccess$Flags.getStringFlag(String) is null` | 2 | | | **(a) 파생**: `JVMAccess`도 같은 `.so`를 쓴다. 로드 실패로 flag 조회가 null이 된다. | 재현 A에서 함께 발생, B·F에서 함께 사라짐 |
| `ProfileUploader - Failed to upload profile … SocketException: Broken pipe` (09:38:57Z) | 1 | | | (d) 전송 실패, Agent 실행 중. 원인 **미확정** | 다음 업로드 09:39:53Z `Upload done` |
| `ProfileUploader - Upload done` (09:39:53Z) | 1 | | | 정상 완료 줄의 오분류 | JFR 기반 업로드는 동작했다 |
| `TelemetryRouter - Got FAILURE sending telemetry …:8126` + `Couldn't send app-closing event!` (09:43:16Z) | 2 | | | (d) Agent 정지와 앱 종료가 동시에 일어남 | §2.4 |
| `DDAgentApi - Error while sending N traces … ConnectException: Failed to connect to datadog-agent/172.18.0.14:8126` (09:43:16Z) | | 1 | 1 | (d) Agent 정지 뒤. N 2 / 5건 유실 | §2.4 |
| **합계** | **14** | **5** | **1** | | |

조사 범위의 Docker 원본에는 Datadog 창 밖의 profiler 관련 줄도 있었다.

| UTC | 서비스 | 원문 | 분류 |
| --- | --- | --- | --- |
| 02:57:37~02:58:00 | realtime·data-api | `UnknownHostException: datadog-agent` (trace·profile) | (d) 공동 배포 중 Agent 재생성 구간 |
| 03:54:04, 03:55:57 / 03:55:12 | realtime / data-api | `Untrusted crash uploader script /tmp/ddprof_root/pid_7/dd_crash_uploader.sh (wrong owner or group/world-writable)`, OOME 스크립트 같은 문구 | **(c)** 같은 컨테이너를 재시작해 쓰기 레이어 `/tmp`에 이전 실행의 스크립트가 남은 경우. 재현 D. 그 실행 동안 crash·OOME 알림이 동작하지 않는다(관측 기능). agent가 거부하는 정확한 조건은 미확인 |
| 03:55:38~03:55:44 | realtime·data-api | `ConnectException …:8126`, telemetry FAILURE | (d) dockerd 정지 중 |
| 09:43:17~09:43:58 | notification·realtime·data-api | remote config poll, telemetry, profile 업로드(`NoRouteToHostException`) 실패 | (d) Agent 정지 뒤 |

### 2.2 유형별 판정

| 유형 | 해당 | 판정·근거 | 미확정 |
| --- | --- | --- | --- |
| (a) 네이티브 라이브러리 매핑·추출 | Business만 | **확정.** 에이전트는 `libjavaProfiler.so`를 `java.io.tmpdir/ddprof_<user>/pid_<pid>/scratch`에 풀고 `System.load`한다. 오류 문구 `failed to map segment from shared object`는 실행 매핑 거부를 뜻한다. 파일 없음이나 심볼 오류가 아니다. **musl/glibc가 원인 아님**: 이미지 베이스는 `eclipse-temurin:17.0.20.1_1-jre-jammy`(image label 22.04, glibc)이다. 에이전트 jar에는 `linux-x64`(glibc)와 `linux-x64-musl`이 모두 있다. **아키텍처가 원인 아님**: tracer 상태 줄은 `architecture: amd64`, `Linux X64`이고 같은 `.so`가 Notification·Realtime에서는 정상 로드됐다. | — |
| (b) JVM 옵션 | 4개 서비스 | **확정(실패 아님).** Business는 `JAVA_TOOL_OPTIONS`(`-Xmx512m -XX:ActiveProcessorCount=2 -Djava.awt.headless=true -javaagent:/opt/dd-java-agent.jar`)를 쓴다. 나머지는 `JAVA_OPTS`의 `-javaagent`이다. 그래서 stderr 안내 2종이 생긴다. `DD_PROFILING_ENABLED=true`는 Business·Notification·Realtime에만 있고 data-api에는 없다(프로파일러 꺼짐). | — |
| (c) 컨테이너 마운트·권한 | Business, Realtime·Data(재시작 시) | **확정.** Business는 `ReadonlyRootfs=true`, `HostConfig.Tmpfs={"/tmp":"size=64m,mode=1777"}`, `User=business`이다. tmpfs 옵션에 `exec`가 없으면 Docker는 `noexec,nosuid,nodev`로 붙인다. 같은 값으로 띄운 로컬 컨테이너의 `/proc/self/mounts`가 `rw,nosuid,nodev,noexec,relatime,size=65536k`를 보였다(로컬 Docker 29.5.3, dev 29.7.2). Notification·Realtime·Data는 tmpfs·read_only가 없고 root로 실행되어 로드에 성공했다. | dev 컨테이너가 정지 상태여서 원격 `mount` 출력은 없다. 추가 확인 방법은 §6 |
| (d) 전송 실패 | 4개 서비스 | 09:43:16Z 이후 건은 Agent 정지(§2.4)와 시각이 일치한다. 02:57·03:55 건은 Agent·dockerd 재기동 구간이다. | 09:38:57Z profile 업로드 broken pipe 1건. Agent health는 09:40:54Z 이후 PASS 기록만 남아 있다. 이전 시각의 Agent 상태 원문은 아직 보지 않았다 |

### 2.3 로컬 재현

[`server/observability/datadog/profiler-check/run.sh`](../../../server/observability/datadog/profiler-check/run.sh)는 다음 조합의 빈 Java 프로그램을 `--network none`으로 띄운다: 실제와 같은 베이스(jammy JRE 17.0.20.1), 같은 dd-java-agent 1.64.0(sha256 고정), 같은 `JAVA_TOOL_OPTIONS`. 원격 서비스에는 요청하지 않는다. 판정은 «종료 코드 0 AND 에이전트 기동 줄(`DATADOG TRACER CONFIGURATION`) 1건 이상 AND 프로파일러를 켠 케이스(B·C·F)는 `Registering process context for OTel profiler` 1건 이상 AND 오류 패턴이 기대 건수»이며, 컨테이너가 못 뜨거나 JVM 이 일찍 죽으면 오류 0건이어도 FAIL 이다. 하나라도 어긋나면 종료 코드 1로 끝난다.

| 경우 | 설정 | `failed to map segment` | 프로파일러 생성 실패 | crash NPE | `Untrusted` |
| --- | --- | ---: | ---: | ---: | ---: |
| A | Business 현행: read-only, `/tmp:size=64m,mode=1777`, uid 10001 | 2 | 1 | 2 | — |
| B | A + `/tmp`에 `exec` | 0 | 0 | 0 | — |
| C | Notification·Realtime 현행: tmpfs 없음, root | 0 | 0 | 0 | — |
| E | A + `DD_PROFILING_DDPROF_ENABLED=false` | **2** | 0 | **2** | — |
| F | A + `/ddprof:size=64m,mode=1777,exec` + `DD_PROFILING_TEMPDIR=/ddprof` (수정안) | 0 | 0 | 0 | — |
| D | C 컨테이너를 같은 쓰기 레이어로 한 번 더 시작 | — | — | — | 1차 0 → 2차 2 |

A의 건수(2·1·2)는 dev Business 원본 건수와 같다. amd64(에뮬레이션, `PLATFORM=linux/amd64`, `Linux X64`)와 arm64(네이티브) 모두 16개 기대값을 통과했다. 원문 첫 줄은 다음과 같다.

```text
MOUNT /tmp rw,nosuid,nodev,noexec,relatime,size=65536k
java.lang.UnsatisfiedLinkError: /tmp/ddprof_business/pid_1/scratch/libjavaProfiler-dd-tmp….so: …: failed to map segment from shared object
[dd.trace …] WARN datadog.trace.api.profiling.ProfilerFlareLogger - Failed to instantiate Datadog profiler on Linux X64
java.lang.NullPointerException: Cannot invoke "String.equals(Object)" because the return value of "com.datadoghq.profiler.JVMAccess$Flags.getStringFlag(String)" is null
```

E에서 보듯 `DD_PROFILING_DDPROF_ENABLED=false`로는 OTel process context·crash tracking 경로의 로드 실패가 남는다. 일회성 실험(스크립트 미포함)도 했다. 이미지에 `.so`를 미리 풀고 `DD_PROFILING_DDPROF_DEBUG_LIB`로 지정하면 프로파일러 생성 실패만 사라졌고 나머지 2+2건은 남았다.

### 2.4 18:43 Agent 정지와 시각 대조

| UTC | KST | 사건 | 근거 |
| --- | --- | --- | --- |
| 09:34:32 ~ 09:39:32 | 18:34 ~ 18:39 | Satellite Dev CD deploy(run 40850676594). Business·Notification 생성 09:36:10, 시작 09:36:22~23 | `gh api`, `docker inspect` |
| 09:36:24 ~ 09:36:45 | 18:36:24 ~ 18:36:45 | 위 2.1의 기동 시점 줄(profiler·crash tracking·안내 문구) | Datadog·Docker |
| 09:41:35 ~ 09:44:37 | 18:41 ~ 18:44 | Data API CI(run 40849669595)의 「Dev 공동 CD / Data·Realtime 공동 배포」 **실패** | `gh api …/jobs` |
| 09:43:10 | 18:43:10 | `sudo /usr/bin/systemctl stop nginx` | `journalctl _COMM=sudo` |
| 09:43:15 | 18:43:15 | dockerd `stopping restart-manager` 6건. `deploy-core-dev.py`의 quiesce 집합(data-api·realtime·business-api·notification·postgres-exporter·datadog-agent)에 `docker stop --time 60` | journal, 코드 |
| 09:43:16 ~ 09:43:58 | 18:43:16 ~ 18:43:58 | 앱 telemetry·trace·profile 전송 실패 | 원문 |
| 09:43:18 / 09:43:21 / 09:44:16 | 18:43 / 18:43 / 18:44 | Business 종료 143, Agent 종료 0, Data·Realtime·Notification 종료 137(60초 뒤 SIGKILL) | `docker inspect` |
| 09:44:18 | 18:44:18 | `일부 서비스 중지에 실패했습니다…` `공동 배포 중단: nginx가 완전히 중지되지 않았습니다.` → 배포 중단. 조사 시점(10:49Z)에도 앱 4개·Agent가 Exited 상태다. | job 로그, `docker ps -a` |

Agent 종료의 직접 메커니즘은 공동 배포 quiesce 단계의 `docker stop`이다. 종료 경위와 복구 조건은 GROMO-2571에서 다룬다. 이 문서는 전송 실패 줄의 시각만 대조했다.

## 3. 업무 영향과 관측 영향

| 사건 | 관측 영향(확정) | 업무 영향 | 판정 |
| --- | --- | --- | --- |
| Exporter F 20건 | Kafka 지표 약 4분 공백(12:53:59~12:58:06) | 같은 구간 앱은 Kafka 클라이언트를 만들기 전이었다(13:03~13:04 생성). data-api·realtime의 Kafka WARN/ERROR는 03:50~04:10Z·05:00~05:10Z 원본과 Datadog에서 모두 0건이다. | **미확정(증거 없음)** |
| 호스트 재부팅·dockerd 재기동 | Datadog 수집 공백(VM 무응답~재기동) | 03:50~04:10Z APM error span이 Business 26건 이상, Realtime 8건 있다. 경로는 내부 Data 호출·Redis 연결·health·websocket이고 Kafka 경로는 없다. | 재기동 구간에 요청 실패가 있었다(확정). Kafka 연결 실패와의 인과 증거는 없다 |
| 브로커 세그먼트 절단 2건 | — | `realtime-events-0`(오프셋 1786 이후) 절단으로 마지막 기록이 유실됐을 수 있다. `__consumer_offsets-21`은 `realtime-v1` 그룹의 coordinator 파티션이다(03:58:06 `Group realtime-v1 … (__consumer_offsets-21)`). 절단으로 커밋 오프셋이 되감겼다면 재처리(중복)가 났을 수 있다. | **미확정**(확인 방법 §6) |
| Exporter E 2건 | 해당 scrape 1회의 offset 지표 누락 | 같은 시각 앱 Kafka 오류 0건, APM error span 0건(00:45~00:58). 05:00~05:10에는 Business `ScreenController.home` 1건뿐이다(Kafka 무관). | **미확정(증거 없음)** |
| Business profiler (a) | 네이티브 프로파일(wall·native CPU 등), OTel process context, crash·OOME 알림이 동작하지 않았다. JFR 기반 프로파일 업로드는 동작했다(`Upload done`). | 같은 컨테이너의 `business_public_failure` 10건(09:39:13~22Z, 내부 504/503 `UPSTREAM_TIMEOUT`·`SERVICE_UNAVAILABLE`)은 상류 Data 시간 초과·일시 실패로 기록됐다. profiler 오류(09:36:26~44Z, Spring 기동 전 premain)와 시각·경로가 다르다. | **업무 영향 증거 없음** |
| 전송 실패 (d) | trace Notification 2·Realtime 5·Data 1건 유실, 09:43:21Z 이후 수집 중단 | 같은 시각 앱 정지는 배포 quiesce와 그 뒤 배포 중단의 결과다. 전송 실패가 원인이 아니다. | profiler·telemetry 오류로 인한 업무 영향 **없음(증거 없음)**. 배포 중단에 따른 dev 정지는 별건(2571) |
| `Untrusted` 스크립트 (c) | 해당 JVM 실행 동안 crash·OOME 알림 미작동 | — | 업무 영향 없음 |

참고로 Datadog `status:error` 20건 중 실제 업무 실패는 0건이었다. 반대로 실제 업무 실패인 `business_public_failure`(앱 ERROR) 10건은 Datadog에 `status:info`로 저장됐다. Datadog error 건수로는 업무 실패를 셀 수 없다. 심각도 정정은 GROMO-2572 등 파이프라인 작업 범위다.

## 4. 원본 로그 보존 한계

| 원본 | 상태 | 사라지는 범위 |
| --- | --- | --- |
| 앱 Docker json-file(50m×4) | Business 111 KB, Notification 33 KB, Realtime 129 KB, Data 302 KB. 크기 회전과는 거리가 멀다. | 다음 배포가 컨테이너를 **재생성하면 로그 파일이 함께 지워진다**. 이번 profiler 원문(09:36~09:44Z)과 Data·Realtime의 02:56Z 이후 원문이 그렇다. 02:56Z 이전 Data·Realtime, 09:36Z 이전 Business·Notification 원문은 이미 없다(00:51 구간 앱 원본 없음 → Datadog으로만 확인). |
| Exporter json-file(10m×3) | 22.7 MB, 10-22 03:33Z부터 보존, 하루 약 3 MB(추정) | 10-29 줄은 현재 파일에 있다. 회전 2번 뒤 삭제된다. 추정 시점은 11-05~11-06이다. |
| 브로커 json-file(10m×3) | 파일 1개 3.0 MB, 09-23부터 | 당분간 안전하다. 컨테이너를 재생성하면 사라진다. |
| Datadog | Agent가 09:43:21Z부터 정지했다. 03:4x VM 무응답~03:55 재기동 사이에도 공백이 있다. | 정지 뒤 로그·trace·profile은 수집되지 않았다. Datadog 인덱스 보존 기간은 확인하지 않았다. |
| `docker events` | 메모리 링 버퍼가 health·exec 이벤트로 채워져 과거 범위 조회 결과가 0건이다. | 사용할 수 없다. journal의 dockerd 줄로 대체했다. |
| journal | 영구 저장(이전 부팅 조회 가능) | — |

이 조사에서 추출한 원문(비밀 제거)은 작업자 scratchpad에만 있다. 위 표의 원문 인용이 저장소에 남긴 사본이다.

## 5. 수정 여부와 이유

**수정함 — Business 프로파일러 임시 경로 분리** ([`docker-compose.satellites.yml`](../../../server/scripts/docker-compose.satellites.yml) `business-api`)

```yaml
DD_PROFILING_TEMPDIR: /ddprof
tmpfs: ['/tmp:size=64m,mode=1777', '/ddprof:size=64m,mode=1777,exec']
```

- `/tmp`는 외부 PDF 임시 파일 자리라 noexec를 유지한다. 실행 권한은 프로파일러 `.so`·JFR 임시 파일이 쓰는 `/ddprof`에만 준다. 로컬 재현 F에서 A의 오류 5건이 0건이 됐다. idle 80초 동안 `/ddprof` 사용량은 1.8 MB(`.so` 1.3 MB + JFR 0.4 MB)였다. 실제 부하에서는 JFR 청크가 더 커질 수 있어 `/tmp`와 같은 64 MiB를 잡았다(tmpfs는 쓴 만큼만 메모리를 쓴다).
- **보안 절충**: read-only 루트에서 쓰기와 실행이 함께 되는 자리가 하나 생긴다. 리뷰어가 이 절충을 받아들이지 않으면 이 두 줄을 되돌린다. 그러면 현행 상태(JFR 프로파일만, crash·OOME 알림 없음)로 돌아가고, 오류 줄은 수집 단계 분류로만 다룬다.
- 비채택 대안: `/tmp`에 exec 추가(B)는 PDF 임시 파일 자리까지 실행이 열려 범위가 넓다. `DD_PROFILING_DDPROF_ENABLED=false`(E)는 OTel·crash tracking 실패가 남는다. 미리 푼 `.so`와 `DD_PROFILING_DDPROF_DEBUG_LIB` 조합은 프로파일러만 고치고 디버그용 키에 기대므로 채택하지 않았다.
- 서버 반영은 하지 않았다. 머지 뒤 다음 Satellite Dev CD가 Business를 재생성할 때 적용된다. 운영 실행 구성은 Infra 저장소에 있어 같은 설정인지 확인하지 않았다.

**수정 안 함**

- Kafka E/F: 원인이 미확정이고, F는 호스트 재부팅의 결과다. 설정 변경 근거가 없다.
- Realtime·Data `Untrusted` 스크립트: 배포가 컨테이너를 재생성하면 사라지고, 영향은 관측 기능뿐이다. 같은 컨테이너의 in-place 재시작에서만 생긴다.
- INFO·WARN 오분류: 심각도 파이프라인 작업(2572) 범위다.

## 6. 추가 확인 방법

| 미확정 | 확인 방법 |
| --- | --- |
| 원격 Business의 실제 `/tmp` 마운트 옵션 | 다음 정상 기동 뒤 `docker exec <business> sh -c 'grep " /tmp " /proc/mounts'`(읽기). 수정 반영 뒤에는 `/ddprof` 줄에 `noexec`가 없는지, 기동 로그에 `failed to map segment`가 0건인지 본다. |
| 호스트 비정상 종료 원인 | GCP 콘솔 serial port 출력·`gcloud compute operations list --filter=targetLink~gromo-dev-app`(reset·guest 이벤트)·Cloud Logging의 VM 이벤트를 03:30~03:55Z로 조회한다. |
| 03:55:34Z dockerd 재기동 주체 | 같은 시각 `journalctl _SYSTEMD_UNIT=google-guest-agent.service`, `/var/log/auth.log`의 root 세션, Actions 러너 서비스 로그(`runsvc.sh` 03:55:30 `Connected to GitHub`, 03:56:36 러너 설정 명령)를 대조한다. |
| 세그먼트 절단의 업무 영향 | data-api outbox의 03:30~03:52Z 전송 완료 기록과 `realtime-events` 오프셋 1786 이후 소비 기록을 대조한다. `realtime-v1` 그룹의 03:58 이후 첫 커밋 오프셋을 절단 전 커밋과 비교해 재처리 범위를 확인한다(읽기 전용 `kafka-consumer-groups --describe`). |
| Exporter E 반복 원인 | 브로커 `connections.max.idle.ms`·Exporter scrape 주기를 확인한다. E 발생 시각 전후 브로커 DEBUG 연결 종료 로그나 conntrack을 비교한다. |
| 09:38:57Z profile 업로드 broken pipe | `docker logs gromo-datadog-agent --since 2026-10-29T09:38:00Z --until 2026-10-29T09:39:30Z`로 trace-agent·profiling proxy 오류를 확인한다(컨테이너가 남아 있는 동안만 가능). |

## 증거 위치

- 원격 명령은 모두 읽기였다: `docker inspect`·`docker ps -a`·`docker logs --since/--until`·`docker image inspect`·`docker version`·`journalctl`(`--list-boots`·`-u docker`·`_COMM=sudo`·`-b -1`)·`last -x -F`·`uptime -s`·`timedatectl`·`cat /var/log/apt/history.log`. `docker events --since --until`도 조회했지만 결과는 0건이었다.
- GitHub: run 40788746756·40805894045·40849669595(Data API CI 공동 배포), 40850676594(Satellite Dev CD), ops-smoke 실행 목록.
- Datadog: `LogsApi.listLogs`·`aggregateLogs`, `SpansApi.aggregateSpans`(읽기).
- 이전 검증 증거: `/tmp/gromo-log-level-audit-20261029/exporter-real-errors.jsonl`, `host-audit.jsonl`. `recent-app-errors-result.json`은 잘린 결과라 분류에는 쓰지 않았다. §2.1은 전수 재조회 결과다.
- 비밀: 원격 sudo 기록에 러너 설정 토큰 문자열이 출력되어 작업 사본에서 지웠다. 문서·보고에는 남기지 않았다.
