# 고양이 잡지 운영 런북

GROMO-2289 고양이 잡지(냐옹)를 운영할 때 쓰는 SQL·설정 절차다. 운영 화면은 따로 만들지 않았다. 운영 사전 검토가 없어서(10/14 확정) 운영 일은 아래 몇 가지뿐이라 SQL 로 충분하다고 봤다.

- 대상 스키마: Data DB 의 V113~V117 (`magazine_asset_meta` · `island_promotions` · `magazine_issues` · `magazine_receipts` · `magazine_editorial_notes` · `island_promotion_reports` · `island_promotion_funnel`).
- SQL 은 `psql` 기준이다. `\set 이름 '값'` 으로 값을 넣고 본문에서는 `:'이름'` 으로 쓴다. 꺾쇠(`<…>`) 자리를 실제 값으로 바꾼다.
- 바꾸는 문장은 `BEGIN;` 안에서 돌린다. 영향받은 행 수(`UPDATE 1` 등)를 확인한 뒤 `COMMIT;`, 다르면 `ROLLBACK;` 한다.
- 시각은 DB 에 UTC 로 저장된다. 「며칠 호」는 KST 날짜(`issue_date`)다. 07:00 KST = 전날 22:00 UTC 다.
- 누가 어떤 경로로 prod DB 에 붙는지는 아직 정해지지 않았다(서버·인프라 담당 확인 필요). 정해지면 이 문서 맨 위에 적는다.

## 1. 기능 스위치 켜기·끄기

설정값 `magazine.enabled` 이고, 환경 변수는 `MAGAZINE_ENABLED` 다. 기본값은 꺼짐이다.

| 상태 | 홍보 신청·고치기 | 07시 발행 잡 | 읽기(재료 목록·쓰기 화면·잡지·기록판) |
| --- | --- | --- | --- |
| 꺼짐 | 503 (공개 `SERVICE_UNAVAILABLE`) | 돌지 않는다 | 열려 있다. 호가 없으면 `issue: null` |
| 켜짐 | 07~24시 KST 에 열림 | 07:00~23:50 KST, 10분마다 | 열려 있다 |

- dev: Secrets Manager `gromo/dev/env` 에 `MAGAZINE_ENABLED=true` 를 넣고 Data 서버를 다시 배포한다.
- prod: 앱의 잡지 화면(A3)이 배포된 뒤에 켠다. 켜는 날 07~23시 사이면 다음 10분 틱이 그날 호를 바로 낸다.
- 끄면 그 순간부터 신청이 막히고 다음 날부터 호가 나오지 않는다. 이미 낸 홍보비는 돌려주지 않는다.

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

잡지 첫 장의 「편집부 소식」 칸이다. 그날 행이 없으면 몽돌 집중 팁(호수 % 14 번째 문장, 앱 번역 파일)이 나온다. 발행 순간(그날 07:00 KST) 값이 그 호에 고정되므로 **전날 안에** 넣는다. 80자까지 넣을 수 있고, 칸 실측 뒤 조정할 수 있다.

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
- 23:50 틱까지 실패하면 `오늘 호가 없다` error 로그가 남고, 그날 호는 나가지 않는다. 그날 신청한 칸은 기록판에 「실리지 않음(SKIPPED)」으로 보인다. 홍보비는 돌려주지 않는다(계획 P15 기본값).
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

## 5. 홍보 기록판 숫자 확인

회관 기록판(`GET /islands/{islandId}/promotions/records`)과 같은 숫자를 SQL 로 본다. 넣음(PIN)은 바다판 잡지(A5)가 나온 뒤에야 생긴다. 섬에서 본 잡지에는 망원경 동그라미가 없다(10/14 확정).

```sql
\set island_id '<섬 id>'
SELECT p.issue_date, p.body,
       count(*) FILTER (WHERE f.step = 'PIN')    AS pinned,
       count(*) FILTER (WHERE f.step = 'ARRIVE') AS arrived,
       count(*) FILTER (WHERE f.step = 'JOIN')   AS joined
FROM island_promotions p
LEFT JOIN island_promotion_funnel f ON f.promotion_id = p.id
WHERE p.island_id = :'island_id'
GROUP BY p.id, p.issue_date, p.body
ORDER BY p.issue_date DESC
LIMIT 20;
```

## 6. 꾸미기 재료

지금 에셋 64종(틀 11 · 스티커 45 · 테이프 8)은 모두 무료(`free`)이고 V113 이 시드했다. 아래는 앞으로 새로 그리는 시즌 재료를 다룰 때 쓴다. 앱이 그림을 가진 id 만 넣는다 — id 는 `mag.` + 그림 id 다.

### 6-1. 시즌 재료 추가와 바다 보상 단계

시즌 재료(`season`)는 바다 집중 누적 보상으로만 생긴다. 지급은 바다 세션이 생긴 뒤부터 돈다. 스티커는 서랍 탭이 반드시 있어야 하고(`cat`·`sea`·`friends`·`deco`), 틀·테이프는 탭이 없다 — DB CHECK 가 막는다. 바다 보상은 스티커·틀만 준다(테이프는 주지 않는다).

```sql
\set product_id 'mag.<그림 id>'
\set title '<이름>'
\set set_key '<YYYY-MM>'
BEGIN;
INSERT INTO catalog_assets (product_id, title, kind, owner_type)
VALUES (:'product_id', :'title', 'ad_sticker', 'user');
INSERT INTO magazine_asset_meta (product_id, kind, bundle, drawer_tab, sort_order)
VALUES (:'product_id', 'ad_sticker', 'season', 'sea', 100);
-- 그 달 바다 집중 누적 120분을 넘으면 준다.
INSERT INTO sea_reward_tiers (set_key, threshold_minutes, product_id)
VALUES (:'set_key', 120, :'product_id');
COMMIT;
```

### 6-2. 서랍에서 내리기(퇴역)

이미 붙인 칸은 그대로 그린다. 퇴역한 재료는 보유 행이 있거나 그 섬의 직전 칸에 있던 것만 다시 실을 수 있다. 무료 재료도 퇴역하면 「모두가 가진 것」 에서 빠진다.

```sql
\set product_id 'mag.<그림 id>'
UPDATE magazine_asset_meta SET retired_at = now() WHERE product_id = :'product_id' AND retired_at IS NULL;
```
