# 주간 섬 랭킹 운영 런북

GROMO-2349 주간 섬 랭킹(분자 read model `island_weekly_focus`, 분모 `island_weekly_member_counts`)을 운영할 때 쓰는 절차다. 운영 화면과 HTTP 엔드포인트는 따로 만들지 않았다. 아래 몇 가지는 설정값과 SQL 로 한다.

- 대상 스키마: Data DB 의 `island_weekly_focus`(V130), `focus_session_details`·`focus_session_intervals`, `islands`·`group_members`. 현행 스키마 정본은 `server/data-api/src/main/resources/db/v0/V0__baseline.sql` 이다.
- SQL 은 `psql` 기준이다. `\set 이름 '값'` 으로 값을 넣고 본문에서는 `:'이름'` 으로 쓴다. 꺾쇠(`<…>`) 자리를 실제 값으로 바꾼다.
- 바꾸는 문장은 `BEGIN;` 안에서 돌린다. 영향받은 행 수를 확인한 뒤 `COMMIT;`, 다르면 `ROLLBACK;` 한다. 읽기 전용 확인 SQL 은 트랜잭션이 필요 없다.
- 주는 **UTC 일요일 00:00Z 포함 ~ 다음 일요일 00:00Z 제외**다. 시각은 DB 에 UTC 로 저장된다. 일요일 00:00Z 앞뒤 몇 분에는 확인 SQL 을 돌리지 않는다(`now()` 로 고른 주가 바뀐다).
- 누가 어떤 경로로 prod DB 에 붙는지는 아직 정해지지 않았다(서버·인프라 담당 확인 필요). 정해지면 이 문서 맨 위에 적는다.

## 1. 이번 주 재계산

분자 사본이 정본(`focus_session_details` × `focus_session_intervals`)과 어긋났을 때(배포 창·장애로 가산이 빠졌거나, 정본을 SQL 로 고쳤을 때) **이번 주** 사본을 정본으로 다시 채운다. 지난 주는 일요일 00:00Z 주 마감 크론이 이미 다시 채운다. 지난 주를 따로 고치는 경로는 없다.

### 1-1. 스위치

설정값 `ranking.weekly-focus.recompute-on-startup`, 환경 변수 `RANKING_WEEKLY_FOCUS_RECOMPUTE_ON_STARTUP`, 기본값은 꺼짐이다. `application-satellites.yml` 에 있어 dev·prod(`<환경>,satellites,realtime-authorization`) 모두 읽는다.

켜면 Data 서버가 기동을 마친 직후(`ApplicationReadyEvent`) 이번 주를 한 번 다시 채운다. 결과는 멱등이다 — 정본에서 그 주를 지우고 다시 채우므로 몇 번을 돌려도 같은 값이다. 인스턴스가 여럿이면 각자 한 번씩 돌고 `island_weekly_focus` 테이블 잠금에서 줄을 선다. 잠금 동안(수 초) 같은 순간의 집중 완료가 그 뒤에 이어진다.

### 1-2. 절차 (dev)

1. Secrets Manager `gromo/dev/env` 에 `RANKING_WEEKLY_FOCUS_RECOMPUTE_ON_STARTUP=true` 를 넣는다.
2. Actions `Ops Dev Redeploy`(`ops-redeploy.dev.yml`)를 `data-api` 로 실행한다. 새 이미지 없이 SM 값을 새로 읽어 컨테이너를 다시 띄운다.
3. Data 서버 로그에서 `주간 섬 랭킹 분자 재계산 week=… 섬=…` (info)를 확인한다. `week` 는 이번 주 일요일 날짜, `섬` 은 채운 섬 수다. 실패하면 `기동 시 주간 섬 랭킹 분자 재계산 실패 week=…` (error)가 스택과 함께 남고 서버는 정상 기동한다 — 원인을 고친 뒤 다시 배포한다.
4. 아래 1-3 대조 SQL 을 돌려 **0행**임을 확인한다.
5. SM 값을 `false` 로 되돌리고(또는 키를 지우고) `Ops Dev Redeploy` 를 한 번 더 한다. **켜 둔 채로 두지 않는다** — 재기동·재배포마다 테이블 잠금을 쥔다.

prod 는 Infra 저장소의 `prod/catus/runtime` 환경 변수로 같은 키를 넣고 재시작한다(`server/scripts/README.md` 의 Catus prod 절차). 정확한 승인·재시작 절차는 인프라 담당에게 확인한다.

