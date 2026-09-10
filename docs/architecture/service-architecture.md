# gromo 서비스 아키텍처 (논리) — Target-1 · Target-2

> 정본(2026-09-10 승격). 결정 근거는 `decisions.md` A1~A19 · 알림 서버 설계 결정 D1~D20(`docs/prd/notification-server/policy.md`, 승격 예정) · 링크·어트리뷰션 설계 장부 v3(승격 예정).
> **Target-1** = 이번 분리 라운드(에픽 1643 + 알림 서버 + 링크 서버) 종료 시점. **MQ = Kafka 단일 노드 컨테이너(A12 확정)** · Redis 없음. **Target-2** = 관리형 MQ · Redis · 워커 분리.

## 0. 한 문장

**앱은 Business API 하나만 본다. 데이터는 Data API 만 만진다. 알림과 링크는 자기 데이터만 갖고, 코어를 부르지 않는다.**

## 1. Target-1 구도

```mermaid
flowchart LR
  APP["gromo 앱<br/>React Native · Expo<br/>iOS / Android"]
  subgraph Edge["Edge"]
    CF["Cloudflare"] --> NX["nginx"]
  end
  subgraph Core["코어 (server/, 같은 compose)"]
    BIZ["Business API<br/>인증 · JWT 발급 · BFF · 패스스루<br/>DB 없음"]
    DATA["Data API<br/>PostgreSQL 유일 소유 · TX 경계<br/>정산·정리 크론 · Flyway"]
  end
  subgraph Noti["알림 서버 (server/notification)"]
    NS["등록부 크론 · 판정 · 템플릿(4 locale)<br/>워커 · /internal/admin/*"]
  end
  subgraph Link["링크·어트리뷰션 (oneorthree/link · Vercel)"]
    LK["랜딩 · 매치 · SKAN · Referrer<br/>내부 발급 API · 대시보드(+알림 콘솔)"]
  end
  PG[("RDS PostgreSQL<br/>database: gromo · gromo_notification")]
  NEON[("Neon Postgres<br/>links · link_clicks")]
  FCM["FCM"]
  IDP["IdP<br/>Apple · Google · Kakao · LINE · Meta"]

  APP -->|"HTTPS /api /auth"| CF
  NX -->|"전량"| BIZ
  NX -->|"/internal/admin/* (토큰)"| NS
  APP -->|"/l/match · /l/referrer"| LK
  BIZ -->|"내부 HTTP · 서비스 토큰<br/>조회 · 명령 · 패스스루"| DATA
  KAFKA[["Kafka (KRaft 단일 노드, 같은 compose)<br/>notification-events · .dlq"]]
  BIZ -.->|"이벤트 (요청형)"| KAFKA
  DATA -.->|"이벤트 (정산형: bet.settled · league.settled)"| KAFKA
  KAFKA -.->|"consume · DLQ · 재시도"| NS
  BIZ -->|"동기 명령·조회<br/>기기 토큰 · 알림 설정"| NS
  NS -->|"리컨실 1종 (새벽 1회)"| DATA
  BIZ -->|"링크 발급 · joined · revoke · withdraw"| LK
  DATA -->|"relay 재전달 (withdraw · revoke · joined)"| LK
  DATA -->|"gromo"| PG
  NS -->|"gromo_notification"| PG
  LK --> NEON
  NS --> FCM
  BIZ --> IDP
  LK -->|"콘솔 → admin API (토큰)"| NS
```

실선 = 동기 HTTP, 점선 = 이벤트(Kafka). `POST /internal/events` 는 **수동 재전송·리컨실용 입구**다 — 브로커 다운 시 이걸 자동 폴백으로 쓸지는 **A18(보류)** 이 정한다. 링크 서버(Vercel)는 브로커에 붙지 않는다.

## 2. 컴포넌트 책임

