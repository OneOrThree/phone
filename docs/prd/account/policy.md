# 계정·설정 — 정책 정본

GROMO-1756 · 2026-09-12 · [색인](README.md) · [상세 계약](low-level-design.md)

## 유지할 정책과 기술 결정

| ID | 정책 | 출처·상태 |
| --- | --- | --- |
| A01 | 신규 Business 경로에는 접두어를 붙이지 않고 JSON 성공은 `{data}`로 감싼다. 기존 Data/chat 경로는 보존한다. | 사용자 확정·선행 1750 |
| A02 | 공개 `name`은 기존 `users.nickname`이다. trim 후 2~10 UTF-16 단위, 다른 사용자와 중복 금지다. | main `UserService.changeNickname`과 DB 유일 제약 유지 |
| A03 | 프로필 변경과 탈퇴는 활성 `users` 행을 수정하기 전에 배타 잠금한다. | 기술 결정. `User`에 `@Version`이 없어 늦은 전체 UPDATE가 파기된 PII를 되살릴 수 있음 |
| A04 | 선택적 AT는 서명·access 타입·만료·주체와 원 세션 활성/현재 세대를 검증한다. prepare·complete·성공 재생에서 users 우선 잠금 아래 재검사하며, 개별 폐기된 AT로 승격하지 않는다. sidless는 입증된 legacy 결합/폐기 fence가 필수이고 userId만으로 다른 활성 세션을 대신 쓰지 않는다. guest=true일 때만 기존 게스트 승격 규칙을 적용하고 기존 userId를 보존한다. 유효한 guest=false AT는 정상 계정 전환을 막지 않으며 제공자 계정 로그인/가입을 진행한다. 기존 6개 소셜 제공자와 게스트 생성 경로를 보존한다. | 장부 ㊒·기존 AuthService. 원본 Apple 예시는 제공자 축소 결정이 아님 |
| A05 | AT/RT 타입·서명·만료를 검증하고 RT 원문을 DB/로그에 저장하지 않는다. | 기존 JwtProvider·TokenHasher |
| A06 | 로그인은 실제 원 자격으로 내구 attempt를 먼저 조회하고, 저장된 검증 결과가 없는 안전한 최초 실행만 IdP 교환 → Data upsert → Business 서명 → Data CAS 확정을 수행한다. 재개는 동일 자격 digest/주체 scope·활성/세대·고정 만료를 검사하고 IdP를 재호출하지 않는다. 같은 성공 준비 generation은 고정 서명 재료로 재생한다. 폐기 아닌 CAS 경쟁은 동일 attempt/자격의 새 nonce 재준비이며 INVALIDATED와 분리한다. 자격 digest는 attempt에 digest key ID를 고정해 모든 흐름에서 attempt/key ID 조회 뒤 계산하고, COMPLETED 응답 유실 재생을 포함한 재생 가능 attempt의 고정 복구 마감까지 이전 키를 검증 전용으로 유지하며, 키 교체를 다른 자격(`IDEMPOTENCY_KEY_REUSED`)으로 판정하지 않는다. COMPLETED 결과 세션은 그 sid로 인증된 최초 성공을 채택으로 내구 기록하고, 고정 복구 마감까지 미채택인 결과 세션만 세션 단위로 폐기한다. 원 선택 세션 폐기나 INVALIDATED를 이유로 채택된 세션을 끊지 않는다. | 이미 확정된 장부 ㊑/㊔/㊙/㊡. 현재 main의 구현 완료를 뜻하지 않음 |
| A07 | 회전하지 않는 refresh는 새 AT와 `refreshToken:null`을 반환한다. 정상 sid RT 회전 CAS 0행은 401 REFRESH_TOKEN이다. 원자 bundle 미지원 클라이언트와 응답 전체 유실의 안전 복구가 미확정인 경로는 정상 회전을 활성화하지 않으며 원 RT 만료를 연장하지 않는다. 동일 subject/sid/gen만으로 완전한 회전 쌍을 증명하지 않는다. 최초 legacy 승격에서만 원 RT로 증명한 동일 완료 결과를 제한 재생하며 구 해시를 부활시키지 않는다. | 기존 AuthService와 장부 ㉮ |
| A08 | RT 정본을 `(userId, sessionId)`로 전환한다. 개별 로그아웃은 해당 세션/Bootstrap만 폐기하고 기기 삭제 outbox를 만들지 않는다. 대상 토큰·ownership DELETE가 기기 삭제를 소유한다. 비게스트 계정 전환과 같은 사용자·다른 sid 재로그인도 이전 주체·기기·고정 키를 전환 전에 내구 준비하되 새 세션 commit 뒤에만 실행하고, rollback이면 이전 등록/RT를 보존한다. 기기 자격·원 키를 내구 큐에 남기고 삭제 실패와 무관하게 RT 폐기·로컬 인증 정리를 계속하며, 실패한 기기 큐는 소진하지 않는다. AT 재전송 인증에 의존하지 않고 검증된 sid/bootstrap 연결 등록은 auth.session.revoked 내구 전달·로컬 세션 fence로 비활성화한다. 이는 독립 DELETE 성공이 아니며 미연결 legacy 등록의 검증된 현재 세션 연결은 앱 전환 활성 조건이다. 삭제·등록 모두 토큰별 tombstone과 최대 ownershipVersion을 보존·대조해 다른 키의 지연 등록도 차단한다(㉴·㋓·㋗·㋞). 새 앱은 삭제 큐 생성 시 고정 Idempotency-Key를 저장하고 직접 전달/outbox relay가 같은 파생 키를 사용하며, 완료 재생은 원 명령 인증·scope·fingerprint 대조 후 과거 ownership 거절보다 먼저 판정한다. authGeneration은 탈퇴·전 기기 로그아웃만 증가시킨다. 같은 사용자 재로그인을 포함한 세션 전환은 commit 뒤 새 세션 bootstrap으로 기기를 재등록해 응답의 새 ownershipToken을 토큰과 원자 저장하고 후속 등록·삭제 CAS에 쓰며, 같은 토큰의 재등록이 확정된 경우에만 이전 세션 DELETE를 대체 완료로 소진한다. | 장부 ㋣/㊼ |
| A09 | sid 없는 legacy RT는 최대 유효 수명 동안 병행 조회하고 첫 refresh에서 세션 토큰으로 승격한다. 앱은 AT만 보지 않고 AT/RT의 타입·subject·sid·authGeneration과 만료를 함께 확인한다. sid 없는 유효 AT 또는 새 sid AT+원 legacy RT의 혼합 저장도 신규 /me 계열 진입 전에 원 RT로 강제 전환/승격 receipt 복구하고 AT/RT 묶음을 원자 저장·공개한다. 가짜 sid는 만들지 않는다. 승격 응답 유실은 원 RT 해시와 고정 서명 재료를 가진 전용 인증 receipt로 동일 sid AT/RT를 복원한다. 이 복구는 아직 미구현이며 Q06 해결·실패 주입 검증 전 강제 전환을 출시하지 않는다. | 장부 ㋪. 타입 없는 잘못된 토큰을 허용한다는 뜻이 아님 |
| A10 | 탈퇴의 환불·증거 동결·관계 정리·파기는 Data 단일 TX다. 주민이 남은 방장은 위임 전 `HOST_WITHDRAW`이며 혼자면 그룹도 닫는다. 본인 발급 초대 링크는 inviter_id nullable 확장 후 같은 TX에서 UUID 연결을 끊고, 링크/클릭은 타인 퍼널 FK 앵커로 보존한다. claimed_user_id 익명화는 claimed_at 소진 표지를 유지하며 후보 조회/domain claim은 두 값이 모두 null일 때만 미소비로 인정한다. 발급자 없는 링크는 폐기되며 모든 발급 writer는 활성 users 공유 잠금으로 탈퇴와 직렬화한다. claim 클릭은 소진 표지만 남기고 matched_device_id·app_instance_id·ip_hash·user_agent 연결을 같은 TX에서 파기한다. 보존하는 group_members 행은 관계 증거만 남기고 알림·공지 권한·상태·역할을 비개인 기본값으로 초기화한다. 탈퇴 확정 때 앱은 일반 로그아웃·계정 전환의 보존 정책과 별도로 그 userId의 기기 로컬 버킷·UUID 마커·누끼 파일을 writer drain 뒤 제거한다. claim은 claimant와 현재 발급자 users를 UUID 순서로 공유 잠근 뒤 링크 행을 다시 읽어 발급자 연결을 재검사하고서야 클릭을 잠근다. 링크 이관 뒤 Link 위성은 claim을 pending으로만 기록하고, Data가 잠금 아래 남긴 `link.claimConfirmed` outbox와 `(groupId, inviterId)` 전이 tombstone 대조로만 확정한다(장부 ㋟·㋥). | 기존 AccountWithdrawalService·GroupMemberService 및 InviteLinkClickRepository의 타인 집계 근거 보존 규칙 |
| A11 | 계정은 soft delete한다. character_generation 본인 이력 전체를 같은 중앙 TX에서 hard delete하고 기존 recordGeneration의 users 배타 → 사용자 advisory → 이력 잠금 순서를 유지한다. 폐기 뒤 동일 키/늦은 생성 재시도도 거절한다. character_equipment 사용자 장착 행은 같은 TX에서 hard delete하며 user_items 보유 증거와 구분한다. user_focus_tags 귀속 파기의 두 대안 모두 setupFocusTag/updateFocusTag·복원/관리·세션 재연결 writer의 활성 users 공유 잠금과 직렬화한다. user_blocks는 blocker/blocked 양방향을, user_streaks는 본인 행을 같은 TX에서 hard delete하며 현재·미래 writer와 users 잠금으로 직렬화한다. friendships는 탈퇴자가 from/to인 행을 status·기존 deleted_at과 무관하게 같은 TX에서 hard delete하고 pinned_users 양방향 삭제를 유지한다. 요청·복원·pin 생성은 두 활성 users 공유 잠금, 수락·거절과 친구 삭제는 행 배타 잠금 재조회로 탈퇴와 직렬화하며 삭제 경합을 500이 아닌 기존 오류 계약으로 처리한다. league_rank_snapshots는 삭제하고 league_weekly_results 개인 결과는 최소 정산 완료 마커와 분리해 파기한다. 내기 참가 행의 정산 근거는 보존하되 acknowledged_at/display_claimed_at/display_claim_token은 nullify하고 claim/renew/ack를 users 생명주기 잠금과 직렬화한다. 직접 PII 파기와 정산·관계 증거의 보존을 구분하고, 현재 남아 있는 개인 필드는 파기 누락으로 드러낸다. group_announcements.user_id도 같은 탈퇴 TX에서 nullify하고 생성과 users 잠금으로 직렬화한다. 미사용 직접 초대 group_invites도 inviter/invitee 양방향 행을 같은 TX에서 hard delete하며 무관한 타인 초대는 보존한다. notification_sent_logs의 탈퇴 수신자 및 사용자 상대 이력은 종류별 의미를 확인해 같은 TX에서 파기하되, 다른 활성 수신자의 RANK_OVERTAKE는 target_user_id만 nullify하여 주간 발송 상한 근거를 보존하며, 이미 발송된 늦은 결과도 검증된 원 발송 증거/고정 ID로 상대 연결 없이 멱등 기록하고 동시 writer·위성 이관 재생과 직렬화한다. group_challenge_members의 사용자별 창형 측정 원본은 판정에 필요한 증거 확정을 검증한 뒤 같은 TX에서 hard delete한다. 필요한 판정이 불명확하면 탈퇴 성공을 확정하지 않는다. 최소 정산 증거는 별도 참가 행에 보존하고 원본 측정 이력/프로필로 노출하지 않는다. Business 링크 미리보기 캐시는 탈퇴 명령 전 차단 표지·원자 대조·확정 뒤 prefix 삭제로, Data 프레즌스 lease·`:closed`는 시작 콜백·재구축 Lua의 같은 Redis tombstone 원자 대조로 재생성을 막는다. 보존한 내기 결과와 진행 중 회차(creatorUserId·참가자·세션 참가자)의 공개 DTO는 탈퇴자 행의 userId를 null(비연계 행 key)로 치환하고 내부 정산 근거는 유지한다. | 기존 FK·정산 근거 및 1756 완료 조건. 보존 행이 있으므로 완전 익명화/모든 행 삭제라고 표현하지 않음 |
| A12 | 신규 계정 조회·변경은 동기 활성 검사를 수행한다. 로그인에는 제공자 증명과 대상 계정 활성 검사, 로그아웃에는 RT 증명과 대상 세션 검사를 적용한다. 검사 순서는 AT/RT 서명·타입·만료(401) → 사용자 활성(404 `USER_NOT_FOUND`) → 세션·authGeneration(401)이며, 탈퇴 뒤 세션 폐기와 비활성이 함께 참이면 404가 우선한다. | 1757 완료 조건. legacy 조회의 AT 만료까지 읽기 창은 별도 호환 계약. 본인 부재는 기존 404 USER_NOT_FOUND를 보존 |
| A13 | 알림 선호 정본은 이관 뒤 알림 서버다. Data는 내구 명령/outbox, Business는 전달·응답을 맡는다. Notification의 누락 설정 행 생성·기본값 응답은 사용자 tombstone·authGeneration을 같은 로컬 원자 경계에서 대조해 탈퇴 뒤 재생성하지 않는다. | 1659 기반 재사용. 새 Data 설정 정본을 중복 생성하지 않음 |
| A14 | `notifications` PATCH는 부분 명령과 field mask를 끝까지 유지한다. 적용 순서 역전에 대비해 알림 서버에 필드별 적용 버전을 둔다. 최초 처리부터 대체된 명령은 SUPERSEDED로 확정해 적용한 척 요청값을 반환하지 않는다. APPLIED·SUPERSEDED 구분은 재적용 판정에만 쓰고, 최초 처리와 재전달(Business receipt 재개 포함)은 모두 응답 시점 정본 현재 값을 돌려준다. 앱은 마지막으로 보낸 명령의 응답만 반영한다. | 기술 결정. 기존 전체 PUT은 5개 필드를 모두 선택하고 각 버전을 전진시킴 |
| A15 | 음량·음소거·진동·동작 줄이기는 기기 로컬, OS 알림 권한은 OS 정본이다. | 원본 설정 계약. `notifications=true`가 OS 허용을 뜻하지 않음 |
| A16 | PATCH 프로필·PATCH 설정·DELETE 계정에는 1750의 범용 멱등 키를 적용한다. 로그인/로그아웃은 별도 인증 계약이다. | 선행 1750 적용 표. 일반 receipt에 토큰이나 cookie를 저장하지 않음 |
| A17 | 본문 없는 로그아웃의 RT는 `X-Refresh-Token` 전용 헤더로 전달한다. AT가 같이 있으면 같은 사용자·세션이어야 한다. AT 만료가 유효 RT 폐기를 막지 않도록 RT가 인증 정본이다. | 기술 결정. 기존 RT 증명 의도 유지, 요청/추적/프록시 로그에서 헤더 삭제 |
| A18 | 기존 제공자의 token 검증 경로는 명시적 `credential` 확장으로 유지한다. `authorizationCode`는 실제 교환 어댑터가 처리하며 JWT 검증 함수에 대신 넣지 않는다. 미지원 provider는 기존 400 UNSUPPORTED_PROVIDER를 보존하고, 알려진 provider의 지원하지 않는 credential 종류와 구분한다. 제공자 자격 실패는 KAKAO_TOKEN·APPLE_TOKEN·GOOGLE_TOKEN·LINE_TOKEN·INSTAGRAM_TOKEN·FACEBOOK_TOKEN 각각 401, refresh와 logout의 RT 자격 실패는 REFRESH_TOKEN401을 보존한다. | 기술 결정. 원본 code-only 대비 변경은 LLD에 명시 |
| A19 | 앱 명령/로그인 시도 ID는 하이픈 포함 36자 UUID이며 v4/v7은 생성 권고다. 다른 버전 비트라는 이유로 거부하지 않는다. | 선행 공통 UUID 규약과 일치 |
| A20 | 신규 PATCH와 legacy POST/PATCH /api/v1/users/me 및 완료 입력을 바꾸는 모든 writer가 users 배타 잠금 아래 같은 전이/outbox 경계를 공유한다. 승인된 완료 판정의 false→true는 user.onboarded, 실제 이름 변경은 기존 동기 writer의 user.displayNameChanged를 프로필·receipt와 같은 Data TX에 내구화한다. 완료 재생·무변경은 새 사건을 만들지 않는다. 랭킹은 기존 사용자 점수/상태 version과 주차별 절대 점수, Link는 멤버십 snapshotVersion과 폐기 상태를 대조하며 두 축은 별개다. 생산자/소비자 구현·회귀 전 활성화하지 않는다. | 기존 아키텍처 ㊣/㋡. 이름 writer는 선행 재사용; Q03/Q04 판정·제품 정책은 미결 유지 |
| A21 | 기존 chat_read_cursors의 탈퇴 사용자 행을 모든 방에서 hard delete한다. 중앙 탈퇴와 같은 TX에 chat/realtime 대상 user.withdrawn 전달을 내구화하고, 소비자는 로컬 사용자 잠금 아래 tombstone/version·커서 삭제·중복 수신 완료를 같은 TX에 확정한다. markRead와 복원/import 등 모든 cursor writer도 같은 잠금·폐기 재검사를 거쳐 늦은 UPSERT의 부활을 막는다. 멤버십 캐시 삭제는 이 DB fencing을 대체하지 않는다. 메시지 본문/sender_id 보존과 우체통 읽음 표시 정책은 별개다. 같은 tombstone과 개별 로그아웃의 auth.session.revoked 세션 fence를 REST·STOMP 인가, 기존 구독 전달, 메시지 저장 writer에 적용하고, 소비자 커밋 뒤 멤버십 캐시 삭제·전 인스턴스 활성 소켓 종료를 완료 조건에 포함한다. 캐시·소켓 정리 실패가 fence 재검사를 대체하지 않는다. | 기존 개인 cursor의 파기 누락 보완. 소비자/쓰기 fencing은 후속 구현·검증 조건이며 현재 완료 아님 |
| A22 | 정상 사용자 활동 로그의 user_id/MDC/payload 연결과 실제 로컬·회전·호스트·외부 복사본도 삭제/비식별화한다. 중앙 내구 파기 작업, sink별 폐기 fence·지연 queue/upload 차단·완료 증거를 요구한다. 실제 외부 구성/보존 근거 미확인은 gate로 남기며 maxHistory를 제품/법적 보존 기간으로 정하지 않는다. GA4 User-ID·app_instance_id·설치 device_id 연결도 파기 대상이다. 중앙 TX에 삭제 작업을 내구 기록하고, 앱은 탈퇴 성공 뒤 식별자 해제·재설정 전에는 사용자 연결 이벤트를 보내지 않으며, 지연 전송을 고려한 재요청·완료 증거를 요구한다. | main logger/logback/운영 compose의 실제 사용자 UUID 경로. 구현·운영 연결은 미완료이며 LLD 로그 파기 경계 적용 |

