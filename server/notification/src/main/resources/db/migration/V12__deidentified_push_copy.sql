-- 켜진 알림 4종(FRIEND_REQUEST · FRIEND_ACCEPTED · MAIN_ISLAND_TRANSFERRED · ISLAND_KICKED)의 표시 문구에서
-- 닉네임·섬 이름을 뺀다 (GROMO-2519) — 템플릿 16행(4종 × ko/en/ja/zh-Hant)의 title·body 를 이름 없는 문구로 바꾼다.
--
-- 왜: 계정을 바꾸는 동안 이전 계정 앞으로 나간 푸시를 OS 가 앱의 검증 없이 자동 표시할 수 있다
-- (docs/prd/fishcat/account/low-level-design.md 「OS 자동 표시 경로는 활성 조건이다」). 그래서 원격 payload 의
-- 제목·본문에는 계정과 이어진 이름을 싣지 않고 비식별 일반 문구만 담는다.
--
-- 새 파일로 덮어쓰는 이유: V2·V7·V9 의 시드는 이미 적용돼 바이트가 계약이다(워크플로 「적용된 마이그레이션 불변」 —
-- 고치면 Flyway 체크섬이 달라져 dev·prod 가 부팅하지 못한다). 그래서 시드는 그대로 두고 이 UPDATE 가 대체한다.
-- V7(MAIN_ISLAND_TRANSFERRED)·V9(ISLAND_KICKED) 머리말의 「구 경로의 한국어 상수와 «글자 그대로» 같아야 한다」는
-- 요구는 더 이상 유효하지 않다 — Data 의 구 문구 경로가 없어졌고 producer 는 params 만 싣는다.
--
-- V8 의 MAGAZINE_PUBLISHED 는 호수만 쓰고 이름이 없어 그대로 둔다. kinds·deeplinks 도 건드리지 않는다.
-- 제목은 이미 이름이 없어 현행 시드와 같은 값을 다시 적는다 — Console 이 그사이 고친 행도 이 문장이 목표 상태
-- (이름 없음)로 덮어쓴다. version 은 Console 저장(AdminCatalog 의 ON CONFLICT 갱신)과 같은 뜻으로 1 올린다.
--
-- producer(Data)는 counterpartNickname·islandName 을 계속 싣는다(계약 안정성). Renderer 는 템플릿이 쓰지 않는
-- params 를 무시하므로 producer 는 그대로이고, 이미 쌓인 발송도 발송 시점에 렌더해 새 문구로 나간다.
UPDATE templates t SET title = v.title, body = v.body, version = t.version + 1
FROM (VALUES
  ('FRIEND_REQUEST.ko','새로운 친구 요청','친구 요청이 도착했어요'),
  ('FRIEND_REQUEST.en','New friend request','A friend request is waiting for you'),
  ('FRIEND_REQUEST.ja','新しいフレンド申請','フレンド申請が届きました'),
  ('FRIEND_REQUEST.zh-Hant','新的好友邀請','你收到了一則好友邀請'),
  ('FRIEND_ACCEPTED.ko','친구가 됐어요!','보낸 친구 요청이 수락됐어요'),
  ('FRIEND_ACCEPTED.en','You’re now friends!','Your friend request was accepted'),
  ('FRIEND_ACCEPTED.ja','フレンドになりました！','送ったフレンド申請が承認されました'),
  ('FRIEND_ACCEPTED.zh-Hant','成為好友了！','你送出的好友邀請已被接受'),
  ('MAIN_ISLAND_TRANSFERRED.ko','메인 섬이 바뀌었어요','떠난 섬 대신 새 메인 섬이 정해졌어요'),
  ('MAIN_ISLAND_TRANSFERRED.en','Your main island changed','You left your main island, so a new one was chosen for you.'),
  ('MAIN_ISLAND_TRANSFERRED.ja','メイン島が変わりました','前のメイン島を離れたので、新しいメイン島が決まりました。'),
  ('MAIN_ISLAND_TRANSFERRED.zh-Hant','主要島嶼已變更','你已離開原本的主要島嶼，已為你設定新的主要島嶼。'),
  ('ISLAND_KICKED.ko','섬에서 나가게 되었어요','그 섬에서 더 이상 함께할 수 없게 되었어요'),
  ('ISLAND_KICKED.en','You left an island','You can no longer stay on that island.'),
  ('ISLAND_KICKED.ja','島を離れることになりました','その島では、これ以上一緒に過ごせなくなりました。'),
  ('ISLAND_KICKED.zh-Hant','你已離開島嶼','你無法再留在那座島了。')
) AS v(id, title, body)
WHERE t.id = v.id;