| 컴포넌트 | 소유 데이터 | 하는 일 | **안 하는 일** |
|---|---|---|---|
| **Business API** (신규, `server/services/business-api`) | 없음 (stateless) | 앱 진입점. **인증**(IdP 검증·게스트·AT 서명·refresh·logout, A7) · 화면 단위 BFF(`/bff/*`) · 아직 BFF 가 없는 엔드포인트 **패스스루**(A8) · 요청형 유스케이스 조합 · 요청형 이벤트 발행(친구·챌린지 개설 등 — **Business 가 유스케이스를 완료하는 것만**. `내기 승리`는 제외: 현행 `GroupBetEarlyWinConfirmer.confirmWins` 가 집중 세션 저장 **트랜잭션 안에서** `GroupBetWonEvent` 를 발행하고 응답엔 어떤 참가자가 확정됐는지도 없어 Business 는 발생 사실을 알 수 없다 → **Data API 가 그 트랜잭션의 outbox 에 기록·발행**한다, A4·A21) · 링크 발급 호출 | DB 접근 · 트랜잭션 · 크론 · 정산 |
| **Data API** (현 `server/services/data-api`) | `gromo` database 전체 | 데이터 서빙(`/internal/*` 조회·명령, A9) · **트랜잭션 경계·쓰기 불변식** · Flyway · **정산·정리 크론**(내기 3 · 리그 주간 · orphan sweep, A4) · 정산형 이벤트 발행(D10) · RT 저장·대조·회전·탈퇴 검사(A7) | 공인 노출 · JWT 검증 · FCM · 문구 · 알림 크론 |
| **알림 서버** (신규, `server/services/notification`) | `gromo_notification` database (templates · kinds · jobs · deeplinks · deliveries · device_tokens · settings · snapshots) | 이벤트 소비 · 스냅샷 · 등록부 크론 22 · 판정(quiet hours·쿨다운·dedup) · 템플릿 렌더(ICU, 4 locale) · FCM 발송·재시도·이력 · `/internal/admin/*` | 도메인 테이블 읽기(D4) · Data API 쓰기 · 화면 |
| **링크 서버** (별도 레포 `oneorthree/link`, Vercel + Neon) | `links` · `link_clicks` · SKAN·Referrer 원장 · 캠페인 비용 | 랜딩 · 지문 매치 · claim 귀속 · SKAN 포스트백 · Install Referrer · 캠페인 링크 대시보드 · **알림 콘솔 화면**(D17) | 코어 호출(단방향) · 유저 인증(콘솔 비밀번호 2겹은 별개, D18) |
| **앱** | 로컬 설정 · 토큰(SecureStore) | Business API 만 호출 · link 서버엔 match/referrer 만 · 언어 설정을 서버에 보고(**`users.language`** — V50, 알림 D11. 이벤트 봉투 키만 `locale`) | — |

## 3. 의존 방향 — 단방향 규칙

```
앱 → Business API → Data API
        │               │
        ├──이벤트──▶ 알림 서버 ◀──이벤트──┘        알림 서버 → Data API : 리컨실 1종만
        └──발급────▶ 링크 서버 ◀──relay 재전달──┘  링크 서버 → (아무도 부르지 않음)
                     ▲
              콘솔 → 알림 서버 admin API
```

| 허용 | 금지 |
|---|---|
| Business → Data (조회·명령·패스스루) | Data → Business |
| Business / Data → 알림 (이벤트, 발행 주체 = 그 유스케이스를 완료한 프로세스) | 알림 → `gromo` database 직접 읽기 |
| **Business → 알림 (동기 명령·조회)** — 앱의 기존 계약 `PUT/DELETE /users/me/device-token` · `PUT`·**`GET`** `/users/me/notification-settings` 가 패스스루로 오면 `POST/DELETE /internal/devices` · `PUT`·**`GET`** `/internal/users/{id}/notification-settings` 로 전달(서비스 토큰 + `X-User-Id`). 설정 정본이 `gromo_notification` 이라 **GET 도 알림 서버에서 읽어야 한다** — Data API 패스스루로는 정본을 못 읽는다. 데이터가 `gromo_notification` 소유라 이벤트로는 못 쓴다 | 알림 → Business |
| 알림 → Data (`GET /internal/users/notification-snapshot` 하나) | 알림 → Data 쓰기 |
| Business → 링크 (발급 · **claim** · joined · revoke · **withdraw**, 표시정보 스냅샷 동봉) — 링크 서버는 Kafka 에 붙지 않으므로 `user.withdrawn` 을 받을 방법이 없다. 탈퇴 tombstone 은 **Business → 링크 `POST /internal/users/{id}/withdraw`(서비스 토큰, 멱등·재시도 가능)** 로 전달한다 — 앱의 기존 계약 `POST /api/v1/invite-links/claim` 이 패스스루로 오면 `POST /internal/links/{slug}/claim {userId}`(서비스 토큰)로 전달한다. `link_clicks` 에 유저를 붙이는 일이라 링크 서버만 할 수 있고, 이 경로가 없으면 **설치 매치는 성공해도 최종 귀속이 기록되지 않는다** | 링크 → 코어 어떤 것도 |
| **Data → 링크 (relay 재전달)** — A21 outbox 의 링크 대상 미전달분을 relay 잡이 재호출한다: `user.withdrawn` → `POST /internal/users/{id}/withdraw`, **`link.revoked` → `POST /internal/links/{slug}/revoke`**, **`link.joined` → `POST /internal/links/{slug}/joined`**. joined 를 포함하는 이유는 현 `GroupService.publishJoinAttribution` 이 **커밋 후 fire-and-forget** 으로 발행하기 때문이다 — 가입이 Data 에서 커밋된 직후 응답이 유실되거나 Business 가 죽으면 보낼 주체가 사라져 **가입 귀속·캠페인 전환 데이터가 영구 누락**된다(A21 의 요청형 내구성이 그대로 적용된다). 그래서 멤버십 트랜잭션에서 `link.joined` outbox 행을 함께 만든다. 폐기를 포함하는 이유는 **그룹 탈퇴·강퇴가 Data 트랜잭션에서 커밋된 뒤 Business 의 revoke 호출만 재시도 한도를 넘겨 실패하면 예전 slug 가 계속 살아 있기 때문**이다 — 그룹 HLD(`docs/prd/group/features/01-acquisition/high-level-design.md:83`)는 발급자 탈퇴·강퇴 시 active 링크를 **멤버십 전이와 함께** 폐기하도록 요구하고, 같은 문서 70행대로 비공개 그룹 가입이 slug 유효성에 걸려 있어 폐기 누락은 **비공개 그룹 무단 가입**으로 이어진다. 그래서 **멤버십 전이 트랜잭션에서 `link.revoked` outbox 행을 함께 만든다**. **다만 내구성만으로는 순서 역전을 못 막는다** — 발급자가 멤버십 검사를 통과한 뒤 강퇴되고 `link.revoked` 가 **먼저** 도착하면 폐기할 링크가 없어 멱등 no-op 이 되고, **뒤늦게 도착한 발급이 새 active slug 를 만들어** 이후엔 폐기할 사건조차 없다. 그래서 링크 서버는 **`(groupId, inviterId)` 별 멤버십 tombstone/버전**을 두고 **그보다 오래된 발급을 거부**한다(claim tombstone 과 같은 거부 규칙의 적용). Business 는 크론이 없고(§6) 링크는 Kafka 를 안 쓰므로 **outbox 와 같은 DB 를 가진 Data API 만 재시도할 수 있다**. 이것 외의 Data → 링크 호출은 금지 | Data → 링크 (relay 재전달 외 전부) |
| 링크(콘솔) → 알림 admin API | 알림 → 링크 (Target-1; `type=push` 링크가 필요해지면 알림 → 링크 호출만, 폴백 스킴) |
| 앱 → Business, 앱 → 링크(match·referrer) | 앱 → Data · 앱 → 알림 |

