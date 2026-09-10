# 목표 아키텍처 — 결정 장부 (A1~A19)

> 팀 공유 정본. `service-architecture.md`·`system-architecture.md` 와 어긋나면 **이 장부가 맞다**. 새 결정은 A 번호를 이어서 추가하고, 뒤집힌 결정은 지우지 말고 취소선 + 후속 번호로 남긴다.
> 결정자: 조재영. 2026-09-09~10 브레인스토밍. 잠정 = `(잠정)`, 보류 = `(보류)`.
> 본문의 숫자만 있는 티켓 번호(1643 · 1658 · 1659 · 1660 · 1661 · 1695 …)는 전부 Jira **GROMO-####** 이다(예: 1658 = GROMO-1658). "후속 논의"는 같은 날 뒤이어 진행된 다른 설계 세션(MQ · 레포 분리)을 뜻한다.

## 산출물

| 파일 | 내용 |
|---|---|
| `service-architecture.md` | 논리 — 컴포넌트 · 책임 · 데이터 소유 · 의존 방향(단방향 규칙) · 통신 방식 · 배치의 자리 · 인증 경계. Target-1 / Target-2 두 장 |
| `system-architecture.md` | 물리 — 환경별(dev GCP · prod AWS) 배치 · 네트워크 노출면 · DB 3개 위치 · CI/CD 표준 · 관측 · 롤백. Target-1 / Target-2 |
| `diagrams/*.svg` | 직각 연결선 다이어그램 6장 (서비스 구도 · 배치 · 레포 · 랭킹 3시점) |

## 결정 로그

