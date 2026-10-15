-- GROMO-1999 · 진행 중인 건설 목표의 「대상 주민」 명단 백필
--
-- 스키마 변경 없음 — 데이터 백필 전용이다(V30 선례).
--
-- 배경: 이 티켓부터 `island_construction_contributions` 의 행은 두 가지를 겸한다 —
--   ① 그 epoch 의 «대상 주민 명단»(행이 있으면 대상, 없으면 대상 아님)
--   ② 그 주민이 채운 누적 물고기(amount)
-- 목표를 고르는 순간 그 시점의 활성 주민을 amount=0 으로 심고(IslandConstructionService#setTarget),
-- 기여 누적은 «이미 있는 대상 행만» UPDATE 한다(IslandConstructionContributionRepository#accumulate).
--
-- 그래서 «이 마이그레이션 전에 이미 골라져 있던 목표»는 그대로 두면 안 된다. 종전 스키마에서는
-- 실제로 기여한 주민에게만 행이 있었으므로:
--   · 기여가 아직 없던 목표 → 대상 행이 0개라 accumulate 가 갱신할 행을 영영 못 찾는다.
--     기여가 안 쌓이니 행도 안 생기고, 행이 없으니 기여가 안 쌓인다 — «스스로 회복되지 않는» 교착이며
--     RESIDENT_SPLIT 건물은 영구히 건설 불가가 된다. 같은 목표를 다시 PUT 해도 무변경 200 으로
--     조기 반환돼(C11) 시드가 돌지 않으므로, 목표를 «다른 값으로» 바꾸기 전에는 풀리지 않는다.
--   · 기여자가 일부 있던 목표 → 그 사람들만 대상으로 잡혀 분모가 작아진다. 나머지 당시 주민의 몫을
--     건너뛰고 건설이 열린다.
--
-- ⚠️ 근사치다. 「목표 선택 당시의 주민」을 복원할 근거가 DB 에 없다:
--   · group_members 에 이탈 «시각»이 없다(is_left 불리언뿐 — 그 열은 GROMO-2050 이 더한다).
--   · group_members.created_at 은 최초 가입 시각이고 재가입은 같은 행을 되살리므로(rejoin) 그 시점의
--     소속 여부를 말해 주지 않는다.
--   · island_construction_states.updated_at 도 목표 선택 시각이 아니다 — 목표 해제(clearTarget)와
--     같은 열을 쓴다.
-- 없는 근거를 지어내는 대신 «이 마이그레이션이 도는 시점의 활성 주민»으로 채운다. 이후 이탈자는
-- 판정이 현재 활성 주민과 교집합을 잡으므로 알아서 빠지고, 이 사이에 새로 가입한 사람이 대상에
-- 들어갈 수 있다는 것이 근사치가 지는 오차다. 2.0 미출시라 실제 대상은 dev 데이터뿐이다.
--
-- amount 는 건드리지 않는다 — ON CONFLICT DO NOTHING 이라 이미 기여한 행은 그대로다.
-- 목표가 없는 섬(target_building_id IS NULL)은 대상 자체가 없으므로 심지 않는다.
INSERT INTO island_construction_contributions (island_id, epoch, user_id, amount, updated_at)
SELECT s.island_id, s.target_epoch, gm.user_id, 0, now()
FROM island_construction_states s
         JOIN group_members gm ON gm.group_id = s.island_id AND gm.is_left = false
WHERE s.target_building_id IS NOT NULL
ON CONFLICT (island_id, epoch, user_id) DO NOTHING;

-- 남는 모순: 「목표는 걸려 있는데 활성 주민이 0명」인 섬은 위 JOIN 이 아무 행도 만들지 않는다.
-- 이걸 RAISE EXCEPTION 으로 막지 «않는다» — 그 상태는 이미 죽은 섬이고, 대상이 0명이면
-- IslandConstructionService#funded 가 명시적으로 false 를 돌려 «건설 불가»로 degrade 하기 때문이다
-- (돈이 잘못 움직이는 방향이 아니다). 데이터 한 줄 때문에 dev·prod 부팅을 막는 편이 더 큰 사고다.