원칙: **위성(알림·링크)은 코어를 부르지 않고, 코어가 위성에 밀어준다.** 위성이 코어의 사실을 알아야 하면 이벤트/발급 시 **동봉**하고, 정합은 리컨실/PATCH 로 맞춘다.

## 4. 통신 방식

| 방식 | Target-1 | Target-2 |
|---|---|---|
| 동기 내부 HTTP | 서비스 토큰(Bearer) + `X-User-Id`. 타임아웃·재시도·서킷을 **공통 RestClient 팩토리**에 처음부터. **재시도 대상 = 멱등 GET + 멱등이 보장된 명령**(전체 교체 `PUT`, `DELETE /internal/devices`, `POST …/withdraw`) — GET 만 재시도하면 로그아웃의 기기 토큰 삭제가 일시 오류 한 번에 영구 실패한다. 앱은 그 실패를 무시하고 로컬 토큰을 지워 **사용자가 재시도할 방법이 없고**, 알림 DB 에 남은 이전 계정 토큰으로 푸시가 계속 간다. **이 내구화는 명시적 로그아웃뿐 아니라 계정 전환에도 적용된다** — 현행 `App.tsx:528` 은 계정 전환 시 이전 AT 로 `deleteDeviceToken(...).catch(() => {})` 를 불러 **실패를 삼키므로**, 이 경로가 Data API 를 안 거치면 outbox 행 자체가 안 생긴다. 계정 전환도 이전 AT 로 같은 로그아웃 계약을 타게 한다. 여기에 더해 **알림 서버는 기기 토큰 등록 시 같은 FCM 토큰을 쓰던 다른 `userId` 행을 제거**한다(토큰은 기기 단위 유일) — 전달이 통째로 유실돼도 새 계정 로그인이 이전 계정 토큰을 자동 회수하는 두 번째 방어선이다. 재시도까지 실패한 삭제는 **Data API 의 outbox 에 적재해 relay 가 이어받는다** — Business API 는 DB 가 없어 스스로 내구화할 수 없으므로, 로그아웃이 RT 폐기를 위해 어차피 부르는 **Data API `/internal/auth/logout` 트랜잭션에서 `device.token.deleted` outbox 행을 함께 만든다**(A21 과 같은 모양). 그리고 relay 의 전달 표시에 **`noti_delivered_at` 을 추가**한다 — 기존 `kafka_published_at`·`link_delivered_at` 만으로는 알림 서버 직접 호출분을 표시할 칸이 없다 | 동일 |
| 이벤트 | **A21**: Data API 명령 트랜잭션이 이벤트 레코드를 함께 저장하고 결정적 `eventId` 를 돌려준다 — 발행은 그 레코드에서. **Kafka 단일 노드 컨테이너**(A12) — 토픽 `notification-events`(파티션 3, 키 = userId) + `.dlq`, 봉투 = `eventId` · `type` · `occurredAt` · `scheduledAt` · `userId` · `locale` · `subjectId` · `params`. 소비 측 `eventId` UNIQUE 멱등 + Spring Kafka 재시도·DLQ + 1일 1회 리컨실 (D7·D19). `POST /internal/events` 는 **수동 재전송·리컨실 입구**(자동 폴백 채택 여부는 A18 보류) | 관리형 브로커(MSK 등)로 승격 또는 그대로. 봉투·어댑터 동일 |
| 공유 저장소 | 없음 | Redis — **A19 네임스페이스 표 + ACL**: `league:*`·`presence:*`(Data 쓰기 · Business 읽기) · `noti:*`(알림) · `auth:rt:*`(Business) · `cache:<svc>:*`·`lock:<svc>:*`(각자, 공유 금지) |
| 앱 ↔ 서버 | REST `/api/v1`(패스스루) + `/bff/*` + `/auth/*` | 동일 |

