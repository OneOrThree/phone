# 고양이 잡지 운영 런북

고양이 잡지의 검토·승인·게시와 운영 SQL 절차다. 최종 검토와 발행은 [콘텐츠 백오피스](../../../../backoffice/README.md)에서 수행한다. SQL은 재료 관리와 장애 조사에 사용한다.

**승인 발행 전환:** 이 버전부터 10분 주기 잡이 새 호를 자동으로 만들지 않는다. 관리자가 날짜·편집부 문구를 정하고 비공개 스냅샷을 불러와 검토 → 승인 → 게시한다. 실제 게시 날짜는 당일 KST 07시 이후다. 홍보 내용이 검토 이후 바뀌면 다시 불러와 승인한다. 기존 잡은 이미 게시한 호의 알림 펼치기를 재시도한다. 배포 전에 운영자 토큰·백오피스 영구 저장소·매일 발행 담당자를 준비한다.

- 대상 스키마: Data DB 의 V118~V123, 알림 펼치기 표시 열은 V126 (`magazine_asset_meta` · `island_promotions` · `magazine_issues` · `magazine_receipts` · `magazine_editorial_notes` · `island_promotion_reports`).
- SQL 은 `psql` 기준이다. `\set 이름 '값'` 으로 값을 넣고 본문에서는 `:'이름'` 으로 쓴다. 꺾쇠(`<…>`) 자리를 실제 값으로 바꾼다.
- 바꾸는 문장은 `BEGIN;` 안에서 돌린다. 영향받은 행 수(`UPDATE 1` 등)를 확인한 뒤 `COMMIT;`, 다르면 `ROLLBACK;` 한다.
- 시각은 DB 에 UTC 로 저장된다. 「며칠 호」는 KST 날짜(`issue_date`)다. 07:00 KST = 전날 22:00 UTC 다.
- 누가 어떤 경로로 prod DB 에 붙는지는 아직 정해지지 않았다(서버·인프라 담당 확인 필요). 정해지면 이 문서 맨 위에 적는다.

## 1. 기능 스위치 — 항상 켜짐(10-27, 티켓 2535)

종전 스위치 `magazine.enabled`는 없다. 홍보 신청·고치기는 07~24시 KST에 열리고 읽기(재료 목록·쓰기 화면·잡지)는 늘 열려 있다. 호가 없으면 `issue: null`이다. 새 호는 백오피스에서 승인 후 게시하며, 알림 재시도 잡은 하루 종일 10분마다 돌며 최근 7호 중 아직 알림을 펼치지 않았고 만료 전인 호를 재시도한다. 전날 늦게 게시한 호도 다음날 07:00 KST 만료 전까지 대상이며 조용한 시간 정책은 그대로 적용된다. 아래 배포 이력은 자동 발행이었던 이전 버전의 기록이다.

- dev: 2026-10-27 #1345(`cb1e18e28`) 배포부터 항상 켜져 있다. 발행된 호와 알림은 §4-1·§4-4의 조회로 확인한다.
- 운영: 다음 `main → release` 승격일에 #1345를 포함한 Data 이미지가 배포되면 켜진다(예정일은 그 승격일). 그때부터 홍보 신청에는 물고기 60마리가 차감되고 `MAGAZINE_PUBLISHED` 알림 사건도 생성된다. 실제 푸시 발송은 알림 서버의 발송 게이트와 전달 경로 상태에 달려 있다.

### dev 스모크 섬

dev 스모크는 자신이 만든 `smoke-island-*`·`smoke-friends-*`·`smoke-core-*` 섬을 검사 종료 시 마지막 주민 퇴장 API(`DELETE /islands/{id}/memberships/me`)로 닫는다. 중간에 실패해도 정리를 시도하고 정리 실패는 스모크 FAIL이다. 옛 실행의 고정 이름 `smoke-island`를 포함해 이미 만들어진 섬은 이 변경으로 닫히지 않는다. 생성 응답에 ID가 없으면 이번 실행의 고유 이름으로 섬을 조회해 확인된 경우에만 닫고 TC는 FAIL로 남긴다. 조회로 확인할 수 없으면 다른 섬을 닫지 않고 아래 SQL로 수동 확인한다.

