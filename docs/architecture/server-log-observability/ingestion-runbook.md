# 원본 로그 S3 보관과 수집 장애 복구 런북 (GROMO-2556)

> 2026-10-29 작성. 로컬 Docker(Fluent Bit 4.2.8, Loki 3.3.2, MinIO)로만 시험했다. **AWS·dev·prod 에는 요청을 보낸 적이 없다.** 실제 S3·IAM·Infra·dev 호스트가 필요한 단계는 아래 「미확인·차단」에 «미실행 — 배포 게이트»로 적었다. 이 문서는 무유실·exactly-once 를 약속하지 않는다.

관련: [아키텍처 §3·§5](README.md) · [구현 계획 §4·§5·§7](implementation-plan.md) · [실행 중 수집 경로 조사(2554)](runtime-inventory.md) · 설정 [`server/observability/fluent-bit/`](../../../server/observability/fluent-bit/) · 하네스 `server/observability/fluent-bit/local-test/s3/run-s3.sh`

## 1. 구성 요약

| 항목 | 내용 |
| --- | --- |
| 수집기 | Fluent Bit 4.2.8 한 프로세스(overlay 서비스 `fluent-bit`). 입력 3종: Docker `*-json.log`(allowlist 4서비스 + `nginx`), dev 호스트 Nginx 파일(선택), `dummy` canary |
| 출력 | A: Loki(`Match_Regex ^(docker\|nginx_host\|canary)$`). B: S3(선택 모듈) — 같은 레코드를 `rewrite_tag`(keep)로 `s3.<env>.<service>` 로 복제해 S3 출력만 받게 한다. 두 출력은 청크·재시도·디스크 한도가 따로다 |
| 상태 볼륨 | `fluent_bit_state`: `tail.db`(Docker), `nginx-tail.db`(호스트 Nginx), `storage/`(엔진 버퍼), `s3/`(S3 `store_dir`) |
| 스위치(기본 모두 꺼짐) | `OBS_LOG_S3=on` → `modules/s3-on`, `OBS_LOG_NGINX_HOST=on` → `modules/nginx-host-on` 이 `/fluent-bit/etc/modules/<이름>` 에 마운트된다. 값 `off`(또는 미설정)는 주석뿐인 `off.conf`. 필수 `${VAR:?}` 없음(`compose config -q` 확인) |
| S3 설정 변수 | `OBS_LOG_S3_BUCKET`(켤 때 필수), `OBS_LOG_S3_REGION`(기본 `ap-northeast-2` — **미확인 가정**), `OBS_LOG_S3_TOTAL_FILE_SIZE`(10M), `OBS_LOG_S3_UPLOAD_TIMEOUT`(5m), `OBS_LOG_S3_STORE_LIMIT`(64M: 2554 dev 산정 52 MB 올림) |
| 자격 | `s3-on` 에는 `endpoint` 와 키가 없다 — AWS 기본 엔드포인트와 자격 체인(인스턴스 역할)을 쓴다. 새 장기 액세스 키를 기본으로 두지 않는다 |
| dev | **S3 자격이 없다(2554 실측).** dev overlay 에서 `OBS_LOG_S3` 를 켜지 않는다. 켜면 업로드가 실패한다 |

### 스위치 방식 판단

- `@INCLUDE` 대상 디렉터리를 마운트로 갈아 끼우는 방식을 택했다. 환경변수로 Match 를 바꾸거나 `endpoint` 를 빈 값으로 두는 방식은 AWS 없이 동작을 확인할 수 없어 피했다.
- `/fluent-bit/etc/modules/*` 가 etc 안에 있어 마운트 없이도(2555 하네스 등) `off.conf` 로 설정이 완성된다.
- 켜는 쪽은 환경변수가 compose 에 도달해야 한다. `ops-monitor.dev.yml` 이 만드는 env 에 변수를 넣는 방법은 워크플로 수정이 필요해 이번 범위 밖이다(요청 항목 §9).

## 2. S3 키, 시간 의미, lifecycle 범위

```text
system_log/v2/env=<env>/service=<service>/date=YYYY-MM-DD/hour=HH/<수집기 HOSTNAME>-<$UUID 8자>.json.gz
```

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 형식 | gzip JSONL(`compression gzip`, 레코드 한 줄당 JSON 한 개). Fluent Bit 의 `date` 키는 끈다(`json_date_key false`) | 로컬 MinIO 객체 읽기(gunzip) |
| env·service | 키 값은 레코드의 `env`·`service`. **S3 레코드 본문에도 `env`·`service`·`log_kind` 가 남는다**(Loki 출력만 라벨로 옮기며 본문에서 뺀다) | 객체 내용 확인 |
| service allowlist | `rewrite_tag` 규칙이 `data-api\|business-api\|notification\|realtime\|nginx\|canary` 만 통과시킨다 | 설정 |
| 시간 | **객체 «첫 레코드» 의 event time(UTC)**. 한 객체 안에 다른 시간대 레코드가 섞일 수 있다 — 정확한 발생·수집 시간 파티션이 아니다. 시험 k: event time 이 3시간 전인 레코드가 첫 레코드인 객체에 5분 전 레코드가 함께 들어가 `hour=03`(현재 06시대) 키가 만들어졌다 | 하네스 k |
| 재시작 복구 파일의 시간 | 수집기 재시작 뒤 «이전 실행의 로컬 버퍼» 로 다시 올린 객체는 키 시간이 **복구(재기동) 시각**이다 — 레코드 시각과 몇 시간 어긋날 수 있다 | 4.2.8 `plugins/out_s3/s3_store.c:237-247` `set_files_context` 가 `first_log_time = time(NULL)` |
| 조회 여유 | 키 hour 로 바로 거르지 않는다. **`[from − X, to + Y]` 가 걸치는 hour 객체를 읽고 레코드 `timestamp` 로 다시 거른다.** 기본 X = Y = 1시간(2560 `server/observability/athena/render.py` `--margin-hours` 기본 1과 같음). 최대 어긋남은 `upload_timeout`(운영 후보 5m)보다 클 수 있다 — S3 장애 중 재시도(아래 §7, 계산상 최대 약 1시간)와 재시작 복구(위 행)가 더해진다. 장애가 길었던 구간은 여유를 그만큼 늘린다 | 설정·소스 |
| `date`/`hour` 시간대 | **UTC**. 플러그인이 키 시각을 `gmtime_r` 로 만든다 — 컨테이너 `TZ` 와 무관하다. 하네스·overlay 모두 `TZ` 를 주지 않으며 시험 k 의 키도 UTC 였다. 그래서 `TZ=UTC` 를 따로 두지 않는다 | 4.2.8 `src/aws/flb_aws_util.c:1196`, `1210` |
| event time 의 출처 | 실제 파이프라인은 Docker json-file 이 줄에 찍은 시각(앱 `timestamp` 와 밀리초~초 차)이다. 앱 `timestamp` 를 event time 으로 쓰도록 parser 에 `Time_Key` 를 주지 않았다(Loki 시각을 바꾸는 2555 설정과 충돌) | `parsers.conf` |
| 고유성 | `${HOSTNAME}`(컨테이너 id) + `$UUID`(플러그인이 만드는 **무작위 8자**). 정말 전역 UUID 가 아니다. 같은 컨테이너·같은 접두 안에서 8자 충돌은 이론상 가능하나 시험 중 관찰되지 않았다(수십 개 객체 규모, 충돌 확률은 계산하지 않음) | 키 목록 |
| 업로드 | `total_file_size` 10M 미만이면 PutObject. `upload_timeout` 5m 이 지나면 크기와 무관하게 닫는다. 하네스는 20s 로 줄였다. 10 MiB 크기 트리거는 **미실행** | 로그 "will use PutObject API" |
| lifecycle | `system_log/` 규칙(90일, 미완료 multipart 1일)의 범위에 들어간다. 규칙 파일([`s3-log-archive-lifecycle.json`](../../../server/scripts/s3-log-archive-lifecycle.json))은 바꾸지 않았다. **실제 버킷 적용 여부는 미확인(2554)**. PutObject 방식이라 미완료 multipart 는 평소 생기지 않는다 | 파일 |
| 보존 기준 | S3 만료는 업로드 시각 기준이다. 오래된 로그를 다시 올리면 만료가 늦어진다(구현 계획 §4와 동일) | — |

