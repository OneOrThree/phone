# 알림 producer 계약 — Data 가 무엇을 적고 Notification 이 무엇을 하는가

정본은 `docs/architecture/decisions.md` A22 와 `docs/contracts/notification-event-v1.json` 이다.
이 문서는 그 둘 사이의 **종류별 구체값**을 못 박는다 — 어떤 사건이 언제 어떤 키로 적히고,
발송 입력이 무엇이며, 조용한 시간에 걸리면 어떻게 되는가.

기계가 읽을 형태는 `/tmp/gromo-notification-catalog.json`(알림 서버 템플릿 시드용)이다.
이 문서와 그 파일이 어긋나면 **코드가 맞다** — 둘 다 `NotificationKind` 에서 나왔다.

## 1. 경계

| | Data | Notification |
| --- | --- | --- |
| 후보 판정 | **한다** (코어 DB 를 읽어야 답할 수 있는 질문이다) | 안 한다 |
| 렌더 (제목·본문·로케일) | 안 한다 | **한다** (kind × locale 템플릿) |
| 묶음 (bundling) | 안 한다 | **한다** (`userId` × `groupId` × `slotAt`) |
| 조용한 시간 판정·이월 | 정책만 실어 보낸다 | **한다** (설정의 정본을 쥔 쪽이다) |
| 발송·재시도·dedup 상태 | 안 한다 | **한다** |
| 발송 이력 완료 표시 | **하지 않는다** | **한다** |

Data 가 조용한 시간을 직접 거르면 설정을 두 곳이 읽는다. 설정 최종 상태의 정본은 이관 후
알림 DB 이므로, Data 가 자기 사본으로 거르면 **갱신이 늦은 쪽이 사용자의 설정을 어긴다**.

## 2. 봉투

| 필드 | 값 |
| --- | --- |
| `type` | `notification.requested` — **단일**. 실제 종류는 `params.kind` 가 가른다 |
| `schemaVersion` | `1` |
| `userId` | 수신자 **하나**. fan-out 은 이미 펼쳐진 뒤다(㊢) |
| `subjectId` | 도메인 대상 UUID 문자열. 대상 없는 kind 는 `null` |
| `aggregate` | `USER:<userId>` |
| `scheduledAt` | **항상 `null`** |
| `locale` | `users.language` (`ko`·`en`·`ja`·`zh-Hant`). 미보고는 `null` → 수신 측 `ko` 폴백 |
| `version` | outbox 가 USER 축 행 잠금 아래 발급 |

`scheduledAt` 이 항상 `null` 인 이유: 이월(`DEFER`)은 **발행**을 미루는 일이 아니라 **발송**을
미루는 일이고, 그 판정에 필요한 조용한 시간 설정의 정본은 알림 DB 에 있다. relay 를 붙잡아 두면
그사이 설정이 바뀌어도 이미 박힌 시각으로 나가고, Kafka 에 아직 없는 사건은 알림 서버가
상태(설정 삭제·탈퇴·ack)를 반영할 기회조차 갖지 못한다.

## 3. 결정적 사건 키

```
noti:<KIND>:<userId>:<subjectId|none>:<시간축|none>
```

조립은 `NotificationEventKey.of(...)` **한 곳**에서만 한다 — producer 와 이관 export 가 같은
함수를 부른다. 두 곳이 각자 문자열을 만들면 구분자 하나, `none` 이라는 단어 하나가 언제든
갈라지고, 그러면 이관분과 신규분이 서로를 중복으로 보지 못해 **사용자에게 두 번** 간다.

축 넷이 전부 필요하다. kind 가 없으면 같은 회차의 결과와 환불이 한 건으로 접히고, `userId` 가
없으면 fan-out 이 한 명으로 줄고, `subjectId` 가 없으면 서로 다른 회차가 뭉치고, 시간축이 없으면
매일 반복되는 알림이 첫날 이후 멈춘다.

### 시간축

| 값 | 버킷 | 대체한 구 dedup |
| --- | --- | --- |
| `NONE` | `none` | 선점 UNIQUE `(user_id, kind, subject_id)` — 시간축이 없었다 |
| `MINUTE` | 사건 시각 epoch-second (분 내림) | 「최근 1분」 조회 |
| `QUARTER_HOUR` | 사건 시각 epoch-second (15분 내림) | (현재 쓰는 kind 없음 — 묶음 슬롯과 같은 폭) |
| `DAY` | KST `yyyyMMdd` | 「당일 `sent_at`」 조회 / 하루 1회 크론 |
| `WEEK` | 그 주 월요일의 KST `yyyyMMdd` | 주 1회 크론 |

폭이 구 dedup 창보다 **좁으면** 중복 푸시가 나가고, **넓으면** 매일 반복되는 알림이 첫날 이후
영영 안 나간다. 둘 다 조용히 일어나므로 kind 마다 명시적으로 고른다.