## 5. 인증 경계 (A7 · A8)

- **AT**: Business API 가 HS256 `JWT_SECRET` 으로 서명·검증. 다른 서비스는 키를 갖지 않는다.
- **RT**: Data API **`users.refresh_token_hash`** 에 **해시로** 저장한다(V16 이 `refresh_token` 을 rename 하며 평문을 폐기했다 — 평문 저장으로 되돌리지 않는다). refresh 요청 → Business API → Data API `/internal/auth/refresh`(해시 대조·회전·탈퇴 검사) → Business API 가 새 AT 서명.
- **탈퇴·무효 유저**: 매 요청 검사는 없다(stateless). Data API 가 `/internal/*` 호출마다 `X-User-Id` 활성 검사(현 `JwtFilter` 로직 이관). **단 위성(알림·링크)으로 직행하는 쓰기는 그 검사를 안 거친다** — 기기 토큰 등록·알림 설정·초대 claim 은 Business → 위성 직접 호출이라, 탈퇴 직전 발급된 AT 로 최대 3600초 동안 토큰을 재등록할 수 있다. 따라서 **위성 쓰기 전에 Business API 가 Data API 활성 검사를 먼저 통과시킨다**(조회 1회 또는 같은 유스케이스의 Data 호출에 편승). 읽기 전용 경로는 AT 3600s 창 수용.
- **내부**: 서비스 토큰 5종(A11 ⑥). 호출은 두 종류 — **사용자 위임**(서비스 토큰 + `X-User-Id`)과 **서비스 전용**(토큰만: `/internal/auth/*` · 배치 트리거 · 리컨실). 콘솔 사람 인증은 링크 대시보드의 비밀번호 2겹(D18), 알림 서버는 사람을 모른다.
- **로그아웃 시 기기 토큰 삭제**는 Business → 알림 `DELETE /internal/devices` 로 반드시 전달한다 — 빠지면 로그아웃한 이전 계정의 푸시가 같은 기기로 계속 간다.
- **탈퇴 시 알림 DB 정리**: `settings`·`device_tokens`·`user_snapshot`·`bet_participations` 는 `gromo_notification` 소유라 Data API 트랜잭션으로 못 지운다. 탈퇴 커밋 후 **`user.withdrawn` 이벤트 + 알림 서버의 멱등 삭제**(같은 userId 로 여러 번 와도 안전)로 처리하고, **미처리분은 새벽 리컨실이 잡는다**(스냅샷에 있는데 Data API 에 없는 유저 = 삭제 대상). 이 경로가 없으면 탈퇴 후에도 푸시가 계속 간다.
- **결과 확인(ack) ↔ 대기 중 푸시 직렬화**: 현행 `ChallengeResultAckService.acknowledge` 는 **확인 트랜잭션 안에서** `BetResultAcknowledgedEvent` 의 동기 리스너(`BetResultAckSuppressionListener`)가 대기 중인 알림 클레임·tombstone 을 함께 갱신해, 5분 flush 가 **이미 본 결과를 뒤늦게 보내지 못하게** 막는다. 알림 DB 를 분리하면 그 갱신 대상이 `gromo_notification` 으로 넘어가 **같은 트랜잭션에 담을 수 없고**, ack 를 Kafka 이벤트로만 보내면 Data 커밋과 알림 소비 사이에 flush 가 끼어들어 **사용자가 이미 확인한 결과 푸시를 다시 받는다**. 두 DB 를 한 트랜잭션에 못 넣으므로 **prepare/commit 2단계**로 순서 경계를 만든다: ⓐ **prepare** — Data ack 를 커밋하기 **전에** 알림 서버에 `POST /internal/users/{id}/result-ack/prepare {sessionId}` 를 보내 대기 클레임을 **`HELD`(발송 보류) 로 잠근다**. flush 는 `HELD` 를 건너뛰므로 이 순간부터 발송이 막힌다. ⓑ **Data ack 커밋.** ⓒ **commit** — `.../result-ack/commit` 으로 클레임을 종결한다. 재시도까지 실패하면 `noti_delivered_at` 미표시로 relay 가 이어받는다(멱등). **단순 「동기 종결 1회」로는 안 된다** — Data ack 를 먼저 커밋하면 명령이 나가기 전에 flush 가 발송할 수 있고, 알림 종결을 먼저 하면 뒤이은 Data ack 실패 때 푸시가 **영구 억제**된다. 그 실패에 대비해 **`HELD` 는 리스(만료 시각)를 갖는다** — ⓑ·ⓒ 가 오지 않으면 만료 후 자동으로 발송 가능 상태로 돌아간다.
- **탈퇴 경합 차단(tombstone)**: 활성 검사와 위성 쓰기 사이에 탈퇴가 커밋되면, 지연 도착한 기기 토큰 등록·claim 이 **삭제된 유저 데이터를 되살린다**(다음 새벽까지 푸시 가능). 그래서 위성은 삭제 시 **tombstone(`user_id` + `withdrawn_at`)을 남기고, 그 이후 도착한 같은 유저의 쓰기를 거부**한다. 링크 서버도 같은 tombstone 을 갖는다(링크엔 리컨실 경로가 없어 이게 유일한 방어). **tombstone 은 이후 쓰기만 막으므로 그 전에 이미 수락된 claim 은 따로 되돌려야 한다** — 탈퇴 커밋 뒤 지연된 claim 이 withdraw 보다 **먼저** 도착하면 정상 수락되고, `invite_link_clicks.claimed_user_id` 는 현행 계약상 **최초 1회만 기록**이라 나중에 온 withdraw 가 그냥 두면 탈퇴 유저의 귀속이 남는다. 따라서 **withdraw 는 한 트랜잭션에서 ⓐ 그 유저의 기존 claim 을 제거·익명화하고 ⓑ tombstone 을 기록한다**(순서 역전에 무관하게 수렴) — **전달은 Kafka 가 아니라 Business → 링크 `POST /internal/users/{id}/withdraw`** 다(링크는 브로커에 붙지 않는다). 실패 시 재시도하고, **미전달분은 Data API 의 relay 잡이 재호출한다**(§6) — Business API 는 크론을 갖지 않고(§6) 링크 서버는 Kafka 를 소비하지 않으므로, 전달을 되살릴 수 있는 주체는 **탈퇴 트랜잭션과 같은 DB 에 outbox 행을 가진 Data API** 뿐이다. outbox 행은 대상별 전달 표시(`kafka_published_at` · `link_delivered_at`)를 따로 갖고 relay 는 **비어 있는 쪽만** 재시도한다(링크의 withdraw 는 멱등이라 중복 호출이 안전). 탈퇴 이벤트가 늦게 와도 tombstone 이 먼저 도착한 쓰기를 되돌린다 — 순서 보장이 아니라 **거부 규칙**으로 푼다.

