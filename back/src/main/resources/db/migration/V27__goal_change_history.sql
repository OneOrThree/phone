-- ════════════════════════════════════════════════════════════════════
-- 목표 변경 직전 값 보존 — '그날의 목표'로 판정·지급하기 위한 1단계 이력 (GROMO-1049)
-- ════════════════════════════════════════════════════════════════════
-- 서버는 지금까지 현재 목표만 알고 있어서, 유저가 목표를 바꾸면 어제분 지급을 오늘 목표로 산정했다.
-- 앱은 어제 목표로 판정·표시하므로 "보인 금액 ≠ 받은 금액"이 됐다.
--
-- 지급 창이 [어제, 오늘] 이틀뿐이라 전체 변경 이력 테이블은 필요 없고, 직전 값 하나면 충분하다.
--   previous_goal_minutes : 오늘 처음 목표를 바꾸기 직전의 값 (= 어제 유효했던 목표)
--   goal_effective_from   : 현재 목표가 유효해진 날짜(유저 로컬). 이 날짜 이전 날은 previous 를 쓴다.
--
-- 보존은 '오늘의 첫 변경'에서만 일어난다(UserScreenTimeSettings/UserFocusTimeSettings.changeGoal).
-- 하루에 여러 번 바꿔도 previous 가 덮이지 않아야 어제 기준이 살아남는다.
--
-- 기존 row 는 둘 다 NULL 로 시작 → 이력이 없으므로 지금과 동일하게 현재값으로 근사한다(백필 없음).

ALTER TABLE public.user_screen_time_settings
    ADD COLUMN previous_goal_minutes integer,
    ADD COLUMN goal_effective_from date;

ALTER TABLE public.user_focus_time_settings
    ADD COLUMN previous_goal_minutes integer,
    ADD COLUMN goal_effective_from date;
