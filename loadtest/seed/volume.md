# 시드 볼륨 설계 — post-V7 스키마 기준 (진실 원천: `back/src/main/resources/db/migration/V1~V7`)

> PRD §8-2(작성 시점 post-V2)와 부하테스트-아키텍처.md(v2 설계) 볼륨표의 **최신 교정본**.
> 이후 V8+ 마이그레이션이 추가되면 이 표부터 갱신한다. `SEED_VERSION=seed-v1`.

## 볼륨표

| 테이블 | 건수(SCALE=1) | 생성 경로 | 핵심 제약·규칙 (post-V7) |
|---|---|---|---|
| occupations | 19 | CSV | code PK — users.occupation CHECK 도메인과 동일 19종 |
| **default_tags** | 40 | CSV | V4 신설 — name UNIQUE. id=`md5('dtag-'||i)` |
| occupation_default_tags | 76 (19×4) | CSV | V4: name→`default_tag_id` FK(NOT NULL), UNIQUE(occupation, default_tag_id) |
| league_tier_configs | 5 | CSV | PK=tier_level(int) |
| users (+1:1 ×5) | 10만 (×5) | CSV / 위성은 SQL | nickname UNIQUE(한글, trgm 표적)·is_guest 10%·is_deleted 2%·last_active_at NOT NULL |
| **user_focus_tags** | 40만 (유저×4) | SQL | V4 신설 — default_tag_id NOT NULL, partial UNIQUE(user,default_tag) WHERE deleted_at IS NULL. id=`md5('utag-'||n||'-'||i)` |
| daily_focus_stats | ~1,200만 (유저×평균 활동일 120) | SQL | UNIQUE(user_id,date)·total_distraction_seconds·is_focus_time_goal_achieved. **focus_sessions보다 선행**(FK 대상) |
| daily_screen_time_stats | ~1,200만 | SQL | UNIQUE(user_id,date)·total_screen_time_minutes·is_screen_time_goal_achieved |
| **focus_sessions** | **~3,000만** (활동일×1~4회) | SQL | PK 외 인덱스 0(Phase 1 표적). status COMPLETED 97%/CANCELED 3%·focus_type INFINITE 60/RANGE 25/POMODORO 15·`total_distraction_seconds` NOT NULL·focus_tag_id→**user_focus_tags**·daily_focus_stat_id FK. id=`seed_uuid_v7(started_at)` — 커서 정렬 보존 |
| focus_sessions_pomodoro_setting | 3 | SQL | V6 프리셋 마스터 |
| **focus_session_pomodoros** | ~450만 (POMODORO 세션 1:1) | SQL | V6 — focus_session_id UNIQUE FK. 세션에서 유도 |
| currency_transactions | 500만 (유저×50) | SQL | type ∈ SESSION_COMPLETE/STREAK_BONUS/PURCHASE·idempotency_key UNIQUE=`md5('ct-'||n||'-'||i)` |
| friendships | ~200만 (유저×20) | SQL | UNIQUE(from,to)·status PENDING/ACCEPTED/REJECTED·deleted_at 5% |
| pinned_users | ~20만 | SQL | V3 리네임(구 pinned_friends)·컬럼 pinned_user_id·UNIQUE(user,pinned_user) |
| groups | 5만 | CSV | V5로 미션 컬럼·V3로 code·**V7로 host_id/bet_type/notice_permission/started·ended_at 없음** — 방장 = members i=1 OWNER 단일 원천. 한글 name(Phase 3 표적)·status WAITING/ACTIVE/ENDED |
| group_join_codes | 0 | — | V3 신설 — 부하 표적 아님, 시드 생략 |
| user_blocks | 0 | — | V7 신설 — 부하 표적 아님, 시드 생략 |
| group_members | ~100만 (그룹×20) | SQL | UNIQUE(user,group)·role OWNER(i=1)/MEMBER·status INACTIVE/CHALLENGE/FOCUS·is_left·**V7 announcement_permission(OWNER=ALLOW)** |
| group_challenges | 20만 (그룹×4) | SQL | V5: 파라미터 컬럼 없음. type TIME_WINDOW/DURATION·category FOCUS/SCREEN_TIME·status ACTIVE/INACTIVE·created_at NOT NULL |
| group_challenge_durations / _windows | ~10만 / ~10만 | SQL | V5 CTI — type별 1:1 상세(NOT NULL 파라미터) |
| group_challenge_members | ~200만 (챌린지×10) | SQL | UNIQUE(challenge,user)·progress_minutes·created_at NOT NULL |
| league_arenas | ~4만 (12주×유저/30/티어) | SQL | V2: started_at·created_at NOT NULL. status ACTIVE(현재주)/ENDED |
| league_arena_users | ~120만 (arena×30) | SQL | UNIQUE(arena,user)·rank·result PROMOTED/STAY/RELEGATE_WARNING/RELEGATED |
| items | 500 | CSV | idx<400 EQUIPPABLE(slot=idx%4)/나머지 DECORATIVE. id=`md5('item-'||idx)` |
| user_items | ~100만 (유저×10) | SQL | UNIQUE(user,item)·is_used |
| character_equipment | 40만 (유저×4슬롯) | SQL | UNIQUE(user,slot_type)·슬롯 일치 EQUIPPABLE만 |
| **합계** | **≈ 7,000만 / ~15GB+** | | 하한 요구(≥3,000만) 충족. 데이터 > SUT RAM(8GB) 유지 |

## 결정론 규칙 (재현성)

- **차원 UUID**: `md5('<prefix>-'||n)` — CSV 생성기(node)와 팩트 SQL이 **같은 공식**을 공유해
  조인 없이 FK를 유도한다 (`user-` `group-` `item-` `dtag-` `utag-` `odt-`).
- **시간순 UUID**: focus_sessions만 `seed_uuid_v7(started_at)` — 커서 페이지네이션(`ORDER BY id DESC`)의
  부하 특성 보존.
- **난수**: SQL `setseed(0.548)` + node mulberry32 고정 시드 — 같은 SCALE이면 같은 golden.
- **공유 공식**: 그룹 멤버 `memberIdx(g,i) = (g*17 + i*53) % N_users + 1` — `i=1`이 role=OWNER
  (V7 이후 방장의 단일 원천 — groups.host_id 는 삭제됨).

## 적재 순서 (FK 위상)

```
CSV:  occupations → default_tags → occupation_default_tags → league_tier_configs → users → groups → items
SQL:  유저 위성 ×5 → user_focus_tags → currency_transactions → friendships → pinned_users
      → group_members → group_challenges(+durations/windows) → group_challenge_members
      → league_arenas → league_arena_users → user_items → character_equipment
      → pomodoro_setting(3)
      → [제약 저장·드롭] daily_focus_stats → daily_screen_time_stats → focus_sessions
        → focus_session_pomodoros [30에서 제약 복원 + VACUUM ANALYZE]
```

대형 4테이블(dfs·dsts·sessions·pomodoros)만 PK/UNIQUE/FK를 드롭 후 적재하고 30에서 복원한다
(수십 배 가속). 제약 DDL은 `pg_get_constraintdef`로 `seed_saved_constraints`에 저장해 이름·정의
그대로 복원 — 마이그레이션이 제약명을 바꿔도 시드 스크립트는 수정 불필요.
