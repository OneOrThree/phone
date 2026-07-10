-- k6 파라미터 export — "seed 와 부하가 같은 세상을 봐야 한다" (설계 문서 §1-6)
-- 관측 VM 에서 실행, 산출물은 ~/seed/params/*.jsonl (50_mint 가 JSON 배열로 변환 + 토큰 병합)
\set ON_ERROR_STOP on

-- Zipf 전개: 활동량(세션 수) 비례로 유저를 중복 수록 → k6 에서 uniform 샘플 = Zipf 분포
-- (평균 ~2회 수록, 핫유저는 수십 회 — 총 ~20만 항목)
\copy (SELECT row_to_json(t) FROM (SELECT u.id AS "userId", u.nickname FROM users u JOIN (SELECT user_id, sum(session_count) AS sc FROM daily_focus_stats GROUP BY user_id) a ON a.user_id = u.id CROSS JOIN generate_series(1, greatest(1, least(40, (a.sc / 150)::int))) WHERE u.is_deleted = false) t) TO 'seed/params/users_zipf.jsonl'

-- uniform 샘플 1만 — 캐시 편향 없는 대조군
\copy (SELECT row_to_json(t) FROM (SELECT id AS "userId", nickname FROM users WHERE is_deleted = false ORDER BY md5(id::text) LIMIT 10000) t) TO 'seed/params/users_uniform.jsonl'

-- 활성 그룹 id — 그룹 조회·검색 시나리오용
\copy (SELECT row_to_json(t) FROM (SELECT id AS "groupId" FROM groups WHERE status = 'ACTIVE' ORDER BY md5(id::text) LIMIT 20000) t) TO 'seed/params/group_ids.jsonl'

-- 검색어 사전 — 실존 닉네임·그룹명의 프리픽스 (LIKE/trgm 검색이 실제로 매칭되도록)
\copy (SELECT row_to_json(t) FROM (SELECT DISTINCT left(nickname, 2) AS term FROM users WHERE is_deleted = false AND nickname IS NOT NULL UNION SELECT DISTINCT left(name, 2) FROM groups LIMIT 2000) t) TO 'seed/params/search_terms.jsonl'
