-- 메인 섬 자동 이전 카탈로그 (GROMO-1971) — kind 1종 + 템플릿 4로케일 + 딥링크.
--
-- V2 에 끼워 넣지 않는 이유: 이미 통합 브랜치에 있는 마이그레이션을 고치면 Flyway 체크섬이 달라져
-- dev·prod 가 부팅하지 못한다(워크플로 「적용된 마이그레이션 불변」이 바이트로 검사한다). 카탈로그는
-- 「생성 후 변경은 Console 등록부가 소유한다」(V2 머리말)이지만, 아직 등록부가 없는 동안의 신규 kind 는
-- 이렇게 새 파일로 더한다.
--
-- 이 kind 가 카탈로그에 없으면 OUTBOX 모드에서 InboundService.enqueue 가 422 UNKNOWN_NOTIFICATION_KIND 를
-- 던지고 사건이 재시도 끝에 DLT 로 간다 — producer 만 늘리면 「CI 는 초록인데 켜는 순간 전량 유실」이다.

-- eligibility_required = false: 「이미 일어난 이전」의 통보라 발송 직전에 되물을 상태가 없다
-- (FRIEND_ACCEPTED 와 같은 판단이고, Data 의 NotificationEligibilityService 도 이 kind 를 무조건 허용한다).
-- quiet_policy = DROP: 지연된 「섬이 바뀌었다」는 의미가 없어 조용한 시간이면 이월하지 않고 버린다.
INSERT INTO kinds(id,silent,quiet_policy,eligibility_required) VALUES('MAIN_ISLAND_TRANSFERRED',false,'DROP',false);

-- 섬 이름은 «뒤»에 온다 — 한국어 조사({islandName}(으)로 · 이(가))가 받침에 따라 갈리기 때문이고,
-- 구 경로(Data 의 MainIslandNotificationService)의 한국어 상수도 같은 문장이다. 컷오버에서 같은 알림의
-- 문구가 조용히 바뀌면 그건 기능 변경이다.
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAIN_ISLAND_TRANSFERRED.ko','MAIN_ISLAND_TRANSFERRED','ko','메인 섬이 바뀌었어요','떠난 섬 대신 새 메인 섬이 정해졌어요 — {islandName}');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAIN_ISLAND_TRANSFERRED.en','MAIN_ISLAND_TRANSFERRED','en','Your main island changed','You left your main island, so {islandName} is your new one.');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAIN_ISLAND_TRANSFERRED.ja','MAIN_ISLAND_TRANSFERRED','ja','メイン島が変わりました','前のメイン島を離れたので、{islandName}が新しいメイン島になりました。');
INSERT INTO templates(id,kind,locale,title,body) VALUES('MAIN_ISLAND_TRANSFERRED.zh-Hant','MAIN_ISLAND_TRANSFERRED','zh-Hant','主要島嶼已變更','你已離開原本的主要島嶼，{islandName}成為新的主要島嶼。');

-- 구 경로가 PushMessage 에 싣는 링크와 «글자 그대로» 같아야 한다 — 컷오버에서 딥링크 라우팅이 바뀌면
-- 같은 알림을 눌렀는데 다른 화면이 열린다.
INSERT INTO deeplinks(id,url_template,data_template) VALUES('MAIN_ISLAND_TRANSFERRED','gromo://group?g={islandId}','{"type":"MAIN_ISLAND_TRANSFERRED"}'::jsonb);