옛 섬 정리는 재영님이 dev Data DB에서 아래 **조회만** 실행해 대상 ID를 확정한다. `smoke-` 접두어만으로 종료 대상을 고르지 않는다. 활성 주민이 스모크 전용 게스트인지, 다른 주민·대기 중 가입 신청·진행 중 집중·실사용 홍보가 있는지 확인하고 하나라도 불분명하면 그 섬은 제외한다.

```sql
-- 살아 있는 후보. 사람이 같은 접두어로 지은 섬도 나올 수 있다.
SELECT id, name, status, created_at FROM islands
WHERE name LIKE 'smoke-%' AND deleted_at IS NULL AND status <> 'ENDED'
ORDER BY created_at, id;

-- 후보 하나씩 실제 ID로 바꿔 주민과 게스트 여부를 확인한다.
\set island_id '<확인한 스모크 섬 UUID>'
SELECT i.id, i.name, i.status, i.deleted_at, m.user_id, m.role, m.is_left, u.is_guest, u.is_deleted
FROM islands i
LEFT JOIN group_members m ON m.group_id = i.id AND m.is_left = false
LEFT JOIN users u ON u.id = m.user_id
WHERE i.id = :'island_id'::uuid;

SELECT status, count(*) FROM island_join_requests
WHERE island_id = :'island_id'::uuid GROUP BY status;
SELECT d.session_id, d.user_id, d.lifecycle FROM focus_session_details d
WHERE d.island_id = :'island_id'::uuid AND d.lifecycle IN ('ACTIVE', 'PAUSED');
SELECT p.id, p.moderation, p.applied_by, u.is_guest, u.is_deleted
FROM island_promotions p JOIN users u ON u.id = p.applied_by
WHERE p.island_id = :'island_id'::uuid;
```

해당 게스트의 유효한 토큰이 **실제로 남아 있다면**, 진행 중 집중을 먼저 끝내고 각 주민이 자기 토큰으로 `DELETE /islands/{id}/memberships/me`를 호출한다. 주민이 여럿이면 다른 주민이 먼저 나가고 방장이 마지막에 나간다. API 성공 뒤 위 조회로 `islands.status = 'ENDED'`, `deleted_at IS NOT NULL`, 활성 주민 0명인지 확인한다. 토큰은 로그·문서에 남기지 않는다.

옛 실행의 토큰이 없으면 API로 퇴장시킬 수 없다. **`UPDATE islands SET status = 'ENDED', deleted_at = now()` 단독 실행은 금지한다.** 그것만으로는 `group_members.is_left`·이탈 시각, 대기 중 가입 신청 취소, 주민·섬 상태 사건, 공동 데이터 삭제가 빠진다.

이 경우 재영님과 Data 서버 담당이 현재 `GroupMemberService.withdrawGroupAndRecord()` 및 `IslandPurgeService.purgeIsland()`를 기준으로 대상 ID별 수동 트랜잭션을 작성·검토한 뒤 실행한다. 개인 집중·정산 증거는 보존하고, 공동 통장·건설·퀘스트·게시판·방명록·잡지 홍보·랭킹 등 `IslandPurgeService.PURGE_STATEMENTS` 대상은 자식부터 삭제해야 한다. 신청자나 주민이 스모크 게스트가 아니거나 활성 집중이 있으면 먼저 원인을 처리하고 재조회한다. 실행 전후 활성 주민·대기 신청·공동 데이터 건수를 비교하고 예상과 다르면 `ROLLBACK`한다. 서비스 경로와 같은 이탈·상태 사건을 만들 수 없는 SQL은 실행하지 않는다. 동등한 수동 트랜잭션을 마련할 수 없으면 Data 담당자가 서비스 경로를 사용하는 일회성 관리 명령을 준비한 뒤 정리한다.

## 2. 신고로 숨겨진 칸

서로 다른 소셜 계정 3명이 신고하면 그 칸은 자동으로 `moderation = 'HIDDEN'` 이 되고 모든 독자에게서 빠진다. 서버는 경고 로그 `promotion hidden id=…` 를 남긴다. 운영은 확인한 뒤 내리거나(REMOVED) 되살린다(CLEARED).

### 2-1. 숨겨진 칸 목록

