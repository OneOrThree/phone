# dev 로그 수집 중단 타임라인과 복구 조건 (2026-10-29, GROMO-2571)

조사는 읽기 전용이다. Agent·앱·컨테이너 시작/중지/재시작, 배포, workflow dispatch, AWS 요청을 하지 않았다.
원격 조회는 GCP SSH(`sudo -n docker inspect/ps/logs`, `journalctl`, `last`, `systemctl is-active/show`), `gh run list/view`, `gh api` GET, Datadog MCP 읽기 도구뿐이다.

## 1. 한 줄 요약

- `gromo-datadog-agent`는 같은 시각에 멈춘 dev 컨테이너 6개 중 하나다. 6개는 모두 Data·Realtime 공동 배포 job이 중지 대상으로 고르는 집합과 같다.
- 그 job(`Data API CI` run 40849669595 → `Dev 공동 CD / Data·Realtime 공동 배포`)은 nginx 중지 확인에 실패해 종료했다. 중지한 서비스는 복원되지 않았다.
- 따라서 Agent 정지는 의도된 «수집 중단»이 아니라 배포 quiesce 단계의 부산물이다. 사람이 Agent만 따로 끈 증거는 없다.
- 조사 시점(10:49Z)에도 Agent·Data·Realtime·Business·Notification·postgres-exporter가 `Exited`, nginx가 `failed`다. 수집만이 아니라 dev 앱이 내려간 상태다.

## 2. 타임라인