A06/A08/A09 및 A11/A21/A22의 추가 파기·검증은 목표 계약이다. 기존 기기 DELETE의 키 생략 호환은 유지하되 새 앱 삭제 흐름에는 고정 키가 필수다. main은 Data에서 JWT를 발급하고 `users.refreshTokenHash` 하나를 보관한다. 미통합 1659에는 세션 확인·bootstrap·outbox 기반이 있으나 세션별 RT 정본 전환이나 전체 Business 로그인 이관이 끝난 것은 아니다.

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

## 결정 대기

| ID | 남은 제품 입력 | 권고·영향 |
| --- | --- | --- |
| Q03 | `catColor` 6종의 정확한 자산 ID와 기존 사용자 초기값 | 원본 샘플 black/calico/ginger만으로 6개 enum을 만들어내지 않는다. 기존 사용자에게 재선택을 요구할지, 승인한 기본색을 줄지 확인 필요 |
| Q04 | Q03에 따른 기존 사용자 온보딩 승계 | 신규 사용자는 유효 name과 catColor를 모두 저장하면 완료로 계산하는 안을 권고한다. 기존 isNewUser는 완료 여부가 아니므로 그대로 매핑하지 않는다. legacy 사용자의 재진입 여부는 Q03과 함께 확정 |
| Q05 | 실제 수락 가능한 약관 문서 버전 | `2026-09`는 예시다. 버전 카탈로그를 배포 설정으로 주입하고 실제 약관 문서와 연결해야 한다. 별도 보존 기간을 이 설계에서 임의로 정하지 않는다 |
| Q06 | legacy 게스트 승격 결과의 복구 창과 창 밖 장기 실패 처리 | 원 RT 증명·같은 활성 세션·고정 만료 이내의 동일 결과 재생을 구현한다. 복구 창 수치는 임의 확정하지 않는다. 제공자 없는 게스트의 창 밖 대체 복구는 미승인이며 자동 신규 계정 생성/자산 이전으로 대신하지 않는다. 해당 결정과 응답 유실·앱 종료 검증 전 강제 승격 출시 보류 |