## 6. 배치의 자리 (A4 · A5)

| 잡 | Target-1 프로세스 | 락 |
|---|---|---|
| 내기 정산 3종 · 리그 주간 정산 · orphan sweep · **판돈 동결 감지(`GroupBetFreezeMonitor.detectFrozenBets`)** | **Data API** (ShedLock, `gromo`) | 그대로 |
| **코어 이력 의존 판정 잡** — 비활성 복귀(`InactiveReturnNotificationService`, `users.last_active_at` D+3/7/14) · 리그 리인게이지먼트(`LeagueReengagementNotificationService`, 주간 집중 통계·스트릭·진행 중 세션) | **Data API 에 남긴다** — 판정만 코어에서 하고 알림 서버엔 **발송 명령**만 보낸다 | 그대로 |
| 알림 22 잡 (예약·묶음 flush + 자체 투영으로 판정 가능한 것) | **알림 서버** 등록부 (`notification_jobs` + ShedLock, `gromo_notification`) | 그대로 |
| 봇 틱 · 순위 추월 | **폐기** (A5 · D6) | — |
| 탈퇴·이벤트 전달 relay (A21 outbox → Kafka 발행 + 링크 `POST /internal/users/{id}/withdraw`) | **Data API** (lease + ShedLock, `gromo`) | 그대로 |
| 리컨실 (스냅샷 대조) | 알림 서버, 새벽 04:00 | — |
| 링크 집계 | 링크 서버 (Vercel Cron) | — |

Business API 는 크론을 갖지 않는다 → 단일/다중 인스턴스 무관.

**판정 잡의 분류 기준**: ②′ 투영으로 판정이 성립하면 알림 서버, **코어 이력을 읽어야 하면 Data API 에 남긴다.** `last_active_at` 같은 값은 전환 시점에 **이미 비활성인 유저가 이후 이벤트를 만들지 않아** 투영으로 복구되지 않고, 그 잡의 창(D+3/7/14 단일 KST 날짜)은 한 번 놓치면 다음 단계까지 대상에서 빠진다. 마찬가지로 **판돈 동결 감지는 `GroupChallengeBetSessionRepository` 를 읽어야 해서** 알림 서버로 옮기면 단방향 규칙 위반이고, 표에서 빠뜨리면 **정산 배치가 조용히 멈춘 경우 묶인 참가비를 탐지할 경로가 사라진다.**

