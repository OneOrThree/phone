-- ════════════════════════════════════════════════════════════════════
-- V50 — users.language: 앱이 선택한 표시 언어 (GROMO-1659 D11 · GROMO-1692 계약)
-- ════════════════════════════════════════════════════════════════════
-- 푸시를 사용자 언어로 렌더링하려면 서버가 유저의 언어를 알아야 한다. 앱은 지금 언어 선택을
-- 로컬(AsyncStorage)에만 두고 서버로 보내지 않는다(1692 가 이 컬럼이 생긴 뒤 PATCH /users/me
-- 로 채운다). 알림 서버 설계(D11)는 이 컬럼을 «users.locale» 이라 불렀지만, 앱 쪽 계약(1692)이
-- 이미 «language» 로 적혀 있어 그 이름을 따른다 — 이벤트 봉투의 키는 «locale» 로 남길 수 있다.
--
-- 값은 앱의 SUPPORTED_LOCALES 그대로: ko · en · ja · zh-Hant (BCP-47 태그). 'system' 은 오지
-- 않는다 — 앱이 기기 언어로 해석한 값을 보낸다. DB 에 CHECK 를 두지 않는 이유: 언어가 늘 때
-- 마이그레이션 없이 API 검증(@Pattern)만 고치면 되게. NULL = 아직 보고된 적 없음(구앱·미접속).
ALTER TABLE users ADD COLUMN language varchar(8);

COMMENT ON COLUMN users.language IS
    '앱이 적용 중인 표시 언어(BCP-47: ko·en·ja·zh-Hant). 푸시 렌더 언어의 정본. NULL=미보고. GROMO-1659 D11, V50';
