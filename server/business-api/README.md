# Business API (`server/business-api`)

앱이 들어오는 유일한 표면이자 코어·위성 조합의 주체다(목표 아키텍처 §2 · A22 ㊫).

> **이것은 최소 구현이다.** 1661 의 전체 BFF/IdP 이전과 구분한다 — 여기 있는 것은 「링크·알림 위성을
> 조합해야만 성립하는 기존 외부 경로」와 「이관 정지 창의 구·신 조합」뿐이다. 인증 발급(AT 서명 ·
> refresh 회전 · logout · 최초 로그인 RT 2단계 · 소셜 선택적 인증)과 그 밖의 패스스루는 **아직 Data
> API 에 남아 있다.** 전환 기간에 이 서비스는 legacy issuer 가 서명한 AT 를 **검증만** 한다.

## 없는 것이 계약이다

| 없는 것 | 왜 |
| --- | --- |
| DB · 트랜잭션 | §2 「안 하는 일」. `build.gradle` 에 JPA·Flyway 의존성 자체를 넣지 않아, 나중에 누가 저장소를 붙이려 하면 빌드 파일에서 먼저 걸린다 |
| 크론(`@Scheduled`) | §6. 재개가 필요한 단 하나의 동작(claim 의도)은 **운영자가 실행하는 일회성 CLI** 로 두어 스케줄을 런북에 남겼다 |
| FCM 발송 경로 | 신 서버의 모든 발송은 공통 `dispatch_enabled` 게이트 뒤에서만 일어난다(A22 ㋭). **발송 경로가 없는 것이 그 게이트를 지키는 방법**이다 |
| 링크 `confirm`·`revoke`·`withdraw` 호출 | claim 확정 전달은 Data 의 락 아래 outbox + relay 가 한다(A22 ㋟). Business 가 응답을 받은 뒤 보내면 그때는 이미 락이 풀려 그 사이 revoke 가 끼어든다. 있으면 누가 그 경로를 쓴다 |
| 범용 프록시 | 인바운드 헤더를 복사할 통로가 없다. `InternalCall` 이 `Authorization`·`X-User-Id` 를 거부하고, 경로는 각 클라이언트의 상수뿐이다 |

## 보안 경계 두 줄

1. **AT 검증** — 서명 · 만료 · `type=access` · subject UUID. refresh 는 서명이 맞아도 거절한다(같은 키로
   서명되므로 서명 검증만으로는 구분되지 않고, 수명 30일 RT 로 위성 쓰기에 닿으면 AT 1시간 만료 정책이
   통째로 무력화된다).
2. **외부 `X-User-Id` 폐기 후 재설정**(A22 ㉸) — Data 가 `JwtFilter` 를 떼고 이 헤더를 신뢰하게 되므로,
   앱 헤더가 새어 들어가면 정상 AT 를 가진 사용자가 **남의 데이터를 읽고 쓴다**. 필터 통과 후로는
   인바운드 헤더에서 온 사용자 신원이 존재하지 않는다.

`gen` claim 은 **없으면 없는 채로 흘린다.** 구 AT 에는 `gen` 이 없는데(현 `JwtProvider` 는 `type`·`guest`
만 싣는다) Data 의 현재 세대로 채우면 로그아웃 전에 발급된 옛 AT 가 최신 세대로 태깅돼 **기기 토큰
tombstone 을 우회**한다(A22 ㊍).

## 외부 경로 (기존 URI·성공상태·오류코드 보존)

| Method · Path | 조합 | 성공 |
| --- | --- | --- |
| `POST /api/v1/groups/{groupId}/invite-link` | 활성검사 → Data 발급컨텍스트 → Link 발급 | 200 `{slug, url}` |
| `POST /api/v1/invite-links/claim` | 활성검사 → Data 내구적재 → Link 잠정claim → Data 확정 | 200 (정지 창엔 202) |
| `PUT /api/v1/users/me/device-token` | 활성검사 → (bootstrap 시) Data 세션확인 → Noti 등록 | 200 `{ownershipToken}` |
| `DELETE /api/v1/users/me/device-token` | Data outbox **먼저** → Noti 직접삭제 → 완료표시 | 204 |
| `PUT /api/v1/users/me/notification-settings` | 활성검사 → Data 내구명령 → Noti 적용(version) | 204 |
| `GET /api/v1/users/me/notification-settings` | Noti **정본** 조회 | 200 5필드 |
| `POST /api/v1/me/challenge-results/{sessionId}/claim` | Data 단독 (재시도 없음) | 200 |
| `POST /api/v1/me/challenge-results/{sessionId}/ack` | Noti prepare → Data ack → Noti commit | 200 |
| `POST /l/match` | **한시**, 무인증. 구 후보 조회 + Neon 소진 | 200 `{matched…}` |