**시간축이 `NONE` 이 아닌 kind 는 원본 사건 시각이 필수다.** 없으면 `IllegalArgumentException`
으로 죽는다 — 「없으면 지금」으로 접으면 같은 원인의 재처리가 다른 키가 되어 멱등이 무너진다
(하루 뒤 재처리 = 다음 날 알림). 이관 export 도 같은 규칙으로 `slot_at` 에서 키를 만든다.

### 경합

`append` 는 조회 **전에** `allocateVersion(USER:<userId>)` 로 유저 축 행을 배타 잠금한다.
잠그지 않으면 같은 결정적 키가 동시에 들어올 때 둘 다 「없다」를 보고 둘 다 INSERT 해서,
한쪽이 UNIQUE 위반으로 죽으며 **도메인 트랜잭션 전체를 되돌린다** — 중복 알림 하나를 막으려다
정산·친구 요청이 롤백된다. 대가로 version 번호가 띈다(중복이라 적지 않은 호출도 번호를 하나
쓴다). 소비 측은 단조 증가만 보고 연속에 기대지 않으므로 빈 번호는 무해하다.

## 4. 종류 19 — 축·정책·렌더 입력

`RANK_OVERTAKE` 와 봇 계열은 **없다**(A5 폐기). 구 코드의 크론과 판정은 남아 있지만
`OUTBOX` 모드에서 발송하지 않고 판정 건수만 로그로 남긴다 — 폐기가 「조용한 사라짐」이 아니라
「기록된 중단」이 되게.

| kind | 시간축 | subject | 조용한 시간 | 적격성 | `data.type` | 렌더 입력(`params`) |
| --- | --- | --- | --- | --- | --- | --- |
| `LEAGUE_WEEKLY_RESULT` | WEEK | — | DROP | 무관 | — | `result`(PROMOTED\|RELEGATED\|STAY) · `previousTierLevel` · `newTierLevel` |
| `LEAGUE_DEADLINE` | DAY | — | DROP | 무관 | — | `rank` |
| `LEAGUE_FINAL_DEADLINE` | DAY | — | DROP | 무관 | — | `rank` |
| `LEAGUE_DEADLINE_D1` | DAY | — | DROP | 무관 | — | `shortfallSeconds` |
| `LEAGUE_RELEGATION_WARNING` | DAY | — | DROP | 무관 | — | `shortfallSeconds` |
| `LEAGUE_RELEGATION_WARNING_EVENING` | DAY | — | DROP | 무관 | — | `shortfallSeconds` |
| `INACTIVE_RETURN` | DAY | — | DROP | 무관 | — | `stage`(D3\|D7\|D14) |
| `MISSED_FOCUS_TODAY` | DAY | — | DROP | 무관 | — | (없음) |
| `STREAK_AT_RISK` | DAY | — | DROP | 무관 | — | `streakCount` |
| `BET_RESULT` | NONE | 회차 | **DEFER** | 의존 | `BET_RESULT` | `challengeId` · `stake` · `betStatus` · `achieved` · `payout` |
| `BET_VOID_REFUND` | NONE | 회차 | **DEFER** | 의존 | `BET_VOID_REFUND` | `challengeId` · `stake` · `voidReason`(nullable) |
| `BET_WON` | NONE | 회차 | DROP | 의존 | `BET_WON` | `challengeId` |
| `BET_SILENT_FLUSH` | NONE | 회차 | **BYPASS** | 의존 | — | `silent=flush` |
| `CHALLENGE_SESSION_OPEN` | NONE | 회차 | **DEFER_UNTIL** | 의존 | `CHALLENGE_SESSION_OPEN` | `challengeId` · `stake` · `deferExpiresAt` |
| `CHALLENGE_WINDOW_END` | DAY | 챌린지 | DROP | 의존 | `CHALLENGE_WINDOW_END` | `challengeId` |
| `CHALLENGE_ENDED` | DAY | 챌린지 | DROP | 의존 | `CHALLENGE_ENDED` | `challengeId` |
| `CHALLENGE_CREATED` | NONE | 챌린지 | DROP | 의존 | `CHALLENGE_CREATED` | `challengeId` · `groupName` · `missionLabel` |
| `FRIEND_REQUEST` | MINUTE | 상대 유저 | DROP | 의존 | `FRIEND_REQUEST` | `counterpartUserId` · `counterpartNickname` · `requestId` |
| `FRIEND_ACCEPTED` | MINUTE | 상대 유저 | DROP | 무관 | `FRIEND_ACCEPTED` | `counterpartUserId` · `counterpartNickname` · `requestId` |

공통 `params` 는 위에 더해 `kind` · `quietPolicy` · `groupId`(그룹 사건만) · `slotAt`(묶음 축, ISO-8601 UTC).