## 7. 데이터 소유 (A10)

| 저장소 | 소유자 | 내용 |
|---|---|---|
| RDS `gromo` | Data API | 도메인 전체 (users · focus · league · group · currency · …). 다른 서비스 직접 접근 금지 |
| RDS `gromo_notification` | 알림 서버 | 알림 HLD §5 의 14 테이블. 별도 DB 유저·Flyway |
| Neon (link) | 링크 서버 | links · link_clicks · skan · referrer · spend |
| 앱 로컬 | 앱 | 설정 · 토큰 |

교차 조회는 **없다** — 필요한 사실은 이벤트·발급에 동봉하거나(위성), Data API 조회 API 로(코어).

### 7.1 기존 데이터 이관 (소유권만 옮기면 데이터가 사라진다)

`users.device_token` · `user_notification_settings` · **`notification_sent_logs`** · `group_invite_links` · `invite_link_clicks` 는 **이미 운영 데이터가 들어 있다**. 스키마만 새로 만들고 전환하면 기기 토큰·수신 설정이 사라져 푸시가 멈추거나 opt-out 이 기본값으로 되돌아가고, 이미 공유된 초대 slug 가 새 링크 서버에서 조회되지 않는다. 이관 절차를 배포 계획에 넣는다:

**순서가 핵심이다 — 이중 쓰기를 먼저 켠다.** 백필을 먼저 돌리면 *백필 완료 시점 ~ 이중 쓰기 활성화 시점* 사이의 토큰 변경·수신 설정 변경·링크 발급이 **구 저장소에만 남고 새 저장소엔 영영 안 들어간다**(그 창은 배포 한 번만큼 벌어진다). 그래서 쓰기를 먼저 양쪽으로 흘려 두고, 백필은 그 뒤에 **과거분만** 채운다.

| 단계 | 내용 |
|---|---|
| ① 이중 쓰기 | 전환 창 동안 구·신 양쪽에 쓴다(읽기는 아직 구). 롤백이 데이터 손실이 되지 않게 하는 유일한 장치이자, ②의 누락 창을 없애는 장치. **단 `invite_link_clicks` 는 예외** — 새 클릭은 앱·브라우저가 Vercel 로 **직접** 보내 Neon 에 쌓이는데 링크 서버는 코어를 부를 수 없어 구 테이블에 같이 쓸 방법이 없다. 이 리소스만 **원자적 전환**으로 간다(아래 §7.2) |
| ② 백필 | 구 저장소 → 새 저장소 과거분 복사(`device_token`·설정·**`notification_sent_logs` → `deliveries`**, 링크 2테이블 → Neon). **발송 이력은 상태(`SENT`·`PENDING`·`DEFERRED`)와 사건 키(`subject_id`)까지 매핑해 옮긴다** — `deliveries` 가 빈 채로 시작하면 `BetEventNotificationService.rescanAndFlush` 가 최근 48시간 회차를 새 사건으로 다시 선점해 **결과 푸시가 재발송**되고(`V45__notification_claim_pipeline_shedlock.sql:53-61` 이 같은 위험을 명시한다), 반대로 `PENDING`·`DEFERRED` 행은 유실되어 나가야 할 푸시가 사라진다. slug·user_id 는 **불변**이라 키 변환 없음. **단 링크는 그대로 복사하면 안 된다** — 현 `group_invite_links` 에는 폐기 컬럼이 없고(`V21`), 종료·삭제된 그룹의 링크는 `InviteLinkService.resolveLanding`·`InviteLinkMatchService` 가 **코어 DB 를 런타임 조회해 만료**시킨다. Target-1 링크 서버는 코어를 못 부르므로 그대로 옮기면 **이미 죽은 slug 가 새 저장소에서 되살아난다**. 백필 시 **그룹 상태와 발급자 멤버십을 함께 스냅샷해 해당 행을 폐기 상태로 확정**한다. **이중 쓰기가 이미 넣은 최신 행을 덮지 않도록 `ON CONFLICT DO NOTHING`**(또는 원본이 더 최신일 때만 갱신)으로 넣는다 |
| ②′ 투영 부트스트랩 | 알림 서버는 코어 DB 를 안 읽고 **자체 `user_snapshot`·`bet_participations` 로 판정**한다. 이벤트는 소비 시작 이후 것만 오고 새벽 리컨실은 **유저 스냅샷만** 다루므로, 부트스트랩 없이 켜면 **전환 당시 진행 중이던 내기가 나중에 정산돼도 참가자 투영이 없어 결과 알림이 안 나간다**. 소비자·잡을 켜기 **전에** ⓐ 전 유저 스냅샷(표시명·언어·설정) ⓑ **진행 중·미정산 내기의 참가 상태**를 DB 스냅샷으로 초기 적재하고, **컷은 시각이 아니라 커서로 잡는다** — 「스냅샷 시각」을 watermark 로 쓰면 스냅샷을 읽은 뒤 커밋됐는데 `occurredAt` 이 그 시각보다 이른 변경이 **스냅샷에도 없고 이후 적용에서도 빠져** 영구 누락된다. 둘 중 하나를 쓴다: ⓐ **같은 DB 스냅샷에서 outbox 의 단조 증가 커서를 함께 확정**하고 그 커서 이후만 적용하거나, ⓑ **소비를 먼저 시작해 이벤트를 버퍼링한 뒤** 스냅샷을 뜨고 `eventId` 로 중복 제거한다 |
| ③ 검증 | 건수·체크섬 대조 — 유저별 토큰 유무, **설정 5필드 전량**(`notification_enabled` · `sound_enabled` · `night_mode_enabled` · **`night_start_time`** · **`night_end_time`**, `V1__baseline.sql`), 링크 slug 집합과 **active/revoked 건수**, 발송 이력의 상태별·사건 키별 건수, ②′ 투영 건수. 심야 두 시각은 **nullable 이라 null 상태 자체를 대조 대상에 포함**한다 — 플래그 3개만 보면 시각이 누락·오변환돼도 「불일치 0」을 통과해 심야 사용자 푸시가 엉뚱한 시각에 나간다. 불일치 0 이 전환 조건 |
| ④ 읽기 전환 | 새 저장소로 읽기 이동. 여기까지가 되돌릴 수 있는 마지막 지점 |
| ⑤ 구 저장소 제거 | 관찰 기간(최소 1 릴리즈) 뒤 컬럼·테이블 드롭 — **롤백 창을 벗어난 뒤**(§3 expand/contract) |