`RANKING_WEEKLY_FOCUS_RECOMPUTE_ON_STARTUP` 은 `.github/scripts/write-compose-env.py` 의 data-api 선택 키 목록에 있어야 컨테이너 env 로 내려간다. 목록에서 빠지면 SM 에 넣어도 무시된다.

### 1-3. 대조 SQL — 정본 vs 사본 (읽기 전용, 0행이면 일치)

정본 쪽은 `FocusSessionDetailRepository.sumIslandActiveSeconds`(구간마다 자르지 않고 창과의 교집합을 모두 더한 뒤 섬마다 한 번만 내림, 0초 섬 제외), 사본 쪽은 `IslandWeeklyFocusRepository.findSeconds`(`active_micros / 1000000`, 1초 미만 섬 제외)와 같은 술어다. 한 문장이라 두 쪽이 같은 스냅샷을 본다. 이번 주(`now()` 의 UTC 일요일 주)를 본다.

```sql
WITH w AS (SELECT ws::date week_start, ws AT TIME ZONE 'UTC' b, (ws + interval '7 days') AT TIME ZONE 'UTC' e
           FROM (SELECT date_trunc('week', (now() AT TIME ZONE 'UTC') + interval '1 day') - interval '1 day' ws) s),
canon AS (SELECT d.island_id, FLOOR(SUM(EXTRACT(EPOCH FROM (LEAST(i.ended_at,w.e)-GREATEST(i.started_at,w.b)))))::bigint seconds
          FROM w JOIN focus_session_intervals i ON i.started_at < w.e AND i.ended_at > w.b
          JOIN focus_session_details d ON d.session_id = i.session_id
          WHERE d.lifecycle='COMPLETED' AND d.kind='ISLAND' AND i.kind='ACTIVE' AND i.ended_at IS NOT NULL
          GROUP BY d.island_id HAVING FLOOR(SUM(EXTRACT(EPOCH FROM (LEAST(i.ended_at,w.e)-GREATEST(i.started_at,w.b))))) > 0),
rm AS (SELECT f.island_id, f.active_micros/1000000 seconds FROM island_weekly_focus f JOIN w USING (week_start)
       WHERE f.active_micros >= 1000000)
SELECT 'canon_only' side, * FROM (TABLE canon EXCEPT TABLE rm) a
UNION ALL SELECT 'rm_only', * FROM (TABLE rm EXCEPT TABLE canon) b;
```

- `canon_only` 는 정본에는 있는데 사본에 없거나 초가 다른 섬, `rm_only` 는 사본에만 있거나 초가 다른 섬이다. 초가 다르면 두 쪽에 같은 `island_id` 가 한 행씩 나온다.
- 사본은 마이크로초 합이고 정본은 초로 한 번 내린 값과 비교하므로, 정상이면 1초 어긋남도 없다.
- 재계산을 끝낸 뒤에도 행이 남으면 재계산 뒤에 정본만 바뀐 것이다(완료 전이는 정본과 사본을 같은 트랜잭션에서 바꾸므로 보통 아니다). 한 번 더 확인하고, 그래도 남으면 `island_id` 로 두 쪽을 따로 조회해 원인을 찾는다.

### 1-4. `GET /rankings/islands?week=` 와 맞춰 보기

응답의 `items[].averageFocusSeconds` 는 `분자(초) ÷ 분모(활성 주민 수)` 를 정수로 내린 값이다. 이번 주 분모는 **지금** 인원이고, 이름이 없는 섬(소프트 삭제·종료)은 목록에서 빠진다. 아래 SQL 이 같은 값을 만든다.

```sql
\set week '<YYYY-MM-DD, UTC 일요일>'
SELECT i.id AS island_id, i.name, f.active_micros / 1000000 AS seconds, m.members,
       (f.active_micros / 1000000) / m.members AS average_focus_seconds
FROM island_weekly_focus f
JOIN islands i ON i.id = f.island_id AND i.deleted_at IS NULL AND i.status <> 'ENDED'
JOIN (SELECT gm.group_id, count(*) AS members
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.is_left = false AND u.is_deleted = false
      GROUP BY gm.group_id) m ON m.group_id = f.island_id
WHERE f.week_start = :'week' AND f.active_micros >= 1000000
ORDER BY average_focus_seconds DESC, i.id;
```