| UTC | KST | 출처 | 사건 |
| --- | --- | --- | --- |
| 03:53:35 | 12:53:35 | `uptime -s`, `last` | VM 부팅(별도 사건: 12:48 무응답 → reset 복구). 컨테이너는 03:55:47 전후 재기동 |
| 09:26:39 | 18:26:39 | `gh run` 40849669595 | main push `72e436852`(#1388 GROMO-2563) → `Data API CI` 시작 |
| 09:34:18~09:39:39 | 18:34~18:39 | `gh run` 40850676594 | `Satellite Dev CD` 성공(deploy job: self-hosted `gromo-dev-app`, 09:34:32~09:39:32). Business·Notification만 교체, Agent는 이때 실행 중이어서 datadog overlay 포함 |
| 09:41:35 | 18:41:35 | job 123372233174, journal `runsvc.sh` | `Dev 공동 CD / Data·Realtime 공동 배포` 시작(러너 `gromo-dev-app`) |
| 09:42:46 | 18:42:46 | job 단계 7 | `DB 전환 및 Data·Realtime 공동 교체`(`deploy-core-dev.py`) 시작 |
| 09:43:05~09:43:08 | 18:43:05 | Agent 로그, journal | `catus-db-*` 임시 컨테이너 3개가 생성·종료(`postgres:16.14-alpine` pull 직후). Agent가 tailer 추가 |
| 09:43:10 | 18:43:10 | `journalctl _COMM=sudo` | `runner`가 `sudo /usr/bin/systemctl stop nginx` 실행 |
| 09:43:15 | 18:43:15 | journal nginx | `Stopping timed out. Terminating` → `Failed with result 'timeout'` → nginx 비정상 `failed` |
| 09:43:15 | 18:43:15 | journal dockerd | 6개 컨테이너에 `stopping restart-manager`(docker stop 시작): datadog-agent, data-api, business-api, realtime, postgres-exporter, notification |
| 09:43:16 | 18:43:16 | Agent 로그 | Agent 종료 절차 시작(logs-agent, tailer 10개 중지). 종료 신호 종류를 로그가 밝히지 않음 |
| 09:43:16.19 | 18:43:16 | `docker inspect` | postgres-exporter 종료(ExitCode=2) |
| 09:43:17 | 18:43:17 | Datadog | dev 로그 마지막 수신(realtime 09:43:17.047, business 09:43:16.861, notification 09:43:16.823, kafka 09:43:16.468) |
| 09:43:18 | 18:43:18 | `docker inspect` | business-api 종료(143, SIGTERM) |
| 09:43:21 | 18:43:21 | `docker inspect` | Agent 종료. ExitCode=0, OOMKilled=false. 로그 `AGENT EXITED WITH CODE 0, SIGNAL 0` |
| 09:44:16 | 18:44:16 | `docker inspect` | notification·data-api·realtime 종료(137, 중지 시작 +60초 = `docker stop --time 60` 만료 후 SIGKILL) |
| 09:44:17 | 18:44:17 | `journalctl _COMM=sudo` | `runner`가 `systemctl stop nginx` 재실행(`deploy-core-dev.py`의 실패 처리 `stop()`) |
| 09:44:18 | 18:44:18 | job 로그 | `일부 서비스 중지에 실패했습니다…`, `공동 배포 중단: nginx가 완전히 중지되지 않았습니다.` exit 1 → job `failure`(09:44:37 종료) |
| 10:49:22 | 19:49:22 | `systemctl`, `docker ps -a` | nginx `failed`(InactiveEnter 09:43:15). 위 6개 `Exited`. db·redis·kafka·prometheus·grafana 등은 `Up` |

`docker events`는 09:30~10:00Z 범위에서 아무것도 돌려주지 않았다(데몬 이벤트 버퍼 한계로 추정, 미확인). 그래서 kill/stop/die 이벤트 원본은 증거에 없다.

## 3. 판정

### 확정(직접 증거)

- 메커니즘: Agent는 외부에서 중지 요청을 받아 정상 종료 절차를 밟았다(크래시·OOM 아님). 근거: ExitCode=0, OOMKilled=false, 정상 종료 로그, `restart-manager` 중지 로그, `RestartPolicy`가 재기동하지 않은 상태.
- 동시성: 중지된 컨테이너는 data-api, realtime, business-api, notification, postgres-exporter, datadog-agent로 `deploy-core-dev.py`의 `QUIESCE_SERVICES`/`QUIESCE_NAMES`와 일치한다. db·redis·business-redis·kafka·prometheus·grafana는 중지되지 않았다.
- 실행 주체(워크플로): 같은 구간에 `Dev 공동 CD` job이 dev VM 러너(`gromo-dev-app`, 사용자 `runner`)에서 돌았고, `runner`의 `sudo systemctl stop nginx`가 09:43:10에 기록됐다. 스크립트는 nginx 중지 직후 `docker stop --time 60`을 호출하도록 작성돼 있다(`72e436852`의 `deploy-core-dev.py` `stop()`).
- 복원 실패 원인(1차): nginx 중지가 시간 초과로 `failed`가 됐고 스크립트가 `ActiveState != inactive`로 판정해 중단했다. `except` 경로의 `stop()` 재시도도 같은 이유로 실패했고, 스크립트는 `restore()`로 가지 않는다. 같은 날 11:38~12:03 KST 의 같은 유형 사건(티켓 2561)과 같은 증상이다.
- 푸시 대상 workflow: push 주체 `joejaeyoung`(main push `72e436852`, #1388).

### 미확정

- `docker stop` 호출 자체의 호출자 로그는 없다. docker 데몬은 호출한 사용자·프로세스를 기록하지 않는다. «이 job이 호출했다»는 시각·대상 집합·스크립트 코드의 일치에 근거한 강한 정황이며, 직접 기록이 아니다. 같은 시각에 사람이 동일한 6개를 직접 `docker stop` 했을 가능성을 증거만으로는 배제할 수 없다. 다만 `last -F`에 09:00~09:45Z 사람 SSH 세션이 없고(최근 세션 07:05~07:25Z `lappel10`), 외부 sshd 로그에는 스캔 시도(preauth 실패)만 있다.
- nginx 중지 시간 초과의 근본 원인(웹소켓 접속 유지 등). 같은 날 11:38 KST 의 유사 사건(티켓 2561)은 웹소켓 접속 중 시간 초과로 기록됐으나, 이번 사건의 nginx 로그로 재확인하지 않았다.
- 의도 여부: 배포 자체는 의도된 main 머지의 결과이며, 수집 중단을 의도한 증거는 없다.
- `postgres-exporter`가 ExitCode=2인 이유(stop 중 신호 처리인지 별개 오류인지).
- Datadog에 `data-api` 서비스 로그가 조회 결과에 없다. 이 조회 범위(`host:gromo-dev*`, 09~11Z)에서 서비스 7종만 나왔다. 호스트 태그·서비스명이 다를 가능성이 있어 별도 확인이 필요하다.
- 모니터: 조회에 보이는 모니터가 0건이다(권한·계정 범위 때문일 수 있음). «no data» 알림이 울렸는지 판정할 수 없다.

### 추가 확인 방법

1. 러너 진단 로그 `/opt/actions-runner/_diag/Worker_*.log`에서 job 123372233174 시간대의 프로세스 실행 기록을 읽는다(읽기).
2. `auditctl`/`auditd`가 켜져 있으면 `docker stop` 호출자를 조회한다(꺼져 있으면 없음).
3. dev 운영 담당자·팀에게 09:43Z(18:43 KST)에 Agent나 컨테이너를 수동으로 만졌는지 묻는다.
4. job 123372233174 전체 로그(`gh api repos/OneOrThree/phone/actions/jobs/123372233174/logs`)에서 스크립트 출력 전문을 확인한다. 현재 단계 7은 stdout을 거의 남기지 않는다.
5. Datadog 호스트 태그와 서비스 목록으로 data-api 로그 유무를 확인하고, 모니터 조회 권한을 가진 계정으로 모니터 목록을 다시 본다.

## 4. 증거 위치

- 이 조사의 원격 조회 결과: 조정자 scratchpad `.../scratchpad/2571/`(`agent.txt`, `agent2.txt`, `ps.txt`, `journal.txt`, `tail.txt`, `job.log`, `deploy-core-dev.py`). 비밀 값은 저장하지 않았다.
- 이전 점검: `/tmp/gromo-log-level-audit-20261029/host-audit.jsonl`, `followup-coordinator-notes.md`(`ops-datadog.dev`·`ops-monitor.dev` 최근 실행 없음).
- GitHub: `Data API CI` run 40849669595, job 123372233174, `Satellite Dev CD` run 40850676594.
- 코드: `.github/scripts/deploy-core-dev.py`(`QUIESCE_SERVICES`, `stop()`, `restore()`, `deploy()`), `.github/workflows/data-api-cd.dev.yml`.

## 5. 운영 절차

### 5.1 수집 재개 전제

수집 재개는 «Agent만 켜기»가 아니라 dev 복구의 일부다. 아래를 모두 만족해야 한다.

1. 승인: dev 운영 담당자가 재개를 명시한다. 이 문서의 조사는 재개 승인이 아니다.
2. 선행 상태 확인: `systemctl show -p ActiveState nginx`, `docker ps -a`, `free -m`, `uptime`, `df -h /var/lib/docker`로 VM 용량·부하를 확인한다. dev VM 은 과부하(swap·kafka/monitor 상주) 전력이 있다(10-23~ 스모크 timeout, 10-29 12:48 무응답 → reset). 여유가 없으면 재개하지 않는다.
3. 먼저 배포 중단 상태를 정리한다. nginx가 `failed`이고 앱이 내려가 있으므로 수집만 켜면 수집할 로그가 없다. 복구 경로는 `server/scripts/README.md`와 GROMO-2561(nginx 중지 시간 초과 수정)을 따른다. 이 문서는 해당 절차를 대체하지 않는다.
4. 재개 명령은 저장소 경로만 쓴다: `.github/workflows/ops-datadog.dev.yml`(`action: up` 또는 `restart`), 앱·nginx 복구는 `ops-redeploy.dev.yml`/`data-api-cd.dev.yml`의 수동 복구 입력. 이번 조사에서는 실행하지 않았다.
5. 공동 배포 job이 같은 시각에 돌고 있지 않은지 `gh run list`로 확인한다(경합 방지).
6. **3~4번 실행 전에 5.1a 로 중단 구간 원본 로그를 먼저 확보한다.** 복구가 컨테이너를 교체하면 원본이 사라진다.

### 5.1a 복구 전 원본 로그 확보 (재개 절차의 첫 단계)

`deploy-core-dev.py` 의 복구 경로는 `up -d --no-deps --force-recreate data-api realtime`(`.github/scripts/deploy-core-dev.py:321`)으로 Data·Realtime 컨테이너를 새로 만든다. 컨테이너가 교체되면 그 컨테이너의 `json-file` 로그(`docker logs` 원본)도 함께 사라진다. 중지된 `Exited` 컨테이너가 남아 있는 지금이 중단 구간 원본을 얻을 마지막 기회다. Agent 도 `ops-datadog.dev.yml:119-120` 에서 `--force-recreate` 로 교체되므로 같다.

복구 승인 전에, 복구와 다른 시각에 컨테이너별로 사본을 만든다(읽기 전용, 쓰기 위치는 VM 의 비밀 없는 임시 디렉터리):

```
sudo docker logs --timestamps --since 2026-10-29T09:30:00Z --until <확보 시각 UTC> <컨테이너> > <디렉터리>/<컨테이너>.log 2>&1
```

대상: `data-api`, `realtime`, `business-api`, `notification`, `gromo-datadog-agent`, postgres-exporter. 사본이 비어 있으면 그 사실과 `docker inspect -f '{{.LogPath}}'` 의 파일 크기를 함께 기록한다. 로테이션(아래 표)으로 이미 밀려난 구간은 사본에도 없다. 5.2 의 복구 뒤 비교는 이 사본을 «원본»으로 쓴다.

### 로그 회전 설정(`json-file`)

| 대상 | 설정 | 근거 |
| --- | --- | --- |
| 앱: data-api | `max-size 50m` × `max-file 4` | `server/scripts/docker-compose.dev.yml:13-15,22` |
| 앱: realtime | `50m` × `4` | `docker-compose.realtime.yml:22-24,64` |
| 앱: business-api, notification | `50m` × `4` | `docker-compose.satellites.yml:6-8,36,91` (Business 단독 overlay `docker-compose.business.yml:4-6,47`) |
| 인프라: db, redis | `10m` × `3` | `docker-compose.dev.yml:16-18,67,99` |
| 인프라: business-redis | `10m` × `3` | `docker-compose.satellites.yml:9-11,15` |
| 인프라: realtime-db-init | `10m` × `3` | `docker-compose.realtime.yml:25-27,42` |
| 인프라: kafka | `10m` × `3` | `docker-compose.kafka.yml:19-21,25` |
| 인프라: gromo-datadog-agent | `10m` × `3` | `docker-compose.datadog.yml:13-15,19` |
| 인프라: 관측 스택(Prometheus·Grafana 등) | `10m` × `3` | `docker-compose.observability.yml:12-14` |

요약은 `server/scripts/README.md:140-141`(앱 컨테이너당 200 MB, 인프라 30 MB). postgres-exporter 는 `docker-compose.observability.yml:102-103` 에서 인프라 설정(`10m` × `3`)이다. 참고: Datadog 은 `gromo-datadog-agent`·`gromo-postgres-exporter` 등의 로그를 수집에서 제외한다(`docker-compose.datadog.yml:40` `DD_CONTAINER_EXCLUDE_LOGS`) — 두 컨테이너는 5.2 의 Datadog 비교 대상이 아니다.

### 5.2 재개 뒤 최신 로그 유입 검증

«건수가 늘었다»가 아니라 «원본의 최신 시각이 Datadog에 도달했다»로 판정한다.

1. 원본 최신 시각: `sudo docker logs <컨테이너> --since 10m --timestamps | tail -1`(서비스별). 결과가 비어 있으면 **판정 불가**다(아래 «유휴 서비스»). 5.1a 사본과 비교할 때는 `--since`/`--until` 로 같은 구간을 자른다.
2. Datadog 최신 시각 — 아래 둘 중 하나(`SELECT … FROM logs GROUP BY` 는 Logs Explorer 검색창에서 실행되지 않는다).
   - Logs Explorer UI: 검색식 `host:gromo-dev* service:<서비스>`, 시간 범위 «Past 15 minutes», 목록을 `Date` 내림차순으로 정렬해 맨 위 행의 시각을 읽는다. 건수는 같은 검색식에서 Visualize 를 «Timeseries/Table», Group by `service`(또는 `container_name`), 측정 `Count` 로 본다.
   - Logs API: 키는 환경변수(`DD_API_KEY`, `DD_APP_KEY`, `DD_SITE`)로만 넣고 값을 출력하지 않는다. 최신 시각은 `POST https://api.${DD_SITE}/api/v2/logs/events/search`, 본문 `{"filter":{"query":"host:gromo-dev* service:<서비스>","from":"now-15m","to":"now"},"sort":"-timestamp","page":{"limit":1}}` 의 첫 이벤트 `timestamp` 다. 구간별 건수는 `POST https://api.${DD_SITE}/api/v2/logs/analytics/aggregate`, 본문 `{"filter":{"query":"host:gromo-dev*","from":"<시작>","to":"<끝>"},"compute":[{"aggregation":"count","type":"total"}],"group_by":[{"facet":"service","limit":20}]}`. 헤더는 `DD-API-KEY: $DD_API_KEY`, `DD-APPLICATION-KEY: $DD_APP_KEY`. (경로·본문은 이 환경에서 공식 문서에 접속하지 못해 기억 기준으로 적었다 — 실행 전에 Datadog API 문서의 Logs 절과 대조한다.)
   - SQL(DDSQL)은 «Datadog MCP `analyze_datadog_logs` 로 조사할 때»에만 쓴다(예: `SELECT service, max(timestamp) FROM logs GROUP BY service`).
3. 판정: 서비스마다 `원본 최신 - Datadog 최신 < 2분`이면 정상. 2분 이상이면 지연·누락으로 기록한다.
4. 중단 구간(09:43:17Z~재개 시각)은 Agent가 `container_collect_all` 파일 tailer로 다시 읽을 수 있다. 다만 json-file 로테이션(위 표)에 밀려난 로그는 복구되지 않고, 5.1a 를 건너뛰고 컨테이너가 교체됐다면 원본 자체가 없다. 복구 범위는 «Datadog에서 중단 구간 건수가 5.1a 사본의 건수와 같은가»로 별도 확인한다.

### 유휴 서비스 — 빈 결과는 수집 실패가 아니다

복구 뒤 10분 이상 로그가 없는 서비스는 `docker logs --since 10m` 이 비어 «최신 원본 시각»을 못 구한다. 근거: dev 저트래픽 구간에는 앱이 idle 이고 `/health` 는 로그를 남기지 않는다(`.github/workflows/ops-datadog.dev.yml:188-190`). 요청 단위 access log 도 앱에 없다(`server/data-api/src/main/resources/logback-spring.xml:119` 가 TODO 로 남아 있음).

- 원본 결과가 비어 있으면 그 서비스는 **판정 불가**로 기록한다. 통과도 실패도 아니다. `--since` 를 늘려(예: 1h) 마지막 줄이 있으면 그 시각으로 비교하고, 없으면 판정 불가 그대로 둔다.
- 검증용 로그를 만들어야 할 때의 절차(**이번에 실행하지 않는다**, 재개 승인 뒤에만):
  - Agent tailer 자체: `ops-datadog.dev.yml:188-200` 이 쓰는 방식 — `alpine:3.20` 프로브 컨테이너가 5초마다 `GROMO-1489 collection probe N` 을 14회 출력한다. 앱이 아니라 수집기 점검이다.
  - 앱 서비스별로 요청 한 번에 반드시 로그를 남기는 엔드포인트: 코드로 확인한 것은 business-api 뿐이다 — 외부 요청에 `X-User-Id` 헤더가 있으면 `log.warn("외부 사용자 신원 헤더를 폐기했다")`(`server/business-api/src/main/java/com/oneorthree/business/config/RequestEnvelopeFilter.java:55-56`). 이 필터가 적용되는 경로·dev 로그 레벨은 실행 전에 확인한다.
  - data-api: 요청마다 남는 엔드포인트 **없음**(access log 미구현, 위 TODO). 오류 처리 경로의 `log.warn`(`GlobalExceptionHandler.java:103` 등)은 오류를 일부러 만들어야 해서 검증용으로 쓰지 않는다.
  - realtime: WebSocket 연결 시 `websocket_connection` info 한 줄(`server/realtime/src/main/java/com/oneorthree/realtime/config/WebSocketConnectionDiagnostics.java:127`). 유효한 인증 연결이 필요하다.
  - notification: 요청 단위 로그 **없음**(발송 시에만 `DispatchService.java:737,750`).
  - 위 방법이 없거나 위험하면 «없음»으로 두고 판정 불가로 마감한다. 2556 의 Fluent Bit canary(60초마다 `service=canary`)는 Loki·S3 경로용이라 Datadog Agent 수집 판정에는 쓸 수 없다. Datadog 쪽 저트래픽 판정 수단(합성 로그 주기 발행 등)은 아직 없다 — 후속 과제.

### 5.3 건수 판정 규칙

- 재개 직후의 건수 증가를 복구로 보지 않는다. 지연 전송(backfill)과 신규 로그가 섞인다.
- 중단 구간 안의 시각(`timestamp`)으로 센 건수만 누락 평가에 쓴다.
- 서비스가 하나라도 «원본 최신 - Datadog 최신» 기준을 못 넘으면 전체 복구로 부르지 않는다.

### 5.4 의도된 중지 시 알림 취급

- 사전에 모니터 downtime/mute를 걸고, 건 사람·사유·시작·종료 시각을 이 폴더 또는 Jira에 기록한다.
- 공지: 개발 채널에 중지 사유·예상 시간·복구 담당을 알린다.
- 이번 사건 기준: 조회 가능한 모니터가 0건이었으므로 «no data» 모니터가 있는지부터 확인해야 한다. 없다면 로그 미수신 감시 자체가 비어 있다(후속 후보).
- 중지가 끝나면 downtime을 해제하고 5.2 검증을 기록한다.

### 5.5 롤백(재개가 문제를 일으킬 때)

1. 증상 기준: dev VM 메모리·swap 급증, 앱 health 악화, Agent 재시작 반복.
2. 중지: `ops-datadog.dev.yml` `action: down`. 직접 `docker stop`은 쓰지 않는다(경합).
3. 기록: 시작·중지 시각(UTC/KST), 판단 근거(지표 값), 실행한 사람, run id를 남긴다.
4. 이후 5.1의 용량 확인을 다시 통과하기 전에는 재개하지 않는다.