#### 7.2 `invite_link_clicks` 만은 원자적 전환

클릭 쓰기의 주체가 **코어가 아니라 방문자 → Vercel** 이라 이중 쓰기가 성립하지 않는다. 순서를 이렇게 고정한다:

**백필이 라우팅 전환보다 먼저다.** 링크 서버는 코어를 부를 수 없어 구 `invite_link_clicks` 를 대신 조회할 수단이 없으므로, 전환 순간 Neon 에 없는 클릭은 그대로 `matched:false` 가 되고 **뒤늦은 백필은 이미 나간 응답을 되돌리지 못한다**. 매치 창이 3시간이라 위험 구간은 「전환 직전 3시간의 클릭」 전부다.

1. **구 클릭을 Neon 으로 백필**(§7.1 ②) — 여기까지는 라우팅을 안 건드리므로 언제 해도 안전하다.
2. **전환 직전 증분 백필을 짧은 주기로 반복**해 미반영 창을 분 단위 → 초 단위까지 좁힌다(`clicked_at > 마지막 커서`, 멱등 upsert).
3. **구 클릭 쓰기를 먼저 닫는다** — 구 랜딩을 새 링크 호스트로 **302 리다이렉트**로 바꿔 이 순간부터 구 테이블에 새 행이 생기지 않게 한다(리다이렉트된 클릭은 곧바로 Neon 에 적재된다). 「전환 후 비동기 백필이 앱의 매치보다 빠를 것」이라는 가정에 기대면 안 된다 — 마지막 커서 이후 구 저장소에 기록된 클릭의 사용자가 전환 직후 매치를 부르면 **그 자리에서 `matched:false`** 가 나가고, 뒤늦은 백필로는 이미 나간 응답을 복구할 수 없다.
4. **쓰기가 멎은 뒤 마지막 증분 백필을 끝까지 돌려 커서가 멈춘 것을 확인한다** — 구 쓰기가 닫혔으므로 이 작업은 유한하게 종료된다. 여기까지가 원자적 컷이다.
5. **랜딩 302 와 매치 프록시 전환을 한 번에 적용한다** — 둘 다 nginx 설정이므로 **한 설정 변경 + 한 reload 로 원자적으로** 넘긴다. 쪼개면 반대 방향 창이 생긴다: 3에서 302 만 켜면 새 클릭은 Neon 에만 쌓이는데 구 `/l/match` 는 아직 구 저장소를 읽어, 그 사이 링크를 열고 곧바로 앱으로 돌아온 사용자가 **즉시 `matched:false`** 를 받고 그 응답은 복구되지 않는다. 원자 적용이 불가능한 경우에만 차선으로 **그 구간의 매치가 Neon 도 함께 읽게** 한다.
6. 그 뒤로 **구 테이블은 읽지 않는다**.
7. **롤백하면 전환 창의 클릭은 유실된다** — 되돌릴 수 있는 지점은 3(구 쓰기를 닫기) 이전뿐이고, 이후는 roll-forward. 손실 범위는 매치 창과 같은 3시간으로 한정된다(그 사실을 감수하고 전환한다).


## 8. Target-2 에서 달라지는 것

