# 마을회관 없는 섬 정리 런북

GROMO-2763. `POST /islands`(「새 섬 만들기」)가 마을회관 없이 섬을 만들던 동안 생긴 섬을 한 번 정리하는 운영자 명령이다. 회관은 건물 트리의 뿌리라 회관 없는 섬에서는 아무것도 지을 수 없다. 같은 티켓에서 `POST /islands` 도 항해 정착(GROMO-2650)과 같이 회관을 완공 상태로 심으므로, 배포 뒤에는 새 대상이 생기지 않는다.

**이 명령은 배포만으로는 돌지 않는다.** 마이그레이션이 아니라 운영자가 부르는 내부 관리 API 이고, 기본값이 dry-run 이다. 운영 실행은 소유자 지시로만 한다.

## 1. 결정 (2026-11-05, 소유자)

- 대상: `deleted_at IS NULL`, `status <> 'ENDED'`, `island_facilities` 에 `building_id = 'hall'` 행이 없는 섬. 짓는 중(`BUILDING`)인 회관도 «있음» 이다.
- 다른 섬에도 소속된 주민은 그 소속이 남는다. 현재 섬은 나가기와 같은 규칙(`UserIslandContextRecovery`)으로 옮긴다 — 남은 섬 중 «가 본 섬» 이 있으면 가장 최근에 머문 섬, 없으면 먼바다다.
- 다른 섬이 없는 주민은 먼바다로 간다: `user_island_contexts.current_island_id = NULL`, `loss_reason = 'LEFT'`. `LEFT` 가 없으면 앱이 첫 항해 튜토리얼 대상으로 본다(`app/app-dev/src/services/model/reducer.ts` 의 `awaiting-first-island`). 컨텍스트 행이 없던 주민(가입만 하고 옮긴 적 없음)도 행을 만들어 `LEFT` 를 적고, 앞선 강퇴의 `KICKED` 가 남아 있던 주민도 `LEFT` 로 덮는다(그대로 두면 앱이 이 섬을 «강퇴된 섬» 으로 안내한다).
- 정리 순간 집중 중인 주민은 보상 없이 끝낸다(강퇴와 같은 `MEMBERSHIP_LOST`, 기본 마커 `AUTO_CLOSED`, 정산 행 없음).
- 섬 공동 지갑의 물고기는 섬과 함께 사라진다. Realtime DB 의 섬 채팅은 건드리지 않는다.

## 2. 명령이 섬마다 하는 일

섬 하나가 트랜잭션 하나다. 한 섬이 실패하면 그 섬만 롤백하고 다음 섬으로 넘어가며, 응답의 `outcomes` 에 남긴다.

1. 주민 `users` 행 공유 잠금 → 섬 행 배타 잠금 → **대상인지 다시 판정**(그사이 회관이 생겼거나 섬이 닫혔으면 `SKIPPED`).
2. 일반 주민 먼저, 방장 마지막으로 한 사람씩: 이탈 마킹(`left_reason = 'LEFT'`) → 이 섬의 진행 중 집중을 미정산 종결 → 메인 섬·현재 섬 복구 → 주민 목록 사건(`island.members.updated`, `MEMBER_REMOVED`).
3. 섬 종료(`status = 'ENDED'`) → 상태 사건(`island.updated`, `CLOSED`) → 대기 가입 신청을 `CANCELLED`/`ISLAND_CLOSED` 로 종결 → `IslandPurgeService` 로 공동 데이터 삭제(지갑·원장·홍보 칸·옛 무인도 예약 등)와 `deleted_at` 묘비.

알림은 내지 않는다. 강퇴가 아니라 강퇴 알림·안내가 없고, 메인 섬이 옮겨져도 「메인 섬 이전」 알림을 끈다 — 본인이 하지 않은 일로 한꺼번에 이전 알림이 가지 않게 했다. 주민 0명인 섬은 사건 주체가 없어 상태 사건을 생략한다(받을 주민도 없다).

