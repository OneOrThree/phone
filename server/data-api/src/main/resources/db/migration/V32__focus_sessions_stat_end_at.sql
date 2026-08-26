-- GROMO-1252 (코드리뷰 2차 ②): 통계 귀속용 '유효 종료 시각' 컬럼.
--
-- ended_at 은 클라가 보낸 값 그대로 저장해야 재업로드 중복 검사(user, started_at, ended_at)가 성립한다.
-- 그래서 미래 ended_at 위조 세션이 그대로 남는데, 사전집계(daily_focus_stats)는 완료 시점 now 로 클램프해
-- 고정되는 반면 by-category 실시간 집계는 조회 시점 now 로 클리핑해 시간이 갈수록 더 세는 어긋남이 생겼다.
-- 완료 순간의 클램프 결과 min(ended_at, now)를 여기 고정 보관해 모든 조회가 같은 값으로 자르게 한다.
ALTER TABLE focus_sessions ADD COLUMN stat_end_at timestamptz;

-- 기존 완료 행 백필 — 정상 행은 stat_end_at = ended_at(동작 불변), 미래 ended_at 위조 행은 마이그레이션
-- 시각에 고정돼 더 이상 시간이 갈수록 늘지 않는다. 진행 중(ended_at NULL) 행은 완료 시점에 채워진다.
UPDATE focus_sessions SET stat_end_at = LEAST(ended_at, now()) WHERE ended_at IS NOT NULL;