**`LEAGUE_RELEGATION_WARNING` 과 `…_EVENING` 은 문구가 완전히 같다.** kind 를 가른 이유는 오직
dedup 축이다 — 일 09:00 과 18:00 은 *의도된 하루 2회 발송*인데 한 kind + DAY 축으로 두면 저녁분이
아침 키에 접혀 영영 안 나간다.

`CHALLENGE_ENDED`(일 목표형)와 `CHALLENGE_WINDOW_END`(창형)의 이름이 어긋나 보이는 것은 앱의
레거시 딥링크 폴백이 `CHALLENGE_WINDOW_END` 문자열에 걸려 있기 때문이다 — 두 이름 다 계약이다.

### 조용한 시간 정책

| 값 | 뜻 | 쓰는 kind |
| --- | --- | --- |
| `DROP` | 버린다 — 지연 도착이 거짓말이 되는 알림 | 위 표의 대부분 |
| `DEFER` | 조용한 시간이 끝난 뒤 보낸다(N44). 묶음·dedup 은 **원래 슬롯** 유지 | `BET_RESULT` · `BET_VOID_REFUND` |
| `DEFER_UNTIL` | 이월하되 `params.deferExpiresAt` 에서 만료 — 그때 이미 참가 마감이면 버린다 | `CHALLENGE_SESSION_OPEN` |
| `BYPASS` | 표시가 아니라 앱 기동 신호라 필터를 타지 않는다(HLD §6 예외) | `BET_SILENT_FLUSH` |

## 5. 묶음 — Data 가 하지 않는다

구 경로는 `(유저 × 그룹 × 15분 슬롯)` 으로 접어 한 건을 보냈다. 신 경로에서 Data 는
**회차/챌린지마다 한 건씩** 적고 `groupId` 와 **원래 슬롯**(`slotAt`, 사건 시각 기준)을 실어 보낸다.
접는 일은 알림 서버가 한다.

내기 결과·무효 환불 묶음 키에 **kind 를 넣지 않는다.** 넣으면 한 슬롯에서 어떤 회차는 정산되고 어떤 회차는 무효화된
경우 묶음이 둘로 갈려 푸시가 2건 나가고, 「하루 2~3건 상한」(N20)이 깨진다.

`slotAt` 이 발송 시각이 아니라 **사건 시각**(`settled_at` 등)인 것도 계약이다 — 재훑기·이월이
언제 돌아도 묶음이 같아야 한다.

`CHALLENGE_WINDOW_END`와 `CHALLENGE_ENDED`는 kind별 사용자·그룹·KST 일 슬롯으로 묶는다. 각 사건의 `bundleMembers`는 이번 배치의 대상 challengeId 문자열 배열, `bundleRepresentative`는 생성순 첫 대상이다. 수신 측은 선언된 대상 집합과 실제 도착한 subjectId를 대조하고, 이미 SENT·SUPPRESSED인 구성원도 수신 완료에 포함한다. 늦은 사건을 기다릴 때는 다음 시도를 이월하여 다른 사용자의 알림을 계속 처리한다. 임의 시간이 지났다는 이유로 일부만 발송하지 않는다. 새로 도착한 구성원 때문에 대기를 해제할 때도 FCM 실패·조용한 시간의 재시도 시각은 보존한다.

## 6. 요청형 사건은 `BEFORE_COMMIT`

구 리스너 넷은 `@TransactionalEventListener(AFTER_COMMIT)` + `@Async` 다. 커밋은 끝났는데
리스너가 돌기 전에 프로세스가 죽으면 **그 알림은 아무 흔적 없이 사라진다** — 도메인 데이터는
남았는데 알림만 없어서 나중에 어디를 봐도 「나갔어야 했다」를 알 수 없다. 내기 결과만 15분
재훑기가 회수하고 친구 요청·챌린지 개설·승리 확정은 회수 경로 자체가 없다.

`afterCommit` 안에서 outbox 만 적는 것으로도 안 된다 — 그 시점의 트랜잭션은 이미 커밋됐으므로
새 트랜잭션이 열리고, 그것이 실패하면 같은 유실이 남는다. 원자성은 **같은 트랜잭션**에서만 나온다.

그래서 `NotificationRequestOutboxListener` 가 `BEFORE_COMMIT` + `Propagation.MANDATORY` 다.
여기서 나는 예외가 커밋을 되돌리는 것은 **의도**다 — 사건을 적지 못했다면 그 도메인 변경은
「알림이 나갈 것」이라는 약속을 지킬 수 없다.

`OUTBOX` 모드에서 구 `AFTER_COMMIT` 리스너 다섯(회차 종료 · 승리 확정 · 챌린지 개설 · 친구 요청 ·
친구 수락)과 동기 ack 억제 리스너는 각각 조기 return 한다. 두 경로가 겹쳐 돌면 같은 사건이
FCM 으로도 가고 Kafka 로도 간다.

