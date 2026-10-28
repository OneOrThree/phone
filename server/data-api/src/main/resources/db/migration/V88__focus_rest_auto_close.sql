-- GROMO-1998: 휴식이 1시간을 넘기면 서버가 이번 집중을 «정상 종료» 하고, 그 결과를 다음 접속에 한 번만 보여준다.
-- 정책 정본: planning-document/policy-2026-09-14.md 「집중·휴식·도서관」 —
--   "휴식하기를 누른 순간부터 1시간이 지나면 서버가 이번 집중을 자동 종료한다. 정상 종료와 같게
--    집중 기록·퀘스트 진행에 반영하고, 다음에 앱을 켤 때 결과창을 한 번 보여준다."

-- 1) 자동 종료 표지 — 사용자가 직접 끝낸 정산(finish)과 서버가 끝낸 정산을 구분한다.
--    소속 상실 종결(MEMBERSHIP_LOST)은 애초에 정산 행을 만들지 않으므로 이 축과 섞이지 않는다.
ALTER TABLE focus_settlements
    ADD COLUMN auto_closed boolean NOT NULL DEFAULT false;

-- 2) 결과 확인 시각 — 「한 번만 제공」의 유일한 근거다. 인메모리 플래그가 아니라 이 컬럼의
--    `acknowledged_at IS NULL` 조건부 UPDATE 가 최초 1회만 성공한다(league_weekly_results 와 같은 관례).
--    finish 로 끝난 정산은 결과를 그 자리에서 이미 돌려줬으므로 애초에 auto_closed=false 라
--    미확인 목록에 들어오지 않는다 — 이 컬럼은 자동 종료분에만 의미가 있다.
ALTER TABLE focus_settlements
    ADD COLUMN acknowledged_at timestamptz;

-- 인덱스를 더하지 않는다: 미확인 결과 조회는 언제나 「이 사용자의」 세션에서 출발하고
-- (focus_session_details_user_id_idx) 정산은 그 세션 PK 로 한 건씩 집는다.
