-- 고양이 잡지 발행 카탈로그 (GROMO-2307) — kind 1종 + 템플릿 4로케일 + 딥링크.
--
-- V2 에 끼워 넣지 않는 이유: 이미 통합 브랜치에 있는 마이그레이션을 고치면 Flyway 체크섬이 달라져
-- dev·prod 가 부팅하지 못한다(워크플로 「적용된 마이그레이션 불변」이 바이트로 검사한다). 카탈로그는
-- 「생성 후 변경은 Console 등록부가 소유한다」(V2 머리말)이지만, 아직 등록부가 없는 동안의 신규 kind 는
-- 이렇게 새 파일로 더한다.
--
-- 이 kind 가 카탈로그에 없으면 OUTBOX 모드에서 InboundService.enqueue 가 422 UNKNOWN_NOTIFICATION_KIND 를
-- 던지고 사건이 재시도 끝에 DLT 로 간다 — producer 만 늘리면 「CI 는 초록인데 켜는 순간 전량 유실」이다.

-- eligibility_required = false: 「이미 발행된 호」의 통보라 발송 직전에 되물을 상태가 없다
-- (정식 계정·미탈퇴는 Data 가 대상을 고를 때 이미 봤다).
-- quiet_policy = DROP: 07:00~23:50 틱에서만 나가고, 조용한 시간에 걸리면 이월하지 않고 버린다.
INSERT INTO kinds(id,silent,quiet_policy,eligibility_required) VALUES('MAGAZINE_PUBLISHED',false,'DROP',false);

-- 구 경로(Data 의 MagazineIssueNotifier)의 한국어 상수와 «글자 그대로» 같은 문장이어야 한다 — 컷오버에서
-- 같은 알림의 문구가 조용히 바뀌면 그건 기능 변경이다.
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAGAZINE_PUBLISHED.ko','MAGAZINE_PUBLISHED','ko','오늘의 고양이 잡지가 왔어요','냐옹 {issueNo}호가 나왔어요 — 새 섬 소식을 확인해 보세요');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAGAZINE_PUBLISHED.en','MAGAZINE_PUBLISHED','en','Today''s Cat Magazine is here','Nyaong No. {issueNo} is out — see what islands are up to');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAGAZINE_PUBLISHED.ja','MAGAZINE_PUBLISHED','ja','今日の猫マガジンが届きました','ニャオン{issueNo}号が出ました — 新しい島のニュースをチェックしましょう');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAGAZINE_PUBLISHED.zh-Hant','MAGAZINE_PUBLISHED','zh-Hant','今天的貓咪雜誌來了','喵嗚第{issueNo}期出刊了 — 快來看看新的島嶼消息');

-- 구 경로가 PushMessage 에 싣는 링크(gromo://magazine?issue=<호 id>)와 «글자 그대로» 같아야 한다.
-- 앱의 목적지·수신은 GROMO-2090·2091 몫이다.
INSERT INTO deeplinks(id,url_template,data_template) VALUES('MAGAZINE_PUBLISHED','gromo://magazine?issue={issueId}','{"type":"MAGAZINE_PUBLISHED"}'::jsonb);