**친구 2종의 원본 시각은 `friendships.updated_at` 이다**(`created_at` 아님). 거절 후 재요청이
같은 행을 `reopen`/`restore` 하므로 `created_at` 은 원래 관계의 시각으로 남고, 그걸 키에 쓰면
재요청이 옛 키에 접혀 영영 안 나간다. `@UpdateTimestamp` 는 flush 때 채워지는데 `BEFORE_COMMIT`
은 JPA 커밋 flush **전**이라 읽기 직전 `entityManager.flush()` 를 명시적으로 부른다.

## 7. 조회 3종

| | 경로 | 용도 |
| --- | --- | --- |
| ① | `GET /internal/users/notification-snapshot?cursor=&limit=` | 유저 투영 부트스트랩 · 새벽 리컨실 |
| ② | `GET /internal/users/{userId}/result-ack?sessionId=` | 정본 ack — `HELD` 만료(`NEEDS_CONFIRM`)의 **유일한 탈출구** |
| ③ | `POST /internal/notifications/eligibility` | 발송 직전 상태 재확인 |

**개수가 계약이다.** 후보 탐색·정산·회계용 코어 조회를 하나씩 더하다 보면 알림 서버가 사실상
코어 DB 를 읽는 상태가 되고, 그때는 DB 를 나눈 의미가 남지 않는다.

**그리고 `projections` 는 이 셋을 대신하지 않는다.** 컷오버 이관이 `user`·`participation` 두 자원으로
알림 서버의 `projections` 를 **한 번 세우지만**(승인 계획 ②′ · 이관 계약의 `UserProjectionRecord` ·
`ParticipationProjectionRecord`), **그 투영을 갱신할 이벤트 producer 가 아직 하나도 없다** —
`InboundService.PROJECTIONS` 6종 중 어느 것도 Data·Business 가 발행하지 않는다. 즉 적재된 값은
**그 시점에 박제된 bootstrap** 이다.

그래서 발송 판정은 계속 **코어 정본**이 소유한다: 적격성은 ③, 탈퇴·세대는 Data 명령/outbox 이벤트,
설정은 알림 서버의 `settings` 테이블(이관 `settings` 자원이 채우고 `notification.settings.changed` 가
갱신한다)이다. 「투영이 있으니 읽어도 되겠지」로 판정을 옮기면 **변경 피드가 없는 채로 조용히 옛
상태로 판정**하게 된다 — 판정을 투영으로 옮기려면 **그 투영의 producer 를 먼저 배선**해야 한다.

① 의 항목은 **표시명(`displayName`)·언어·설정 5필드 존재/null·탈퇴·세대**를 싣는다. 표시명은 지금
어떤 템플릿도 쓰지 않지만 제공자를 먼저 배포해 둔다(A22 ㉹) — 템플릿이 투영 표시명을 쓰기 시작하는
순간, 그때 비어 있으면 **개명한 적 없는 유저 전원이 빈 이름으로 렌더된다**.

②는 `InternalNotificationController` 가 제공한다. `InternalChallengeResultController`(선점·확인,
호출자는 Business)와 나눠 둔 이유는 **호출자가 다르기 때문**이다 — ②의 호출자는 알림 서버다.
읽기 로직 자체는 `ChallengeResultAckService.readAckState` 하나뿐이라 「행이 없을 때」의 처리가
두 곳에서 갈리지 않는다.

**②는 행이 없어도 404 가 아니다.** 「미확인」과 「참가 행 없음」은 억제를 푸는 쪽에서 결론이
같고(둘 다 「확인 표시 없음」), 404 를 던지면 수렴 경로가 그 예외에 막혀 탈출구를 두고도
빠져나오지 못한다. `{acknowledged:false, acknowledgedAt:null}` 을 그대로 돌려준다.

### ③ 적격성 — fail-closed

| 조건 | 결과 |
| --- | --- |
| 모르는 kind | `UNKNOWN_KIND` **거절** |
| 수신자 없음·탈퇴 | `USER_INACTIVE` 거절 |
| 대상이 필요한데 비어 있음 | `SUBJECT_REQUIRED` 거절 |
| 대상이 사라짐 | `SUBJECT_GONE` 거절 |
| 챌린지 삭제·(개설 알림만) 비활성 | `CHALLENGE_INACTIVE` 거절 |
| 그룹원 아님 | `NOT_GROUP_MEMBER` 거절 |
| 친구 요청이 이미 수락·거절됨 | `REQUEST_RESOLVED` 거절 |
| 회차가 더는 `OPEN` 아님 | `SESSION_CLOSED` 거절 |
| 참가 마감 지남 | `JOIN_CLOSED` 거절 |
| 이미 참가함 | `ALREADY_JOINED` 거절 |
| 그 회차 참가자 아님 | `NOT_PARTICIPANT` 거절 |
| 회차가 아직 미종료 | `NOT_SETTLED` 거절 |
| **DB 장애·타임아웃** | **거절이 아니라 5xx** |

