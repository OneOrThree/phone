# 로그 통합 티켓과 구현 현황

작성: 2026-10-29. 구현 기준: `main`의 `81ef2140ab87f3c0f2bfb741bc3c6ae09f3c9932`.
작업 브랜치: `bfeat/GROMO-2553-request-log-context`.

기존 작업 폴더의 변경과 분리한 worktree에서 작업한다. 아래 **로컬 구현·검증**은 배포·S3 적재·Datadog 실측 완료를 뜻하지 않는다. 2553의 구현은 `epic-batch` 인계 커밋으로 보존한다. 티켓별 PR 생성·리뷰와 나머지 구현은 에픽 배치에서 이어간다.

## 티켓과 선후관계

전체 티켓은 조재영 담당, `관측·분석` 도메인이다. 2026-10-29 사용자 지시로 [에픽 2562](https://romance.atlassian.net/browse/GROMO-2562)에 8개를 묶고, 에픽 포함 9개를 활성 **SCRUM Sprint 17**(id 469, 2026-11-01 종료)에 넣었다. 개별 기한은 별도로 지정하지 않았다. 예상 시간은 계획용 추정이며 실제 소요 시간이나 납기 약속이 아니다.

| 티켓 | 검증 가능한 작업 단위 | 선행 | 초기 예상 | 현황 |
| --- | --- | --- | --- | --- |
| [2553](https://romance.atlassian.net/browse/GROMO-2553) | Business 요청 → 조합 worker → HTTP worker → Data 요청 로그 연결 | 없음 | 8h | 진행 중, 아래 로컬 구현 |
| [2554](https://romance.atlassian.net/browse/GROMO-2554) | 실제 수집 경로·버전·용량·IAM·보존·업로더 조사 | 없음, 2553과 병행 | 4h | dev 실측·Datadog 조회 완료, AWS·prod 미확인 → [조사표](runtime-inventory.md) |
| [2555](https://romance.atlassian.net/browse/GROMO-2555) | 4개 JVM JSON → Fluent Bit → dev Loki 조회 | 2553·2554 | 2d | 스프린트 대기 |
| [2556](https://romance.atlassian.net/browse/GROMO-2556) | 시스템/Nginx 원본 → S3·장애 복구·컷오버 | 2555 | 2d | 스프린트 대기 |
| [2557](https://romance.atlassian.net/browse/GROMO-2557) | Outbox → Kafka/HTTP 소비·재시도 원인 연결 | 2555 | 2d | 스프린트 대기 |
| [2558](https://romance.atlassian.net/browse/GROMO-2558) | 여러 원사건 → 기기별 묶음 발송 연결 | 2557 | 1d | 스프린트 대기 |
| [2559](https://romance.atlassian.net/browse/GROMO-2559) | Realtime Redis 2개 채널·STOMP·구버전 호환 | 2555·2557 | 2d | 스프린트 대기 |
| [2560](https://romance.atlassian.net/browse/GROMO-2560) | 통합 조회·Athena·APM/지표 연결·운영 검증 | 2556·2558·2559 | 2d | 스프린트 대기 |

Jira에도 위 방향의 `Blocks` 링크를 등록했다. 2554는 실제 환경 접근·인프라 확인이 필요한 작업이고, 나머지는 로컬 구현·검증을 진행할 수 있다. 수집기 운영 활성화는 2554 결과를 먼저 확인한다.

기존 [790](https://romance.atlassian.net/browse/GROMO-790)은 user-activity Fluent Bit 전환, [924](https://romance.atlassian.net/browse/GROMO-924)는 Java S3 업로더 제안, [2288](https://romance.atlassian.net/browse/GROMO-2288)은 새 prod·호스트 업로더 구축이다. 2556과 관련 링크만 연결했으며 담당자·상태·범위를 바꾸지 않았다. 신규 수집은 `system_log/v2/`를 다루고, Java S3 업로더를 추가하지 않는다. 실제 컷오버에서 실행 중인 2288 업로더와 중복을 확인해야 한다.

## 2553에서 구현한 경로

1. Business `RequestEnvelopeFilter`가 생성한 ID를 `RequestLogContext`로 MDC `request_id`에 설치한다. 응답의 `X-Request-Id`와 같으며, 외부 동명 헤더를 채택하지 않는다.
2. `ScreenComposer`가 원래 사용하는 `UpstreamRequestContext.within`에 같은 scope를 적용한다. MDC 전체를 복사하지 않고 명시적인 context의 ID만 사용한다.
3. `InternalHttpClient`의 두 번째 worker도 `context.within` 안에서 실행한다. 같은 ID는 HTTP `X-Request-Id`로 전달된다. 기존 Future·queue·cancel/remove 구조를 유지한다.
4. Data `TraceIdFilter`는 `X-Request-Id`를 별도로 검증해 `request_id`에 넣는다. `X-Trace-Id → X-Request-Id → 생성` 순서의 기존 `trace_id` 호환 계약은 유지한다. ID는 `[A-Za-z0-9_-]{1,128}`로 제한한다.
5. Data는 본인이 소유한 `trace_id`·`request_id`·`user_id`의 이전 값만 복원한다. Business도 자신의 `request_id`만 복원한다. `MDC.clear()`로 tracer·다른 필터의 키를 삭제하지 않으며, `dd.*`를 부모 스레드에서 복사하지 않는다.
6. Business의 Boot Logback level 패턴과 Data의 기존 APP 콘솔/파일 패턴에 `[request_id=...]`를 넣는다. 원본 텍스트에서 이 값으로 두 서비스 로그를 모아 볼 수 있다.

Data에 `X-Request-Id`가 없으면 검증된 레거시 상관 ID를 fallback으로 사용한다. 헤더가 있지만 형식 검사를 통과하지 못하면 새 ID를 생성한다. **이 request ID와 기존 trace_id를 Datadog APM trace ID라고 해석하지 않는다.** 정규화된 APM JSON 필드는 2555 범위다.

최신 main에 `InternalCall`의 `X-Request-Id` 대소문자 무관 차단이 이미 있어 별도 구현은 하지 않았다. 회귀 테스트로 헤더 덮어쓰기를 확인한다. 같은 main에서 Data의 `/internal/*` 등록도 이미 적용되어 있어 등록 범위를 바꾸지 않았다.

## 검증 기록

- 실제 loopback HTTP 서버를 통한 요청 필터 → 조합 pool → HTTP pool 테스트: 서버 수신 헤더·응답 DTO·세 스레드의 로그 MDC가 같은 요청 ID인지 검증한다. 같은 pool을 두 요청이 재사용해도 새 ID가 적용된다.
- 중첩 scope·예외·재사용 thread: 이전 request ID와 context 복원, 다른 MDC 변경 보존, tracer/개인 키의 부모→worker 복사 없음.
- Data 필터: request ID와 레거시 trace ID가 다를 때 분리, 잘못된 문자·길이의 입력 거부, 사용자 없는 요청에서 상위 user_id 누출 방지, 예외 후 tracer·상위 문맥 보존.
- 기존 HTTP 실제 TCP 테스트: deadline·TLS 대기·본문 지연·취소·큐 포화·재시도·서킷 회복·예약 헤더 보호.

| 범위 | 실행 명령 | 결과 |
| --- | --- | --- |
| Business 전체 | `cd server/business-api && ./gradlew build --console=plain` | 성공. 테스트 2,196개, 실패·오류·skip 0. Checkstyle Main·SpotBugs Main·JAR 빌드 통과 |
| Data 필터 | `cd server/data-api && SPRING_PROFILES_ACTIVE=ci ./gradlew test --tests '*TraceIdFilterTest' checkstyleMain spotbugsMain --console=plain` | 성공. 필터 테스트 22개, 실패·오류·skip 0. Main 정적 검사 통과 |
| 문서·변경 | 상대 링크 존재 검사, `git diff --check` | 상대 링크 78개 정상, 공백 오류 없음 |

Business의 Checkstyle Test·SpotBugs Test는 저장소 설정에 따라 비활성이다. Data의 전체 DB 통합 테스트를 실행한 것으로 해석하지 않는다. 운영 로그 내용이나 자격증명을 테스트 fixture에 사용하지 않았다.

## 아직 구현하지 않은 경계

- 이 첫 티켓은 요청 ID의 동기 HTTP 경로를 연결한다. Preview worker, Outbox 영속 carrier, Kafka/Redis/STOMP, Notification 묶음 전송은 후속 범위다.
- Data 인증 실패는 TraceIdFilter 앞에서 끝나므로 이번 구현만으로 Data의 모든 401/403 로그에 요청 ID가 생기지 않는다. 인증 이전 scope·인증 이후 사용자 보강, async/error dispatch의 최종 access 상태는 2555에서 검증한다.
- 기존 Business access log의 미처리 예외/async 요청 최종 상태 판정은 이번에 변경하지 않았다. 해당 access 로그 status만으로 500 여부를 판단하지 않는다.
- DD agent 활성 상태의 span 전파, sample 미보관 시 조회, 로그 JSON·마스킹·log_id, Loki/S3 수집·재전송·중복 제거·보존·부하 영향은 아직 미검증이다.
- 구현 기준 main에서 Data의 `AsyncConfig`·`NotificationAsyncConfig`는 삭제됐다. 초기 계획의 레거시 GA4/push executor를 복원하지 않는다.
- Infra 정본은 2288에서 확인한 `OneOrThree/Infra`다. 실제 수집 설정·운영 버전은 2554에서 재확인한다.

## epic-batch 실행

사용자가 `/epic-batch`를 명시 호출했다. 기준 스킬은 `~/.claude/skills/epic-batch/SKILL.md`와 그 선행 `parallel/SKILL.md`다.

- 에픽 통합 브랜치: `feat/GROMO-2562-log-observability`, 기준 `origin/main`.
- 기존 2553 브랜치를 첫 하위 PR로 재사용한다. 이후 파일 충돌 경계별 체인에서 티켓별 PR을 쌓는다.
- 기본 모드로 실행하며 `--merge-sub`는 지정하지 않았다. 사용자 머지 뒤 통합 PR을 main에 준비한다.
- 조정자는 계약·브리프·검증·git·PR·리뷰를 맡고, 구현은 Claude 하위 에이전트에 배분한다.
- 운영 환경 조사·자격 접근 불가 항목은 증거와 함께 미검증으로 남긴다. 실제 서비스 재시작·배포·Terraform apply는 이번 실행에 포함하지 않는다.
- 설계·진행·검증은 이 `docs/architecture/server-log-observability/`에 계속 남긴다. 개인 작업 브리프·세션 기록만 gitignored `doc/`를 쓴다.
