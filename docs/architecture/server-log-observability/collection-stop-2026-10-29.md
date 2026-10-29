# dev 로그 수집 중단 타임라인과 복구 조건 (2026-10-29, GROMO-2571)

조사는 읽기 전용이다. Agent·앱·컨테이너 시작/중지/재시작, 배포, workflow dispatch, AWS 요청을 하지 않았다.
원격 조회는 GCP SSH(`sudo -n docker inspect/ps/logs`, `journalctl`, `last`, `systemctl is-active/show`), `gh run list/view`, `gh api` GET, Datadog MCP 읽기 도구뿐이다.

## 1. 한 줄 요약

- `gromo-datadog-agent`는 같은 시각에 멈춘 dev 컨테이너 6개 중 하나다. 6개는 모두 Data·Realtime 공동 배포 job이 중지 대상으로 고르는 집합과 같다.
- 그 job(`Data API CI` run 40849669595 → `Dev 공동 CD / Data·Realtime 공동 배포`)은 nginx 중지 확인에 실패해 종료했다. 중지한 서비스는 복원되지 않았다.
- 따라서 Agent 정지는 의도된 «수집 중단»이 아니라 배포 quiesce 단계의 부산물로 보는 것이 가장 부합한다(호출자 로그 없음, §3). 사람이 Agent만 따로 끈 증거는 없다.
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
| 09:43:10 | 18:43:10 | `journalctl _COMM=sudo` | `runner`가 `sudo /usr/bin/systemctl stop nginx` 실행. 이 job 은 main push `72e436852`(#1388, push 주체는 그 커밋 작성자)로 시작됨 |
| 09:43:15 | 18:43:15 | journal nginx | `Stopping timed out. Terminating` → `Failed with result 'timeout'` → nginx 비정상 `failed`. 중지 시도부터 5초 만이며 unit 의 `TimeoutStopSec=5`(실측, §3 미확정 1)와 일치 |
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

`docker events`는 09:30~10:00Z 범위에서 아무것도 돌려주지 않았다(이벤트 버퍼 한계 여부는 미확인, §3 미확정 5). 그래서 kill/stop/die 이벤트 원본은 증거에 없다.

## 3. 판정

### 확정(직접 증거)

- 메커니즘: Agent는 크래시·OOM이 아니라 외부 중지 요청으로 정상 종료했다. 직접 증거는 `ExitCode=0`, `OOMKilled=false`, 같은 6개 컨테이너에 찍힌 dockerd `stopping restart-manager`(09:43:15) 로그뿐이다. (보조 정황: Agent 의 정상 종료 로그, `RestartPolicy=unless-stopped` 가 명시 중지 뒤 재기동하지 않는 동작 — 이것만으로 외부 중지를 입증하지는 못한다.)

### 확정(정황 일치)

시각·집합의 일치에 근거한 정황이다. 호출자의 직접 기록은 없다(미확정 2).

- 동시성: 중지된 컨테이너는 data-api, realtime, business-api, notification, postgres-exporter, datadog-agent로 `deploy-core-dev.py`의 `QUIESCE_SERVICES`/`QUIESCE_NAMES`와 일치한다. db·redis·business-redis·kafka·prometheus·grafana는 중지되지 않았다.
- 실행 시각 일치: 같은 구간에 `Dev 공동 CD` job이 dev VM 러너(`gromo-dev-app`, 사용자 `runner`)에서 돌았고, `runner`의 `sudo systemctl stop nginx`가 09:43:10에 기록됐다. 스크립트는 nginx 중지 직후 `docker stop --time 60`을 호출하도록 작성돼 있다(`72e436852`의 `deploy-core-dev.py` `stop()`).

### 확정(직접 증거) — 복원 실패 원인

- 복원 실패 원인(1차): nginx 중지가 시간 초과로 `failed`가 됐고 스크립트가 `ActiveState != inactive`로 판정해 중단했다. `except` 경로의 `stop()` 재시도도 같은 이유로 실패했고, 스크립트는 `restore()`로 가지 않는다.
- 참고: 같은 날 11:38~12:03 KST 에 티켓 2561 의 유사 사건(dev 공동 배포 중 nginx 중지 시간 초과)이 있었다. 원인 동일성은 미확인이다.

### 미확정과 추가 확인 방법(번호가 짝)

| # | 미확정 | 확인 방법 | 지금까지 확인한 것 |
| --- | --- | --- | --- |
| 1 | nginx 중지 시간 초과의 근본 원인 | nginx access/error 로그의 09:43Z 전후, 열린 연결·웹소켓 접속 여부 | 읽기 조회함: `systemctl show nginx -p TimeoutStopUSec` = `5s`. unit 에 `TimeoutStopSec=5`, `ExecStop=start-stop-daemon --retry QUIT/5` 가 있어 종료 제한 시간은 5초다(`ExecStop` 의 `--retry QUIT/5` 가 이 5초 안에 소진됐을 수 있다). 5초 만의 실패는 짧은 설정 탓이며 연결이 많았는지는 확인 못 했다 |
| 2 | `docker stop` 호출자 | (a) 러너 `/opt/actions-runner/_diag/Worker_*.log` 의 job 123372233174 시간대 기록, (b) `auditd` 가 켜져 있으면 호출자 조회, (c) dev 운영 담당자에게 09:43Z 수동 조작 여부 질의, (d) job 전체 로그(`gh api repos/OneOrThree/phone/actions/jobs/123372233174/logs`, 단계 7 은 stdout 이 거의 없음) | 호출자 직접 기록 없음(docker 데몬은 호출자를 기록하지 않는다). 시각·대상 집합·코드 일치의 강한 정황이다. `last -F` 에 09:00~09:45Z 사람 SSH 세션 없음(최근 세션 07:05~07:25Z 운영자 계정), sshd 로그에는 스캔 시도(preauth 실패)만 있음(`last -F` 발췌는 부록 A) |
| 3 | 의도 여부 | 2-(c) 와 같다 | 배포 자체는 의도된 main 머지의 결과이며 수집 중단을 의도한 증거는 없다 |
| 4 | postgres-exporter ExitCode=2 의 이유 | 종료 시각 전후 dockerd·컨테이너 로그 | 읽기 조회함: `FinishedAt=09:43:16.190Z`, `docker logs` 마지막 줄은 03:56:17Z 의 정상 줄이고 종료·오류 줄이 없다(부록 A). 신호 처리인지 별개 오류인지 **여전히 미확정** |
| 5 | `docker events` 빈 결과 | `docker info` 의 이벤트 설정, `journalctl -u docker` | 이벤트 버퍼 한계 여부 미확인 |
| 6 | 모니터 «no data» 알림 | 모니터 조회 권한이 있는 계정으로 목록 확인 | 조회 가능한 모니터 0건(권한·계정 범위 가능). 판정 불가 |

해소됨: Datadog 에 `data-api` 로그가 없어 보였던 것은 서비스명 차이였다. 서비스명은 `data-api` 가 아니라 `gromo-back-dev` 이며 06:00~09:43Z 에 225건이 수집돼 있었다(사건 이전에도 수집 중).

## 4. 증거 위치

- 증거 원본은 조정자 임시 폴더에 있어 팀원이 열 수 없다. 핵심 발췌를 문서 끝 «부록 A»에 붙였다. 비밀 값과 개인 계정명은 제외했다.
- GitHub: `Data API CI` run 40849669595, job 123372233174, `Satellite Dev CD` run 40850676594.
- 코드: `.github/scripts/deploy-core-dev.py`(`QUIESCE_SERVICES`, `stop()`, `restore()`, `deploy()`), `.github/workflows/data-api-cd.dev.yml`.

## 5. 운영 절차

### 5.1 수집 재개 전제

수집 재개는 «Agent만 켜기»가 아니라 dev 복구의 일부다. 번호 순서대로 진행하며, **되돌릴 수 없는 단계(컨테이너 교체)보다 5.1a 가 앞선다.**

1. 승인: dev 운영 담당자가 재개를 명시한다. 이 문서의 조사는 재개 승인이 아니다.
2. **5.1a 로 중단 구간 원본 로그 사본을 먼저 확보한다.** 어느 복구 경로를 고르든 선행이다.
3. 선행 상태 확인: `systemctl show -p ActiveState nginx`, `docker ps -a`, `free -m`, `uptime`, `df -h /var/lib/docker`로 VM 용량·부하를 확인한다. dev VM 은 과부하(swap·kafka/monitor 상주) 전력이 있다(10-23~ 스모크 timeout, 10-29 12:48 무응답 → reset). 여유가 없으면 재개하지 않는다.
4. 공동 배포 job이 같은 시각에 돌고 있지 않은지 `gh run list`로 확인한다(경합 방지).
5. 복구 경로를 고른다(아래 비교). 이 문서는 `server/scripts/README.md` 와 GROMO-2561(nginx 중지 시간 초과 수정)의 절차를 대체하지 않는다.
6. nginx 가 `failed` 인 점: 스크립트의 nginx 시작은 `sudo -n <NGINX_SYSTEMCTL> start nginx` 뒤 `systemctl is-active` 만 확인한다(`.github/scripts/deploy-core-dev.py` `deploy()`). systemd 는 `failed` 유닛을 `start` 로 다시 시작할 수 있어 `reset-failed` 는 상태 표시 정리용이며 보통 필수가 아니다. 다만 시작 횟수 제한(`StartLimitBurst`)에 걸려 있으면 `reset-failed` 가 필요하다. 이는 코드와 systemd 일반 동작에 근거한 판단이고 이 VM 에서 실행해 확인하지 않았다(미검증). 러너 sudoers 허용 범위가 `reset-failed` 를 포함하는지도 확인 전이다. 복구 경로(`--recovery-only`)는 별개다: `deploy-core-dev.py:197-198` 이 nginx `ActiveState` 가 `inactive` 가 아니면 «새 이미지로 재개하려면 nginx가 완전히 중지되어 있어야 합니다.» 로 중단한다. 지금 nginx 는 `failed` 라 복구 경로는 시작 전에 막힌다. `systemctl reset-failed nginx` 등으로 `inactive` 로 만든 뒤 실행해야 하며, 러너 sudoers 허용 여부는 확인 전이고 이 VM 에서 미검증이다. 티켓 2561 수정이 이 문제를 다루는지는 저장소에서 확인하지 못했다(2561 수정 범위 미확인).
7. 재개 명령은 저장소 경로만 쓴다: workflow `Dev Datadog (APM + Observability)`(`.github/workflows/ops-datadog.dev.yml`)의 입력 `action: up` 또는 `restart`. 앱·nginx 복구는 workflow `Data·Realtime Dev CD`(`.github/workflows/data-api-cd.dev.yml`)를 `workflow_dispatch` 로 실행하며 입력은 `image_digest`(Data), `realtime_image_digest`(Realtime), `image_revision`(main 40자 SHA, 미완료 current DB 복구 전용)이다. 이 경로는 `--recovery-only` 로 돈다(`data-api-cd.dev.yml:125-127`). `ops-redeploy.dev.yml` 은 SM 시크릿 재적용용이라 이 복구와 다르다. 이번 조사에서는 실행하지 않았다. 선행 조건: 위 6번대로 nginx 가 `inactive` 여야 이 복구 경로가 시작된다.

#### 복구 경로 비교

| 경로 | 동작 | 로그 | 근거 |
| --- | --- | --- | --- |
| 수동 `docker start <컨테이너>` 직접 실행 | 기존 `Exited` 컨테이너를 그대로 시작한다. 컨테이너 ID 가 같다. 스크립트·nginx·DB 확인을 거치지 않는다 | `json-file` 로그가 보존된다 | docker 일반 동작. 이 VM 에서 실행해 확인하지 않았다(미검증) |
| 스크립트 복구 경로(`Data·Realtime Dev CD` 수동 실행 = `--recovery-only`) | 실패 시 `except` 가 `stop()` 재시도 후 `save('failed')`(`deploy-core-dev.py:334-341`)하고 원래 실행 중이던 목록을 `state['running']` 에 남긴다(저장 함수 `:145`, 호출 `:340`). `--recovery-only` 는 미완료 상태·writer 전부 중지·nginx `inactive`·current DB·다른 DB 연결 0 을 요구한다(`:184-198`, `:247-249`). 통과하면 `deploy()`(`:311`)가 다시 `database`→`apply`(`:317-318`)→Data·Realtime `--force-recreate`(`:321`)→`restore()`(`:278`)를 진행한다 | Data·Realtime 은 교체돼 이전 로그가 사라지고, `restore()` 가 `CORE` 를 건너뛰고 `docker start` 하는 위성·관측만 보존된다 | `deploy-core-dev.py:278-291,311-341`. `failed` 상태에서 `runner('apply')` 를 다시 호출하는 것은 코드상 확인했다. **그 apply 가 current DB 에서 변경 없는 no-op 인지는 DB runner(`deploy-v0.py`)를 읽지 않아 미확인** |
| 재배포(`--force-recreate`) | 컨테이너를 새로 만든다. 새 ID | 이전 컨테이너의 로그는 사라진다 | `deploy()` 의 `up -d --no-deps --force-recreate data-api realtime`(`:321`), `ops-datadog.dev.yml:119-120` `restart` 분기의 `--force-recreate datadog-agent`/`data-api` |

`deploy-core-dev.py` 는 Data·Realtime 을 항상 `--force-recreate` 로 교체하고 위성·관측만 `docker start` 한다. «Data·Realtime 을 건너뛰고 나머지만 `docker start`» 하는 동작은 `restore()` 안에서 `deploy()` 의 교체 뒤에만 일어나며 스크립트 단독 경로가 아니다. 따라서 이 스크립트 경로로는 Data·Realtime 의 중단 구간 원본이 사라지고 나머지는 보존된다. 어느 쪽이든 5.1a 사본이 먼저다.

### 5.1a 복구 전 원본 로그 확보 (재개 절차 2번)

컨테이너가 교체되면 그 컨테이너의 `json-file` 로그(`docker logs` 원본)도 함께 사라진다. 중지된 `Exited` 컨테이너가 남아 있는 지금이 중단 구간 원본을 얻을 마지막 기회다.

복구 승인 전에, 복구와 다른 시각에 컨테이너별로 사본을 만든다(읽기 전용, 쓰기 위치는 VM 의 비밀 없는 임시 디렉터리):

```
sudo docker inspect -f '{{.Name}} FinishedAt={{.State.FinishedAt}} LogPath={{.LogPath}}' <컨테이너>   # 사본이 종료 시각까지 닿았는지 판정용
sudo docker logs --timestamps --since 2026-10-29T09:30:00Z --until <확보 시각 UTC> <컨테이너> > <디렉터리>/<컨테이너>.log 2>&1
```

`2>&1` 은 stdout·stderr 를 섞어 시각 정렬이 흐트러질 수 있다. 권장은 `> <컨테이너>.out.log 2> <컨테이너>.err.log` 로 나눠 저장하는 것이다.

대상: `data-api`, `realtime`, `business-api`, `notification`, `gromo-datadog-agent`, postgres-exporter. `State.FinishedAt` 을 사본과 함께 기록하고 사본 마지막 줄 시각이 거기에 닿는지 비교한다. 사본이 비어 있으면 그 사실과 `LogPath` 파일 크기를 함께 기록한다. 로테이션(아래 표)으로 밀려난 구간은 사본에도 없다. 5.2 의 복구 뒤 비교는 이 사본을 «원본»으로 쓴다.

### 로그 회전 설정(`json-file`)

줄 번호는 낡기 쉬워 서비스 키와 `logging` 앵커 이름으로 적는다(`x-app-logging`, `x-infra-logging` 은 각 compose 파일 상단 정의).

| 대상 | 설정 | 근거 |
| --- | --- | --- |
| 앱: data-api | `max-size 50m` × `max-file 4` | `docker-compose.dev.yml` 의 `data-api` → `*app-logging` |
| 앱: realtime | `50m` × `4` | `docker-compose.realtime.yml` 의 `realtime` → `*app-logging` |
| 앱: business-api, notification | `50m` × `4` | `docker-compose.satellites.yml` → `*app-logging` (Business 단독 `docker-compose.business.yml` 도 같음) |
| 인프라: db, redis | `10m` × `3` | `docker-compose.dev.yml` → `*infra-logging` |
| 인프라: business-redis | `10m` × `3` | `docker-compose.satellites.yml` → `*infra-logging` |
| 인프라: realtime-db-init | `10m` × `3` | `docker-compose.realtime.yml` → `*infra-logging` |
| 인프라: kafka | `10m` × `3` | `docker-compose.kafka.yml` → `*infra-logging` |
| 인프라: gromo-datadog-agent | `10m` × `3` | `docker-compose.datadog.yml` → `*infra-logging` |
| 인프라: 관측 스택(Prometheus·Grafana·postgres-exporter 등) | `10m` × `3` | `docker-compose.observability.yml` → `*infra-logging` |

요약은 `server/scripts/README.md` 의 로그 회전 절(앱 컨테이너당 200 MB, 인프라 30 MB). 참고: Datadog 은 `gromo-datadog-agent`·`gromo-postgres-exporter` 등의 로그를 수집에서 제외한다(`docker-compose.datadog.yml` 의 `DD_CONTAINER_EXCLUDE_LOGS`) — 두 컨테이너는 5.2 의 Datadog 비교 대상이 아니다.

### 5.2 재개 뒤 최신 로그 유입 검증

**사전 조건(확인함):** data-api 는 사건 이전에도 Datadog 에 수집되고 있었다. 서비스명은 `gromo-back-dev` 이며 06:00~09:43Z 에 225건이 있었다(§3 «해소됨»). 컨테이너명 → Datadog 서비스명 대응이 필요하다: data-api→`gromo-back-dev`, business-api→`gromo-business-dev`, notification→`gromo-notification-dev`, realtime→`gromo-realtime-dev`(조회 결과 기준, 재개 후 다시 확인).

«건수가 늘었다»가 아니라 «원본의 최신 시각이 Datadog에 도달했다»로 판정한다.

1. 원본 최신 시각: `sudo docker logs <컨테이너> --since 1h --timestamps | tail -1`(서비스별). 결과가 비어 있으면 **판정 불가**다(아래 «유휴 서비스»). 5.1a 사본과 비교할 때는 `--since`/`--until` 로 같은 구간을 자른다.
2. Datadog 최신 시각 — 아래 둘 중 하나(`SELECT … FROM logs GROUP BY` 는 Logs Explorer 검색창에서 실행되지 않는다). **원본과 Datadog 모두 «마지막 한 줄» 기준으로 시간 창을 같게(둘 다 1h 이상) 잡는다.** 창이 어긋나면 로그가 드문 서비스에서 오판한다.
   - Logs Explorer UI: 검색식 `host:gromo-dev* service:<서비스>`, 시간 범위 «Past 1 hour», 목록을 `Date` 내림차순으로 정렬해 맨 위 행의 시각을 읽는다. 건수는 같은 검색식에서 Visualize 를 «Timeseries/Table», Group by `service`(또는 `container_name`), 측정 `Count` 로 본다.
   - Logs API **(미검증: 공식 문서 미대조)**: 키는 환경변수(`DD_API_KEY`, `DD_APP_KEY`, `DD_SITE`)로만 넣고 값을 출력하지 않는다. 최신 시각은 `POST https://api.${DD_SITE}/api/v2/logs/events/search`, 본문 `{"filter":{"query":"host:gromo-dev* service:<서비스>","from":"now-1h","to":"now"},"sort":"-timestamp","page":{"limit":1}}` 의 첫 이벤트 `timestamp` 다. 구간별 건수는 `POST https://api.${DD_SITE}/api/v2/logs/analytics/aggregate`, 본문 `{"filter":{"query":"host:gromo-dev*","from":"<시작>","to":"<끝>"},"compute":[{"aggregation":"count","type":"total"}],"group_by":[{"facet":"service","limit":20}]}`. 헤더는 `DD-API-KEY: $DD_API_KEY`, `DD-APPLICATION-KEY: $DD_APP_KEY`. (기억 기준이며 `compute`/`group_by` 형식은 특히 틀리기 쉽다 — 실행 전에 Datadog API 문서의 Logs 절과 대조한다.)
   - SQL(DDSQL)은 «Datadog MCP `analyze_datadog_logs` 로 조사할 때»에만 쓴다(예: `SELECT service, max(timestamp) FROM logs GROUP BY service`).
3. 판정: 서비스마다 `원본 최신 - Datadog 최신 < 2분`이면 정상. 2분 이상이면 지연·누락으로 기록한다. **`gromo-datadog-agent`·postgres-exporter 는 Datadog 수집 제외라 판정 대상이 아니다.**
4. 중단 구간(09:43:17Z~재개 시각)의 backfill 기대는 복구 방식에 따라 다르다:

| 서비스 | 복구 방식 | 중단 구간 backfill | 근거 |
| --- | --- | --- | --- |
| data-api, realtime | `deploy-core-dev.py` 가 `--force-recreate` 로 교체. `ops-datadog.dev.yml` `restart` 도 data-api 를 교체한다 | **불가**. 이전 컨테이너 로그가 사라진다. 5.1a 사본이 유일한 원본 | `deploy()`(`:321`), `ops-datadog.dev.yml:120` |
| business-api, notification | `restore()` 의 `docker start` (기존 컨테이너) | 기대 가능하나 **미검증**. 컨테이너 로그가 보존되고 Agent 오프셋 볼륨(`datadog_agent_run`)이 유지돼야 하며, Agent 가 `Exited` 상태에서 재기동해 이전 구간을 읽는지는 실측 전이다 | `restore()`, `docker-compose.datadog.yml` `datadog_agent_run` |
| 그 외 위성(수동 `docker start`) | 기존 컨테이너 | 기대 가능, 미검증 | 위와 같음 |
| 수집기(Agent) | `ops-datadog.dev.yml` `restart` 는 `--force-recreate`(교체), `up` 은 `up -d --no-deps` | 교체하면 Agent 컨테이너 로그는 사라지나 Agent 는 비교 대상이 아니다. 앱 컨테이너 쪽 원본이 살아 있는지가 관건이다 | `ops-datadog.dev.yml` |

json-file 로테이션(위 표)에 밀려난 구간은 어느 경우에도 복구되지 않는다. 복구 범위는 «Datadog에서 중단 구간 건수가 5.1a 사본의 건수와 같은가»로 별도 확인한다.

### 유휴 서비스 — 빈 결과는 수집 실패가 아니다

복구 뒤 1시간 이상 로그가 없는 서비스는 `docker logs --since 1h` 이 비어 «최신 원본 시각»을 못 구한다. 근거: dev 저트래픽 구간에는 앱이 idle 이고 `/health` 는 로그를 남기지 않는다(`.github/workflows/ops-datadog.dev.yml:188-190`). 요청 단위 access log 도 앱에 없다(`server/data-api/src/main/resources/logback-spring.xml:119` 가 TODO 로 남아 있음).

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

- **현재 수행 불가:** 조회 가능한 모니터가 0건이고 downtime/mute 를 거는 방법(UI/API)과 필요한 권한이 이 문서에 없다. 모니터 접근 권한 확보가 선행 조건이다.
- 권한이 생기면: 사전에 모니터 downtime/mute를 걸고, 건 사람·사유·시작·종료 시각을 이 폴더 또는 Jira에 기록한다.
- 공지: 개발 채널에 중지 사유·예상 시간·복구 담당을 알린다.
- 이번 사건 기준: «no data» 모니터가 있는지부터 확인해야 한다. 없다면 로그 미수신 감시 자체가 비어 있다(후속 후보).
- 중지가 끝나면 downtime을 해제하고 5.2 검증을 기록한다.

### 5.5 롤백(재개가 문제를 일으킬 때)

1. 증상 기준: dev VM 메모리·swap 급증, 앱 health 악화, Agent 재시작 반복.
2. 중지: `ops-datadog.dev.yml` `action: down`. **주의: 이 동작은 «Datadog 제거 + 앱 평문 복원»이다.** Agent 컨테이너를 지우고(`docker rm -f gromo-datadog-agent`) data-api 의 Datadog javaagent 옵션까지 되돌리므로 Agent 만 멈추는 동작이 아니다. 직접 `docker stop`은 쓰지 않는다(경합).
3. 기록: 시작·중지 시각(UTC/KST), 판단 근거(지표 값), 실행한 사람, run id를 남긴다.
4. 이후 5.1의 용량 확인을 다시 통과하기 전에는 재개하지 않는다.

## 부록 A. 증거 발췌 (비밀·개인 계정명 제외)

```
# job 123372233174 (Dev 공동 CD / Data·Realtime 공동 배포) 로그 끝
2026-10-29T09:44:18Z 일부 서비스 중지에 실패했습니다. 중단 상태를 직접 확인해야 합니다.
2026-10-29T09:44:18Z 공동 배포 중단: nginx가 완전히 중지되지 않았습니다.
2026-10-29T09:44:18Z ##[error]Process completed with exit code 1.

# journalctl -u nginx
2026-10-29T09:43:10+0000 systemd: Stopping A high performance web server and a reverse proxy server...
2026-10-29T09:43:15+0000 systemd: nginx.service: Stopping timed out. Terminating.
2026-10-29T09:43:15+0000 systemd: nginx.service: Failed with result 'timeout'.

# journalctl _COMM=sudo (러너 계정)
2026-10-29T09:43:10+0000 sudo: runner : ... /usr/bin/systemctl stop nginx
2026-10-29T09:44:17+0000 sudo: runner : ... /usr/bin/systemctl stop nginx

# journalctl -u docker (6줄, 컨테이너 ID 생략)
2026-10-29T09:43:15Z dockerd: level=info msg="stopping restart-manager" container=...

# docker inspect
gromo-datadog-agent     exit=0 oom=false fin=2026-10-29T09:43:21.162Z rp=unless-stopped
gromo-postgres-exporter exit=2 oom=false fin=2026-10-29T09:43:16.190Z rp=unless-stopped

# docker logs --timestamps --tail 3 gromo-postgres-exporter (읽기 조회, 10-29 조사 후 재조회)
2026-10-29T03:55:51.439Z level=INFO source=tls_config.go:350 msg="TLS is disabled." http2=false address=[::]:9187
2026-10-29T03:56:16.803Z level=INFO source=server.go:73 msg="Established new database connection" fingerprint=db:5432
2026-10-29T03:56:17.185Z level=INFO source=postgres_exporter.go:612 msg="Semantic version changed" server=db:5432 from=0.0.0 to=16.14.0

# systemctl show nginx
TimeoutStopUSec=5s  Result=timeout  ActiveState=failed  SubState=failed
# nginx.service: TimeoutStopSec=5, ExecStop=start-stop-daemon --retry QUIT/5, KillMode=mixed

# Agent 종료 로그
2026-10-29 09:43:16 UTC | CORE | INFO | Stopping logs-agent
2026-10-29 09:43:16 UTC | CORE | INFO | Stopping container launcher - stopping 10 tailers
AGENT EXITED WITH CODE 0, SIGNAL 0, KILLING CONTAINER

# last -F 발췌 (개인 계정, 09:00~09:45Z 세션 없음)
개인 계정 pts/2  <IP>  Thu Oct 29 07:05:17 2026 - Thu Oct 29 07:13:44 2026
개인 계정 pts/0  <IP>  Thu Oct 29 06:59:47 2026 - Thu Oct 29 07:25:16 2026
reboot   system boot  6.8.0-1070-gcp  Thu Oct 29 03:53:36 2026   still running

# Datadog 읽기 조회(host:gromo-dev*, 06:00~09:43:20Z) 서비스별 건수
gromo-business-dev 5163, gromo-kafka-dev 3592, gromo-back-dev 225, gromo-redis-dev 160,
gromo-db-dev 90, gromo-notification-dev 63, gromo-realtime-dev 18, postgres 3
```