「모르면 일단 허용」은 새 kind 가 붙을 때마다 재확인을 조용히 건너뛴다. 반대로 거절은 발송이
멈춰 즉시 눈에 띈다.

일시 오류를 `eligible=false` 로 접지 않는 이유: 장애가 「정책상 안 보냄」으로 둔갑하면 그 동안의
알림이 통째로 사라지고 되짚을 근거도 남지 않는다.

친구 요청의 판정 축은 `subjectId`(상대 유저)가 아니라 **`params.requestId`** 다 — 거절 후 재요청이
같은 행을 되살리므로 상대 유저만으로는 「같은 요청」을 식별할 수 없다.

## 8. 전환 스위치

`notification.dispatch.mode` = `LEGACY`(기본) \| `OUTBOX`. 기본값이 코드에 있으므로
`application-*.yml` 을 건드리지 않아도 기동한다.

**되돌림 스위치가 아니다.** `OUTBOX` 로 올린 뒤 `LEGACY` 로 내리면, 그사이 알림 DB 에만 쌓인
발송 이력을 Data 가 모르므로 **이미 나간 알림이 다시 나간다**(계약 §7 — 「kind 플래그만 legacy 로
되돌려 두 DB 발송 이력의 차이를 무시하지 않는다」). 되돌림은 이관 절차의 일부이지 설정 한 줄이 아니다.

## 9. 이관 (export · 재생)

`--notification.migration.enabled=true` 로만 켜지는 CLI 다. 별도 스크립트가 아니라 같은 배포본인
이유는 **키 조립을 다시 쓰지 않기 위해서**다 — export 가 만드는 사건 키는 producer 가 만드는 키와
한 글자도 달라서는 안 되고, 두 곳이 각자 문자열을 조립하면 그 「한 글자」가 언제든 갈라진다.

wire 계약의 정본은 알림 서버의 `MigrationRecords.java` 다. 아래는 Data 쪽 산출 규칙이다.

### 산출물 넷

| 파일 | 내용 |
| --- | --- |
| `<이름>.json` | 진단용 전체 문서 — manifest · 레코드 전량 · 실패 목록 · report |
| `<이름>.import-NNNN.json` | `POST …/import` 본문 `{records:[…]}` — **500건씩** 나눠 둔다 |
| `<이름>.verify.json` | `POST …/verify` 본문 `{manifest:{…}}` |

배치를 미리 나누는 이유: import 상한이 500 인데 운영 중에 손으로 자르면 **자른 자리가 검증에
남지 않는다**.

### 자원 셋

| 자원 | `recordKey` | 내용 |
| --- | --- | --- |
| `settings` | `userId` | 5필드 + `version`(유저 축 outbox version). 시각 표기는 `HH:mm:ss` |
| `device` | `SHA256hex(deviceToken)` | 토큰 원문 · `userId` · `authGeneration` · `active` |
| `delivery` | `eventId` | 상태 불문 전량 |

시각은 `settings` 의 조용한 시간 두 필드를 빼고 **전부 epoch milliseconds 정수**다 — 이벤트 봉투의
ISO-8601 과 다른 축이라, 섞으면 import 가 파싱에 실패하거나 더 나쁘게는 1970년으로 해석한다.

`settings` 는 **행이 실재하는 유저만** 내보낸다. 설정 행은 지연 생성이고 「행 없음」의 뜻은
「기본값」이다 — 여기서 기본값을 만들어 보내면 「사용자가 직접 켠 것」과 구분되지 않고, 나중에
기본값이 바뀌어도 옛 값이 박제된다.

`device` 는 **탈퇴자도** 내보낸다(`active=false`). 그래야 알림 서버가 그 기기의 토큰을 정리하고,
그러지 않으면 이전 계정 푸시가 그 기기로 계속 간다.

### 체크섬

- `recordChecksum` = `SHA256hex(정규형 JSON(data))`
- `resourceChecksum` = `SHA256hex` of `"<resource>:<recordKey>=<recordChecksum>\n"` 을
  **recordKey 오름차순**으로 이어 붙인 것. 빈 자원도 `SHA256("")` 을 채운다 — 「행이 없다」와
  「자원을 통째로 빠뜨렸다」를 구분해야 한다.

정규형 JSON 의 규칙(`MigrationCanonicalJson`, 단위 테스트가 전부 못 박고 있다):

