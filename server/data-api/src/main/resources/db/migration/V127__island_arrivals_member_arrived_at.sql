-- GROMO-2302 주민 첫 도착 사건(island.member.arrived) — «현 가입 이후 주민으로서 처음 도착했는가» 의 판정 근거.
--
-- member_arrived_at 은 이 사람이 이 섬에 «주민으로서» 마지막으로 도착한 시각이다. 주민 맥락의 도착 writer(섬 생성·
-- 즉시 이동·방문 중 가입·초대 도착·복귀·1.x 생성/참여·주민의 POST /islands/{id}/arrivals)는 매번 덮고, 방문자 도착은
-- 건드리지 않는다. 덮는 값은 GREATEST(now, 현 멤버십 시작)이다 — 가입과 같은 트랜잭션의 도착이 가입 행 created_at
-- (flush 때 찍힘)보다 이른 시각을 남겨 다음 도착이 거짓 첫 도착이 되지 않게 한다. 주민의 POST arrivals 는 덮기 전에 이 값을 현 멤버십 시작 시각(COALESCE(rejoined_at, created_at))과
-- 비교한다 — NULL 이거나 그보다 이르면 «현 가입 이후 첫 도착» 이고 사건을 하나 낸다. 재가입하면 옛 값이 새 시작
-- 시각보다 이르니 다시 첫 도착이 된다.
--
-- 백필하지 않는다: 기존 행은 NULL 로 남고, 그 사람의 다음 주민 도착 하나가 «첫 도착» 으로 판정돼 사건 1건이 나갈 수
-- 있다. 스위치(island.arrival.realtime-events-enabled)가 기본 OFF 라 배포 시점에는 아무것도 나가지 않고, 켠 뒤에도
-- 사람·섬당 최대 1건이다 — 지어낸 시각으로 채우는 것보다 낫다.
ALTER TABLE island_arrivals ADD COLUMN member_arrived_at timestamptz;
COMMENT ON COLUMN island_arrivals.member_arrived_at IS
    '주민으로서 마지막 도착 시각 — NULL 이면 주민 도착 없음(방문자 도착만). 현 멤버십 시작보다 이르면 다음 도착이 주민 첫 도착(GROMO-2302)';