| # | 결정 | 근거 | 날짜 |
|---|---|---|---|
| A1 | **정본은 두 시점으로 나눈다** — Target-1 = 이번 분리 라운드(에픽 1643 + 알림 + 링크) 종료 시점: **MQ 포함(Kafka 단일 노드 컨테이너, A12 확정) · Redis 없음**. Target-2 = 관리형 MQ · Redis · 워커 분리. ~~MQ 없음·HTTP 이벤트~~ 는 09-09 후속 논의(1658 MQ)에서 뒤집힘. | 08-25 시안이 이상형과 다음 분기를 한 장에 그려서 하루 만에 6곳이 뒤집혔다 | 09-09 (후속 수정) |
| A2 | **doc/ 에서 확정 → docs/architecture/ 승격.** 결정 과정은 개인, 결과만 공유. | 조재영 선택 | 09-09 |
| A3 | **팀 사이트 `/spec/architecture` 는 gromo 가 아닌 템플릿 내용(촬영·S3·인코딩 워커)** — 승격본으로 교체 또는 내림. | 09-08 확인. "팀이 실제로 남긴 설계 문서" 문구 아래 공개 중 | 09-09 |
| A4 | **정산·정리 크론은 Data API 가 돌린다** — `GroupBetScheduler` 3종 · `LeagueScheduler` 주간 · `FocusSessionOrphanScheduler`. D2("DB 서빙만")의 예외가 아니라 정의의 일부: **쓰기 불변식·트랜잭션 경계 = Data API 책임**(08-25 시안의 원문). 귀결: 정산 발 이벤트(`challenge.closed` · `bet.settled` · `league.settled`)는 Data API 가 발행. **이벤트 발행 주체 = 그 유스케이스를 완료한 프로세스**(요청형 = Business API, 배치 정산형 = Data API). 알림 D10 정정·D5 보강. | 조재영: "정산 정리는 data api". 정산은 5도메인 락 순서 TX 라 HTTP 로 쪼갤 수 없고 ShedLock 도 DB 가 필요 — DB 를 가진 프로세스가 돌리는 게 맞다 | 09-09 |
| A5 | **봇(`BotScheduler` · V48 리그 봇)은 폐기 예정** — Target-1 에 없음. | 조재영: "봇은 이제 빠질 거고" | 09-09 |
| A7 | **인증은 Business API 가 소유하되 상태는 Data API 에 둔다.** 소셜 로그인(IdP 검증)·게스트·AT 발급·`/auth/refresh`·logout 엔드포인트 = Business API. RT 저장·대조·회전·탈퇴(`is_deleted`) 검사 = Data API `/internal/auth/*` 명령. 흐름: 로그인 → Business API 가 IdP 검증 → Data API "유저 upsert + RT 저장" → Business API 가 AT 서명. refresh → Business API 가 Data API 에 RT 대조·회전 요청 → 통과 시 새 AT 서명. 매 요청 AT 검증은 서명·만료만(stateless), 탈퇴 유저는 Data API 호출에서 차단(AT 3600s 창은 조회 전용 경로라 수용). | 조재영: "인증 자체를 business api 로 이관하고, RT 들어오면 data api 에 인증". 진입점이 인증을 갖는 정석 + D2(상태는 Data API) 둘 다 만족 | 09-09 |
| A8 | **앱 트래픽은 전량 Business API 경유.** nginx 가 `/api/*`·`/auth/*` 를 전부 Business API 로 보내고, BFF 가 없는 엔드포인트는 Business API 가 Data API 로 **패스스루**(경로 전달 + `X-User-Id` + 서비스 토큰). Data API 는 공인 노출 0(`/health`·`/l/**`·`/.well-known/**` 은 nginx/link 서버 몫). JWT(HS256 `jwt.secret`)는 Business API 만 보유 — Data API 의 `JwtFilter` 는 제거되고 `/internal/*` 은 서비스 토큰 + `X-User-Id` 신뢰. | 조재영 선택. 인증·키 한 곳, Data API 내부화가 Target-1 에서 완성. 대가 = 홉 +1(사설망 ~1ms)·패스스루 라우터 | 09-09 |
| A9 | **Data API 내부 표면 규칙 (기본값 채택)** — ① `/internal/*` 단일 접두, 인증 = 서비스 토큰 + `X-User-Id`(배치 트리거 13종 포함해 `X-Batch-Admin-Key` 등 개별 가드 폐지) ② **조회는 정규 리소스 1개 + `ids` 배치 파라미터**, 새 엔드포인트 기준은 "새 리소스이거나 접근 패턴이 근본적으로 다를 때"뿐 — "새 화면이 생겨서"는 Business API 몫 ③ **쓰기는 유스케이스 단위 명령 API**(`POST /internal/focus-sessions/{id}/end` 처럼) — Business API 가 쓰기 여러 개를 순차 호출해 분산 TX 를 흉내 내는 것 금지 ④ 패스스루 기간엔 기존 133 컨트롤러가 `/internal/*` 뒤에서 그대로 서비스되고, BFF 로 대체된 것부터 폐기(08-25 표면 지도의 운명 분류 유지). | 08-25 분리 계획 §2·§3 을 A8 에 맞춰 확정. 질문 없이 채택(관례) | 09-09 |
| A10 | **알림 DB = 같은 RDS 인스턴스 안의 별도 database `gromo_notification`** (별도 DB 유저·별도 Flyway). dev 는 같은 Postgres 컨테이너에 database 2개. Postgres 는 DB 간 조인이 안 되므로 경계가 자동 강제. 별도 인스턴스는 Target-2 에서 부하가 보이면. | 조재영 선택. 비용 0·백업 그대로·경계 강제 | 09-09 |
| A11 | **시스템 표준 (기본값 채택)** — ① compose 파일은 환경당 1개 — **prod 컨테이너 6개**(nginx · business-api · data-api · notification · **kafka** · datadog-agent — 그중 JVM 서비스 3), **dev 는 7개**(+ Postgres `db`, DB 가 RDS 가 아니므로), 오버레이 방식 유지 ② 이미지 태그 `<service>:<sha>`, dev GAR / prod ECR ③ CI 는 `server` 레포 안 **경로 필터 매트릭스**(`services/<name>/**` → 그 서비스만 reusable `be-*.yml` + 이미지 빌드) ④ CD 는 같은 레포 `workflow_dispatch`(service · digest · env), 배포 매니페스트 `deploy/<env>.yml` 자동 커밋, 롤백 = 직전 digest ⑤ Datadog `DD_SERVICE` = `gromo-{business\|data\|notification}-{env}` ⑥ 시크릿 분리: `JWT_SECRET` 은 Business API 만, FCM 자격증명은 알림 서버만, DB 자격증명 2벌, 서비스 토큰 4종(business→data · business/data→notification · link콘솔→notification · core→link). | 관례·기존 파이프라인 연장. 질문 없이 채택 | 09-09 |
| A12 | **브로커 = Kafka KRaft 단일 노드 컨테이너**(`apache/kafka`, ZooKeeper 없음), 같은 compose. 조건 3: ① `KAFKA_HEAP_OPTS=-Xmx512m` · retention 7일 · 토픽 `notification-events`(파티션 3) + `.dlq` · **단일 노드라 내부 토픽 복제 계수를 1로 고정**(`KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1` — 기본 3 이면 `__consumer_offsets` 생성 실패로 컨슈머 그룹이 소비를 시작조차 못 한다 · 트랜잭션 프로듀서를 쓰면 `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1` · `KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1` 도) ② 재시도·DLQ 는 Spring Kafka `DefaultErrorHandler` + `DeadLetterPublishingRecoverer`(코드 ~40줄) ③ 로컬·CI 는 Testcontainers Kafka 통합 테스트 1개. 더 가벼워야 하면 **Redpanda**(Kafka API 호환, 메모리 절반, 코드 동일). **링크 서버(Vercel)는 브로커에 붙지 않는다** — 클릭은 link 가 Neon 에 직접 적재(단방향 유지). D19 는 "브로커 확정 뒤 브로커로 바로"로 수정 → **1659 P1 은 1658 이 끝나야 시작**: 순서 1658 ∥ 1660 → 1659. | 09-09 후속 논의(1658 MQ) 결론. Kafka 를 고른 이유 = 이벤트 스트림·리플레이·스택 학습, SQS 의 운영 인력 0 이점은 감수. 대가: 디스크·업그레이드·모니터링·DLQ 코드 우리 몫, 브로커가 앱과 같은 EC2 라 장애 반경 공유. **prod 가 t4g.small(2 GB)이면 불가 → 사양 실측 필수** | 09-09 **확정** — 조재영: "kafka 도커는 확정이고 이에 맞춰서 ec2 늘릴 거야" |
| A14 | **prod EC2 사이즈업 — 실측 확정: `gromo-prod` = t4g.medium(2 vCPU · 4 GB, arm64, ap-northeast-2a) → t4g.large(8 GB)**. 필요 메모리: JVM 3 의 **힙** 0.5+1+0.5 GB 는 실사용(메타스페이스·스레드 스택·다이렉트 버퍼)으로 **≈1.3~1.5배 = 2.6~3 GB** + Kafka 0.5~1 GB + nginx·agent·OS ≈ **4.5 GB 이상** → medium(4 GB) 불가. dev 도 e2-medium → **e2-standard-2(8 GB)**. **RDS 도 실측: `gromo-prod-db` = db.t4g.micro(2 vCPU · 1 GB RAM · 20 GB · single-AZ · PG 16.13)** — A10 대로 `gromo_notification` database 를 얹으면 1 GB RAM 과 `max_connections`(파라미터 공식 `LEAST(메모리/9531392, 5000)` → 1 GiB 에서 **≈112**)를 두 서비스가 나눠 씀 — data-api 풀은 Hikari 기본 10, 알림 ≤5 라 **커넥션은 여유, 병목은 RAM 1 GB** → Target-1 에서 **db.t4g.small(2 GB) 승격을 같이 검토**(진입 조건: 커넥션 대기·freeable memory 실측). | 조재영: "이에 맞춰서 ec2 늘릴 거야". 사이즈업 없이 t4g.small/medium 이면 Kafka 불가/빠듯 | 09-09 |
| ~~A13~~ → A17 | ~~**레포 구조 = GROMO-1695 결정을 따른다** — 앱은 `OneOrThree/app` 별도 레포, **새로 만드는 서비스는 각자 레포**(링크 1660 · 알림 1659 · Business API 1661), `server/data-api` 는 `phone` 에 남김. 배포 정의(compose · nginx · CD)의 소유자는 `phone`, 각 서비스 레포는 이미지를 빌드·푸시하고 `workflow_dispatch` 로 `phone` 의 CD 를 호출.~~ **서비스가 7개로 늘면서 A17 로 뒤집힘** — JVM 서비스는 `oneorthree/server` 한 레포, 배포 정의도 같은 레포라 레포 간 dispatch·토큰 불필요. | 원문 보존(취소선 정책). 뒤집은 근거는 A17 | 09-09 → 같은 날 후속 논의에서 개정 |
| A16 | **레포 분리의 1차 동기 = 하네스 정리 · 이력서 가독성** (배포 독립은 부수). 실측: CLAUDE.md 4개(루트 117 · 앱 414 · 서버 163), 루트 117줄 중 앱 관련 13줄이 서버 작업에도 로드, 메모리 105개 한 통, 전역 스킬 91개(phone 경로 하드코딩 0), 전역 훅 2개가 `phone/.claude/*.py` 하드코딩(저널·트러블 로그). 두 렌즈 채점: 분리+dispatch 가 관련도 ≈100%·레포=컴포넌트=README, 서브모듈은 절차 텍스트 추가·phone 이력이 봇 bump 커밋으로 오염 → 두 기준 다 최하. 레시피: phone 루트 ≈70줄로, 서비스 레포 CLAUDE.md ≈90줄(서버 163 템플릿 + docs/architecture 링크), 전역 훅 2개를 `~/.claude/hooks/` 로 옮기고 레포별 저널, README = 문제→결정→실측, 팀 사이트 contributions 레포 단위. | 조재영: "레포 분리의 이유가 하네스를 더 깔끔하게 가져가고 나중에 이력서에 넣을 때 읽기 쉽게" | 09-09 |
| A17 | **서비스가 7개(MMP · Notification · Documentation · Data API · Business API · Chat · File Upload)가 되면 "새 서비스마다 레포"(1695)를 재검토** — 이력서 링크는 어차피 **허브 1개**(docs/architecture 승격본 → 팀 사이트 `/spec/architecture` + 조직 README)로 줄이고, 그 아래는 **JVM 서비스 5개를 `oneorthree/server` 한 레포**(`services/<name>/` + 중첩 CLAUDE.md, `deploy/` compose·매니페스트, reusable 워크플로 1벌·경로 필터)로, 앱·link·docs 는 스택이 달라 각자. 근거: 레포 7 이면 CI·토큰·dispatch·시크릿 ×5 복사, GitHub 핀 6개 초과, 메모리 5통으로 같은 규약을 다섯 번 학습; 모노 안에서도 배포 단위는 이미지라 독립 배포·롤백은 동일, 중첩 CLAUDE.md 로 문맥 관련도 ≈95%. 대가: 기여 그래프가 서비스별로 안 갈림(폴더 히스토리로 대체). 채택 시 1695 본문 수정 + A13 의 dispatch 는 불필요(같은 레포). A15(서브모듈 불채택)는 유지. | 조재영: "레포 링크를 여러 개 두면 이력서 읽을 때 피곤하잖아" | 09-09 **확정** — 조재영: "서버 모노로 가자" |
| A18 (보류) | **Kafka 이벤트 실패 정책 — 멘토링 후 결정.** 두 층으로 나뉜다: ① 소비 실패 = 재시도 N + `.dlq` + 사람 개입(A12 에 이미 포함) ② **발행 실패** = 브로커(단일 노드) 다운으로 이벤트가 Kafka 에 도달 못 한 경우 — DLQ 는 브로커 안에 있어 같이 죽는다. 선택지 (a) 유실 수용·메트릭 (b) 발행 실패분만 Data API 테이블에 적재해 5분 재발행(아웃박스 축소판) (c) HTTP 폴백(같은 EC2 라 함께 죽을 확률 큼). 요청형 이벤트(친구 요청·내기 결과·챌린지 개설)는 리컨실이 못 살리므로 이 정책이 유실 여부를 결정한다. | 조재영: "정책 결정은 나중에 하자… 멘토링 좀 받아볼게". Business API 착수 조건(홈·리그 BFF 를 Phase 1 로)은 1661 티켓에 한 줄로 | 09-10, 보류 |
| A19 | **Target-2 공유 저장소(Redis) 규칙 — 네임스페이스 표 + ACL 강제.** 단방향 규칙(§3)이 서비스 호출을 표로 못 박듯, Redis 키도 표로 못 박는다. 표에 없는 키 패턴은 만들 수 없다. 강제 수단은 **Redis ACL**(서비스별 유저 · 키 패턴 · 명령 카테고리). **읽기 전용 패턴은 반드시 별도 selector 로 분리한다** — 같은 selector 안에서는 키 패턴과 권한이 누적돼 뒤의 `+@all` 이 앞의 읽기 전용 패턴에도 적용된다. 예: `ACL SETUSER business on >… ~auth:rt:* ~cache:business:* ~lock:business:* +@all (%R~league:* %R~presence:* +@read)` — 괄호 밖 base selector 는 자기 소유 키 읽기·쓰기, 괄호 안 selector 는 `league:*`·`presence:*` **읽기 전용**. ACL 없이 Redis 를 붙이지 않는다. 그래도 남는 관례 부분 = "같은 서비스 안에서 어떤 키를 어느 네임스페이스에 두나"는 코드 리뷰 몫임을 인정한다. Redis 는 사본이라 소유자가 DB/로그에서 재구축할 수 있어야 한다(랭킹은 Kafka replay). <br><br>\| 네임스페이스 \| 쓰기(소유자) \| 읽기 \| 용도 \|<br>\|---\|---\|---\|---\|<br>\| `league:*` \| Data API \| Business API \| 랭킹 ZSET(ZINCRBY / ZREVRANGE·ZREVRANK) \|<br>\| `presence:*` \| Data API \| Business API \| 프레즌스 리스(TTL) \|<br>\| `noti:*` \| 알림 서버 \| 없음 \| 알림 카운터·쿨다운·멱등 \|<br>\| `auth:rt:*` \| Business API \| 없음 \| RT 블랙리스트 \|<br>\| `cache:<service>:*` \| 그 서비스 \| 그 서비스만 \| 서비스 내부 캐시 — 서비스 간 공유 캐시 금지 \|<br>\| `lock:<service>:*` \| 그 서비스 \| 그 서비스만 \| 분산 락(Business 다중 인스턴스 등) — 다른 서비스 락 획득 금지 \| | PR #731 리뷰 1·2라운드: 산문 3줄 + 예시 네임스페이스로는 캐시·락이 어디에도 안 속했고, 강제 수단 없이 "물리적 강제"처럼 읽혔다. 표 + ACL 로 §3 과 같은 강도로 | 09-10 |
| A15 (검토 결과) | **서브모듈은 채택하지 않는다.** 서브모듈은 분리 방법이 아니라 "분리한 레포를 phone 에 커밋 핀으로 꽂는 방법"이며, 유일한 진짜 장점(phone 커밋 = 시스템 스냅샷)은 **`deploy/<env>.yml` 매니페스트를 CD 버튼이 자동 커밋**하는 것으로 동일하게 얻는다. 대가: 배포 1건당 phone 책갈피 PR +1, 워크트리·클론마다 `submodule update --init`(orca 병렬 배치와 정면 충돌), phone CI 에 private 토큰·recursive 체크아웃, 책갈피 커밋엔 Jira 키 없음, 브랜치 전환 시 포인터 어긋남. 서비스 간 소스 공유가 없으므로(HTTP·Kafka 만) 서브모듈이 맞는 경우가 아니고, 공유 라이브러리가 생기면 패키지(Maven/GitHub Packages)로. | 조재영 검토 요청(09-09 후속). eli5 아티팩트 참조 | 09-09 |
| A6 | **설계 과정의 장부·저널은 각자 로컬 체크아웃의 `doc/`·`logs/`(gitignore) 에 두고 원격에 올리지 않는다.** 확정본만 `docs/architecture/` 로 PR. | 조재영: "지금대로". 워크트리엔 두지 않는다 | 09-09 |