**끝내지 않는 것**: 이 섬을 목적지로 항해 중인 바다 집중(`kind = 'SEA'`). 섬이 마지막 주민 이탈로 닫힐 때와 같은 기존 동작이다. 항해를 마치면 정산은 되고, 도착 요청은 `GROUP_NOT_FOUND`(앱 문구 「더 이상 이용할 수 없는 섬이에요」)로 거절된다. 끝내지 않은 항해도 3시간 방치 종결(`SEA_STALE_AFTER`)이 닫는다. dry-run 의 `activeSeaVoyages` 가 그 수다.

## 3. 부르는 법

- 경로: `POST /internal/admin/hall-less-islands/cleanup?dryRun=true|false`. **`dryRun` 을 빼면 dry-run 이다.** 정리는 `dryRun=false` 를 적었을 때만 한다. `true`/`false` 가 아닌 값은 400 이다.
- 자격: 운영자 전용 caller `ops` 의 토큰 `SVC_TOKEN_OPS_TO_DATA`(섬별 7일 평균 수동 실행과 같은 caller, [섬 랭킹 운영 런북](../island-rankings/ops-runbook.md) §4-1). 토큰이 비면 모든 요청이 `401`, 다른 서비스 토큰이면 `403` 이다.
- 망: Data 서버 안에서만 부른다. nginx 는 `/internal/` 을 막는다. 호스트에 들어가 Data 컨테이너 안에서 컨테이너 env 의 토큰으로 부른다 — 명령에 토큰 값이 드러나지 않는다. Data 이미지(`eclipse-temurin` jammy)에 `curl` 이 있다.

```sh
# <data-container> 는 docker ps 로 확인한다. 운영 V2 는 Compose 프로젝트 catus-v2 의 서비스 app 이다:
#   docker ps --filter label=com.docker.compose.project=catus-v2 --filter label=com.docker.compose.service=app --format '{{.Names}}'
docker exec <data-container> sh -c 'curl -fsS -X POST -H "Authorization: Bearer $SVC_TOKEN_OPS_TO_DATA" "http://localhost:8080/internal/admin/hall-less-islands/cleanup"'
# 실행(되돌릴 수 없다 — 5장 순서대로):
docker exec <data-container> sh -c 'curl -fsS -X POST -H "Authorization: Bearer $SVC_TOKEN_OPS_TO_DATA" "http://localhost:8080/internal/admin/hall-less-islands/cleanup?dryRun=false"'
```

응답:

```json
{
  "dryRun": true,
  "summary": {
    "islandCount": 0, "islandIds": [],
    "residents": 0, "residentsWithAnotherIsland": 0, "residentsGoingToSea": 0,
    "activeIslandFocusSessions": 0, "activeSeaVoyages": 0,
    "walletFish": 0, "pendingJoinRequests": 0, "upcomingPromotions": 0, "onboardingReservations": 0
  },
  "outcomes": []
}
```

- `summary` 는 실행 «직전» 의 대상과 영향이다. `residents` 는 사람 수(여러 대상 섬에 소속된 사람은 한 번), `residentsWithAnotherIsland` 는 대상이 아닌 살아 있는 섬에도 소속된 사람, `residentsGoingToSea` 는 나머지다. `upcomingPromotions` 는 오늘(KST) 이후 호의 잡지 홍보 칸이다.
- 실행이면 `outcomes` 에 섬마다 `{islandId, result, error}` 가 붙는다. `CLOSED` 정리함, `SKIPPED` 대상이 아니게 됨, `FAILED` 그 섬만 롤백(`error` 에 예외 종류, 문구는 Data 로그). `FAILED` 가 있으면 같은 명령을 다시 부른다 — 이미 닫힌 섬은 대상이 아니므로 남은 섬만 다시 처리한다. 잠그는 사이 주민이 바뀐 섬(`IllegalStateException`)과 잠금 교착도 이렇게 풀린다.
- Data 로그: 섬마다 `마을회관 없는 섬 정리 island=… result=… residents=…`(info), 실패는 `마을회관 없는 섬 정리 실패 — 이 섬만 롤백했다 island=…`(warn, 스택 포함).

### 3-1. 운영에서 부르기 전 선행 조건