- 활성 주민 수는 `group_members.is_left = false` 이고 `users.is_deleted = false` 인 행 수다(`GroupMemberRepository.countByGroupIdIn` 과 같다). 섬은 `deleted_at IS NULL AND status <> 'ENDED'` 만 남는다.
- 순위는 공동 순위(1, 1, 3)이고 같은 평균 안의 표시 순서만 UUID 오름차순이다. 이 SQL 의 `i.id` 정렬은 PostgreSQL 의 uuid 순서라 Java 쪽과 다를 수 있으니, 같은 평균끼리는 순서 대신 값만 맞춘다.
- 이미 끝난 주(`week` 가 이번 주가 아님)는 분모가 지금 인원이 아니라 동결된 값이다. 위 SQL 의 `m` 서브쿼리 자리에 `SELECT island_id AS group_id, member_count AS members FROM island_weekly_member_counts WHERE week_start = :'week'` 를 쓴다. 동결 행이 없는 섬은 응답에서 빠진다.

## 2. 2344 전제 점검 — `last_transition_at` ≥ 모든 구간의 `ended_at`

회관 기록 조회(GROMO-2344)는 끝난 세션이 «창과 겹친다» 를 «`last_transition_at > 창 시작`» 으로 먼저 거른다(`FocusSessionDetailRepository.OPEN_OR_ENDED_AFTER_FROM`, 인덱스 `focus_session_details_user_transition_idx (user_id, island_id, last_transition_at)`). 끝난 세션의 `last_transition_at` 이 그 세션의 어떤 구간 `ended_at` 보다도 작지 않다는 전제에 기댄다. 전제가 깨진 행은 구간이 창과 겹쳐도 거름에서 빠져 회관 기록 합계가 조용히 모자란다. 주간 랭킹 분자는 이 거름을 쓰지 않으므로 영향이 없다.

이 점검은 2344 가 나가는 배포 전에, 그리고 대량 정본 보정 뒤에 한가한 시간에 돌린다(읽기 전용이지만 두 표를 모두 훑는다).

```sql
SELECT count(*) FROM focus_session_details d WHERE d.lifecycle='COMPLETED'
  AND EXISTS (SELECT 1 FROM focus_session_intervals i WHERE i.session_id=d.session_id AND i.ended_at > d.last_transition_at);
```

**0 이면 통과**다. 0 이 아니면 **배포를 멈추고** 어긋난 세션을 본다.

```sql
SELECT d.session_id, d.user_id, d.last_transition_at, max(i.ended_at) AS max_ended_at
FROM focus_session_details d JOIN focus_session_intervals i ON i.session_id = d.session_id
WHERE d.lifecycle = 'COMPLETED'
GROUP BY d.session_id, d.user_id, d.last_transition_at
HAVING max(i.ended_at) > d.last_transition_at
ORDER BY max(i.ended_at) - d.last_transition_at DESC
LIMIT 100;
```

바로잡는다. 영향받은 행 수가 위 점검의 개수와 **같아야** 커밋한다.

```sql
BEGIN;
UPDATE focus_session_details d SET last_transition_at = m.mx
FROM (SELECT session_id, max(ended_at) mx FROM focus_session_intervals GROUP BY session_id) m
WHERE m.session_id = d.session_id AND d.lifecycle = 'COMPLETED' AND m.mx > d.last_transition_at;
-- UPDATE N 의 N 이 점검의 count 와 같으면 COMMIT, 다르면 ROLLBACK
COMMIT;
```

고친 뒤 점검 SQL 을 다시 돌려 0 인지 확인한다.

**부작용.** 회관 기록의 `completedAt`(`IslandRecordsService`, `last_transition_at` 에서 온다)이 그 세션의 실제 종료 시각으로 옮겨진다. 기록 목록의 정렬이 바뀔 수 있다. 주간 랭킹 분자는 구간 시각만 쓰므로 그대로다.

## 3. 인덱스 생성 임계 (2,000만 행)

V129·V130 모양의 인덱스(일반 `CREATE INDEX`, 부분 인덱스 포함)는 만드는 동안 그 표의 쓰기를 막는다. 막히는 시간은 어림으로 **1천만 행당 4~5초**다. 읽기는 막히지 않는다. 그래서 아래 세 표가 **2,000만 행**을 넘으면 같은 모양의 인덱스를 일반 마이그레이션으로 더하지 말고 이 절의 선택지를 따른다.