`GET /me/challenge-results` 같은 순수 Data 읽기는 **여기 오지 않는다** — 위성 조합이 필요하지 않아
1661 의 전체 전환 때 함께 옮긴다. 최소 Business 의 범위를 넓히지 않는다.

## 실패 분류 — 「아니오」로 접지 않는다

| 상류 응답 | 결과 | 왜 |
| --- | --- | --- |
| `code` 실린 4xx | **그대로 중계** | 앱이 `GROUP_NOT_FOUND`·`RESULT_CLAIM_HELD` 같은 문자열로 분기한다. 재해석하면 그 분기가 조용히 빠진다 |
| `code` 없는 401/403 | 502 | **우리** 서비스 토큰 문제다. 401 을 주면 정상 세션이 전부 재로그인으로 튄다 |
| `code` 없는 그 밖 4xx | 502 | 배선·계약 어긋남. 400 으로 접으면 「잘못된 요청」으로 숨는다 |
| 5xx · 타임아웃 · 서킷 | 503 | 「모른다」다. 정상 응답으로 접으면 되돌릴 수 없는 `matched:false` 나 토큰 영구 유실이 된다 |

## 재시도 · 멱등

재시도 대상은 **멱등 GET + 명시적으로 멱등을 선언한 명령**뿐이다(§4). GET 만 재시도하면 로그아웃의
기기 토큰 삭제가 일시 오류 한 번에 영구 실패하고, 앱은 그 실패를 삼키고 로컬 토큰을 지워 사용자가
재시도할 방법이 없다. 결과 선점·ack 는 조건부 원자 UPDATE 라 **재시도하지 않는다**.

`Idempotency-Key` 는 **앱이 소유**한다(A22 ㉼). Business 는 그 값에 단계별 접미(`:<step>`)를 붙여
파생하고, **재시도에서 같은 값을 유지**한다. 구 앱은 키를 안 보내므로 매 호출 새 키가 되고, 그 기간엔
「Business 내부 재시도만 보호」로 인정한다. **요청 본문 해시를 영구 멱등키로 쓰지 않는다**(A22 ㊞).

시간 예산은 **재시도까지 합친 전체**다 — 구 앱 match 5초(`deferredInvite.ts:100`), claim 15초
(`api.ts:215-218`). 예산을 넘긴 재시도는 앱이 이미 끊은 뒤에 성공한다.

## 남은 통합 의존성 (전부 미구현)

> **이 서비스만으로는 동작하지 않는다.** 아래 세 제공자가 붙기 전에는 런타임에 연결되지 않으며,
> 테스트의 mock 성공이 그 사실을 대신하지 않는다.

### Data API — `/internal/*` 컨트롤러 **0건**
실제 확인: `grep -rn "/internal" server/data-api/src/main/java` → 0건 (main `69d05f873`).
필요한 14개 경로는 `docs/contracts/business-satellite-api.yaml` 에 스키마·상태·멱등까지 정의했다.
가장 놓치기 쉬운 것들:
- `activation` 응답에 **`authGeneration` 을 담지 말 것** — 담으면 AT 의 빈 `gen` 을 채우려는 유혹이
  생기고 그게 tombstone 우회다(㊍).
- `invite-issue-context` 의 `membershipEpoch` 와 `linkVersion` 은 **발급 경로에서 같은 값**이어야 한다
  (링크가 `ISSUE_EPOCH_MISMATCH` 400 을 준다). 갈리는 것은 폐기뿐이다.
- `claim-intents` 조회는 **원래 `idempotencyKey` 를 저장해 돌려줘야** 한다. 재개 CLI 가 새 키를 만들면
  클릭을 하나 더 소진한다. 그리고 **`pendingTotal`**(인플라이트 포함 전체 미완료)을 줘야 한다 —
  「빈 페이지 = 전부 완료」로 접으면 미완료를 남긴 채 절차가 넘어간다.
- `claim-intents/{id}/lease` 는 **`leaseToken` 을 발급**하고 `.../completed` 는 그것으로 **CAS** 해야
  한다. 없으면 임대 만료 뒤 깨어난 옛 작업자가 새 임대의 작업을 완료로 뺀다.
- 커서는 **시각이 아니라 commit sequence** — 시각 커서는 늦게 커밋된 행을 영구히 건너뛴다(㋖).
- `DurableCommandAck.version` 은 **aggregate 행 잠금 아래** 발급(㊸).

### 알림 서버 — 구현 중 (N 담당)
`/internal/devices`(POST·DELETE) · `/internal/users/{id}/notification-settings`(GET·PUT) ·
`result-ack/{prepare,commit,abort}`. 그리고 **알림 → Data 의
`GET /internal/users/{id}/result-ack`** 이 반드시 있어야 한다 — 없으면 「롤백 직후 프로세스가 죽는
구간」에서 abort 행이 안 생겨 **영구 억제가 실재**한다(A22 ⓓ).