1. **이 코드가 운영에 배포돼 있어야 한다.** main 머지 → `release` 승격 → 소유자 지시로 `prod-cd-V2`. 머지만으로는 운영에 없다.
2. **운영 Data 컨테이너에 `SVC_TOKEN_OPS_TO_DATA` 가 들어 있어야 한다.** 2026-11-05 확인한 Infra main(`69edca4`)의 `prod/catus-v2/runtime/env_writer-V2.py` 는 이 키를 토큰 중복 검사에만 쓰고, Data 컨테이너로 넘기는 `SERVICE_OPTIONAL_KEYS["data-api"]` 에는 없다. 그대로면 운영의 `ops` caller 는 비활성이라 모든 요청이 `401` 이다. 운영에서 쓰려면 Infra 가 그 목록에 키를 더하고, 운영 Secrets Manager 에 새 값(`openssl rand -hex 32`, 다른 `SVC_TOKEN_*` 과 달라야 한다)을 넣고, phone 의 `CATUS_PROD_INFRA_REVISION_V2` 를 그 Infra 커밋으로 올린 뒤 운영 배포가 한 번 돌아야 한다(Apple 폐기 `client_id` env 를 넣은 GROMO-2711 과 같은 네 곳).
3. 운영 호스트 접속은 SSM 세션이다(운영 DB 읽기 전용 조회와 같은 경로). dev V2 는 IAP SSH 로 `catus-dev-v2-app` VM 에 들어간다. dev 는 `.github/scripts/write-compose-env.py` 가 이 키를 이미 넘기므로 dev Secrets Manager 에 값만 있으면 된다.

## 4. 확인 SQL

`psql` 기준이다. 읽기 전용이라 트랜잭션이 필요 없다. 대상 술어는 명령과 같다(`HallLessIslandQuery.TARGET_PREDICATE`).

### 4-1. 대상 세기 (실행 전, 읽기 전용)

```sql
SELECT i.id, i.name, i.created_at, i.is_private,
       (SELECT count(*) FROM group_members m WHERE m.group_id = i.id AND m.is_left = false) AS residents,
       (SELECT w.balance FROM island_wallets w WHERE w.island_id = i.id) AS wallet_fish,
       EXISTS (SELECT 1 FROM onboarding_islands o WHERE o.island_id = i.id) AS onboarding_reservation
FROM islands i
WHERE i.deleted_at IS NULL AND i.status <> 'ENDED'
  AND NOT EXISTS (SELECT 1 FROM island_facilities f WHERE f.island_id = i.id AND f.building_id = 'hall')
ORDER BY i.created_at;
```

dry-run 응답의 `islandCount`·`walletFish` 가 이 결과의 행 수·잔액 합과 같아야 한다(사이에 바뀐 것이 없다면).

### 4-2. 실행 뒤 검증

실행 응답의 `CLOSED` 섬 id 와 실행 시작 시각을 넣는다.

```sql
\set ids '{<섬 UUID>,<섬 UUID>}'
\set started '<실행 직전 시각, 예: 2026-11-10T03:00:00Z>'
```

1. 대상이 0 이다.

   ```sql
   SELECT count(*) FROM islands i
   WHERE i.deleted_at IS NULL AND i.status <> 'ENDED'
     AND NOT EXISTS (SELECT 1 FROM island_facilities f WHERE f.island_id = i.id AND f.building_id = 'hall');
   ```

2. 닫힌 섬에 활성 주민이 없다 — 0.

   ```sql
   SELECT count(*) FROM group_members WHERE group_id = ANY(:'ids'::uuid[]) AND is_left = false;
   ```

3. 현재 섬·메인 섬이 닫힌 섬을 가리키지 않는다 — 둘 다 0.

   ```sql
   SELECT count(*) FROM user_island_contexts WHERE current_island_id = ANY(:'ids'::uuid[]);
   SELECT count(*) FROM user_main_islands WHERE island_id = ANY(:'ids'::uuid[]);
   ```

4. 닫힌 섬의 진행 중 섬 집중이 없다 — `ISLAND` 행이 없어야 한다. `SEA` 행은 그 섬으로 가던 항해라 남을 수 있다(2장).

   ```sql
   SELECT d.kind, count(*) FROM focus_session_details d
   WHERE d.island_id = ANY(:'ids'::uuid[]) AND d.lifecycle IN ('ACTIVE', 'PAUSED')
   GROUP BY d.kind;
   ```