| 항목 | 규칙 |
| --- | --- |
| 키 순서 | **코드포인트** 오름차순 (`String.compareTo` 아님 — 보충 문자에서 갈린다) |
| 공백 | 없음. 구분자는 `,` 와 `:` 뿐 |
| 비 ASCII | **이스케이프하지 않는다.** UTF-8 원문 — 한글 닉네임·그룹명이 이 선택으로 갈린다 |
| 제어문자 | `\b \f \n \r \t` 는 짧은 형태, 나머지는 **소문자** `\uXXXX` |
| 수 | 정수는 정수로. **부동소수는 거부**(표기가 플랫폼마다 달라 체크섬이 갈린다) |
| `null` | 키를 유지한 채 `null` — 키를 빼면 「필드가 아직 없는 구 스키마」와 섞인다 |

### `SENT` 도 새 키로 옮긴다

미발송만 키를 정규화하고 종결분을 구 id 로 두면, 컷오버 뒤 재훑기가 같은 사건을 **새 키**로 다시
만들어 이미 나간 알림이 한 번 더 간다. 그래서 상태와 무관하게 같은 규칙으로 키를 만든다.

시간축은 **`slot_at` 을 먼저** 본다(이월돼도 바뀌지 않게 설계된 컬럼이라 「사건이 언제 일어났는가」에
가장 가깝다). 없으면 `sent_at` → `claimed_at` 순이다. 발송·선점 시각을 먼저 쓰면 이월분·재훑기
회수분이 producer 가 만들 키와 어긋난다.

종결분은 **다시 렌더하지 않으므로** 코어 참조를 붙이지 않는다 — 중복 억제의 근거로만 옮긴다.

`RANK_OVERTAKE` 는 **옮기지 않는다.** 신 producer 가 만들지 않으므로 「새 키로 다시 생길」 위험이
없고, 옮기면 신 카탈로그에 없는 kind 가 알림 DB 에 남는다.

### 실패를 숨기지 않는다

미발송인데 발송 params 를 만들 수 없는 행은 `failures[]` 에 사유(`SESSION_GONE` ·
`PARTICIPANT_GONE` · `CHALLENGE_GONE` · `USER_GONE` · `UNKNOWN_KIND` · `NO_SUBJECT` ·
`NO_EVENT_TIME`)와 함께 남고, **strict 모드에서는 예외로 죽는다**. `--notification.migration.lenient=true`
는 「무엇이 안 되는지 보기만 하는」 사전 점검 전용이다.

### 정지 창 (`stopWindow`)

| 필드 | 출처 |
| --- | --- |
| `closedAt` | **운영자 입력**(`--notification.migration.closed-at=<millis>`). Data 는 정지 창을 닫은 시각을 알 수 없다 — 지어내면 verify 의 `verifiedAt > closedAt` 검사가 아무것도 검사하지 않게 된다 |
| `cursor` | 같은 스냅샷의 `aggregate_versions` **전 축 벡터 해시** — `"av:<축 수>:<sha256>"`. **시각이 아니다**: 시각은 발급 순서일 뿐 커밋 순서가 아니라, 그 시각 이전이 모두 커밋됐다는 뜻이 되지 않는다 |
| `queueDepth` | **실측 합계.** 0 으로 하드코딩하지 않는다 |
| `source` | 언제나 `"data-api"` |

`queueDepth` 는 **「Data 가 아직 밖으로 내보낼 것이 남았는가」**다. 구 클레임 큐를 여기 넣으면
안 된다 — 그 행들은 **이관할 화물**이지 잔여 작업이 아니고, 넣으면 0 이 되는 날이 영영 오지 않아
게이트를 열 수 없다(특히 `next_attempt_at` 이 미래인 이월분은 정의상 지금 비워질 수 없다).

| 항목 | 조회 | 합계 포함 |
| --- | --- | --- |
| `outboxKafkaUndelivered` | `event_outbox_deliveries` `target='KAFKA' AND delivered_at IS NULL` | ✅ 잔여 |
| `outboxNotiUndelivered` | 같은 테이블 `target='NOTI' AND delivered_at IS NULL` | ✅ 잔여 |
| `migrationPayload` | `notification_sent_logs` 의 `PENDING` + `DEFERRED` | ❌ **화물** |

outbox 미전달은 drain 하면 0 이 되는 값이라 게이트 조건으로 삼을 수 있다. 그것을 남긴 채 열면
relay 가 나중에 발행하는 사건이 **이관분과 겹친다**.

내역은 `report.queueBreakdown` 에 전부 적는다 — 합계만 남기면 0 이 아닐 때 어디를 볼지 알 수 없다.
### 최종 export 의 게이트 넷

`closedAt` 없이 도는 최초 탐색 export 는 언제든 허용된다. **최종**(verify 에 쓸 수 있는) export 는
넷을 모두 통과해야 하고, 하나라도 어긋나면 예외로 죽는다:

| 조건 | 근거 |
| --- | --- |
| `closedAt` 이 주어졌다 | 정지 창을 닫은 시각은 운영자만 안다 |
| `--notification.migration.inflight-drained=true` | **DB 로는 알 수 없다.** 구 flush 는 선점 행을 지우고 나가므로, 그 스레드가 아직 도는지는 어떤 조회로도 보이지 않는다. 이 한 가지는 사람이 말해야 하고, 없이 통과시키면 「멈췄다고 생각한」 창 안에서 구 경로가 계속 발송한다 |
| 재조립 실패 0건 | 남기면 그 행들이 구 DB 에만 남고 컷오버 후에는 아무도 그 큐를 보지 않는다 |
| `queueDepth == 0` | 내보내지 못한 outbox 전달이 남은 채 열면 relay 가 나중에 발행하는 사건이 이관분과 겹친다 |

넷을 통과했는지는 문서의 `report.finalEligible` 에 **계산해서 적어 둔다** — 읽는 쪽마다 네 조건을
다시 조합하면 한 곳이 하나를 빠뜨려도 드러나지 않는다. 파일 이름으로는 탐색용과 최종본이 구분되지
않으므로, CLI 도 둘 중 무엇을 만들었는지 로그로 분명히 남긴다.

### 알려진 한계

- **`SUPPRESSED` 를 구 DB 에서 유도할 수 없다.** ack tombstone 은 `consumeUnsentClaims` 가
  `status=SENT` + `sent_at=now` 로 닫아 실제 발송과 구분되지 않는다. 둘 다 종결이라 「다시 보내지
  않는다」는 동작이 같으므로 전부 `SENT` 로 보낸다.
- **`attempts` 는 언제나 0 이다.** 구 테이블에 시도 횟수 컬럼이 없다. 0 을 지어낸 것이 아니라
  「세지 않았다」를 옮긴 것이므로 이 값으로 백오프를 계산하면 안 된다.
- **산출물에 FCM 토큰 원문이 들어간다.** wire 계약의 `device.deviceToken` 이 원문을 요구한다.
  그래서 파일을 **만들 때부터 0600** 으로 만든다(쓰고 나서 조이면 그 사이의 창이 열려 있다).
  사람이 읽는 `report` 쪽 중복 목록에는 앞 8자만 남긴다. POSIX 가 아닌 파일 시스템이면 권한
  지정이 통하지 않으므로 그때는 경고를 남긴다 — 조용히 넘어가지 않는다.
- **증분 export 를 지원하지 않는다.** 재개 커서로 쓸 만한 단조 값이 없다 — 이 프로젝트의 UUID v7
  생성기는 호출마다 새 인스턴스라 같은 밀리초 안에서 단조롭지 않고, 시각은 커밋 순서가 아니다.
  「이 지점 이후」로 이어 읽으면 그사이 낮은 값으로 커밋된 행을 조용히 건너뛴다.

### 놓친 크론 재생

알림 서버는 코어 DB 를 읽지 않아 후보를 다시 찾을 수 없고 Data 로 트리거를 부를 수도 없다
(조회 3종뿐). 그래서 재생은 Data 쪽 CLI 다.

`--notification.migration.replay=<잡 이름>@<놓친 슬롯 ISO-8601>` — **지금 시각이 아니라 놓친
슬롯 시각**을 준다. 판정 잡은 전부 `Instant now` 를 받고 그게 순위 집계 구간이자 「정확히 N일째」의
기준이자 결정적 키의 시간축이다. 지금으로 돌리면 오늘 날짜의 키가 나와서 원래 슬롯의 사건과
다른 키가 되고, 이미 이관된 사건과 중복되거나 원래 슬롯이 영영 재생되지 않는다.

유효기간이 지난 종류는 **건너뛰고 `SKIPPED_EXPIRED` 로 남긴다** — 성공으로 기록하지 않는다.
과거 슬롯을 성공으로 기록하면 그 슬롯은 다시는 점검되지 않는다. `LEGACY` 모드에서는 아예 돌지
않는다(`SKIPPED_LEGACY_MODE`) — 과거 슬롯의 알림이 지금 FCM 으로 곧장 나가기 때문이다.

| 잡 | 유효기간 | 근거 |
| --- | --- | --- |
| `notification-league-weekly-results` | 7일 | 일어난 사실의 통보 — 늦어도 맞다. 다음 주가 오면 두 주 전 이야기가 된다 |
| `notification-league-deadline` | 4시간 | 마감(월 00:00)까지 |
| `notification-league-sunday-crisis` | 15시간 | 그날 자정까지 |
| `notification-league-relegation-warning` | 6시간 | 마감까지 |
| `notification-league-final-deadline` | 2시간 | 이름 그대로 |
| `notification-inactive-return` | 13시간 | 「정확히 N일째」라 날이 바뀌면 그 유저는 이미 다른 단계다 |
| `notification-missed-focus-today` | 2시간 | 「오늘」이 지나면 거짓 |
| `notification-streak-at-risk` | 2시간 | 자정이면 이미 끊겼거나 지켜졌다 |
| `notification-bet-event-rescan` | 48시간 | 자기 회복형 — 한 번 돌리면 48시간치를 스스로 회수한다 |
| `notification-session-open` | 2시간 | 슬롯 유예. 참가 마감은 적격성 조회가 한 번 더 본다 |
| `notification-challenge-window-end` | 24시간 | 결과 통보 |
| `notification-challenge-duration-end` | 14시간 | 어제치 결과 통보 — 조용한 시간 진입까지 |