```mermaid
flowchart LR
  BIZ["Business API ×N"] -->|"조회·명령"| DATA["Data API"]
  BIZ -->|"league:* · presence:* 읽기 · auth:rt:* · cache:business:* · lock:business:*"| REDIS[("Redis · ACL")]
  DATA -->|"league:* · presence:* 쓰기"| REDIS
  BIZ -.->|"이벤트"| MQ[["MQ notification-events<br/>(1658)"]]
  DATA -.->|"정산 이벤트"| MQ
  MQ -.-> NSJ["알림 서버 — 판정"]
  NSJ -.->|"발송 잡"| MQ2[["MQ delivery"]]
  MQ2 -.-> NSW["알림 워커 ×N (분리 배포)"]
  NSW --> FCM["FCM"]
  NSJ & NSW -->|"noti:* · cache:notification:* · lock:notification:*"| REDIS
```

- **MQ**: **Target-1 이 이미 Kafka 다**(A12) — Target-2 의 변경점은 어댑터 교체가 아니라 **자체 호스팅 단일 노드 → 관리형 브로커(MSK 등)로의 접속·운영 전환**이다(부트스트랩 주소·인증·복제 계수·모니터링·업그레이드 주체가 바뀔 뿐, 프로듀서·컨슈머 코드와 봉투는 그대로). at-least-once 는 이미 `eventId` 멱등으로 준비됨.
- **Redis**: 리그 랭킹 ZSET — **완료분만** 담고 진행 중 세션은 `presence:*` 로 조회 시 가산한다(A20). 후보는 **ZSET 상위 N + presence 활성 유저 전원**이며 가산 후 재정렬한다(상위 100 으로 먼저 자르면 101위 이하의 긴 세션이 누락). ZSET 은 DB 정본과 주기 대조·재구축한다. **`presence:*` 도 같은 복구 대상이다** — Redis 재시작·장애 조치로 날아가면 **이미 진행 중인 세션은 새 시작 쓰기가 다시 발생하지 않아** 그 유저들이 세션이 끝날 때까지 실시간 순위에서 통째로 빠진다(완료분 ZSET 만 되살려서는 못 고친다). 기동·복구 시 **DB 의 미종료 세션으로 `presence:*` 를 재적재**하고, 재적재가 끝나기 전 조회는 **현행 SQL 과 같은 DB 폴백**으로 답한다. 리그 BFF 의 50페이지 클라 합산 제거, "지금 N위" 정확도 — D9 해소 · 프레즌스 리스 · RT 블랙리스트(강제 로그아웃) · Business API 다중 인스턴스 락 · 알림 카운터.
- **알림 워커 분리 배포**: 판정과 워커 사이에 큐가 있으므로 코드 무변경으로 워커만 스케일.
- **알림 DB 별도 인스턴스**: 부하가 보이면 (A10).
- **공유 저장소 규칙(A19)**: Redis 키는 네임스페이스 표(`decisions.md` A19)에 있는 것만 — `league:*`·`presence:*` 는 Data 가 쓰고 Business 가 읽으며, `noti:*`·`auth:rt:*` 는 소유자 전용, `cache:<svc>:*`·`lock:<svc>:*` 는 각 서비스 자기 것만(서비스 간 공유 캐시·락 금지). **Redis ACL** 로 서비스별 유저에 키 패턴·명령 권한을 주어 강제한다. 사본이므로 소유자가 재구축 가능해야 한다 — 단방향 규칙의 저장소 판.

## 9. 08-25 시안 대비 변경 요약

| 시안 | 이 문서 |
|---|---|
| 알림 서버가 Data API 로 템플릿·이력·토큰 왕복 | 알림 DB 별도, 코어 호출은 리컨실 1종 |
| 이벤트 발행 = Data API | 발행 = 유스케이스를 완료한 프로세스(요청형 Business · 정산형 Data) |
| MQ(Kafka/SQS)·Redis 첫날부터 | Target-1 = **Kafka 단일 노드 컨테이너**만, Redis 는 Target-2 |
| `/bff/*` 만 Business, 나머지 133 직행 | **전량 Business 경유**, Data API 공인 노출 0 |
| 인증 = 기존 서버 직행 | 인증 = Business API, 상태(RT)는 Data API |
| 링크·콘솔 없음 | 링크 서버(별도 레포·Vercel·단방향) + 콘솔 동거·비밀번호 2겹 |
| 크론 15종 → 알림 서버 | 알림 22 → 알림 서버, 정산·정리 → Data API, 봇·추월 폐기 |

## 10. 열린 점

- D9 만 잠정. (A12 Kafka 확정 · A14 EC2 사이즈업 · A17 서버 모노 확정)
- **레포(A17)**: 앱 `OneOrThree/app` · 링크 `oneorthree/link` · docs 사이트 · **JVM 서비스 5개 = `oneorthree/server`**(`services/data-api|business-api|notification|chat|file-upload` + `deploy/` + `docs/`). 이력서·팀 사이트는 허브 1장(`docs/architecture` 승격본)으로.