```sql
SELECT p.id, p.issue_date, g.name AS island, p.body, p.hidden_at,
       count(r.reporter_id) AS reports,
       string_agg(DISTINCT r.reason, ', ') AS reasons
FROM island_promotions p
JOIN groups g ON g.id = p.island_id
LEFT JOIN island_promotion_reports r ON r.promotion_id = p.id
WHERE p.moderation = 'HIDDEN'
GROUP BY p.id, p.issue_date, g.name, p.body, p.hidden_at
ORDER BY p.hidden_at;
```

### 2-2. 한 칸의 신고 내역

```sql
\set promotion_id '<홍보 id>'
SELECT r.reason, r.created_at, r.reporter_id
FROM island_promotion_reports r
WHERE r.promotion_id = :'promotion_id'
ORDER BY r.created_at;
```

### 2-3. 내리기 — 위반이면

물고기 60마리는 돌려주지 않는다(정본 153행). 내린 칸은 다시 보이지 않는다. 섬장이 쓰기 화면을 다시 열면 그 칸의 글은 비워지고 꾸미기만 불러온다.

```sql
\set promotion_id '<홍보 id>'
BEGIN;
UPDATE island_promotions SET moderation = 'REMOVED'
WHERE id = :'promotion_id' AND moderation = 'HIDDEN';
-- UPDATE 1 이면 COMMIT, 0 이면 이미 처리된 칸이다 — ROLLBACK
COMMIT;
```

### 2-4. 되살리기 — 위반이 아니면

되살린 칸(CLEARED)은 신고가 더 와도 다시 자동으로 숨기지 않는다. 다음 읽기부터 다시 보인다.

```sql
\set promotion_id '<홍보 id>'
BEGIN;
UPDATE island_promotions SET moderation = 'CLEARED', hidden_at = NULL
WHERE id = :'promotion_id' AND moderation IN ('HIDDEN', 'REMOVED');
COMMIT;
```

## 3. 편집부 소식

잡지 첫 장의 「편집부 소식」 칸이다. 백오피스에서 80자 이내 문구를 작성한 뒤 게시 내용을 불러온다. 비공개 스냅샷을 만든 시점의 문구가 승인·게시까지 고정된다. 문구를 바꾸면 새 스냅샷을 불러와 다시 승인한다. 문구를 비우면 기존 날짜별 소식 또는 몽돌 집중 팁(호수 % 14)을 사용한다.

아래 SQL은 기존 날짜별 기본 문구를 관리하는 보조 절차다. SQL을 수정해도 이미 만든 검토 스냅샷이나 게시한 호는 바뀌지 않는다.

### 3-1. 넣기·고치기

```sql
\set issue_date '<YYYY-MM-DD>'
\set body '<편집부 소식 문구>'
BEGIN;
INSERT INTO magazine_editorial_notes (issue_date, body) VALUES (:'issue_date', :'body')
ON CONFLICT (issue_date) DO UPDATE SET body = EXCLUDED.body;
COMMIT;
```

### 3-2. 빼기 — 그날은 몽돌 팁

```sql
\set issue_date '<YYYY-MM-DD>'
DELETE FROM magazine_editorial_notes WHERE issue_date = :'issue_date';
```

### 3-3. 앞으로 넣어 둔 소식

```sql
SELECT issue_date, body FROM magazine_editorial_notes
WHERE issue_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
ORDER BY issue_date;
```

## 4. 발행 확인

### 4-1. 최근 7호

```sql
SELECT issue_no, issue_date, published_at, promotion_count
FROM magazine_issues ORDER BY issue_no DESC LIMIT 7;
```

- 그날 07:10 KST 가 지났는데 그날 호가 없으면 Data 서버 로그에서 `고양이 잡지 발행 실패` 를 찾는다. 23:50 까지 10분마다 다시 시도한다.
- 23:50 틱까지 실패하면 `오늘 호가 없다` error 로그가 남고, 그날 호는 나가지 않는다. 그날 신청한 칸도 발행되지 않는다. 홍보비는 돌려주지 않는다(계획 P15 기본값).
- 최근 7호의 `promotion_count` 가 모두 10 이상이면 서버가 「조간·석간 전환 기준 충족」 경고 로그를 남긴다(OPS-03 판단용).

### 4-2. 그날 호에 실린 칸과 빠진 칸

