-- 섬 강퇴 카탈로그 (GROMO-2315) — kind 1종 + 템플릿 4로케일 + 딥링크.
--
-- V2 에 끼워 넣지 않는 이유: 이미 통합 브랜치에 있는 마이그레이션을 고치면 Flyway 체크섬이 달라져
-- dev·prod 가 부팅하지 못한다(워크플로 「적용된 마이그레이션 불변」이 바이트로 검사한다). 카탈로그는
-- 「생성 후 변경은 Console 등록부가 소유한다」(V2 머리말)이지만, 아직 등록부가 없는 동안의 신규 kind 는
-- 이렇게 새 파일로 더한다.
--
-- 이 kind 가 카탈로그에 없으면 OUTBOX 모드에서 InboundService.enqueue 가 422 UNKNOWN_NOTIFICATION_KIND 를
-- 던지고 사건이 재시도 끝에 DLT 로 간다 — producer 만 늘리면 「CI 는 초록인데 켜는 순간 전량 유실」이다.

-- eligibility_required = false: 「이미 일어난 강퇴」의 통보라 발송 직전에 되물을 상태가 없다
-- (MAIN_ISLAND_TRANSFERRED 와 같은 판단이고, Data 의 NotificationEligibilityService 도 이 kind 를 무조건 허용한다).
-- quiet_policy = DROP: 강퇴 편지가 남고 앱이 다음 실행 때 강퇴 안내를 띄우므로, 조용한 시간이면 이월하지 않고 버린다.
INSERT INTO kinds(id,silent,quiet_policy,eligibility_required) VALUES('ISLAND_KICKED',false,'DROP',false);

-- 구 경로(Data 의 IslandKickNotificationService)의 한국어 상수와 «글자 그대로» 같은 문장이어야 한다 — 컷오버에서
-- 같은 알림의 문구가 조용히 바뀌면 그건 기능 변경이다. 이름 뒤에 «섬»을 붙이지 않는다(이름이 «섬»으로 끝나면 겹친다).
INSERT INTO templates(id,kind,locale,title,body) VALUES('ISLAND_KICKED.ko','ISLAND_KICKED','ko','섬에서 나가게 되었어요','{islandName}에서 더 이상 함께할 수 없게 되었어요');
INSERT INTO templates(id,kind,locale,title,body) VALUES('ISLAND_KICKED.en','ISLAND_KICKED','en','You left an island','You can no longer stay on {islandName}.');
INSERT INTO templates(id,kind,locale,title,body) VALUES('ISLAND_KICKED.ja','ISLAND_KICKED','ja','島を離れることになりました','{islandName}では、これ以上一緒に過ごせなくなりました。');
INSERT INTO templates(id,kind,locale,title,body) VALUES('ISLAND_KICKED.zh-Hant','ISLAND_KICKED','zh-Hant','你已離開島嶼','你無法再留在{islandName}了。');

-- 구 경로가 PushMessage 에 싣는 링크와 «글자 그대로» 같아야 한다. 홈으로 열면 앱이 GET /me/islands 의
-- lossReason=KICKED 를 읽어 강퇴 안내 뒤 먼바다로 보낸다(GROMO-2366).
INSERT INTO deeplinks(id,url_template,data_template) VALUES('ISLAND_KICKED','gromo://home','{"type":"ISLAND_KICKED"}'::jsonb);
