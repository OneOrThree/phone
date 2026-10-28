-- ════════════════════════════════════════════════════════════════════
-- V65 — 탈퇴 파기에 필요한 NOT NULL 해제 (GROMO-1801 · 계정 LLD §4)
-- ════════════════════════════════════════════════════════════════════
-- 탈퇴 TX 가 «값을 지우려면» 컬럼이 null 을 받아야 한다. 새 컬럼·새 테이블은 없다.
-- 값을 채우는 모든 기존 writer 는 그대로 non-null 을 쓴다 — 여기서 풀리는 것은 탈퇴 파기 경로뿐이다.

-- 1) 개인 활동 시각 (LLD §4 users.lastActiveAt). 미접속 푸시·JwtFilter 는 is_deleted=false 만 본다.
ALTER TABLE users ALTER COLUMN last_active_at DROP NOT NULL;

-- 2) 본인 발급 초대 링크의 발급자 연결 (LLD §4 group_invite_links · policy A10).
--    링크·종속 클릭은 타인 퍼널의 FK 앵커로 남고, 발급자 없는 링크는 폐기로 취급한다.
ALTER TABLE group_invite_links ALTER COLUMN inviter_id DROP NOT NULL;

-- 3) 탈퇴자가 claim 한 클릭의 IP 해시 (LLD §4 invite_link_clicks — 「ip_hash 는 nullable 확장 뒤 null」).
ALTER TABLE invite_link_clicks ALTER COLUMN ip_hash DROP NOT NULL;

-- 4) 주간 리그 개인 결과 (LLD §4 league_weekly_results). (user_id, week_start_at) 만 중복 정산 방지
--    완료 마커로 남기고 티어 변경·집중량은 지운다. 기존 CHECK 는 NULL 을 통과시키므로 그대로 둔다.
ALTER TABLE league_weekly_results
    ALTER COLUMN previous_tier_level DROP NOT NULL,
    ALTER COLUMN new_tier_level DROP NOT NULL,
    ALTER COLUMN result DROP NOT NULL,
    ALTER COLUMN focus_seconds DROP NOT NULL;

-- 5) 로그인 시도 자격 digest (LLD §4 「로그인 시도 자격 digest·고정 서명 재료」 · §3 INVALIDATED).
--    탈퇴한 사용자의 시도는 INVALIDATED 로 닫고 digest 를 지운다 — 재생 요청은 digest 대조 전에 404 다.
ALTER TABLE login_attempts
    ALTER COLUMN digest_key_id DROP NOT NULL,
    ALTER COLUMN credential_digest DROP NOT NULL;

-- 6) 폐기된 세션의 RT 해시 (LLD §4 「신규 auth session RT/bootstrap hash」). 폐기 tombstone 은
--    sessionId·epoch·폐기 시각만 남긴다. 유일 인덱스는 NULL 끼리 충돌하지 않는다.
ALTER TABLE auth_sessions ALTER COLUMN refresh_token_hash DROP NOT NULL;