R61 PDF 17쪽을 시각 확인했으나 계정/프로필/색상 선택 화면이 없었다. 15~17쪽은 상점·착장 예시이며 색상 6종의 문자열 enum이나 legacy 기본값의 근거가 아니다. 약관·자산 입력이 없는 상태를 서비스 출시 가능으로 표시하지 않는다.

## 원본 대비 변경

| 원본 | 채택 계약 | 상태 |
| --- | --- | --- |
| `/v1/...` | 접두어 없는 동일 7개 경로 | 사용자 확정 |
| Apple code-only 예시 | code 교환 + 기존 제공자별 검증 자격 확장 | 기존 지원 유지의 기술 결정 |
| logout 본문 없음·RT 위치 미명시 | 본문 없음, 필수 RT 헤더, 제공된 AT는 같은 세션 대조 | 기술 결정 |
| name/색상 예시 | nickname 정책 유지, 색상 목록은 Q03 | 기존 정책 + 미답 제품 입력 |
| onboardingComplete 예시 | 신규/legacy 판정 분리 | Q04 |
| notifications 1개 | 알림 서버 원자 부분 변경 | 기존 소유 경계 유지 |

원본 예시는 [추출본](source-contracts.json)에 수정 없이 보존한다. 추가 재인증이 없는 현재 AT 인증 탈퇴를 더 강한 재인증으로 바꿨다고 주장하지 않는다. 단순 `confirmation: "DELETE"`는 사용자 의도 확인이며 별도 자격 증명이 아니다.

탈퇴 중앙 TX는 랭킹 `user.withdrawn` outbox도 함께 기록한다. 소비자는 tombstone/version과 모든 주차 ZSET·presence 제거를 원자 적용하고 지연/DLT 점수 재생을 거부한다. 비동기 제거 전에도 공개 projection은 현재 활성 조건을 확인한다. 상세 순서·writer 경합은 LLD 리그 이력·랭킹 투영 파기 절을 따른다.