재생 **대상이 아닌** 크론과 그 이유(목록에서 그냥 빼면 「빠뜨린 것」과 구분되지 않는다):

| 잡 | 이유 |
| --- | --- |
| `notification-rank-overtake` | A5 폐기 — 신 카탈로그에 kind 자체가 없다 |
| `notification-bet-event-flush` | 신 모드에서 flush 는 알림 서버 소유 — Data 가 재생할 것이 없다 |
| `notification-silent-flush` | 정산이 이미 지났으면 깨워 봐야 flush 할 것이 없다. 포그라운드 sync 가 최후 보루 |
| `group-bet-freeze-monitor` | 사용자 발송이 아니라 운영 로그 |

## 10. Data 잔류 잡 등록부

`/tmp/gromo-data-resident-jobs.json` — `NotificationScheduler.java` 를 파싱해 뽑은 실측 목록이다.
관리 콘솔의 크론 등록부 seed 이자 재생 CLI 의 id 원본이다.

실측: `@Scheduled` **17개**, 메서드 **16개**(`streak-at-risk` 에만 `@Scheduled` 가 둘 — 일요일만
21:00 오프셋, 22:00 은 마감 2h 푸시와 겹친다). 그중 재생 가능 **12개**, 재생 대상 아님 **4개**.

**kind 19 ≠ cron 12 다. kind 마다 job 을 만들면 안 된다.** 어긋나는 이유는 둘:

- 한 크론이 두 kind 를 낸다 — `notification-league-sunday-crisis` 는 유저당 1건 분기로
  `LEAGUE_RELEGATION_WARNING` 또는 `LEAGUE_DEADLINE_D1` 을 낸다.
- 크론이 아예 없는 kind 가 있다 — `BET_WON` · `CHALLENGE_CREATED` · `FRIEND_REQUEST` ·
  `FRIEND_ACCEPTED` 는 `BEFORE_COMMIT` 리스너로만 나고, `BET_RESULT` · `BET_VOID_REFUND` 는
  이벤트가 주 경로이며 15분 재훑기는 **유실 회수**다.

### 소유권이 바뀌는 잡

| 잡 | 바뀌는 것 |
| --- | --- |
| `notification-bet-event-flush` | **Noti 소유로 이전.** Data 쪽은 `OUTBOX` 모드에서 즉시 0 을 돌려주는 no-op — 남은 구 클레임 행을 여기서 보내면 Noti 가 이미 보낸 것을 Data 가 한 번 더 보낸다 |
| `notification-rank-overtake` | A5 폐기. 크론·판정은 남기되 발송 0, 판정 건수만 로그 — 「조용한 사라짐」이 아니라 「기록된 중단」 |
| `notification-silent-flush` | 후보 판정은 **Data 잔류**(크론은 계속 돈다). 다만 재생은 하지 않는다 |
| `group-bet-freeze-monitor` | **알림이 아니다** — 판돈 동결 운영 로그. 콘솔 알림 잡 목록에서 뺀다 |

### 렌더 카탈로그

`/tmp/gromo-notification-catalog.json` — 19 kind 의 현행 ko 문구·변수·`quietPolicy`·적격성·
딥링크·`data.type`, 그리고 파생 규칙(티어 이름 5단계 · `shortfallText` 포맷). 알림 서버의
ICU 4-locale 템플릿 seed 용이다.

같은 파일의 `bundleRenderKinds` 에 묶음 렌더 전용 4종(`*_BUNDLE`)의 구 Data 문구를 참고값으로
담았다 — **Data 는 이 4종을 발행하지 않는다.** 개별 사건만 낸다.


모집(`CHALLENGE_SESSION_OPEN`)은 Data가 수신자·그룹·슬롯별로 사건을 만들 대상 `sessionId` 집합을
`params.bundleMembers`에 함께 싣는다. 이미 참가해 사건을 만들지 않는 회차는 해당 수신자의 집합에서 제외한다.
Notification은 이미 `SENT`·`SUPPRESSED`인 구성원까지 수신 완료로 세고, 불완전 묶음은 보류한다.
수신 사이에 flush가 실행되어도 먼저 도착한 일부만 발송하지 않으며, 기존 FCM 재시도와 조용한 시간 이월은 보존한다.
