# 계정·설정 — 정책 정본

GROMO-1756 · 2026-09-12 · [색인](README.md) · [상세 계약](low-level-design.md)

## 유지할 정책과 기술 결정

| ID | 정책 | 출처·상태 |
| --- | --- | --- |
| A01 | 신규 Business 경로에는 접두어를 붙이지 않고 JSON 성공은 `{data}`로 감싼다. 기존 Data/chat 경로는 보존한다. | 사용자 확정·선행 1750 |
| A02 | 공개 `name`은 기존 `users.nickname`이다. **앞뒤 공백을 제거(`String.strip`)한 뒤** 2~10 UTF-16 단위이고, 다른 사용자와 대소문자 무시 중복 금지다. 길이는 정규화 **뒤** 값으로 잰다. | policy-2026-09-14 「닉네임은 … 앞뒤 공백 없이 저장한다」 · `UserService.normalizeNickname`(GROMO-2051)과 `uq_users_nickname_lower`(V89) |
| A03 | 프로필 변경과 탈퇴는 활성 `users` 행을 수정하기 전에 배타 잠금한다. | 기술 결정. `User`에 `@Version`이 없어 늦은 전체 UPDATE가 파기된 PII를 되살릴 수 있음 |
| A04 | 선택적 AT는 서명·access 타입·만료·주체와 원 세션 활성/현재 세대를 검증한다. prepare·complete·성공 재생에서 users 우선 잠금 아래 재검사하며, 개별 폐기된 AT로 승격하지 않는다. sidless는 입증된 legacy 결합/폐기 fence가 필수이고 userId만으로 다른 활성 세션을 대신 쓰지 않는다. guest=true일 때만 기존 게스트 승격 규칙을 적용하고 기존 userId를 보존한다. 유효한 guest=false AT는 정상 계정 전환을 막지 않으며 제공자 계정 로그인/가입을 진행한다. 기존 6개 소셜 제공자와 게스트 생성 경로를 보존한다. | 장부 ㊒·기존 AuthService. 원본 Apple 예시는 제공자 축소 결정이 아님 |
| A05 | AT/RT 타입·서명·만료를 검증하고 RT 원문을 DB/로그에 저장하지 않는다. JWT에는 key ID를 싣고, 키 교체 뒤 이전 키는 그 키로 발급된 AT/RT의 최대 exp까지 검증 전용으로 유지한다. 로그인·digest 복구 창과 분리하며, 더 일찍 제거하는 것은 authGeneration 전진 등 의도적인 전 세션 폐기 롤아웃으로만 한다. | 기존 JwtProvider·TokenHasher |
| A06 | 로그인은 실제 원 자격으로 내구 attempt를 먼저 조회하고, 저장된 검증 결과가 없는 안전한 최초 실행만 IdP 교환 → Data upsert → Business 서명 → Data CAS 확정을 수행한다. 재개는 동일 자격 digest/주체 scope·활성/세대·고정 만료를 검사하고 IdP를 재호출하지 않는다. 같은 성공 준비 generation은 고정 서명 재료로 재생한다. 폐기 아닌 CAS 경쟁은 동일 attempt/자격의 새 nonce 재준비이며 INVALIDATED와 분리한다. 자격 digest는 attempt에 digest key ID를 고정해 모든 흐름에서 attempt/key ID 조회 뒤 계산하고, COMPLETED 응답 유실 재생을 포함한 재생 가능 attempt의 고정 복구 마감까지 이전 키를 검증 전용으로 유지하며, 키 교체를 다른 자격(`IDEMPOTENCY_KEY_REUSED`)으로 판정하지 않는다. COMPLETED 결과 세션은 그 sid로 인증된 최초 성공을 채택으로 내구 기록하고, 고정 복구 마감까지 미채택인 결과 세션만 세션 단위로 폐기한다. 원 선택 세션 폐기나 INVALIDATED를 이유로 채택된 세션을 끊지 않는다. | 이미 확정된 장부 ㊑/㊔/㊙/㊡. 현재 main의 구현 완료를 뜻하지 않음 |
| A07 | 회전하지 않는 refresh는 새 AT와 `refreshToken:null`을 반환한다. 정상 sid RT 회전 CAS 0행은 401 REFRESH_TOKEN이다. 원자 bundle 미지원 클라이언트와 응답 전체 유실의 안전 복구가 미확정인 경로는 정상 회전을 활성화하지 않으며 원 RT 만료를 연장하지 않는다. 동일 subject/sid/gen만으로 완전한 회전 쌍을 증명하지 않는다. 최초 legacy 승격에서만 원 RT로 증명한 동일 완료 결과를 제한 재생하며 구 해시를 부활시키지 않는다. | 기존 AuthService와 장부 ㉮ |
| A08 | RT 정본을 `(userId, sessionId)`로 전환한다. 개별 로그아웃은 해당 세션/Bootstrap만 폐기하고 기기 삭제 outbox를 만들지 않는다. 대상 토큰·ownership DELETE가 기기 삭제를 소유한다. 비게스트 계정 전환과 같은 사용자·다른 sid 재로그인도 이전 주체·기기·고정 키를 전환 전에 내구 준비하되 새 세션 commit 뒤에만 실행하고, rollback이면 이전 등록/RT를 보존한다. 기기 자격·원 키를 내구 큐에 남기고 삭제 실패와 무관하게 RT 폐기·로컬 인증 정리를 계속하며, 실패한 기기 큐는 소진하지 않는다. AT 재전송 인증에 의존하지 않고 검증된 sid/bootstrap 연결 등록은 auth.session.revoked 내구 전달·로컬 세션 fence로 비활성화한다. 이는 독립 DELETE 성공이 아니며 미연결 legacy 등록의 검증된 현재 세션 연결은 앱 전환 활성 조건이다. 삭제·등록 모두 토큰별 tombstone과 최대 ownershipVersion을 보존·대조해 다른 키의 지연 등록도 차단한다(㉴·㋓·㋗·㋞). 새 앱은 삭제 큐 생성 시 고정 Idempotency-Key를 저장하고 직접 전달/outbox relay가 같은 파생 키를 사용하며, 완료 재생은 원 명령 인증·scope·fingerprint 대조 후 과거 ownership 거절보다 먼저 판정한다. authGeneration은 탈퇴·전 기기 로그아웃만 증가시킨다. 같은 사용자 재로그인을 포함한 세션 전환은 commit 뒤 새 세션 bootstrap으로 기기를 재등록해 응답의 새 ownershipToken을 토큰과 원자 저장하고 후속 등록·삭제 CAS에 쓰며, 같은 토큰의 재등록이 확정된 경우에만 이전 세션 DELETE를 대체 완료로 소진한다. 사용자가 바뀌는 전환은 재등록 전에 FCM 토큰을 교체하고, 등록 응답의 deliveryTag를 ownershipToken과 원자 저장해 앱이 푸시의 보관함 저장·표시·딥링크·flush 직전 대조한다. OS가 앱 검증 없이 표시할 수 있는 원격 payload에는 항상 비식별 문구만 싣고 계정 연계 내용은 태그 검증 뒤 조회로만 보여 주며(NSE 실패·시간 초과 포함), 이 노출 0을 새 전환 흐름 활성 조건으로 둔다. | 장부 ㋣/㊼ |
| A09 | sid 없는 legacy RT는 최대 유효 수명 동안 병행 조회하고 첫 refresh에서 세션 토큰으로 승격한다. 앱은 AT만 보지 않고 AT/RT의 타입·subject·sid·authGeneration과 만료를 함께 확인한다. sid 없는 유효 AT 또는 새 sid AT+원 legacy RT의 혼합 저장도 신규 /me 계열 진입 전에 원 RT로 강제 전환/승격 receipt 복구하고 AT/RT 묶음을 원자 저장·공개한다. 가짜 sid는 만들지 않는다. 승격 응답 유실은 원 RT 해시와 고정 서명 재료를 가진 전용 인증 receipt로 동일 sid AT/RT를 복원한다. 이 복구는 아직 미구현이며 Q06 해결·실패 주입 검증 전 강제 전환을 출시하지 않는다. | 장부 ㋪. 타입 없는 잘못된 토큰을 허용한다는 뜻이 아님 |
| A10 | 탈퇴의 환불·증거 동결·관계 정리·파기는 Data 단일 TX다. 주민이 남은 방장은 위임 전 `HOST_WITHDRAW`이며 혼자면 그룹도 닫는다. 본인 발급 초대 링크는 inviter_id nullable 확장 후 같은 TX에서 UUID 연결을 끊고, 링크/클릭은 타인 퍼널 FK 앵커로 보존한다. claimed_user_id 익명화는 claimed_at 소진 표지를 유지하며 후보 조회/domain claim은 두 값이 모두 null일 때만 미소비로 인정한다. 발급자 없는 링크는 폐기되며 모든 발급 writer는 활성 users 공유 잠금으로 탈퇴와 직렬화한다. claim 클릭은 소진 표지만 남기고 matched_device_id·app_instance_id·ip_hash·user_agent 연결을 같은 TX에서 파기한다. 보존하는 group_members 행은 관계 증거만 남기고 알림·공지 권한·상태·역할을 비개인 기본값으로 초기화한다. 탈퇴 확정 때 앱은 일반 로그아웃·계정 전환의 보존 정책과 별도로 그 userId의 기기 로컬 버킷·UUID 마커·누끼 파일을 writer drain 뒤 제거한다. claim은 claimant와 현재 발급자 users를 UUID 순서로 공유 잠근 뒤 링크 행을 다시 읽어 발급자 연결을 재검사하고서야 클릭을 잠근다. 링크 이관 뒤 Link 위성은 claim을 pending으로만 기록하고, Data가 잠금 아래 남긴 `link.claimConfirmed` outbox와 `(groupId, inviterId)` 전이 tombstone 대조로만 확정한다(장부 ㋟·㋥). | 기존 AccountWithdrawalService·GroupMemberService 및 InviteLinkClickRepository의 타인 집계 근거 보존 규칙 |
| A11 | 계정은 soft delete한다. character_generation 본인 이력 전체를 같은 중앙 TX에서 hard delete하고 기존 recordGeneration의 users 배타 → 사용자 advisory → 이력 잠금 순서를 유지한다. 폐기 뒤 동일 키/늦은 생성 재시도도 거절한다. character_equipment 사용자 장착 행은 같은 TX에서 hard delete하며 user_items 보유 증거와 구분한다. user_focus_tags 귀속 파기의 두 대안 모두 setupFocusTag/updateFocusTag·복원/관리·세션 재연결 writer의 활성 users 공유 잠금과 직렬화한다. user_blocks는 blocker/blocked 양방향을, user_streaks는 본인 행을 같은 TX에서 hard delete하며 현재·미래 writer와 users 잠금으로 직렬화한다. friendships는 탈퇴자가 from/to인 행을 status·기존 deleted_at과 무관하게 같은 TX에서 hard delete하고 pinned_users 양방향 삭제를 유지한다. 요청·복원·pin 생성은 두 활성 users 공유 잠금, 수락·거절과 친구 삭제는 행 배타 잠금 재조회로 탈퇴와 직렬화하며 삭제 경합을 500이 아닌 기존 오류 계약으로 처리한다. league_rank_snapshots는 삭제하고 league_weekly_results 개인 결과는 최소 정산 완료 마커와 분리해 파기한다. 내기 참가 행의 정산 근거는 보존하되 acknowledged_at/display_claimed_at/display_claim_token은 nullify하고 claim/renew/ack를 users 생명주기 잠금과 직렬화한다. 직접 PII 파기와 정산·관계 증거의 보존을 구분하고, 현재 남아 있는 개인 필드는 파기 누락으로 드러낸다. group_announcements.user_id도 같은 탈퇴 TX에서 nullify하고 생성과 users 잠금으로 직렬화한다. 미사용 직접 초대 group_invites도 inviter/invitee 양방향 행을 같은 TX에서 hard delete하며 무관한 타인 초대는 보존한다. notification_sent_logs의 탈퇴 수신자 및 사용자 상대 이력은 종류별 의미를 확인해 같은 TX에서 파기하되, 다른 활성 수신자의 RANK_OVERTAKE는 target_user_id만 nullify하여 주간 발송 상한 근거를 보존하며, 이미 발송된 늦은 결과도 검증된 원 발송 증거/고정 ID로 상대 연결 없이 멱등 기록하고 동시 writer·위성 이관 재생과 직렬화한다. group_challenge_members의 사용자별 창형 측정 원본은 판정에 필요한 증거 확정을 검증한 뒤 같은 TX에서 hard delete한다. 필요한 판정이 불명확하면 탈퇴 성공을 확정하지 않는다. 최소 정산 증거는 별도 참가 행에 보존하고 원본 측정 이력/프로필로 노출하지 않는다. Business 링크 미리보기 캐시는 탈퇴 명령 전 차단 표지·원자 대조·확정 뒤 prefix 삭제로, Data 프레즌스 lease·`:closed`는 시작 콜백·재구축 Lua의 같은 Redis tombstone 원자 대조로 재생성을 막는다. 보존한 내기 결과와 진행 중 회차(creatorUserId·참가자·세션 참가자)의 공개 DTO는 탈퇴자 행의 userId를 null(비연계 행 key)로 치환하고 내부 정산 근거는 유지한다. | 기존 FK·정산 근거 및 1756 완료 조건. 보존 행이 있으므로 완전 익명화/모든 행 삭제라고 표현하지 않음 |
| A12 | 신규 계정 조회·변경은 동기 활성 검사를 수행한다. 로그인에는 제공자 증명과 대상 계정 활성 검사, 로그아웃에는 RT 증명과 대상 세션 검사를 적용한다. 검사 순서는 AT/RT 서명·타입·만료(401) → 사용자 활성(404 `USER_NOT_FOUND`) → 세션·authGeneration(401)이며, 탈퇴 뒤 세션 폐기와 비활성이 함께 참이면 404가 우선한다. | 1757 완료 조건. legacy 조회의 AT 만료까지 읽기 창은 별도 호환 계약. 본인 부재는 기존 404 USER_NOT_FOUND를 보존 |
| A13 | 알림 선호 정본은 이관 뒤 알림 서버다. Data는 내구 명령/outbox, Business는 전달·응답을 맡는다. Notification의 누락 설정 행 생성·기본값 응답은 사용자 tombstone·authGeneration을 같은 로컬 원자 경계에서 대조해 탈퇴 뒤 재생성하지 않는다. | 1659 기반 재사용. 새 Data 설정 정본을 중복 생성하지 않음 |
| A14 | `notifications` PATCH는 부분 명령과 field mask를 끝까지 유지한다. 적용 순서 역전에 대비해 알림 서버에 필드별 적용 버전을 둔다. 최초 처리부터 대체된 명령은 SUPERSEDED로 확정해 적용한 척 요청값을 반환하지 않는다. APPLIED·SUPERSEDED 구분은 재적용 판정에만 쓰고, 최초 처리와 재전달(Business receipt 재개 포함)은 모두 응답 시점 정본 현재 값을 돌려준다. 앱은 마지막으로 보낸 명령의 응답만 반영한다. 필드별 version 이관은 정지 창에서 기존 전역 version 명령을 drain한 장벽의 마지막 적용 version으로 5필드를 seed하고 allocator를 그보다 큰 값부터 시작하며, drain을 확인하지 못하면 기본값으로 seed하지 않는다. | 기술 결정. 기존 전체 PUT은 5개 필드를 모두 선택하고 각 버전을 전진시킴 |
| A15 | 음량·음소거·진동·동작 줄이기는 기기 로컬, OS 알림 권한은 OS 정본이다. | 원본 설정 계약. `notifications=true`가 OS 허용을 뜻하지 않음 |
| A16 | PATCH 프로필·PATCH 설정·DELETE 계정에는 1750의 범용 멱등 키를 적용한다. 로그인/로그아웃은 별도 인증 계약이다. | 선행 1750 적용 표. 일반 receipt에 토큰이나 cookie를 저장하지 않음 |
| A17 | 본문 없는 로그아웃의 RT는 `X-Refresh-Token` 전용 헤더로 전달한다. AT가 같이 있으면 같은 사용자·세션이어야 한다. AT 만료가 유효 RT 폐기를 막지 않도록 RT가 인증 정본이다. | 기술 결정. 기존 RT 증명 의도 유지, 요청/추적/프록시 로그에서 헤더 삭제 |
| A18 | 기존 제공자의 token 검증 경로는 명시적 `credential` 확장으로 유지한다. `authorizationCode`는 실제 교환 어댑터가 처리하며 JWT 검증 함수에 대신 넣지 않는다. 미지원 provider는 기존 400 UNSUPPORTED_PROVIDER를 보존하고, 알려진 provider의 지원하지 않는 credential 종류와 구분한다. 제공자 자격 실패는 KAKAO_TOKEN·APPLE_TOKEN·GOOGLE_TOKEN·LINE_TOKEN·INSTAGRAM_TOKEN·FACEBOOK_TOKEN 각각 401, refresh와 logout의 RT 자격 실패는 REFRESH_TOKEN401을 보존한다. | 기술 결정. 원본 code-only 대비 변경은 LLD에 명시 |
| A19 | 앱 명령/로그인 시도 ID는 하이픈 포함 36자 UUID이며 v4/v7은 생성 권고다. 다른 버전 비트라는 이유로 거부하지 않는다. | 선행 공통 UUID 규약과 일치 |
| A20 | 신규 PATCH와 legacy POST/PATCH /api/v1/users/me 및 완료 입력을 바꾸는 모든 writer가 users 배타 잠금 아래 같은 전이/outbox 경계를 공유한다(GROMO-1945 구현 — `user.onboarded` 는 `SCORE` 대상에 내구 보류, 랭킹 소비자는 후속). 승인된 완료 판정의 false→true는 user.onboarded, 실제 이름 변경은 기존 동기 writer의 user.displayNameChanged를 프로필·receipt와 같은 Data TX에 내구화한다. 완료 재생·무변경은 새 사건을 만들지 않는다. 랭킹은 기존 사용자 점수/상태 version과 주차별 절대 점수, Link는 멤버십 snapshotVersion과 폐기 상태를 대조하며 두 축은 별개다. 생산자/소비자 구현·회귀 전 활성화하지 않는다. | 기존 아키텍처 ㊣/㋡. 이름 writer는 선행 재사용; Q03/Q04 는 2026-09-19 확정 |
| A21 | 기존 chat_read_cursors의 탈퇴 사용자 행을 모든 방에서 hard delete한다. 중앙 탈퇴와 같은 TX에 chat/realtime 대상 user.withdrawn 전달을 내구화하고, 소비자는 로컬 사용자 잠금 아래 tombstone/version·커서 삭제·중복 수신 완료를 같은 TX에 확정한다. markRead와 복원/import 등 모든 cursor writer도 같은 잠금·폐기 재검사를 거쳐 늦은 UPSERT의 부활을 막는다. 멤버십 캐시 삭제는 이 DB fencing을 대체하지 않는다. 메시지 본문/sender_id 보존과 우체통 읽음 표시 정책은 별개다. 같은 tombstone과 개별 로그아웃의 auth.session.revoked 세션 fence를 REST·STOMP 인가, 기존 구독 전달, 메시지 저장 writer에 적용하고, 소비자 커밋 뒤 멤버십 캐시 삭제·전 인스턴스 활성 소켓 종료를 완료 조건에 포함한다. 캐시·소켓 정리 실패가 fence 재검사를 대체하지 않는다. 보존 메시지의 공개 응답(히스토리·방 목록 최신 메시지·재전송 응답)은 탈퇴 발신자의 senderId를 null로 치환하며 사용자별 대체 식별자를 만들지 않는다. | 기존 개인 cursor의 파기 누락 보완. 소비자/쓰기 fencing은 후속 구현·검증 조건이며 현재 완료 아님 |
| A22 | 탈퇴자의 로그·분석 자료(user-activity user_id, APP MDC user_id, 로컬 활성·회전·호스트 파일, S3 적재본, 로그·trace sink, GA4/Firebase의 User-ID·app_instance_id·설치 device_id 연결)는 **행 단위 삭제가 아니라 보존 기간 만료로 파기**한다. 탈퇴 시점에 개별 레코드를 찾아 지우거나 비식별화하지 않으며, 아래 [로그·분석 보존 기간](#로그분석-보존-기간) 표의 기간이 지나면 저장소 자체의 만료로 사라진다. 기간 값의 정본은 이 표이고 logback `maxHistory`(로컬)와 S3 수명 주기 규칙(적재본)은 각각 자기 행의 값을 구현한다(설정이 표와 다르면 이 표에 맞춘다). 표에 기간이 없거나 설정 미확인인 저장소는 파기 완료를 주장하지 않는다. 앱은 탈퇴 성공 뒤 GA4 User-ID를 해제한 다음에만 이벤트를 보낸다. | 재영님 결정 2026-09-19(GROMO-1942). 이전 판의 행 단위 파기·sink fence·GA4 삭제 요청·앱 인스턴스 등록부 설계를 대체 |
| A23 | 2.0 로그인 화면은 `apple`·`google`·`kakao` 3종을 **국가·로케일로 가르지 않고 모두 노출**한다. 로케일은 **순서만** 정한다 — `ko` 는 카카오·애플·구글, 그 밖은 애플·구글·카카오이며, 판정은 기기 로케일 언어 태그 하나로만 하고 스토어 국가·IP·GPS 를 쓰지 않는다(틀리면 잠금이 되는 값에 불확실한 신호를 더하지 않는다). 세 버튼은 같은 묶음·같은 위계에 둔다(App Store 심사 지침 4.8 동등 노출). **안드로이드는 애플을 노출하지 않는다** — 기존 GROMO-998 유지이며 `expo-apple-authentication` 이 iOS 전용이다. 그 결과 iOS 애플 가입자가 안드로이드로 기기를 옮기면 재진입 수단이 없다(Q07). 게스트는 3종 아래 보조 액션으로 두고 위계를 가르며, 소셜 요구 시점은 기존대로 친구 추가·편지·상점 첫 시도다. **적용 범위는 2.0 화면뿐이다** — 동결된 1.x(`gromo`)의 로그인 노출은 기존 플랫폼별 정책을 그대로 따른다: iOS 는 카카오·애플·구글, 안드로이드는 카카오·구글이며 순서는 로케일과 무관하게 고정이다(`app/legacy/app-dev/src/screens/LoginScreen.tsx` `ALL_PROVIDERS`). 위 로케일 순서 규칙을 1.x 에 소급 적용하지 않는다. **선행 조건**: 애플 버튼은 서버 허용 audience 목록화 전까지 켜지 않는다 — `apple.client-id` 가 단수라 2.0 번들 `com.oneorthree.focuscat` 이 들어가 있지 않고, 1.x `com.oneorthree.gromo` 를 그 값으로 바꿔치기하면 스토어에 남은 1.x 가 끊긴다. 목록화는 안드로이드와 무관하게 **2.0 iOS 출시의 선행 조건**이므로 별도 티켓으로 뗀다. | GROMO-1967 · 2026-09-21 권태화 결정 계정-D1. 기획 정본 「로그인 수단은 `APPLE`·`GOOGLE`·`KAKAO`」·「회원 계정 하나에는 로그인 수단 하나만」. 구현 근거: `AppleJwksClientImpl:121` 의 `getAudience().contains(clientId)` · `application-*.yml` 의 단수 `apple.client-id` · `app/legacy/app-dev/src/screens/LoginScreen.tsx:69`. 2.0 은 Business 가 자격을 검증하지 않고 Data 로 흘려보내므로 같은 검증부를 탄다 |

A06/A08/A09 및 A11/A21의 추가 파기·검증은 목표 계약이다. 기존 기기 DELETE의 키 생략 호환은 유지하되 새 앱 삭제 흐름에는 고정 키가 필수다. main은 Data에서 JWT를 발급하고 `users.refreshTokenHash` 하나를 보관한다. 미통합 1659에는 세션 확인·bootstrap·outbox 기반이 있으나 세션별 RT 정본 전환이나 전체 Business 로그인 이관이 끝난 것은 아니다.

## 로그·분석 보존 기간

A22의 보존 기간 정본이다. 탈퇴자 자료는 이 기간이 지나면 저장소 만료로 파기된다. 값을 바꾸면 구현 위치의 설정을 같은 변경에서 맞춘다.

| ID | 저장소 | 보존 기간 | 구현 위치 | 상태 |
| --- | --- | --- | --- | --- |
| L01 | APP 시스템 로그 파일(`logs/app.log`·일별 회전본, 운영 호스트 `/var/log/springboot`) | **7일** | `logback-spring.xml` `APP_FILE_RAW` `maxHistory=7` | 적용 |
| L02 | user-activity 로그 파일(`logs/user-activity.log`·일별 회전본, 같은 호스트 경로) | **30일** | `logback-spring.xml` `UA_FILE_RAW` `maxHistory=30` | 적용 |
| L03 | S3 적재본 `system_log/` 접두(`system_log/app-N/`, `app.log` 매시간 업로드 — 티켓 590) | **90일** | 버킷 `gromo-prod-logs-808715036056` 수명 주기 규칙 `expire-system-logs`(기록: `server/scripts/s3-log-archive-lifecycle.json`) | 적용 2026-09-19 |
| L04 | S3 적재본 `user_log/` 접두(`user_log/app-N/`, `user-activity.log` 매시간 업로드 — 티켓 590) | **90일** | 같은 버킷 규칙 `expire-user-logs` | 적용 2026-09-19. 티켓 590의 「만료 없음」을 재영님이 90일로 변경(2026-09-19) |
| L10 | S3 적재본 `user-activity/` 접두(`user-activity/dt=YYYY-MM-DD/`, Fluent Bit 전환 예정 — 티켓 790) | **90일** | 같은 버킷 규칙 `expire-user-activity` | 적용 2026-09-19(적재는 790 완료 뒤 시작) |
| L05 | GA4 속성 이벤트 데이터(Firebase Analytics 앱스트림·서버 MP 포함) | **2개월**(권장값) | GA4 관리 > 데이터 설정 > 데이터 보존 | **GA4 관리 화면에서 재영님이 설정 — 설정값 확인 필요** |
| L06 | dev Loki(컨테이너 stdout) | 7일(168h) | `server/observability/loki/loki-config.yml` `retention_period` + compactor | 적용(dev 전용) |
| L07 | Datadog Logs(dev·prod 컨테이너 stdout, APP MDC user_id 포함) | 미정 | Datadog 로그 인덱스 보존(저장소 밖) | 미확인 |
| L08 | Datadog APM trace | 미정 | Datadog 보존 필터(저장소 밖) | 미확인 |
| L09 | Docker 컨테이너 로그(json-file, APP stdout) | **7일 목표**(L01과 같은 stdout). Docker 는 크기로만 지워 기간을 보장하지 못한다 — 앱 로그 컨테이너 `max-size 50m`×`max-file 4`(200 MB), 인프라 컨테이너 `10m`×`3` | `server/scripts/docker-compose.*.yml` 의 `x-app-logging`·`x-infra-logging` 앵커(근거: `server/scripts/README.md` §5) | 설정(GROMO-1957) — 일 로그량 실측 후 크기 보정 전까지 7일 파기 완료를 주장하지 않는다 |

- 로컬 파일(L01·L02)과 S3 적재본(L03·L04·L10)은 **보존 기간이 다르다**. 로컬은 APP 7일·user-activity 30일, S3는 세 접두 모두 90일이다. 탈퇴자 로그의 최종 파기 시점은 더 긴 S3 기간이 정한다.
- S3 만료는 객체 생성(업로드) 시각 기준이고 하루 단위로 처리되므로 실제 삭제는 기록 시각 기준 기간보다 하루 남짓 늦을 수 있다. 버킷은 버전 관리를 쓰지 않아 비현행 버전 규칙이 없다.
- S3 적재 파이프라인(운영 compose 주석의 590·790)과 버킷의 Terraform 원본은 이 저장소가 아니라 `OneOrThree/terraform` 레포의 `aws-prod-server/s3.tf`(티켓 590)에 있다. 수명 주기 규칙은 2026-09-19 CLI로 버킷에 직접 적용했고, 그 Terraform은 2026-09-21 기준 아직 버킷 전체 단일 규칙(`expire-90d`, 90일)이라 동기화가 남아 있다(GROMO-1948). 표의 기간 값 자체는 어느 쪽이든 90일로 같다. 업로더는 위 세 접두 아래에만 쓴다. 다른 접두로 올리면 만료 규칙이 닿지 않는다.
- GA4 이벤트 데이터 보존은 2개월과 14개월만 고를 수 있어 최솟값 2개월을 권장한다. 같은 화면의 「새 활동 시 사용자 데이터 재설정」은 꺼서 새 이벤트가 만료를 늦추지 않게 한다. BigQuery 내보내기가 연결돼 있으면 내보낸 자료에는 이 보존 기간이 적용되지 않으므로 연결 여부도 함께 확인한다.
- L07·L08이 정해지기 전, L09는 크기 보정이 끝나기 전에는 해당 저장소의 탈퇴 파기 완료를 주장하지 않는다.

## RT 장부 대조

| 요청받은 참조 | 실제 장부 | 반영 |
| --- | --- | --- |
| ㉮ | 정상 sid RT 회전 0행 = 세션 종료 401 | 실패한 후보나 구 RT를 성공 응답으로 내리지 않음. 최초 legacy 승격의 동일 성공 결과 제한 재생은 별도 이관 복구 계약 |
| ㉠ | 기준 main 장부에 해당 기호 없음 | 참조 오류 가능성을 기록. 없는 의미를 만들어 쓰지 않음 |
| ⓠ | Business 후보 서명·Data CAS. 구 RT 유지 문구는 취소되고 ㉮ 우선 | 실제 서명/저장 분리 근거로 함께 대조 |
| ㊑/㊔ | userId upsert 뒤 서명, 로그인 시도 nonce로 조건부 저장 | 준비·확정 명령과 내구 시도 상태 |
| ㊙/㊡ | 고정 서명 재료, 성공 CAS 재생·경쟁 충돌 재준비 | 같은 attempt/자격으로 generation+nonce를 한 번 재발급. 폐기 INVALIDATED 및 refresh 경쟁 실패와 분리 |
| ㊱ | ownership 변경 뒤 삭제 성공 응답 재시도 | 같은 사용자·scope·fingerprint의 고정 키 완료 재생을 과거 ownership 거절보다 먼저 판정. 새 등록은 삭제하지 않음 |
| ㊲/㊨/㊪ | 기기 DELETE 위치에서 대상 FCM·소유권 outbox 기록 | RT-only logout에는 세션/bootstrap 폐기만. X-Device-Token·X-Device-Ownership은 별도 DELETE가 처리 |
| ㊒ | 선택적 AT로 게스트 승격 | 기존 userId·지갑·집중·그룹 보존 |
| ㋣/㋪ | 세션별 RT, legacy expand/contract | 기기 B 로그인이 A의 RT를 없애지 않음 |
| ㋞/㋤/㋨ | bootstrap 폐기·동기 세션 검사·sessionEpoch fencing | 종료된 세션의 지연 알림 기기 등록 차단 |

## 설정 소유 표

| 항목 | 정본 | 신규 계약과 관계 |
| --- | --- | --- |
| 알림 선호 | 알림 서버 | `notifications` → `notificationEnabled` |
| OS 알림 권한 | OS | 앱 선호와 별개. 서버 PATCH로 허용할 수 없음 |
| 음량·음소거·진동·동작 줄이기 | 현재 기기/OS | 이 7개 API에 필드를 추가하지 않음 |
| 기존 푸시 소리·야간 모드·야간 시각 | 기존 알림 서버 계약 | 기존 5개 필드를 보존. 로컬 음소거와 동일시하지 않음 |
| 스크린타임 측정 권한 | OS | 기존 권한 보고 API는 보존하되 새 설정 1필드와 합치지 않음 |

GET 후 5개 필드 PUT을 조립하면 다른 기기의 변경을 덮어쓴다. Data outbox의 patch payload와 mask를 알림 서버까지 전달하고 해당 필드만 원자 갱신한다. 전체 version 하나로 오래된 부분 명령을 버리면 다른 필드의 아직 미적용된 변경이 유실될 수 있다. 따라서 필드별 적용 version으로 중복/역전 모두 판정한다. 구 전체 교체 명령도 같은 비교 규칙을 거쳐야 한다.

## 로그인 제공자 노출·순서

A23 의 화면 표다. 2.0 로그인 화면에만 적용하며 동결된 1.x 는 기존 노출을 유지한다.

**국가 판정 기준**: 기기 로케일의 **언어 태그** 하나만 쓴다. 스토어 국가·IP·GPS 는 쓰지 않는다 — 판정이 틀리면
계정 접근이 막히는 자리라 불확실한 신호를 더하지 않는다.

| 국가(로케일) | 플랫폼 | 노출 조합 | 버튼 순서 |
| --- | --- | --- | --- |
| `ko` | iOS | 애플 · 구글 · 카카오 | 카카오 → 애플 → 구글 |
| `ko` | 안드로이드 | 구글 · 카카오 | 카카오 → 구글 |
| `ko` 밖 | iOS | 애플 · 구글 · 카카오 | 애플 → 구글 → 카카오 |
| `ko` 밖 | 안드로이드 | 구글 · 카카오 | 구글 → 카카오 |

- **노출 조합은 국가로 갈리지 않는다.** 위 표에서 국가가 바꾸는 것은 순서뿐이고, 조합을 가르는 축은 플랫폼 하나다.
- 안드로이드에서 애플이 빠지는 것은 `expo-apple-authentication` 이 iOS 전용이기 때문이다(기존 GROMO-998 유지).
- 세 버튼은 같은 묶음·같은 위계에 둔다(App Store 심사 지침 4.8 동등 노출). 순서가 위계를 뜻하지 않는다.
- 애플 버튼은 서버 허용 audience 목록화 전까지 켜지 않는다(A23 선행 조건).

**게스트 로그인은 유지한다.** 제공자 버튼 묶음 **아래**에 보조 액션(텍스트)으로 두고 기본 버튼과 위계를 가른다.
소셜 로그인을 요구하는 시점은 기존 정책 그대로 친구 추가·편지 보내기·상점 구매의 첫 시도다.

## 결정 대기

| ID | 남은 제품 입력 | 권고·영향 |
| --- | --- | --- |
| Q03 | ~~`catColor` 6종의 정확한 자산 ID와 기존 사용자 초기값~~ → **확정(2026-09-19 조재영 결정 계정-Q03, 권장안 승인)**: 앱 2.0 카탈로그 `black`·`ginger`·`cream`·`gray`·`white`·`calico`. 기존 사용자 초기값은 null(백필 없음, 온보딩에서 재선택) | 출처는 앱 `services/model.ts` `colors` — 원본 샘플 3종으로 지어낸 값이 아니다. 카탈로그 밖 값은 공개 422 `OUT_OF_RANGE`(`field: catColor`), DB 는 `users.cat_color` CHECK(V80). 구현 GROMO-1945 |
| Q04 | ~~Q03에 따른 기존 사용자 온보딩 승계~~ → **확정(2026-09-19 조재영 결정 계정-Q04, 권장안 승인)**: 유효 name 과 catColor 를 모두 저장하면 완료. `isNewUser` 는 매핑하지 않고, 색이 없는 기존 행은 미완료로 온보딩에 재진입한다(A24 — 1.x 미이관이라 승계는 최소) | 판정 함수 `OnboardingCompletion` 하나를 로그인·GET·모든 프로필 writer 가 공유하고, false→true 전이만 `user.onboarded`(같은 TX outbox) — A20. 구현 GROMO-1945 |
| Q05 | 실제 수락 가능한 약관 문서 버전 | `2026-09`는 예시다. 버전 카탈로그를 배포 설정으로 주입하고 실제 약관 문서와 연결해야 한다. 별도 보존 기간을 이 설계에서 임의로 정하지 않는다 |
| Q06 | legacy 게스트 승격 결과의 복구 창과 창 밖 장기 실패 처리 | 원 RT 증명·같은 활성 세션·고정 만료 이내의 동일 결과 재생을 구현한다. 복구 창 수치는 임의 확정하지 않는다. 제공자 없는 게스트의 창 밖 대체 복구는 미승인이며 자동 신규 계정 생성/자산 이전으로 대신하지 않는다. 해당 결정과 응답 유실·앱 종료 검증 전 강제 승격 출시 보류 |
| Q07 | ~~iOS 애플 가입자가 안드로이드로 옮겼을 때의 재진입 경로~~ → **확정(2026-09-21 권태화 결정 계정-Q07, 선택지 ③ 채택)**: 이동 잠금을 **한계로 받아들이고 그대로 구현**한다. 안드로이드 Apple 웹 OAuth 도 문의 경로 수동 전환도 지금 만들지 않는다. **추후 변경 예정**이며, 그때 선택지 ①(Services ID + `expo-auth-session`)·②(「로그인 수단 변경 불가」의 좁은 예외 + 문의 경로)를 다시 본다 | 범위는 iOS→안드로이드 이동자로 한정되며 국가 축의 잠금과 달리 예측 가능한 집합이다. 게스트 승격은 다른 계정 생성이지 복구가 아니므로 대체 경로로 세지 않는다. 변경 시점에는 A23 의 「안드로이드는 애플을 노출하지 않는다」와 이 표를 같은 개정에서 고친다 |

R61 PDF 17쪽을 시각 확인했으나 계정/프로필/색상 선택 화면이 없었다. 15~17쪽은 상점·착장 예시이며 색상 6종의 문자열 enum이나 legacy 기본값의 근거가 아니다. 약관·자산 입력이 없는 상태를 서비스 출시 가능으로 표시하지 않는다.

## 원본 대비 변경

| 원본 | 채택 계약 | 상태 |
| --- | --- | --- |
| `/v1/...` | 접두어 없는 동일 7개 경로 | 사용자 확정 |
| Apple code-only 예시 | code 교환 + 기존 제공자별 검증 자격 확장 | 기존 지원 유지의 기술 결정 |
| logout 본문 없음·RT 위치 미명시 | 본문 없음, 필수 RT 헤더, 제공된 AT는 같은 세션 대조 | 기술 결정 |
| name/색상 예시 | nickname 정책 유지, 색상 목록은 Q03 6종 | 기존 정책 + Q03 확정(2026-09-19) |
| onboardingComplete 예시 | name AND catColor, legacy 도 같은 함수 | Q04 확정(2026-09-19) |
| notifications 1개 | 알림 서버 원자 부분 변경 | 기존 소유 경계 유지 |

원본 예시는 [추출본](source-contracts.json)에 수정 없이 보존한다. 추가 재인증이 없는 현재 AT 인증 탈퇴를 더 강한 재인증으로 바꿨다고 주장하지 않는다. 단순 `confirmation: "DELETE"`는 사용자 의도 확인이며 별도 자격 증명이 아니다.

탈퇴 중앙 TX는 랭킹 `user.withdrawn` outbox도 함께 기록한다. 소비자는 tombstone/version과 모든 주차 ZSET·presence 제거를 원자 적용하고 지연/DLT 점수 재생을 거부한다. 비동기 제거 전에도 공개 projection은 현재 활성 조건을 확인한다. 상세 순서·writer 경합은 LLD 리그 이력·랭킹 투영 파기 절을 따른다.