## 3. 켜는 순서

| 단계 | 작업 | 확인 | 상태 |
| --- | --- | --- | --- |
| 1 | 2555 의 Fluent Bit→Loki 가 dev 에 올라가 있고 Promtail 제거는 2555 에서 끝난 상태 | `docker ps` 에 `gromo-fluent-bit`, Promtail 없음 | 2555 소관 |
| 2 | **S3 자격 결정**(2554 결정 대기): GCP dev→S3 단기 자격 연동 또는 dev 용 별도 버킷. 결정 전에는 `OBS_LOG_S3` 를 켜지 않는다 | 자격 체인으로 대상 prefix PutObject 성공, 타 환경 prefix 쓰기 거부 | **미실행 — 배포 게이트** |
| 3 | dev candidate: `OBS_LOG_S3=on`, `OBS_LOG_S3_BUCKET=<dev 버킷>` 으로 ops-monitor 재배포. 기존 업로더는 그대로 둔다 | §6 canary 가 Loki·S3 양쪽에 도착, `s3.0` 지표 `errors`·`dropped_records` 0 | **미실행 — 배포 게이트** |
| 4 | 비교: 같은 시간대에 `system_log/` 기존 업로더 객체와 `system_log/v2/` 객체의 로그 수·마스킹·시간 범위를 대조(기존 업로더는 `app.log` 텍스트, v2 는 stdout JSON 이라 필드가 다르다 — 수량은 이벤트 수가 아니라 «시간대별 줄 수 추세» 로 본다) | 로그량·canary·마스킹 원문 부재 | **미실행** |
| 5 | **기존 업로더 중단**(§5)과 전환 기준 시각·source 파일 위치 기록 | §5 점검표 | **미실행** |
| 6 | prod(Catus): Infra `prod/catus/runtime` 변경으로 Fluent Bit·모듈·IAM 을 적용(§9). 이 저장소로는 못 한다 | — | **Infra 소유** |

## 4. Nginx 입력

### 4.1 공통 정제 (`logs.lua`, 하네스 i 에서 검증)