### 08-25 시안에서 이미 뒤집힌 것 (알림·링크 세션 결정을 상속)

| 시안 | 현재 결정 | 출처 |
|---|---|---|
| 알림 서버 → Data API 호출(템플릿·sent_logs·토큰) | 알림 DB 별도, Data API 호출은 리컨실 1종 | 알림 D3 · D8 |
| 도메인 이벤트 발행 = Data API | Business API | 알림 D5 |
| MQ·Redis 전제 | Target-1 은 **Kafka 단일 노드 컨테이너**(A12 확정) — HTTP 입구는 폴백. Redis 는 리그 BFF 때 | 알림 D19 · A12 |
| 링크 서버 없음 | 별도 레포 `oneorthree/link`, Vercel/Neon, 단방향(코어 → link) | 링크 v3 |
| 운영 콘솔 없음 | link 대시보드 동거, 비밀번호 2겹 | 알림 D17 · D18 |
| 크론 "15종 → 알림 서버" | 알림 22 잡은 알림 서버, 정산·정리 5종은 Data API(A4), 봇·추월 폐기(A5·D6) | 알림 D10(확정) · A4 |
| 도메인 이벤트 발행 = Data API | **그 유스케이스를 완료한 프로세스** — 요청형 Business API · 정산형 Data API | A4 · 알림 D5/D10 |

## 미결 → 전부 결정됨 (09-09)

1. 배치의 자리 → **A4 · A5**
2. Business API 인증 경계 → **A7 · A8**
3. Data API 내부 표면 → **A9**
4. 시스템 → **A10 · A11**. 남은 실측·미결은 `system-architecture.md` §8 (prod 사양 · dev nginx · Vercel Pro vs CF)