### 링크 서버 — 구현 중 (coordinator 직접)
`link/src/lib/{links,migration}.ts` 를 읽어 맞췄다: `POST /internal/links` ·
`POST /internal/links/{slug}/claim` · `POST /internal/links/match`. **확정 OpenAPI 가 나오면 다시
대조해야 한다.**

## 이관 정지 창 (§7.2)

기본값이 전부 **꺼짐**이다. 컷오버 후 제거가 계약이므로(A22 ㊫) 켜진 채 배포되면 라우팅이 바뀐 뒤에도
구 경로가 남아 이중 소진 위험이 생긴다.

```
COMPAT_MATCH_HANDLER_ENABLED=false   # 한시 /l/match
COMPAT_IMPORT_CONTRACT_READY=false   # 구 후보 → Neon 이관 계약 준비 여부
BUSINESS_COMPAT_CLAIM_QUEUE_REPLAY_ENABLED=false  # 202 허용 여부
```

**소진은 Neon 한 곳에서만**(A22 ㊥). 매치는 읽기가 아니라 쓰기라, 양쪽에서 소진하면 잠금이 공유되지
않아 **같은 클릭이 두 기기에 배정**된다. `IMPORT_CONTRACT_READY=false` 인 동안은 구 후보를 조회해
**세기만** 하고, 요청에 `migrationId` 를 **싣지 않는다** — 링크 서버는 그 필드가 있으면 import 모드로
들어가 `openRun` 을 요구하므로 `IMPORT_CLOSED` 이후엔 빈 배열을 보내도 503 이 된다.

### claim 의도 재개 CLI

`202` 는 「나중에 누가 끝낸다」는 약속인데, 그 주체가 될 수 있는 것이 셋 다 막혀 있다 — Business 에
크론을 넣으면 §6 이 깨지고, Data 는 링크를 relay 허용목록 밖으로 부를 수 없고(§3), 링크는 코어를 부를
수 없다. 그래서 **같은 이미지를 일회성 job 으로 띄운다**:

```bash
docker run --rm --env-file business.env \
  -e BUSINESS_CLAIM_REPLAY_ENABLED=true \
  "$BUSINESS_API_IMAGE"
```

원래 `Idempotency-Key` 로 재생한다(새 키를 만들면 링크의 멱등 저장이 «새 명령»으로 보아 **클릭을
하나 더 소진**한다).

**lease 는 `leaseToken` 으로 CAS 한다.** `leased`/만료시각만으로는 안 닫힌다 — 임대가 만료된 뒤 깨어난
옛 작업자가 **「새 임대 소유자의 작업」을 완료 표시**해, 확정되지 않은 claim 이 큐에서 사라지고 귀속이
조용히 유실된다. 기기 토큰 소유권의 `ownershipToken`(A22 ㊚)과 같은 패턴이다: 서버 상태만 보면
「지연된 옛 요청」과 「정상적인 새 요청」을 구별할 수 없으므로 **값을 요청에도 실어야** 순서를 가른다.
토큰이 오지 않으면 CLI 는 완료 표시하지 않고 실패로 센다.

**「미완료 0」은 빈 페이지가 아니다.** 한 순회의 빈 목록은 「지금 집을 것이 없다」는 뜻일 뿐이고,
다른 작업자의 lease·재시도 예정·커서가 지난 뒤 적재된 행이 남아 있다. 그래서 ⓐ 진행이 있는 동안
**커서를 처음부터 다시** 순회하고 ⓑ gate 는 `pendingTotal`(인플라이트 포함 전체 미완료)로 판정한다.
CLI 는 **실패가 남았을 때와 `pendingTotal` 이 남았을 때 모두 비정상 종료**한다 — 어느 쪽이든 삼키면
미완료를 남긴 채 §7.2 가 다음 단계로 넘어간다. 미완료 0 을 확인한 뒤에만
`BUSINESS_COMPAT_CLAIM_QUEUE_REPLAY_ENABLED` 를 끈다.

**서빙 컨테이너에는 `BUSINESS_CLAIM_REPLAY_ENABLED` 를 절대 넣지 않는다.**

## 실행 · 검증

```bash
export JAVA_HOME=/Users/jojaeyoung/Library/Java/JavaVirtualMachines/corretto-17.0.10/Contents/Home
SPRING_PROFILES_ACTIVE=ci ./gradlew build   # 테스트 + checkstyleMain + spotbugsMain
```

