# 로그 마스킹·trace 정규화 보강 (GROMO-2584)

## 사전 자르기 꼬리

provider 는 message·exception 원본이 한도(16 KiB·32 KiB)의 2배를 넘으면 마스킹 전에 UTF-8 문자 경계에서 먼저 자른다. 그 끝에 이메일·휴대폰·주민번호가 걸치면 조각(`user@exam`, `010-1234-56`, `900101-123`)이 마스킹 패턴에 안 걸린다. 앞부분이 마스킹으로 크게 줄면(예: `secret=<긴 값>` → `secret=****`) 그 조각이 16 KiB 출력 안에 원문으로 남았다.

규칙: **사전 자르기를 했으면, 잘린 끝에 이어진 토큰 문자 `[A-Za-z0-9._%+@-]`(이메일·휴대폰·주민번호 패턴이 쓰는 ASCII) 연속 구간을 버린 뒤 마스킹한다.** 한도의 2배 이하인 입력과 바이트 상한·UTF-8 경계 규칙은 그대로다.

| 위치 | 구현 |
|---|---|
| data-api | `MaskingConverter.dropCutToken` ← `ObservationJsonProvider.putLimited` |
| business-api·notification·realtime | `LogMasking.dropCutToken` ← `ObservationJsonProvider.putLimited` |
| Fluent Bit | `logs.lua` `drop_cut_token` ← `raw_record`(JSON 이 아닌 앱 줄) |

토큰 구간이 사전 자르기 지점까지 수십 KiB 이어지면(구분자 없는 덩어리) 그 구간이 통째로 빠진다. 출력이 짧아질 뿐 원문 조각은 남지 않는다. `truncated`·`original_size_bytes`(원본 바이트)는 그대로 붙는다.

**범위 밖**: `logs.lua` 의 Nginx 경로(`nginx_finalize` 의 사전 자르기, `nginx_error` 의 `truncate(mask(truncate(rest, MESSAGE_LIMIT * 2)), …)`)는 같은 꼬리 문제가 있지만 GROMO-2585 담당 함수라 고치지 않았다. 고칠 때는 사전 자르기 결과에 `drop_cut_token` 을 같은 방식으로 적용한다.

## 네 서비스 공통 입력표

`src/test/resources/log-contract-vectors.tsv` 를 네 서비스(data-api·business-api·notification·realtime)에 **같은 바이트로** 둔다. 서비스 간 공유 코드가 없어 복제는 피할 수 없다. 각 서비스의 `LogContractVectorsTest` 가 세 가지를 본다.

- `tableIsTheSharedCopy`: 표의 SHA-256 이 테스트 상수 `VECTORS_SHA256` 과 같다. 네 테스트의 상수가 같으므로 한 복사본만 바뀌면 그 서비스 빌드가 실패한다.
- `everyRowGivesTheSharedResult`: `mask`(4규칙), `cut`(꼬리 버림 + 마스킹), `raw`·`trace`·`span`(`TraceIds`) 줄마다 기대값과 같다.
- `cutRowsLeaveNoPartialTokenInTheOutputMessage`: `cut` 줄의 `|` 가 정확히 사전 자르기 지점(32 KiB)에 오게 앞을 `secret=xxx…` 로 채워 provider 에 넣고, 출력 `message` 가 `secret=**** <기대값>` 인지 본다.

표를 바꿀 때는 네 복사본을 같이 바꾸고, `shasum -a 256` 결과로 네 테스트의 `VECTORS_SHA256` 을 같이 바꾼다. 한계: 한 서비스의 표·상수·코드를 함께 바꾸면 그 서비스만으로는 다른 세 서비스와 어긋난 것을 알 수 없다. 네 복사본을 서로 비교하는 검사는 CI 경로 필터상 네 서비스 변경 모두에서 도는 자리가 없어 넣지 않았다.

Lua 쪽은 `server/observability/fluent-bit/local-test/mask_cases.py` 가 같은 표(data-api 복사본)의 `cut` 줄만 읽어 로컬 Fluent Bit 4.2.8 컨테이너(`--network none`)의 `finalize` 에 넣는다. `mask` 줄은 읽지 않는다 — Lua 마스킹은 키 목록이 더 넓고 Java 와 결과가 다를 수 있는 근사(파일 머리 주석)다. CI 에서는 돌지 않는다.

```bash
python3 server/observability/fluent-bit/local-test/mask_cases.py
```

## 깊은 스택 예외 인코딩 비용

원인: 예외 문자열 전체(깊이 800 이면 약 46 KB)에 마스킹 정규식 4개를 차례로 돌렸다. 스택에는 민감 키도 `@` 도 없는데 키=값·이메일 정규식이 비용의 대부분이었다.

개선: 마스킹 결과를 바꾸지 않는 사전 거르기 두 개를 넣었다(네 서비스 같음, `logs.lua` 의 기존 거르기와 같은 조건).

