-- k6 파라미터 export — "seed 와 부하가 같은 세상을 봐야 한다" (설계 문서 §1-6)
-- 관측 VM 에서 실행(cwd=홈), 산출물은 ~/seed/params/*.jsonl (50_mint 가 JSON 배열로 변환 + 토큰 병합)
--
-- 포맷 주의(#179 리뷰 1): COPY 기본 TEXT 포맷은 백슬래시를 이중 이스케이프해, 값에 " 나 \ 가
-- 있는 JSON 을 깨뜨릴 수 있다. JSON 에 절대 등장하지 않는 제어문자를 QUOTE/DELIMITER 로 쓰는
-- CSV 포맷으로 우회 — 사실상 원문 그대로 기록된다.
-- 옵션은 각 \copy 에 인라인한다 — psql 변수(:copyopts)는 \copy 메타명령 인자에서 확장되지 않는다.
\set ON_ERROR_STOP on

-- Zipf 전개(#179 리뷰 3 반영): 활동량 "순위" 기반 멱법칙 — rank 1 = 40회 수록, 1/√rank 감쇠.
-- (기존 sc/150 산식은 이론 최대 5회라 롱테일 핫유저가 안 생겼음. 순위 기반이라 분포 모양이
--  시드 활동량 산식과 독립적으로 보장된다. 총 항목 ≈ N + 40·2√N ≈ 12만~13만 @ N=10만)
\copy (SELECT row_to_json(t) FROM (SELECT u.id AS "userId", u.nickname FROM (SELECT user_id, row_number() OVER (ORDER BY sum(session_count) DESC, user_id) AS rnk FROM daily_focus_stats GROUP BY user_id) a JOIN users u ON u.id = a.user_id CROSS JOIN generate_series(1, greatest(1, (40.0 / sqrt(a.rnk))::int)) WHERE u.is_deleted = false) t) TO 'seed/params/users_zipf.jsonl' (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

-- uniform 샘플 1만 — 캐시 편향 없는 대조군·쓰기 파티셔닝용
\copy (SELECT row_to_json(t) FROM (SELECT id AS "userId", nickname FROM users WHERE is_deleted = false ORDER BY md5(id::text) LIMIT 10000) t) TO 'seed/params/users_uniform.jsonl' (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

-- 활성 그룹 id — 그룹 조회·검색 시나리오용
\copy (SELECT row_to_json(t) FROM (SELECT id AS "groupId" FROM groups WHERE status = 'ACTIVE' ORDER BY md5(id::text) LIMIT 20000) t) TO 'seed/params/group_ids.jsonl' (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

-- 검색어 사전 — 실존 닉네임·그룹명의 프리픽스 (LIKE/trgm 검색이 실제로 매칭되도록)
\copy (SELECT row_to_json(t) FROM (SELECT DISTINCT left(nickname, 2) AS term FROM users WHERE is_deleted = false AND nickname IS NOT NULL UNION SELECT DISTINCT left(name, 2) FROM groups LIMIT 2000) t) TO 'seed/params/search_terms.jsonl' (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