5. 이번 정리로 소속이 하나도 남지 않은 사람은 전부 먼바다(`LEFT`)다 — 0. 0 이 아니면 그 사람은 앱에서 첫 항해 튜토리얼 대상으로 보인다.

   ```sql
   SELECT count(*) FROM group_members m
   LEFT JOIN user_island_contexts c ON c.user_id = m.user_id
   WHERE m.group_id = ANY(:'ids'::uuid[]) AND m.left_reason = 'LEFT' AND m.left_at >= :'started'::timestamptz
     AND NOT EXISTS (SELECT 1 FROM group_members o WHERE o.user_id = m.user_id AND o.is_left = false)
     AND (c.user_id IS NULL OR c.current_island_id IS NOT NULL OR c.loss_reason IS NULL);
   ```

6. 공동 데이터가 지워졌다 — 0.

   ```sql
   SELECT (SELECT count(*) FROM island_wallets WHERE island_id = ANY(:'ids'::uuid[]))
        + (SELECT count(*) FROM island_promotions WHERE island_id = ANY(:'ids'::uuid[]))
        + (SELECT count(*) FROM onboarding_islands WHERE island_id = ANY(:'ids'::uuid[]))
        + (SELECT count(*) FROM island_join_requests WHERE island_id = ANY(:'ids'::uuid[]) AND status = 'PENDING');
   ```

2·3 을 `ids` 대신 «닫힌 섬 전부»(`JOIN islands i … WHERE i.status = 'ENDED' OR i.deleted_at IS NOT NULL`)로 돌리면 이번 정리와 무관한 옛 잔재까지 나올 수 있다. 이번 정리의 판정은 `ids` 로 한다.

## 5. 절차

1. **운영 읽기 전용 세기.** 4-1 을 운영 DB 에서 돌려 섬 수·주민 수·잔액을 본다. 아무것도 바꾸지 않는다.
2. **dev 에서 먼저.** main 머지 뒤 dev V2 에 자동 배포된다. dev 에서 dry-run → 실행 → 4-2 를 돌려 전부 0 인지 확인한다. dev 에 대상이 없으면 회관 행을 지운 시험 섬으로 만든다.
3. **운영 배포와 선행 조건.** 3-1 의 배포·토큰을 마친다(소유자 지시).
4. **운영 dry-run.** 응답을 1 의 결과와 대조한다. `walletFish`(사라질 물고기)와 `activeIslandFocusSessions`(미정산으로 끝날 집중)를 소유자에게 보고한다. 사용자가 적은 시간을 고른다.
5. **RDS 스냅샷.** 실행 직전에 운영 DB 의 수동 스냅샷을 만든다(예: `aws rds create-db-snapshot --db-instance-identifier <운영 DB 인스턴스> --db-snapshot-identifier gromo-2763-before-hall-cleanup-<YYYYMMDD>`). 상태가 `available` 이 된 뒤에 진행한다. 되돌리는 길은 이 스냅샷 복구뿐이고, 복구는 DB 전체를 그 시점으로 되돌린다.
6. **운영 실행.** `dryRun=false` 로 한 번 부르고 응답을 보관한다. `FAILED` 가 있으면 다시 부른다.
7. **검증.** 4-2 를 돌려 전부 0(4번은 `ISLAND` 행 없음)인지 확인한다. 결과를 티켓에 남긴다.

## 6. 남는 영향

- Realtime 의 멤버십 캐시(최대 120초)는 주민 목록 사건(`MEMBER_REMOVED`, 대상 = 그 주민)이 지운다. relay 지연 동안에는 캐시가 만료될 때까지 옛 섬 채팅 구독이 잠깐 남을 수 있다 — 자진 이탈과 같다.
- 집중 프레즌스는 집중 종결이 섬 목록 사건과 함께 해제를 남긴다(강퇴와 같은 `FocusMembershipLossService` 경로). 매분 물고기 적립은 진행 중 섬 집중만 훑는데 대상 섬의 섬 집중은 모두 끝났으므로 지운 지갑에 닿지 않는다.
- 닫힌 섬의 초대 코드는 지우지 않고 읽을 때 `INVITATION_EXPIRED` 로 거른다(기존 섬 종료와 같다).