- 입력에 민감 키가 하나도 없으면 키=값 정규식을 건너뛴다. 검사는 ASCII 대소문자만 무시하고 새 문자열을 만들지 않는 선형 스캔이다(`toLowerCase` 는 `İ` 반복 입력에서 16384자에 약 800 MB 를 할당해 쓰지 않는다). `(?i)` 도 ASCII 만 무시하므로, 키가 없으면 매치도 없다.
- `@` 가 없으면 이메일 정규식을 건너뛴다.

휴대폰·주민번호 정규식은 그대로 돈다. 스택이나 메시지에 `@`(예: `Object@1a2b`)나 민감 키 단어가 있으면 해당 정규식도 그대로 돈다.

측정: `LoggingEncodingPerfTest`(이미 깊이 800 시나리오가 있다). 로컬 macOS(Apple M5 Pro), Corretto 21.0.11, 단일 JVM, 대표 부하 아님, 인코딩 한 건 비용(µs). 같은 기계에서 변경 전 2회·변경 후 2회 실행했다. 옛 패턴도 `MaskingConverter.mask` 를 쓰므로 함께 빨라졌다.

```bash
cd server/data-api
LOGGING_PERF=1 SPRING_PROFILES_ACTIVE=ci ./gradlew cleanTest test --no-daemon --tests '*LoggingEncodingPerfTest'
```

| 시나리오 | 방식 | 전 p50 (1회·2회) | 후 p50 (1회·2회) | 전 p99 (1회·2회) | 후 p99 (1회·2회) | 출력 바이트 전→후 |
| --- | --- | --- | --- | --- | --- | --- |
| 짧은 줄(약 60B) | 옛 패턴 | 2.2 · 2.3 | 1.1 · 1.0 | 13.7 · 14.9 | 8.3 · 6.4 | 145 → 145 |
| 짧은 줄(약 60B) | 새 JSON | 11.0 · 9.5 | 13.9 · 10.7 | 59.5 · 65.9 | 75.6 · 52.0 | 581 → 581 |
| 4 KiB 메시지 | 옛 패턴 | 235.8 · 239.7 | 39.5 · 35.8 | 426.4 · 442.7 | 117.0 · 84.7 | 4208 → 4208 |
| 4 KiB 메시지 | 새 JSON | 253.5 · 249.5 | 51.6 · 48.0 | 447.5 · 443.3 | 153.6 · 117.8 | 4644 → 4644 |
| 40 KiB 메시지(JSON 은 16 KiB 로 자름) | 옛 패턴 | 2745.9 · 2561.4 | 387.8 · 364.9 | 3746.4 · 3717.6 | 651.0 · 661.8 | 41072 → 41072 |
| 40 KiB 메시지(JSON 은 16 KiB 로 자름) | 새 JSON | 2143.5 · 2122.5 | 363.4 · 334.4 | 3126.5 · 2920.5 | 618.8 · 612.5 | 16977 → 16977 |
| 스택 포함(깊이 40) | 옛 패턴 | 2.8 · 2.7 | 2.2 · 2.3 | 9.9 · 13.2 | 10.1 · 12.2 | 2414 → 2414 |
| 스택 포함(깊이 40) | 새 JSON | 150.4 · 143.5 | 36.8 · 38.2 | 285.2 · 295.9 | 87.6 · 129.6 | 2946 → 2946 |
| 스택 포함(깊이 800, JSON 은 32 KiB 로 자름) | 옛 패턴 | 71.3 · 42.9 | 41.0 · 59.9 | 201.1 · 158.6 | 122.8 · 191.0 | 46054 → 46054 |
| 스택 포함(깊이 800, JSON 은 32 KiB 로 자름) | 새 JSON | 3623.5 · 3136.3 | 629.1 · 798.7 | 4795.1 · 4267.4 | 1016.8 · 1539.0 | 34534 → 34534 |

읽는 법: 깊이 800 새 JSON p50 은 3.1~3.6 ms → 0.6~0.8 ms, 깊이 40 은 약 145 µs → 약 37 µs. 측정 입력(`x` 반복, 합성 스택)에 키·`@` 가 없어 두 정규식이 모두 빠진 경우다. 실제 로그에 키·`@` 가 있으면 줄어드는 폭이 작다. 짧은 줄은 두 번의 차이가 실행 간 흔들림 안이라 개선이라고 보지 않는다. 출력 바이트가 모든 시나리오에서 같다. 이는 결과가 같다는 정황일 뿐이다. 결과가 같은 근거는 위 두 조건(키·`@` 없이는 그 정규식이 매치할 수 없다)이고, 입력표의 대소문자 섞인 키(`Secret:`·`CVV=`·`"accessToken"`)와 `@` 없는 줄이 예시로 확인한다.