```sql
\set issue_date '<YYYY-MM-DD>'
SELECT p.applied_at, g.name AS island, p.body, p.moderation,
       CASE WHEN p.snapshot IS NULL THEN '실리지 않음' ELSE '실림' END AS published
FROM island_promotions p JOIN groups g ON g.id = p.island_id
WHERE p.issue_date = :'issue_date'
ORDER BY p.applied_at, p.id;
```

### 4-3. 그날 호 다시 내기 — dev 전용

dev 에서 07시를 기다리지 않고 다시 발행해 보는 방법이다. **prod 에서는 하지 않는다.** 독자의 받음·읽음 상태가 지워진다.

```sql
\set issue_date '<YYYY-MM-DD>'
BEGIN;
-- 실린 숫자를 지운다 — 다시 낼 때 그 순간 값으로 새로 고정된다.
UPDATE island_promotions SET snapshot = NULL WHERE issue_date = :'issue_date';
-- 호 행을 지우면 그 호의 받음 상태도 함께 지워진다(FK CASCADE).
DELETE FROM magazine_issues WHERE issue_date = :'issue_date';
COMMIT;
```

지운 뒤 10분 안의 다음 틱(07:00~23:50 KST)이 그 날짜가 오늘이면 다시 낸다. 호수는 「지금까지의 마지막 호수 + 1」 이라, 가장 최근 호를 지웠을 때만 같은 호수로 다시 나온다.

### 4-4. 발행 알림(GROMO-2307)

07시 발행 뒤 10분 틱마다 `magazine_issues.notified_at IS NULL` 인 **오늘** 호를 정식 계정 전원(게스트·탈퇴 제외)에게 펼친다. `MagazinePublishScheduler`가 `MagazineIssueNotifier`를 호출하고, Data는 사용자별 `MAGAZINE_PUBLISHED` 사건을 outbox의 Kafka 대상으로 적는다. Relay가 `notification-events`로 전달하면 Notification이 소비해 `deliveries`에 적재하고 발송한다. 펼치기가 전부 끝나면 `notified_at`을 확정하고, 확정된 호는 다시 펼치지 않는다. 앱 실수신은 배포 빌드·FCM 자격과 발송 상태를 함께 확인한다.