| 표 | 인덱스 | 추가된 마이그레이션 |
| --- | --- | --- |
| `focus_session_details` | `focus_session_details_user_transition_idx (user_id, island_id, last_transition_at)` | V130 |
| `group_members` | `group_members_active_group_user_idx (group_id, user_id) WHERE is_left = false` | V129 |
| `island_guestbook_entries` | `island_guestbook_live_recent_idx (island_id, created_at DESC, id DESC) WHERE deleted_at IS NULL` | V129 |

행 수는 통계로 어림한다(정확한 수가 필요하면 `count(*)`).

```sql
SELECT relname, reltuples::bigint AS approx_rows
FROM pg_class
WHERE relname IN ('focus_session_details', 'group_members', 'island_guestbook_entries');
```

`reltuples` 가 `-1` 이면 아직 `ANALYZE` 를 안 한 표다. 한 번 `ANALYZE <표>;` 를 하고 다시 본다.

**지금 이 인덱스들은 어디서 만들어지나.** 셋 다 `db/v0/V0__baseline.sql` 에 들어 있어서, 빈 DB(`empty`)와 이미 V0 인 DB(`current`)에서는 다시 만들지 않는다. V129·V130 이 적용되기 전의 옛 DB(`legacy`)는 `deploy-v0.py` 가 원본 체인(`db/migration/V1`~`V138`)을 V138 까지 적용할 때 이 인덱스들을 만든다. 이 적용은 모든 writer 를 멈춘 중단 창 안에서 하므로, 막힘은 «쓰기 지연» 이 아니라 «중단 창이 늘어남» 으로 나타난다(`server/data-api/docs/db/README.md` 자동 배포 절). 앞으로 `db/v0/V1__*.sql` 이상에 같은 모양의 인덱스를 더할 때가 이 임계를 보는 때다.

**`CONCURRENTLY` 마이그레이션으로 떼어내는 것은 지금 형태로는 안 된다.**

- Flyway 의 `executeInTransaction=false` 와 `CREATE INDEX CONCURRENTLY` 조합은 이미 시도했다가 철회했다(GROMO-801, `db/migration/V18__group_name_trgm_index.sql` 머리 주석). Flyway 가 마이그레이션 구간 내내 별도 커넥션을 `idle in transaction` 으로 잡고, `CONCURRENTLY` 는 자기보다 먼저 시작된 모든 트랜잭션의 종료를 기다리므로 서로 무한 대기한다. 부팅 시 Flyway 를 자동 실행하는 dev/prod 에서는 애플리케이션이 기동 중 멈춘다.
- 적용된 마이그레이션은 바이트가 계약이다(체크섬). V129·V130 파일을 고쳐 쓸 수 없고, V0 와 `db/migration` 의 과거 체인은 불변 자료다.
- V129·V130 의 `CREATE INDEX` 에는 `IF NOT EXISTS` 가 없다. 인덱스를 미리 손으로 만들어 두면 Flyway 가 같은 이름을 다시 만들려다 `already exists` 로 실패한다.

현실적인 선택지는 둘이다.

1. **한가한 시간에 배포하고 막힘을 받아들인다.** 위 어림(1천만 행당 4~5초)이 허용 가능한 중단·지연일 때. 대부분의 경우 이쪽이다. `deploy-v0.py` 경로면 어차피 writer 를 멈춘 창이다.
2. **수동으로 미리 만들고 이력 행을 손으로 맞춘다.** `CREATE INDEX CONCURRENTLY` 를 운영 DB 에서 직접 돌린 뒤, 해당 마이그레이션의 `flyway_schema_history` 행을 체크섬까지 맞춰 직접 넣는다. 위험이 크다 — 체크섬을 잘못 넣으면 기동이 거부되고, 만들다 실패한 `INVALID` 인덱스가 남을 수 있으며, 이력을 손으로 건드리는 일 자체가 되돌리기 어렵다. 방법과 책임 범위를 서버 담당과 먼저 합의한 뒤에만 한다.

새로 추가하는 마이그레이션이라면 `CREATE INDEX IF NOT EXISTS` 로 쓰면 선택지 2 가 안전해진다(미리 만들어 둔 인덱스를 건너뛴다). 이미 적용된 V129·V130 은 고칠 수 없다.