- access: query string 은 JSON `log_format` 이 `$uri` 만 써서 애초에 없다. 경로에서 `[A-Za-z0-9-_.~%]` 로 이어진 묶음(`/` 는 경계)을 아래 규칙으로 가린다: ① 묶음 끝의 확장자(점 + 영숫자 1~5자)를 떼어 «stem» 으로 판정하고 확장자는 남긴다(`main.<해시>.js` → `:redacted.js`). ② stem 이 UUID 8-4-4-4-12 면 유지(`/files/<uuid>.png` 포함). ③ stem 길이가 20 이상이고 **숫자 포함 또는 대문자 포함 또는 구분자(`-` `_` `.`)가 하나도 없으면** `:redacted`. 소문자 kebab/snake 라우트(`/api/v1/notification-preferences`)는 그대로 남고, 무작위 base62·hex·해시는 가려진다(하네스 i 가 정상 경로 3종 `ok-kebab`·`ok-uuid`·`ok-hash` 의 모양을 단언). 경로는 512바이트에서 UTF-8 문자 경계로 자른다. client IP·referrer·user-agent 는 형식에 넣지 않으며, 기본 combined 줄이 들어오면 IP·identd·user·referrer·agent 를 읽지 않고 버리고, **combined 의 `[dd/Mon/yyyy:HH:MM:SS +zzzz]` 를 시간대까지 해석해 `timestamp` 로 쓴다**(해석 실패 시 Fluent Bit 이벤트 시각; 수집 시각으로 덮지 않아 `Read_From_Head`·backlog 재처리에서 과거 요청이 현재로 찍히지 않는다). combined 패턴에 맞지 않는 access 줄(요청 줄이 `"-"` 인 400 등)은 `raw` 로 남기되 앞 IP·ident·user 를 `**** - -` 로, 요청 줄은 경로 정제로, 둘째 따옴표 구간(referer·agent)은 `"-"` 로 바꾸고 닫히지 않은 따옴표 꼬리도 `"-` 로 바꾼다.
- **한계 — 짧은 경로 토큰**: 20자 미만 세그먼트(짧은 OTP·초대 코드, `/verify/ab12cd34` 같은 reset 코드)는 가리지 못한다. **경로에 비밀을 싣는 라우트는 앱에서 막아야 한다**(query·본문·헤더로 옮긴다). 수집기의 길이 규칙은 2차 그물이다. **두 번째 한계 — 구분자를 포함한 소문자 전용 20자 이상 비밀**(예: `abcd-efgh-ijkl-mnop-qrst`)은 소문자 kebab 라우트와 구별되지 않아 가리지 못한다(1라운드의 «20자 이상이면 전부 가림» 은 정상 라우트·정적 파일까지 가려 http_path 라벨·검색을 망가뜨려 위 규칙으로 바꿨다). **세 번째 — 과차단 방향**: 20자 이상이면서 대문자를 포함한 정상 라우트(CamelCase), 숫자를 포함한 정상 라우트(`oauth2-…`·`…-v2-…`)는 비밀로 간주되어 `:redacted` 가 된다. 퍼센트 인코딩 경로는 `%XX` 의 숫자 때문에 길이만 넘으면 가려진다. **네 번째 — 확장자 꼬리**: 확장자를 «점 + 영숫자 1~5자» 로만 보고 떼어 내므로 `<긴토큰>.a1b2c` 처럼 토큰 끝 5자가 점 뒤에 오면 그 5자는 남는다(stem 만 가려진다). **다섯 번째 — fallback 의 `remote_user`**: combined 파싱에 실패한 줄은 앞 세 필드를 공백 단위로 가리므로, 공백이 든 `remote_user`(Basic auth 이름에 공백)는 일부가 남을 수 있다.
- error: `request: "GET /path?query HTTP/1.1"`(프로토콜 없는 HTTP/0.9 `request: "GET /path?query"` 포함) 의 query, `upstream: "http://…?query"` 의 query, `referrer: "…"` 전체, `client: <ip>`, `"/경로"` 로 감싼 파일 경로의 토큰 세그먼트, auth_basic 의 사용자 이름(`user ":redacted" was not found`, `user ":redacted": password mismatch`)을 정제한다. `host: "…"`·`server: …` 는 호스트 이름이라 그대로 둔다. 그 뒤 `mask()`(토큰·인증·이메일·휴대폰 규칙)를 적용한다. 줄은 마스킹 전에 32 KiB 로 먼저 자른다.
- **error 줄 백스톱**: error 줄은 Nginx 가 요청 줄·헤더를 이스케이프 없이 써서 따옴표 경계가 모호하다(`request: "GET /a"?q=S HTTP/1.1"`). 그래서 필드 규칙 뒤에 따옴표와 무관한 줄 전체 백스톱을 둔다: 공백으로 나뉜 각 토큰에서 `?`·`#` 뒤를 지우고(토큰 끝의 닫는 `"`·`,` 는 남긴다), `/` 가 든 토큰(스킴://호스트 제외)에는 경로 토큰 규칙을 적용한다. access fallback 에도 같은 함수가 적용된다. 한계: error 본문에 `?`·`#` 가 든 정상 문장(예: PCRE 설정 오류 정규식)은 해당 토큰 뒤가 지워진다.
- **인코딩된 query·fragment (GROMO-2585)**: `?`·`#` 에 더해 퍼센트 인코딩된 `%3F`·`%23`(대소문자 무관, `%3f` 포함)도 query·fragment 시작으로 보고 그 뒤를 지운다(경로 정제와 백스톱 공통). `%253F`(= `%25` + `3F`)·`%20`·`%2F` 같은 다른 인코딩은 그대로 남는다. 한계: 경로 값 자체에 `%3F`·`%23` 이 든 정상 URL(인코딩된 `?` 를 파일 이름에 쓰는 경우)은 그 뒤가 잘린다. 입력표 ⑥·⑦ 과 하네스 i 의 `502-enc`·`502-enc-frag`·`ok-enc` 가 단언한다.
- **upstream userinfo (GROMO-2585)**: `upstream: "http://user:pass@host/…"` 처럼 URL 권한부에 `user:pass@` 가 있으면 `http://host/…` 로 userinfo 를 `@` 째 지운다(스킴·호스트·포트는 보존; `@` 를 남기면 이메일 규칙이 도메인 호스트를 가린다). `upstream:` 필드 규칙, 잘린 줄의 꼬리, 줄 전체 백스톱 모두 같은 함수를 쓴다. 입력표 ⑧. **규칙(r2 결정)**: query·path 를 자르기 «전에» URL 토큰 전체(공백·따옴표 전까지)에서 `스킴://` 뒤 «마지막 `@`» 까지를 지운다. 이전 규칙은 첫 `/`·`?`·`#` 까지의 권한부에서만 `@` 를 찾아, 비밀번호에 raw `/`·`?`·`#` 가 있으면(`http://user:pa/ss@host/x`, `http://user:p?ss@host`) userinfo 앞부분이 남았다. 대가: 경로에 `@` 가 든 정상 URL(`http://10.0.0.1:8080/users/@me` → `http://me`)은 호스트·앞 경로까지 지워진다. **예외 — query 안의 `@`**: 마지막 `@` 앞에 query 표식(`?`·`#`·`%3F`·`%23`)이 있고 그 앞에 `/` 가 있거나 `@` 뒤가 host[:port] 꼴(영숫자·`.`·`_`·`-`, 또는 `[IPv6]`)이 아니면(`/p?email=a@b.com&code=S`) query 의 `@` 로 보고 첫 query 표식 앞의 마지막 `@` 까지만 지운다(비밀번호의 `/` 가 있어도 `http://user:pa/ss@host/x?e=a@b.com` 은 잔존 0). 마지막 `@` 규칙을 그대로 쓰면 query 표식까지 지워져 `code=S` 가 남는다(하네스 i 첫 시도에서 `leaked=['C0DE','INV1TE']` 로 발견). 한계: 비밀번호에 `?` 가 있고 같은 URL 의 query 에 `@` 가 있으며 그 뒤가 host 꼴이 아니면(`http://svcuser:UP?PASS@10.0.0.1:8080/x?e=a@b.com&code=Q`) 첫 `?` 앞의 `svcuser:UP` 만 남는다(`?` 뒤 비밀번호 `PASS` 는 지워짐; 입력표 ⑧ 이 현재 결과 그대로 고정). **과잉 가림은 진단 정보 손실일 뿐이고 비밀 누출은 되돌릴 수 없어 과잉 가림 쪽을 택했다**(upstream URL 의 경로·query 에 `@` 가 실리는 빈도는 확인하지 못했다). 줄 전체 백스톱은 upstream 이 아닌 URL 토큰(access fallback 등)에도 같은 규칙을 적용하므로 `https://example.com/@scope/pkg` 같은 토큰도 `https://pkg` 로 과잉 가려진다. 입력표 ⑧ 이 비밀번호의 `/`·`?`·`#` 3사례, `_` 호스트·IPv6 호스트(`my_backend:8080`·`[::1]:8080`) 비밀번호 `?` 2사례, 비밀번호 `/` + query 안 `@` 1사례(모두 잔존 0), `/users/@me` 1사례(위 결과 그대로), query 안 이메일 1사례를 고정한다. 한계: 비밀번호에 공백·`"` 가 든 경우는 토큰 경계가 끊겨 남을 수 있다. 호스트 쪽 `%3F`·`%23` 은 `sanitize_url` 도 `query_pos` 와 같은 규칙으로 잘라 URL 의 query 시작과 일치한다(입력표 ⑧).
- **한계 유지 — `/` 없는 토큰 (GROMO-2585)**: 백스톱의 토큰 규칙(20자 이상 묶음 가림)은 `/` 가 든 토큰에만 적용한다. `/` 없는 토큰(예: error 본문 `client sent invalid header <긴 토큰>`)의 비밀은 가리지 못한다 — 입력표 ⑨ 가 이 한계를 단언한다. 모든 토큰에 적용하지 않은 근거: 줄 전체 토큰에 규칙을 걸면 숫자를 포함한 20자 이상 호스트 이름(`host: "…oneorthree2.internal"`, 입력표 ⑨ 에 포함)·함수·식별자가 가려져 error 로그의 진단 가치가 사라지고, 가릴 비밀과 현재 규칙으로는 구별하기 어렵다(경로의 `/` 문맥이 유일한 신호). 비밀 값이 Nginx error 본문에 실리는 경로가 확인되면 그 필드(Nginx 메시지 종류)를 지정해 따로 가린다.
- **잘린 error 줄**: Nginx 는 error 한 줄을 약 2 KiB(`NGX_MAX_ERROR_STR`)에서 자르고 뒤쪽 필드(`upstream`·`host`·`referrer`)부터 잘린다. 그러면 마지막 따옴표 값이 닫히지 않아 위 규칙이 모두 비껴간다(r2 까지는 `code=`·`invite=` 같은 목록 밖 키와 경로 토큰이 그대로 남았다 — r3 단위 입력으로 확인). 따옴표 수가 홀수면 마지막 따옴표 뒤를 줄 끝까지 정제한다: `referrer` 는 `-`, `upstream` 은 URL 규칙(스킴·호스트 보존), 그 밖(`request: "GET /…`, `open() "/…`)은 query 제거 + 경로 정제. 긴 파일 경로는 Nginx 가 스스로 `…BBB... (2: No such file or directory), client: …` 처럼 잘라 뒤에 글을 붙이므로(하네스 i 첫 실행에서 이 형태의 경로 토큰이 남아 발견), 경로 정제는 세그먼트 전체가 아니라 «토큰 묶음» 단위로 가린다. 하네스 i 가 실제 Nginx 로 잘린 줄 4종(request·upstream·referrer·open() 경로)과 auth_basic 실패·UUID 꼴이 아닌 긴 hex 경로를 만들어 확인한다(`unclosed_quote_errors`, `leaked=[]`).
- 필드: `log_kind` = `access`(요청) \| `infrastructure`(error). 계약 §5 의 `application\|access\|raw` 에 `infrastructure` 를 더했다. `service=nginx`, `env`. `log_id` 는 수집기가 부여하는 무작위 UUID(원천에 안정 커서가 없다 — 수집기가 같은 파일을 처음부터 다시 읽으면 새 id 가 붙어 중복이 된다). trace 필드는 없다 — **trace 없는 로그도 그대로 보관된다**(S3·Loki 모두 도착 확인).
- 연결: access 는 `edge_request_id`(Nginx `$request_id`)와 upstream 응답 헤더 `X-Request-Id`(`request_id`, Business 가 응답에 주는 자기 UUID)를 함께 남긴다. 502/413 처럼 upstream 에 닿지 않은 요청은 `request_id` 가 없다. **error 로그는 요청 단위 연결을 주장하지 않는다** — `connection`(`*<번호>`)과 시간으로만 보조 연계한다. error 시각은 서버 로컬 시간인데 UTC 로 간주해 `timestamp` 를 만든다(dev VM 시간대 **미확인**).

### 4.2 dev 호스트 Nginx (systemd, Nginx 1.18)

| 단계 | 작업 |
| --- | --- |
| 1 | `server/scripts/nginx-log-format.conf.example` 의 `log_format gromo_json …` 을 **http 수준**(`/etc/nginx/nginx.conf` 의 `http {}` 또는 `conf.d/*.conf`)에 넣는다. 이 파일은 저장소 밖이라 수작업이다. `nginx-dev-2.0-routes.conf.example` 은 location include 라 `log_format` 을 넣을 수 없다 |
| 2 | server 블록(또는 http 수준)에 `access_log /var/log/nginx/access.json.log gromo_json;` 를 **추가**한다(기존 `access.log` combined 는 유지 — 수집기는 읽지 않는다) |
| 3 | `sudo nginx -t` → `sudo systemctl reload nginx`. 새 파일에 JSON 줄이 한 줄씩 생기는지 확인 |
| 4 | logrotate: 기존 설정(daily·rotate 14·compress·delaycompress·`create 0640 www-data adm`)이 `/var/log/nginx/*.log` 를 덮으므로 새 파일도 회전한다(**2554 실측은 `access.log` 기준 — 새 파일 회전은 적용 뒤 확인**). postrotate 의 `nginx -s reopen` 이 새 파일을 만든다 |
| 5 | `OBS_LOG_NGINX_HOST=on` 으로 ops-monitor 재배포. 컨테이너는 root 라 `0640 www-data:adm` 파일을 읽는다 |
| 롤백 | `OBS_LOG_NGINX_HOST` 제거 후 재배포(수집 중지), 필요하면 `access_log …json.log` 줄을 지우고 reload. 이미 보낸 객체·Loki 줄은 남는다 |

수집기 동작(하네스 i 에서 검증): `Read_From_Head On` + 파일별 DB offset, 회전(rename 후 새 파일) 뒤에도 따라간다. 회전된 `.1` 은 읽기 대상이 아니며(Path 정확 지정) 이미 읽은 부분만 보냈다. **압축된 `.gz` 는 읽지 않는다**: 회전 직후 `delaycompress` 덕에 `.1` 이 하루 압축되지 않지만, 수집기가 멈춘 채 하루 넘게 방치되면 그 사이 회전된 내용은 읽지 못한다.

### 4.3 prod 컨테이너 Nginx

- 수집: 2555 와 같은 Docker 입력. `nginx` 서비스를 allowlist 에 넣었고(`FLB_COMPOSE_PROJECT` 일치 조건 그대로), stdout 은 access, stderr 는 error 로 취급한다. 공식 이미지는 `access.log→stdout`, `error.log→stderr` 심볼릭 링크다.
- 하네스 i 의 `nginx` 서비스(compose 서비스명 `nginx`, `nginx:1.28-alpine`)로 JSON access·error 모두 검증했다.
- **설정 변경은 Infra 소유**(`prod/catus/runtime`): `log_format gromo_json` 추가, `access_log /dev/stdout gromo_json;`. 적용 전의 기본 combined 줄도 수집기가 정제해 `service=nginx` 로 보관한다(요청 단위 `edge_request_id` 는 JSON 형식에서만).
- 서비스 이름이 `nginx` 가 아니면 `logs.lua` 의 ALLOWED 와 `rewrite_tag` 규칙을 맞춰야 한다. prod 의 실제 compose 서비스명·프로젝트명은 **미확인**.

## 5. 기존 업로더 중단·롤백 순서 (implementation-plan §7 구체화)

기존 경로: 호스트 systemd 타이머(티켓 590, 매시간 `system_log/app-N/`·`user_log/app-N/`)와 새 prod 호스트 업로더(2288). dev 에는 업로더가 없다(2554 실측).

| 순서 | 작업 | 점검 |
| --- | --- | --- |
| 0 | 두 업로더(590 타이머, 2288)가 같은 호스트에서 **같은 prefix 에 이중으로 쓰는지** 확인한다. `systemctl list-timers`, 최근 객체의 `LastModified`, 2288 산출물 | 공존 여부는 **미확인** |
| 1 | v2 를 켠 채 기존 업로더는 그대로 둔다. 새 접두 `system_log/v2/` 와 기존 `system_log/app-N/` 은 키가 겹치지 않는다 | v2 객체가 매 `upload_timeout` 마다 늘어남, canary S3 도착 |
| 2 | v2 backlog 가 없음(`store_dir` 비어 있음, `s3.0` `errors` 0)과 canary 연속 도착을 확인한 뒤 **전환 기준 시각**과 source 파일 위치를 기록한다 | 기록 |
| 3 | **APP 업로더만 중단**: 타이머의 `app.log` 대상만 막는다. 같은 타이머가 `user-activity.log`(`user_log/`)도 올리면 APP 경로만 분리하고 user-activity 적재는 유지한다(790 의 전환 예정 접두는 이 작업 범위가 아니다) | 중단 뒤 `system_log/app-N/` 에 새 객체 없음, v2 계속 증가 |
| 4 | Promtail 제거는 2555 에서 완료(이 작업에서 다시 하지 않음) | — |
| 롤백 | ① S3 출력만 끈다: `OBS_LOG_S3` 제거 후 재배포(Loki 는 계속 동작 — 두 출력 독립) ② 기존 업로더 타이머 재개. **중복 범위 기록**: 전환 기준 시각 ~ 재개 시각 사이는 v2 와 기존 업로더에 같은 줄이 있을 수 있다 ③ `fluent_bit_state` 볼륨·`store_dir`·tail DB 는 지우지 않는다(남은 backlog 를 다시 보낼 수 있다) |

## 6. Canary 운영

- 생성: Fluent Bit `dummy` 입력이 **60초마다** 합성 레코드 1건(`service=canary`, `logger=fluent-bit.canary`, 고유 `log_id`, `canary_seq`, `canary_boot`; 개인정보 없음)을 만든다. `canary_seq` 는 수집기 프로세스마다 1부터 다시 세고, `canary_boot` 는 프로세스마다 새 무작위 값이다. Loki 에는 항상, S3 모듈이 켜져 있으면 S3(`service=canary` 접두)에도 간다. **canary 는 모듈 스위치와 무관하게 기본 켜짐**이다(끄는 스위치는 없다 — 필요해지면 후속).
- 확인(하네스 `canary.py`): **Loki 조회와 S3 객체 조회를 각각 따로** 한다 — Loki 결과와 무관하게 S3 객체를 직접 읽어 `log_id` 를 찾는다. 객체 읽기가 실패하면 다음 회차에 다시 읽는다. 관측 창은 `run-s3.sh` 가 돌린 시나리오 전체 + `max(max-delay, 2×interval+5초)` 다(마지막 시나리오 뒤에도 canary 가 최소 2주기 더 발행돼야 실행 끝의 꼬리 유실이 «뒤 번호 도착» 으로 공백이 된다). 하네스 `--interval`(기본 60)은 Fluent Bit canary 입력의 `Interval_Sec`·`Rate` 와 같아야 한다. 판정: 한 sink 에만 없거나 늦으면 `MISSING_IN`, 같은 `canary_boot` 안에서 빠진 `canary_seq` 는 `MISSING_BOTH`(어느 sink 에도 안 온 canary), sink 별 마지막으로 받은 canary 의 발행 시각이 «60초 + max-delay» 보다 오래되면 `STALE`(처음 몇 건 뒤 수집이 멈췄거나 조회가 계속 실패; 관측 종료 신호 시각 − `interval/2` 이후에 발행된 canary 를 하나도 못 받은 sink 도 `STALE` — 마지막 시나리오 직후 수집기가 멈춘 경우), 판정 시각 기준 max-delay 안에 발행돼 아직 안 온 것은 `PENDING`(성공으로 세지 않고 따로 출력). 유실을 일부러 만드는 f1·f2 는 `run-s3.sh` 가 각 시나리오의 시작·끝 시각을 `canary.py --allow-loss-file` 로 넘기고, **그 창 안에서 발행된 canary 의 `MISSING_*` 만** `ALLOWED_LOSS` 로 출력하고 종료 코드에서 뺀다(창 밖 유실은 그대로 실패). 못 잡는 꼬리: 수집기가 SIGKILL·교체로 끝난 boot 의 마지막 번호들(같은 boot 의 뒤 번호가 없다)과 관측 끝 직전 2주기 안의 발행분(`PENDING`). `canary.py` docstring 에 같은 내용을 적었다.
- 운영 적용 설계(**미구현·미실행**): 별도 주기 작업(관측 호스트 cron 또는 Grafana 쪽 쿼리)이 ① Loki `{service="canary"}` 의 마지막 canary 시각 ② S3 `service=canary/` 의 최신 객체 내용의 마지막 canary 시각을 각각 지표로 내고, 각 sink 에서 «마지막 canary 나이 > 임계» 이면 따로 경보한다. S3 는 `upload_timeout` 만큼 늦게 보이므로 임계는 `upload_timeout` + 여유(초기 후보 10분, 하네스 20s 환경 측정과 별개). 저트래픽 시간대의 정상(canary 만 있음)과 수집 단절(canary 도 없음)이 구분된다. canary 도착이 모든 실제 로그의 무유실 증명은 아니다.
- 추가 경보 후보: `s3.0` `errors`·`dropped_records`, `store_dir` 사용량 80%(64M 기준 51 MB), 로그에 `will not retry`(§7 d).

## 7. 장애 시나리오 결과 (로컬 하네스, 측정 그대로)

환경: 로컬 Docker, Fluent Bit 4.2.8, Loki 3.3.2(dev 와 같은 설정), MinIO `RELEASE.2026-10-23T20-06-51Z`(Chainguard 빌드, digest 고정 — 공식 `minio/minio` 는 Docker Hub·Quay 에서 받을 수 없었다), `upload_timeout` 20s(운영 후보 5m), `total_file_size` 10M. 기대 `log_id` 집합은 외부 생성기가 들고(`uuid5(RUN-i)`) 2초 간격 watcher 가 Loki·S3 를 따로 조회해 처음 본 시각을 기록한다. **지연은 2초 해상도**이고 `emitted_ms`(생성기 시각) 기준이다. Loki 는 같은 스트림·시각·본문을 저장 시 합치므로 Loki 쪽 중복은 과소 계수될 수 있다. 시나리오마다 1회(b1 은 3회, 아래) 실행한 값이라 분포는 모른다. 아래 소스 `file:line` 은 r4 에서 v4.2.8 태그 소스 대조를 마쳤다(대조 대상 전부 일치, `s3.c:1920-1925` 만 `1917-1919` 로 고침).

| ID | 시나리오 | sink | 기대 | 수신 | 누락 | 중복 | 지연 p50 / p95 / 최대(초) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | 정상, 600건 | Loki | 600 | 600 | 0 | 0 | 1.8 / 2.7 / 2.8 |
| | | S3 | 600 | 600 | 0 | 0 | 20.7 / 26.4 / 27.0 |
| b1 | 전송 중 `docker restart`(SIGTERM) 1000건 | Loki | 1000 | 1000 | 0 | 0 | 2.0 / 5.3 / 6.9 |
| | | S3 | 1000 | 1000 | 0 | 0 | 8.7 / 21.7 / 23.2 |
| b2 | 전송 중 SIGKILL 후 재기동 1000건 | Loki | 1000 | 1000 | 0 | 0 | 1.7 / 5.6 / 7.2 |
| | | S3 | 1000 | 1000 | 0 | 0 | 16.1 / 30.1 / 31.7 |
| c | 수집기를 Loki·MinIO 네트워크에서 30초 분리 1200건 | Loki | 1200 | 1200 | 0 | 0 | 2.8 / 53.7 / 62.4 |
| | | S3 | 1200 | 1200 | 0 | 0 | 20.3 / 38.3 / 41.3 |
| d | MinIO 정지 50초(Loki 정상) 1800건, `Retry_Limit no_limits`(=5회) | Loki | 1800 | 1800 | 0 | 0 | 1.6 / 2.7 / 4.9 |
| | | S3 | 1800 | 1296 | **504** | 0 | 16.8 / 32.7 / 36.0 |
| d (수정 후) | 같은 시험, `Retry_Limit 60` | Loki | 1800 | 1800 | 0 | 0 | 1.5 / 2.9 / 6.9 |
| | | S3 | 1800 | 1800 | 0 | 0 | 23.9 / 65.1 / 69.6 |
| d2 | S3 403(잘못된 비밀키) 60초 후 올바른 키로 수집기 재생성 1200건 | Loki | 1200 | 1200 | 0 | 0 | 1.6 / 3.7 / 6.7 |
| | | S3 | 1200 | 1200 | 0 | 0 | 33.1 / 60.7 / 63.8 |
| d3 | MinIO 정지 90초, 복구 60초 뒤, `Retry_Limit no_limits` | S3 | 2400 | 1539 | **861** | 0 | 26.9 / 62.3 / 66.2 |
| | 같은 시험에서 수집기 재시작 뒤 150초 | S3 | 2400 | 1539 | **861** | 0 | (재시작이 누락분을 되살리지 못함) |
| d3 (수정 후) | 같은 시험, `Retry_Limit 60`, 복구 60초 뒤 | Loki | 2400 | 2400 | 0 | 0 | 1.6 / 2.6 / 3.0 |
| | | S3 | 2400 | 2400 | 0 | 0 | 45.8 / 100.9 / 107.0 |
| d4 | MinIO 정지 5분, `Retry_Limit 60`, 4800건 | Loki | 4800 | 4800 | 0 | 0 | 1.6 / 2.7 / 5.0 |
| | | S3 | 4800 | 4800 | 0 | 0 | 113.9 / 332.1 / 356.4 |
| e | Loki 정지 3분(S3 정상), 복구 후 200초 | Loki | 2400 | 2350 | **50** | 0 | 91.6 / 270.9 / 369.4 |
| | | S3 | 2400 | 2400 | 0 | 0 | 12.4 / 21.5 / 23.4 |
| e2 | 같은 시험, 복구 후 최대 900초 | Loki | 2400 | 2390 | **10** | 0 | 88.0 / 338.8 / 436.0 |
| | | S3 | 2400 | 2400 | 0 | 0 | 12.3 / 22.0 / 26.8 |
| f1 (※ S3 엔진 상한 64M 로 측정) | 두 sink 정지 + Loki 엔진 1M·S3 `store_dir` 2M·total_file_size 1M, 6000건 | Loki | 6000 | 2151 | **3849** | 0 | 52.2 / 90.8 / 91.4 |
| | | S3 | 6000 | 3477 | **2523** | 165 | 48.1 / 77.9 / 78.9 |
| f1 수정 후 (r6: `Retry_Limit 60`·S3 엔진 1M 실제 적용, 마운트 설정 확인) | 같은 조건 | Loki | 6000 | 2135 | **3865** | 0 | 미집계 |
| | | S3 | 6000 | 6000 | 0 | 166 | 미집계 — S3 엔진 `dropped_records` 160 인데 누락 0: `store_dir` 버퍼가 재전송한 것으로 추정(미확인), 중복은 그 결과로 보임 |
| f2 (※ 같음) | f1 + 생성기 Docker 로그 500k×2 회전 | Loki | 6000 | 2027 | **3973** | 0 | 40.9 / 61.9 / 62.5 |
| | | S3 | 6000 | 3527 | **2473** | 334 | 48.5 / 59.5 / 60.6 |
| h | 수집기 정지 중 생성기 컨테이너 신규 생성, 재기동 뒤 400건 | Loki | 400 | 400 | 0 | 0 | 16.8 / 20.6 / 21.3 |
| | | S3 | 400 | 400 | 0 | 0 | 41.9 / 45.8 / 46.5 |

수집기 지표(`/api/v1/metrics`, 시나리오 끝): a·b1·e·h 에서 `dropped_records` 0. d: `s3.0` `dropped_records` 60·`errors` 4. e: `loki.1` `retried_records` 7594(`dropped_records` 0). f1: `loki.1` `dropped_records` **3849**(= 누락 수), `s3.0` `dropped_records` 168. f2: `loki.1` 3973, `s3.0` 167.

### 해석과 한계

위 표의 «수정 후» 행은 r1 에서 `Retry_Limit 60` 으로 바꾼 뒤 다시 돌린 값이다(병합된 2555 최종 `logs.lua`·`fluent-bit.conf` 기준). 같은 병합본에서 a 와 Nginx 시나리오(i)도 다시 돌려 누락·중복 0, 민감값 0 이었다(a: Loki 600/600 p50 1.5s, S3 600/600 p50 20.9s).

- **a·b·c·h**: 이 규모에서 누락·중복 0. b1(SIGTERM 재시작)은 같은 시험을 3회 돌려 **1회에서 S3 누락 1건**(1000 중 999)이 나왔고 2회는 0 이었다. 원인은 확인하지 못했다 — 재시작 순간의 S3 버퍼 파일 처리로 추정하지만 **미확정**이다. SIGKILL(b2)은 3회 시험에서 누락·중복이 나오지 않았으나 표본이 작다.
- **d·d3·d4 (원인 확인과 완화)**: 수집기 로그 `Chunk file failed to send 5 times, will not retry` 의 한도는 설정으로 바뀐다. 4.2.8 `plugins/out_s3/s3.c` 는 초기화에서 `if(ctx->ins->retry_limit < 0) { ctx->ins->retry_limit = MAX_UPLOAD_ERRORS; }`(`s3.c:620-621`)로 `Retry_Limit no_limits`(-1)를 `#define MAX_UPLOAD_ERRORS 5`(`s3.h:51`)로 바꾼다. 업로드 큐는 `upload_contents->retry_counter >= ctx->ins->retry_limit` 이면 «will not retry» 를 찍고 파일을 `s3_store_file_inactive` 로 버리고(`s3.c:1908-1914`), 실패마다 `2 * retry_counter` 초 뒤로 미룬다(`s3.c:1917-1919`). 같은 한도가 flush 경로(`s3.c:3837-3842`)·put_all_chunks(`s3.c:1374-1380`)·멀티파트(`s3.c:1662`, `3309`, `3324`)에도 쓰인다. 그래서 `Retry_Limit` 를 양수로 주면 그 값이 쓰이고, 기본 `no_limits` 는 사실상 5회다 — 이 하네스(`upload_timeout` 20s)에서는 약 20~30초 정지에서 버려졌다(시간 환산은 하네스 값이며 운영 후보 5m 에서는 업로드 시점이 달라 다를 수 있다). **`s3-on` 은 `Retry_Limit 60` 으로 바꿨다**(재시도 간격이 2n초씩 늘어 N 번이면 대략 N(N-1)초). **«약 1시간»은 이 backoff 합산 계산값이고, 실측으로 견딘 최대 정지는 5분(d4)이다.** 같은 d·d3 시험이 누락 0 이 됐고 5분 정지(d4)도 누락 0 이었다 — **각각 1회 실행에서 0** 이다(b1 은 3회 중 1회 누락이 나왔으므로 반복하면 달라질 수 있다). 정지가 이 한도를 넘으면 같은 유실이 생기므로 «S3 정지 약 1시간(계산) 이상 → 그 구간 원본 유실» 이 한계다. 상한은 `store_dir_limit_size`(64M)가 따로 잡는다 — 정지 중 쌓이는 양이 이를 넘으면 새 데이터가 버려진다(f1/f2 의 S3 `dropped_records`). 수집기 지표 `s3.0 dropped_records` 는 이 시험에서 누락과 무관하게 올랐다(d 수정 후 40, d4 168, 유실 0) — 이 값만으로 유실을 판정하지 않는다.
- **엔진 쪽 저장 상한(r3)**: `Retry_Limit` 은 플러그인 업로드 한도이면서 **엔진 flush 재시도 한도**이기도 하다(엔진은 같은 `ins->retry_limit` 을 쓴다 — `src/flb_task.c:326`). `store_dir` 이 `store_dir_limit_size` 에 닿으면 `s3_store_buffer_put` 이 `Buffer is full` 로 실패하고(`s3_store.c:136-140`) flush 는 `FLB_RETRY` 를 돌려준다(`s3.c:3912-3915`). 그러면 `rewrite_tag` 에미터(`Emitter_Storage.type filesystem`)의 청크가 `fluent_bit_state` 의 `storage/` 에 재시도 대기로 남는다. 엔진 backoff 는 `random(5, min(2000, 5·2^n))` 초(`src/flb_scheduler.c:259-266`, 기본 base 5·cap 2000 — `include/fluent-bit/flb_scheduler.h:29-30`)라 60회면 청크 하나가 **수 시간**(계산: 평균 약 15시간, 최대 약 29시간) 남는다. 에미터는 filesystem 이라 `Emitter_Mem_Buf_Limit` 로 멈추지 않고(`src/flb_input_chunk.c:2461-2463` — FS 저장소는 메모리 한도로 pause 하지 않는다) 디스크 상한은 출력의 `storage.total_limit_size` 뿐인데(`flb_input_chunk.c:718-751`, 미설정 = -1 이면 검사 생략), r2 의 S3 출력에는 이 값이 없었다. 즉 **S3 장애가 `store_dir` 을 채운 뒤에는 에미터 청크가 상한 없이 쌓였다**. r3 에서 S3 출력에 `storage.total_limit_size 64M` 를 두었다 — 넘으면 S3 경로의 가장 오래된 청크부터 버리고(`flb_input_chunk.c:666-711`, S3 `dropped_records`) Loki 출력(128M)과는 따로 센다. 4.2.8 은 시작 때 «`store_dir_limit_size` 를 쓰라» 경고를 한 줄 찍지만 엔진은 이 값을 적용한다(`s3.c:637-640`). 로컬 실측(아래 «엔진 상한 실측»)으로 확인했다.
- **남은 한계 — 두 상한의 폐기 방향이 반대다**: 엔진 `storage.total_limit_size`(S3 출력 64M)를 넘으면 **가장 오래된 청크부터** 버리고(`flb_input_chunk.c:666-711`), `store_dir_limit_size`(64M)를 넘으면 `Buffer is full` 로 **새 데이터**를 거절한다(`s3_store.c:136-140`). 긴 S3 장애에서는 먼저 `store_dir` 이 차서 새 데이터가 엔진 청크로 넘어가고, 그 청크가 다시 엔진 상한에서 오래된 것부터 버려진다 — 어느 쪽이 유실되는지가 구간마다 다르다(`s3.0` `dropped_records` 로만 보인다). **최악 디스크 합계 = `store_dir` 64M + 엔진 청크 64M + 재시작 잔여분**(아래 ②: 이전 파일은 크기 0 으로 잡혀 한도 밖에 더 쌓일 수 있다). Loki 출력의 엔진 상한 128M 은 별도이므로 `fluent_bit_state` 볼륨은 **상한 합계 256M(64+64+128)에 `store_dir` 초과분·재시작 잔여분·tail DB 여유를 더해 최소 1 GiB 를 권고**한다(계산값, 64M 실값 실측 아님). 2554 가 산정한 `store_dir` 용량(약 2 GB)과 별개이니 Infra 요청 항목(§9)에 같이 적는다.
- **`store_dir` 의 상한이 깨지는 경로(소스 확인, 실측 아님)**: ① «will not retry» 로 버린 파일은 디스크에서 지우지 않고(`s3_store.c:404-414` → `flb_fstore_file_inactive` 는 «don't delete the real file», `src/flb_fstore.c:238-256`) 사용량 계산(`current_buffer_size`)에서도 빼지 않는다 — 재시작 전까지 그만큼 여유가 줄어 새 데이터가 `Buffer is full` 로 엔진 청크(위 상한)로 넘어간다. ② 재시작 때 다시 읽은 이전 파일은 크기 0 으로 잡힌다(`set_files_context` 가 `size` 를 채우지 않음, `s3_store.c:237-247`) — 재시작 직후 디스크의 `store_dir` 은 한도 + 이전 잔여분까지 커질 수 있다. ③ 95% 이상 찼을 때 `s3_store_buffer_put` 은 데이터를 **덧붙인 뒤** -1 을 돌려준다(`s3_store.c:198-204`) — 엔진이 같은 청크를 다시 보내 같은 레코드가 또 덧붙는다. f1·f2 의 S3 중복(165·334)과 방향이 맞다(이 경로가 원인인지 대조는 하지 않았다).
- **`store_dir` 소실**: `store_dir`·엔진 청크·tail DB 는 모두 `fluent_bit_state` 볼륨에 있다. 컨테이너만 재생성하면 남지만, **볼륨을 지우거나(`down -v`, 볼륨 이름 변경) 호스트를 교체하면 아직 못 올린 S3 backlog 가 함께 사라진다**. 롤백·재배포 때 볼륨을 유지한다(§5 롤백 ③).
- **d2 와 d3 의 차이**: d2 는 수집기를 재생성해 «will not retry» 로 버려진 파일까지 되살린 것처럼 보였다. 소스상 파일별 실패 횟수(`chunk->failures`)는 프로세스 메모리에 있어 재시작하면 0 이고, 재시작 때 로컬 버퍼를 다시 읽는다(`s3_store.c:211-250` `set_files_context`, 로그 «Sending locally buffered data from previous executions»). 그런데 d3(5회 한도)에서는 같은 재시작이 861건을 되살리지 못했다. 둘의 차이를 소스로 설명하지 못했다 — **미규명**. 따라서 «재시작하면 복구된다» 를 복구 절차로 믿지 않는다. 재시작으로 복구된 파일의 객체 키 시간은 복구 시각이다(`set_files_context` 가 `first_log_time = time(NULL)`).
- **c** 는 30초 분리라 한도 안이었다. 분리를 늘린 시험은 하지 않았다(**미실행**).
- **e·e2 (Loki 누락, 판정 부분 확정)**: 수집기는 `dropped_records` 0 으로 보고했지만 Loki 에는 연속 10~148건이 없었다(e2 의 누락은 idx 190~199 연속 10건, Loki 정지 직후 구간). Loki 설정은 dev(`server/observability/loki/loki-config.yml`)와 하네스가 **같은 파일**이다. 효과 설정(`/config`)은 `ingester.wal.enabled: true`, `wal.dir: /loki/wal`(컨테이너 파일시스템, 볼륨 아님), `checkpoint_duration: 5m`, **`flush_on_shutdown: false`**, `chunk_idle_period: 30m`, `max_chunk_age: 2h` 다. 별도 확인: 같은 설정의 Loki 에 100건을 push 한 직후 `docker stop`(SIGTERM) 후 재시작하면 100/100 이 보였고, push 직후 `docker kill`(SIGKILL) 후 재시작하면 **0/100** 이 보였다. 즉 Loki 는 «받았다» 고 응답한 항목을 WAL 에 동기화하기 전에 SIGKILL 되면 잃는다. e 의 `docker stop` 은 기본 10초 유예 뒤 SIGKILL 이라, 종료가 느린 Loki 가 SIGKILL 되었을 가능성이 있다 — **e·e2 에서 실제로 SIGKILL 되었는지는 확인하지 못했다(미확정)**. 이 구간은 S3 에는 있다. Loki 복구 뒤 backlog 는 3분 중단에 최대 약 6~7분(369~436초) 걸렸다(수집기 재시도 backoff).
- **f1·f2**: 한도 도달 시 오래된 청크부터 버려진다. Loki 는 지표 `dropped_records` 와 누락 수가 일치했다. S3 는 누락과 함께 **중복(165, 334)** 이 생겼다. 소스 회전(f2)은 두 sink 가 막힌 동안에도 수집기가 계속 읽어서 추가 손실로 나타나지 않았다. 숫자는 한도를 일부러 작게 한 시험값이며 dev 64M/128M 에서의 손실량이 아니다.
- **수용창 g (Loki 3.3.2, dev 설정)**: 별도 push 시험에서 스트림 최신 항목보다 **59분 오래된 항목은 수용(204), 61분 이상은 400 `entry too far behind`** 로 거절됐다(1·10·30·59분 수용, 61·90·180분 거절). 3분 backlog(e/e2)는 수용창 안이었다. 30분 backlog 실측은 **미실행**(3분으로 축소). 거절된 항목은 시각을 바꿔 넣지 않고 S3 확인으로 본다.

### 도착 지연 (canary, 2초 해상도, 60초 간격)

| 실행 | sink | canary 수 | p50(초) | 최대(초) |
| --- | --- | --- | --- | --- |
| r1·r2: 하네스 시작 뒤 첫 420초(시나리오 전체가 아님) | Loki | 6 | 2.1 | 27.1 |
| | S3 | 6 | 25.0 | 67.7 |
| r1·r2: d3·e2·i 실행의 첫 420초 | Loki | 5 | 1.8 | 2.9 |
| | S3 | 6 | 26.2 | 79.2 |

r1·r2 의 `canary.py` 는 고정 420초만 보았다 — 그 뒤에 발행된 canary 는 검증되지 않았고, 두 sink 모두에 없는 canary 는 목록에 나타나지 않았다. r3 부터 관측 창이 시나리오 전체 + max-delay 이고 빠진 번호·정지를 판정한다(§6).

S3 지연은 `upload_timeout` 20s + 업로드 타이머 주기가 지배한다. 운영 후보 5m 에서의 p95 ≤5분 목표(구현 계획 P2)는 **미검증**이다 — 5m 이면 정의상 객체가 닫히는 데 5분이 걸려 p95 가 5분 근처 또는 초과할 수 있다. 목표와 `upload_timeout` 을 함께 조정해야 한다.

### Nginx (시나리오 i)

| 입력 | 요청 | Loki 수신 | S3 수신 | 누락 | 중복 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| prod 컨테이너 Nginx(Docker 입력) | 200건 | 200 | 200 | 0 | 0 | 정상·upstream·502·413·404 5종 ×40 |
| dev 호스트 Nginx(파일 tail) | 400건(회전 전 200, 회전 후 200) | 400 | 400 | 0 | 0 | 중간에 `mv` + `nginx -s reopen` |

- upstream `X-Request-Id` 연결 120/120, 502 120건, 413 120건 확인. error 로그 879건(하네스는 `error_log info` 레벨이라 많다).
- 민감값 검사: query(`token=`·`email=`·`code=`·`phone=`)·Referer 토큰·이메일 도메인·경로 토큰·`phone` 값 원문이 Loki·S3 에서 **0건**(최종 실행). 첫 실행에서 `open() "…/PATHTOKEN…" failed` 형태의 error 로그에 경로 토큰이 남아 `logs.lua` 를 고쳤다(따옴표 경로 정제 추가).
- 앱 로그 마스킹의 일부(`Bearer`·`token`·`authorization`·`refresh` 키, 마스킹 전 사전 자르기)는 2555 리뷰 반영분과 같게 맞췄다.
- **r3 재실행**(`run-s3.sh a i`, 1회): 요청 종류를 12종으로 늘렸다(위 5종 + UUID 꼴이 아닌 긴 hex 경로, auth_basic 실패, 잘린 줄 4종 — request·upstream·referrer·open() 경로, query 에 `invite=` 추가). Docker 480·호스트 960 = 1440건이 Loki·S3 모두 누락·중복 0, upstream 연결 120/120, error 2559건 중 닫는 따옴표 없는 줄 480건, 민감값 0(`leaked=[]`). 같은 실행의 a: Loki 600/600 p50 1.7s, S3 600/600 p50 20.8s, canary 3건(Loki p50 1.7s·S3 p50 25.8s, 빠진 번호 0). r3 첫 실행에서는 Nginx 가 긴 파일 경로를 스스로 `…... (2: No such file or directory), client: …` 로 잘라 경로 토큰이 Loki·S3 에 남았고(`leaked=['PATHTOKEN']`), 경로 정제를 «토큰 묶음» 단위로 바꾼 뒤 위 결과가 나왔다.

### 엔진 상한 실측 (r3, S3 정지 + 작은 `store_dir`)

환경: 하네스와 같은 이미지·같은 `fluent-bit/` 설정 디렉터리를 쓰는 별도 로컬 프로젝트(`obs2562-s3cap`). `store_dir_limit_size 1M`, `total_file_size 1M`, `upload_timeout 20s`. MinIO 를 멈춘 채 생성기 120,000건(약 500건/초, 약 240초)을 보내고 15초마다 `fluent_bit_state` 사용량을 쟀다. 설정마다 1회 실행. **축소값 시험(`store_dir` 1M·상한 4M)이며 64M 실값의 동작은 외삽이다.**

| S3 출력 설정 | 에미터 청크(`storage/emitter.3`) | `store_dir` | S3 `dropped_records` | Loki 수신 |
| --- | --- | --- | --- | --- |
| r2: `storage.total_limit_size` 없음 | 15초마다 약 3 MB씩 늘어 **46,716K(234 파일)** — 생성기가 끝나서 멈췄을 뿐 상한이 없다 | 892~992K(1M 한도에서 멈춤) | 2 | 120000/120000 |
| r3: 같은 자리 `4M`(실험용 축소값, 운영 값은 64M) | 31초부터 **3,804~3,972K(19~20 파일)** 에서 머묾 | 856~896K | 108,417 — 한도를 넘은 오래된 S3 청크를 버림(= S3 유실) | 120000/120000 |

- 두 설정 모두 Loki `dropped_records` 0, 입력 pause 0 — S3 쪽 상한이 Loki 경로를 막지 않았다. 수집기 로그: `Buffer is full` r2 1,234회·r3 557회, r3 시작 때 `store_dir_limit_size` 경고 1줄.
- **대량 유실을 받아들이는 선택(r3 축소값 시험)**: 엔진 상한을 둔 축소값(`4M`)으로 S3 를 오래 세운 시험에서 **S3 유실 108,417/120,000**(Loki 120000/120000)이었다. 64M 상한은 디스크 폭주를 막는 대신 장시간 S3 정지 시 대량 유실을 받아들이는 선택이다. «약 1시간» 계산(`Retry_Limit 60`)은 정지 동안 쌓이는 양이 상한 안일 때만 성립하고, 상한을 넘기면 가장 오래된 청크부터 버려져 그 시간보다 훨씬 일찍 유실이 시작된다.
- 64M 크기 자체·MinIO 복구 뒤 엔진 청크 재전송은 이 실험에서 보지 않았다. 일반 S3 정지 d(MinIO 50초)를 새 설정(`64M`)으로 1회 다시 돌렸다: Loki 1800/1800·S3 1800/1800, 중복 0, S3 지연 p50 21.4s·최대 61.5s, `s3.0` `dropped_records` 40·`errors` 2(이전과 같이 유실 없이 오르는 값), canary 12건 빠진 번호 0(관측 756초, max-delay 600초).

## 8. 미확인·차단 조건

| 항목 | 상태 |
| --- | --- |
| 실제 S3 업로드·IAM·버킷 정책·lifecycle 적용 | **미실행 — 배포 게이트**(AWS 요청 금지) |
| dev→S3 자격 방식(2554 결정 대기) | 차단: 결정 전 dev 에서 `OBS_LOG_S3` 금지 |
| AWS 에서의 `endpoint` 없는 설정 동작, 리전 값(`ap-northeast-2` 는 가정) | 미확인 |
| prod Nginx 의 compose 서비스명·`log_format` 적용 | Infra 소유, 미확인 |
| dev 호스트 `nginx.conf` 수정·새 `access.json.log` 의 logrotate 회전 | 미실행(저장소 밖) |
| dev 호스트 시간대(error.log 시각 해석) | 미확인 |
| 기존 업로더(590·2288) 공존 여부 | 미확인 |
| 10 MiB 크기 트리거, 5분 `upload_timeout` 실측, 30분 backlog, 30초 초과 네트워크 분리, 호스트 디스크 포화 | 미실행 |
| 첫 기동 시 기존 `*-json.log` 전체 재읽기(Read_From_Head) 규모와 Loki 수용창 밖 거절 | 로컬 소량만 확인, 실제 dev 규모 미확인 |
| S3 폐기 한도 | 원인은 소스로 확정, `Retry_Limit 60` 으로 완화(약 1시간은 계산, 실측은 5분 정지까지). d2/d3 재시작 복구 차이는 미규명 |
| S3 장애가 길 때 디스크 | 엔진 쪽은 `storage.total_limit_size 64M` 로 상한(r3, 로컬 실측). `store_dir` 은 «will not retry» 파일·재시작 잔여분 때문에 한도를 넘을 수 있다(소스 확인, 실측 아님). 1시간 넘는 S3 정지 실측은 미실행 |
| b1(SIGTERM 재시작) 3회 중 1회 S3 1건 누락 | 원인 미확정 — 운영 전 재현 필요 |
| Loki 정지 시 연속 10~148건 누락 | WAL 은 켜져 있으나 `flush_on_shutdown: false`, SIGKILL 시 0/100 별도 확인. e 의 실제 SIGKILL 여부는 미확정 |

## 9. Infra(prod) 요청 항목

1. S3: 환경별 prefix 쓰기 권한이 있는 인스턴스 역할(Fluent Bit 호스트), `system_log/v2/` 에 대한 PutObject, 타 환경 prefix 거부. lifecycle `system_log/` 90일·미완료 multipart 1일이 실제 버킷에 적용돼 있는지 확인.
2. Catus 런타임: Fluent Bit 4.2.8 서비스 추가(`/var/lib/docker/containers` 읽기 전용, 상태 볼륨, `FLB_COMPOSE_PROJECT`·`FLB_ENV=prod`, `OBS_LOG_S3=on`, 버킷·리전·`store_dir` 한도 — 용량 확인 전 2554 산정 약 2 GB; `fluent_bit_state` 볼륨은 상한 합계 256M(`store_dir` 64M + S3 엔진 64M + Loki 엔진 128M) + `store_dir` 초과분·재시작 잔여분·tail DB 여유로 **최소 1 GiB 권고**, §7 «남은 한계»), Nginx 컨테이너에 `gromo_json` `log_format` 과 `access_log /dev/stdout gromo_json;`.
3. `ops-monitor.dev.yml`(또는 env 렌더)에 `OBS_LOG_NGINX_HOST`·`OBS_LOG_S3*` 변수를 넘기는 경로.
4. `OBS_*`·`DD_*` 와 별개로 Datadog 컨테이너 로그 수집 제외 목록의 `gromo-promtail` → `gromo-fluent-bit`(계약 §6, 2555 소관).