테스트는 **실제 필터 체인 + 실제 컨트롤러 + 실제 클라이언트**를 띄우고 상류만 JDK 내장 `HttpServer`
(`MockUpstream`)로 바꾼다. 클라이언트를 모킹하면 이 서비스의 계약 대부분(어떤 헤더가 나가는가, 재시도에서
그 헤더가 유지되는가, 상태별로 실패가 어떻게 갈라지는가)이 검증 대상에서 빠진다.

포트: 서비스 8080(`SERVER_PORT`), 관리 9091. **9091 은 호스트에 publish 하지 않는다** — 포트 격리가
`/actuator/*` 를 사설로 유지하는 유일한 수단이다. compose 헬스체크용으로 서비스 포트에 정보를 담지 않는
`GET /health` 하나를 둔다.

## 실행한 원시 검사 결과 (2026-09-11)

| 검사 | 결과 |
| --- | --- |
| `SPRING_PROFILES_ACTIVE=ci ./gradlew build` | **exit 0** — 91 tests / 0 failures / 0 errors (`test` + `checkstyleMain` + `spotbugsMain`) |
| `docker build -t business-api-verify:local .` | **exit 0** |
| 컨테이너 부팅(prod 프로파일, 합성 시크릿) | `Started BusinessApplication`, `GET /health` → **200** `{"status":"UP"}` |
| 무인증 `GET /api/v1/users/me/notification-settings` | **401** `{"code":"UNAUTHORIZED",…}` |
| 서비스 포트로 `GET /actuator/health` | **404** `ENDPOINT_NOT_FOUND` (관리 포트 9091 격리 확인) |
| 매핑 없는 `GET /nope` | **404** `{"code":"ENDPOINT_NOT_FOUND",…}` |
| `POST /l/match` (한시 핸들러 꺼짐) | **404** `{"code":"COMPAT_HANDLER_DISABLED",…}` |
| 필수 시크릿 **빈 값** | **exit 1** — `IllegalStateException: LINK service-token 미설정` |
| 필수 시크릿 **부재** | **exit 1** — `LINK service-token 이 치환되지 않았다: ${SVC_TOKEN_BIZ_TO_LINK}` |

### 이 검증에서 실제로 잡은 결함 두 건

**① 필수 시크릿이 「부재」일 때 fail-fast 가 동작하지 않았다.**
`application-prod.yml` 은 기본값 없는 `${SVC_TOKEN_BIZ_TO_LINK}` 만 두므로 변수가 없으면 부팅이 실패할
것으로 기대했지만, **Spring 은 값을 리터럴 `"${SVC_TOKEN_BIZ_TO_LINK}"` 로 남기고 부팅에 성공**했다
(`Started BusinessApplication` 까지 확인). blank 검사는 그 리터럴을 통과시킨다.

그 상태는 정확히 막으려던 것이다 — 리터럴이 Bearer 토큰으로 나가 상류가 전부 401 을 주고, 그 401 은
운영에서 「인증 장애」로 보여 **원인이 시크릿 미주입이라는 사실이 가려진다**. 그리고 이 경로는 가설이
아니다: dev 배포의 env 생성기는 **고정 허용목록에 있는 키만 출력**하므로(A22 ㋯), 새 키를 그 목록에
추가하는 것을 빠뜨리면 변수는 「없는」 상태가 된다. **가장 일어나기 쉬운 실수가 곧 이 구멍이었다.**
→ `RequiredConfig` 가 `${...}` 리터럴을 거절하고, 메시지에 **변수 이름**을 담아 어느 env 키가 빠졌는지
바로 알려 준다(치환되지 않았으므로 비밀이 아니다). `jwt.secret`·`link.ip-salt`·`base-url` 에도 적용했다 —
특히 `jwt.secret` 리터럴은 32바이트를 넘어 **HS256 키로 「성립」**하므로 막지 않으면 legacy issuer 와 다른
키로 조용히 떠서 모든 AT 가 401 이 된다.

**② 매핑되지 않은 경로가 500 이었다.**
전역 핸들러의 `Exception` 그물에 걸려 500 이 나왔다 — 관리 포트 격리가 **정상 동작**한 것인데(서비스
포트에 `/actuator/*` 가 없다) 응답은 「서버 장애」로 보였다. → `NoResourceFoundException` 을 404
`ENDPOINT_NOT_FOUND` 로 매핑했다. `NOT_FOUND` 라는 이름은 쓰지 않는다 — 앱이 그 문자열을 「그룹이
사라짐」으로 해석하는 분기가 17곳이다(GROMO-1725).

> **운영 완료가 아니다.** 위는 전부 로컬 검사다. Data `/internal/*` 제공자가 0건이므로 이 서비스는
> 아직 어떤 환경에서도 실제 트래픽을 처리할 수 없다. dev 배포·prod 전환은 미실행이다.
