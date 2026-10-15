-- V8 — league_arena_users 주간 누적 집중 시간 분 → 초 전환 (GROMO-665)
-- 배경: DailyFocusStat 는 GROMO-642 에서 이미 초(total_focus_seconds)로 전환됐으나 리그만 분 누적이라
--       FocusService 가 addedSeconds/60 으로 내려 저장 → 30초 세션 다수가 손실되는 정밀도 문제.
-- 방향: 컬럼명을 초로 rename 하고 기존 분 누적값을 *60 으로 초 환산(데이터 없으면 0*60=0 무해).
--       precision 은 이미 분 내림으로 유실됐으므로 *60 은 하한 근사이나 진행 중 주간의 상대 랭킹 순서는 보존.

ALTER TABLE league_arena_users RENAME COLUMN total_focus_minutes TO total_focus_seconds;
UPDATE league_arena_users SET total_focus_seconds = total_focus_seconds * 60;