경로를 열려면 Data의 `OUTBOX_RELAY_ENABLED=true`, Notification의 `NOTIFICATION_KAFKA_ENABLED=true`·`NOTIFICATION_SCHEDULING_ENABLED=true`, 알림 DB의 `dispatch_control.enabled=true`가 모두 필요하다. 실제 발송에는 등록부의 `delivery-dispatch` job 활성화와 FCM 자격도 필요하다([알림 서버 운영 절차](../../../../server/notification/README.md#dev-발송-게이트)). 운영의 실제 설정값은 배포 환경에서 확인한다. `OUTBOX_RELAY_REALTIME_KAFKA_ENABLED`는 잡지 알림과 무관하다.

**로그** — `고양이 잡지 알림` 접두로 찾는다.

| 문구 | 수준 | 뜻 |
| --- | --- | --- |
| `펼치기 완료` | info | 먼저 확정한 틱만 남긴다(겹친 틱은 남기지 않는다) |
| `펼치기 실패 — 다음 틱(10분 뒤)에 이어서 한다` | warn | 예외로 끊겼다 — 같은 방식으로 이어진다 |
| `고양이 잡지 알림 펼치기가 그날 마지막 틱까지 실패했다` | error | 23:50 틱에서 예외로 끊겼다 — 다음 날은 다른 호만 보므로 자동 재시도는 끝났다 |

**확인**

```sql
-- ① Data DB: 호 상태. notified_at 이 NULL 이면 펼치기 미완료다.
SELECT id, issue_date, issue_no, notified_at FROM magazine_issues ORDER BY issue_date DESC LIMIT 3;
```

호 id를 확인한 뒤 알림 서버 DB에서 발송 상태를 조회한다. `notified_at`은 outbox 적재 완료 표시이며 FCM 발송 완료 표시가 아니다.

```sql
-- ② 알림 서버 DB: 그 호의 발송 상태. subject_id 는 위에서 확인한 호 id다.
SELECT status, count(*) FROM deliveries
 WHERE kind = 'MAGAZINE_PUBLISHED' AND subject_id = '<호 id>'
 GROUP BY status;
```

```sql
-- ③ Data DB: 현재 정식 계정 수. 펼치기 당시의 대상 수와는 달라질 수 있다.
SELECT count(*) FROM users WHERE is_guest = false AND is_deleted = false;
```

**펼치기 실패 뒤** — 같은 날 다음 틱이 남아 있다면 `notified_at IS NULL`인 호를 다시 펼친다. 사용자별 독립 트랜잭션과 결정적 사건 키가 이미 적힌 요청의 중복을 접는다. `notified_at`이 잘못 확정된 경우에는 원인을 확인한 뒤 같은 날 `notified_at`을 NULL로 되돌려 다음 틱에 다시 펼칠 수 있다. 23:50 이후에는 다음 날 틱이 **다른 날짜의 호**만 보므로 지난 호는 이 방법으로 되살릴 수 없다. `deliveries`의 미발송 상태와 `notification-events.DLT`를 확인하고 담당자에게 알린다.

**주의**

- cron 이 10분이고 `lockAtMostFor` 가 PT9M 이라 펼치기가 9분을 넘기면 틱이 겹칠 수 있다. 선점·결정적 키가 중복을 막고, 겹친 틱이 같은 사용자에서 서로 기다릴 수 있다.
- Relay·Kafka 소비·발송 스케줄러·DB 발송 게이트 중 하나라도 닫혀 있으면 알림이 발송되지 않는다. `notified_at`만으로 수신을 판단하지 않는다.
- 하루 중간에 배포하면 그날 호 알림이 그 시각에 나간다(DROP 은 조용한 시간만 버린다). 23:50 이후~07:00 전 배포는 다음 07:00 틱이 정상 경로로 처리한다(cron `0 0/10 7-23`).
- 틱은 발행 결과와 상관없이 `notifyIfPending` 을 부른다 — 오늘 날짜 호 행이 있고 `notified_at IS NULL` 이면 펼치고, 그 호가 없으면 조용히 끝난다.
- 발송 확인은 알림 서버 DB의 `deliveries`에서 한다. `event_id`는 `noti:MAGAZINE_PUBLISHED:<userId>:<호 id>:<KST 날짜>`이며 상태는 `PENDING`·`DEFERRED`·`SENT`·`SUPPRESSED`·`FAILED` 중 하나다. 처리 못 한 Kafka 레코드는 `notification-events.DLT`에 쌓인다. DLT 재처리 절차는 아직 문서화되지 않았다(담당자 보강).
- Data에서 잡지 사건을 내보내기 전에 알림 서버 V8 카탈로그 적용을 확인한다. 없으면 `UNKNOWN_NOTIFICATION_KIND`로 거절될 수 있다.

**롤백** — 알림 서버를 V8 카탈로그가 없는 버전으로 되돌리면 남은 `MAGAZINE_PUBLISHED`가 422(`UNKNOWN_NOTIFICATION_KIND`)로 DLT에 갈 수 있다. Data와 알림 서버의 배포 버전·미전달 outbox를 먼저 확인한다. 아래 V125·V126 기준 절차는 10/16 배포 기록이며 V0 이후의 현행 마이그레이션 번호가 아니다.

### 4-5. 10/16 마무리 에픽 — 앱 인계 항목

이 절의 V125·V126·V129 표기는 10/16 당시 배포 기록이다. V0 이후 DB의 `flyway_schema_history`에는 이 번호의 행이 없다.

서버가 먼저 나가고 앱이 따라온다. 앱이 규칙대로 읽기 전까지 아래 값은 서버만 준비된 상태다.

| 티켓 | 서버가 내리는 것 | 앱 규칙 |
| --- | --- | --- |
| 2316 | 비공개 섬장도 홍보할 수 있다(서버 409 없음). `SERVER_MAX_STICKERS` 10→5 — 기존 6~10장 칸을 고치면 400 `PROMOTION_LAYOUT_INVALID`. 잡지 칸·편집부 랭킹·새 섬의 `privateIsland` | 비공개 섬장의 홍보 버튼 해제. 스티커는 5장까지, 6~10장 칸은 고치기 전에 줄이게 한다. `privateIsland` 는 **키가 없으면 false**. true 면 망원경 동그라미를 숨기고 「초대로만」 안내를 보인다(잡지→망원경 핀은 404) |
| 2317 | `GET /me/telescope` 항목 `buildingCount`. 목록은 1시간 스냅샷(V125 `telescope_buckets`), 핀 만료는 정시+1h | `buildingCount` 는 **키가 없으면 0**. 단계는 앱 `islandStage(memberCount, buildingCount)`. 목록은 1시간 고정이고 빠진 섬은 채우지 않으므로 새 섬 칸 0 은 빈 상태. 핀 수명은 정시까지이고, 가까운 섬을 핀하면 그 시간 라벨을 보이지 않는다 |
| 2287 | V129 부분 인덱스 2개 — `group_members (group_id, user_id) WHERE is_left=false`(망원경 후보·핀 가시성의 섬별 주민 수), `island_guestbook_entries (island_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`(방명록 최근 30개·정리). 07:00 평균 스냅샷은 섬 id 를 5000개씩 끊어 주민 수를 센다(바인드 상한 32767) | 응답 계약 변화 없음. 롤백은 새 마이그레이션의 `DROP INDEX`(일반 `CREATE INDEX` 라 적용 중 `group_members` 쓰기가 잠시 막힌다 — 활성 주민 10만 행 규모에서 수십 ms) |
| 2090·2091 | 알림 `gromo://magazine?issue={issueId}` · `data.type=MAGAZINE_PUBLISHED`. `issue` 는 호 id(UUID). 만료는 호 날짜 다음 날 07:00 KST. 만료된 호도 최근 7호 안이면 200 에 `current=false` 이고, 404 는 7호 밖 호 id 일 때만이다 | 만료 호를 탭하면 열되 «현재 호» 표시는 하지 않고, 7호 밖 호 id 를 탭하면 「없는 호」로 처리한다. 실수신은 배포 빌드·FCM 자격과 발송 상태를 확인한다 |

### 4-6. 10/16 마무리 에픽 롤백 순서

아래는 10/16 배포 당시의 롤백 기록이다. 현재 배포의 실행 절차로 사용하기 전에 V0 스키마와 실제 이미지 버전을 다시 확인한다.

**되돌릴 신호**

- `GET /me/telescope` 의 5xx·지연이 정시 직후에 튄다(2306 — 읽기-쓰기 트랜잭션 + 사용자 행 공유 잠금 + 버킷 INSERT).
- 알림 서버가 422 `TEMPLATE_ARGUMENT_MISSING`/`UNKNOWN_NOTIFICATION_KIND`를 내고 DLT로 간다(2307 — 카탈로그와 params 짝).
- data-api에 `고양이 잡지 알림 펼치기 실패` warn이 연속으로 뜬다(2307 — 펼치기 예외). 4-4의 호 상태와 알림 서버 `deliveries`·DLT를 먼저 확인한다.
- 비공개 섬 핀 404 는 앱 2316 전의 알려진 창이라 롤백 신호가 아니다.

1. **되돌리는 순서**: data-api → outbox 의 `MAGAZINE_PUBLISHED` 비우기 → 알림 서버. 알림 서버를 먼저 되돌리면 V8 이 없어 422 로 DLT 에 간다.
2. **Flyway(당시)**: data-api V125·V126과 알림 서버 V8을 기준으로 한 조치였다. V0 이후 DB의 `flyway_schema_history`에는 data-api V125·V126 행이 없으므로 현재 DB에 그대로 적용하지 않는다.
3. **2306**: `telescope_buckets` 행이 남아, 재배포하면 같은 1시간 안의 낡은 스냅샷이 정본처럼 재사용된다(영향 작음). 당겨진 핀 `expires_at` 은 복구할 수 없다.
4. **2305**: 롤백 사이 비공개 섬이 낸 홍보는 돈이 빠졌는데 잡지에 실리지 않는 상태다. `groups.is_private` 는 현재 값이므로, 현재 비공개인 섬의 홍보 중 롤백 기간에 신청된 것(`island_promotions.applied_at` 범위, 조인 `island_promotions.island_id = groups.id`)을 센다. 환불 판단의 후보 목록일 뿐이다.
5. **2307**: 재배포 뒤 `notified_at`이 NULL인 오늘 호는 첫 틱에 다시 펼쳐진다. 이미 적힌 사용자별 사건은 결정적 사건 키가 중복을 접는다.

### 4-7. 10/16 마무리 에픽 — 배포 직후 확인

아래 V125·V126 조회는 당시 배포 확인 기록이다. V0 이후 DB에서는 0행이므로 현재 배포 성공 판정에 사용하지 않는다.

```sql
-- ① data-api: V125·V126 이 success=true
SELECT version, description, success FROM flyway_schema_history WHERE version IN ('125','126') ORDER BY installed_rank;
-- ① 알림 서버 DB 에서도 같은 조회로 version = '8' 을 본다.

-- ② 핀: 배포 직후엔 거의 0 이다(V125 UPDATE 로 대부분 만료). 이후 새로 넣은 것만 는다.
SELECT count(*) FROM telescope_pins WHERE expires_at > now();

-- ② 버킷: 누군가 GET /me/telescope 를 한 번 열어야 현재 정시 행이 생긴다 — 배포 직후 0 건은 정상이다.
SELECT bucket_start, count(*) FROM telescope_buckets GROUP BY 1 ORDER BY 1 DESC LIMIT 3;
```

**읽는 법**

- 버킷은 사용자당 1행이다(새 버킷 행을 넣을 때 그 사람의 옛 행을 지운다 — V125 헤더). 그래서 시간대별 이력이 쌓이지 않고, 위 조회는 «지금 정시 버킷에 몇 명이 열었나» 만 보여 준다.
- ③ 오늘 호 알림은 4-4 의 `notified_at` 쿼리와 `펼치기 완료` 로그로 본다.
- ④ 비공개 섬 랭킹은 읽기 시점 계산이라 SQL 이 없다. 편집부 페이지(`GET /me/magazine/today`) 또는 `/rankings/islands` 응답에 `privateIsland=true` 항목이 보이면 정상이다(10/16 의도).

## 5. 망원경 홍보 칸 미리보기

망원경은 `telescope_pins.promotion_id` 로 원래 홍보 칸의 글·꾸미기와 발행 당시 섬 정보를 읽는다. 현재 호에 보이는 칸만 미리보기로 제공한다. 홍보 성과(넣음·도착·가입)와 기록판 API는 제공하지 않는다. V123은 이전 집계 테이블만 제거하며 홍보 칸과 핀의 연결은 보존한다.

## 6. 꾸미기 재료

지금 에셋 64종(틀 11 · 스티커 45 · 테이프 8)은 모두 무료(`free`)이고 V118 이 시드했다. 아래는 앞으로 새로 그리는 시즌 재료를 다룰 때 쓴다. 앱이 그림을 가진 id 만 넣는다 — id 는 `mag.` + 그림 id 다.

### 6-1. 시즌 재료 추가

시즌 재료(`season`)는 지금 **지급 경로가 없다**. 바다 집중 누적 보상 엔진(GROMO-2274)은 GROMO-2301에서 세션 단위 꾸미기 보상(`customization_reward_*`, 머리·목만)으로 바뀌었고, 옛 누적·단계표는 V0 스키마 정리에서 제거했다. 시즌 재료를 다시 주려면 지급 경로를 새로 정해야 한다. 등록만 해 두려면 스티커는 서랍 탭이 반드시 있어야 하고(`cat`·`sea`·`friends`·`deco`), 틀·테이프는 탭이 없다 — DB CHECK 가 막는다.

```sql
\set product_id 'mag.<그림 id>'
\set title '<이름>'
BEGIN;
INSERT INTO catalog_assets (product_id, title, kind, owner_type)
VALUES (:'product_id', :'title', 'ad_sticker', 'user');
INSERT INTO magazine_asset_meta (product_id, kind, bundle, drawer_tab, sort_order)
VALUES (:'product_id', 'ad_sticker', 'season', 'sea', 100);
COMMIT;
```

### 6-2. 서랍에서 내리기(퇴역)

이미 붙인 칸은 그대로 그린다. 퇴역한 재료는 보유 행이 있거나 그 섬의 직전 칸에 있던 것만 다시 실을 수 있다. 무료 재료도 퇴역하면 「모두가 가진 것」 에서 빠진다.

```sql
\set product_id 'mag.<그림 id>'
UPDATE magazine_asset_meta SET retired_at = now() WHERE product_id = :'product_id' AND retired_at IS NULL;
```
