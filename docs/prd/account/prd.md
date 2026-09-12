# 계정·설정 API — PRD

GROMO-1756 · [정책](policy.md) · [HLD](high-level-design.md) · [LLD](low-level-design.md)

## 문제와 목표

새 앱은 로그인·내 프로필·설정을 7개 계약으로 읽는다. 기존 서버의 인증·프로필·알림·탈퇴 경로를 단순히 이름만 바꾸면 인증 재료, 세션 축, 신규 고양이 색상, 탈퇴 파기 대상과 설정 저장 주체가 맞지 않는다.

목표는 7개 공개 계약의 스키마와 기존 상태의 호환 경계를 정하고, 로그아웃/탈퇴 뒤 유효하지 않은 주체가 새 계정 API를 다시 사용하지 못하게 하는 것이다. 인증은 Business, 계정·세션 상태와 원자 탈퇴는 Data, 알림 선호 정본은 이관 뒤 알림 서버가 소유한다. 새 계약을 만든다는 이유로 Data의 탈퇴 TX를 여러 HTTP 요청으로 쪼개지 않는다.

## 공개 계약 7종

| 원본 ID | 신규 경로 | 결과 |
| --- | --- | --- |
|auth|POST `/auth/sessions`|AT·RT·userId·onboardingComplete|
|me|GET `/me`|id·name·catColor·linkedProviders·onboardingComplete|
|profile|PATCH `/me`|id·name·catColor|
|logout|DELETE `/auth/sessions/current`|revoked|
|delete|DELETE `/me`|deleted|
|settings|GET `/me/settings`|notifications|
|settings-save|PATCH `/me/settings`|notifications|

refresh는 위 7종의 새 기능 개수로 더하지 않는다. 장부상 기존 `/auth/refresh`를 유지/이관하기 위한 세션 기반 의존으로 설계한다. 기존 Data `/api/v1/auth/*`, `/api/v1/users/me`와 `/notification-settings` 계약은 호환 대상으로 보존한다. 신규 endpoint에서 필드 이름이 `name`이라고 기존 DB의 `nickname`을 무조건 rename하지 않는다.

## 요구사항

| ID | 요구사항 | 근거/문서 |
| --- | --- | --- |
| FR01 | 7개 요청·응답 필드와 null/생략·오류를 명시 | LLD 스키마, source-contracts.json |
| FR02 | 게스트→소셜 승격은 기존 userId·집중·지갑·그룹을 보존. 원 선택 세션의 활성/세대를 prepare·complete·재생에서 재검사하며 sidless legacy 결합/폐기 fence도 요구. 유효한 비게스트 선택 AT의 정상 제공자 계정 전환도 보존 | 장부㊒, 기존 AuthService |
| FR03 | 실제 원 자격으로 내구 attempt 선조회→최초 미검증일 때만 IdP 교환→upsert→서명→조건부 저장. 재개는 scope·활성·세대·고정 만료를 확인하고 IdP 재교환 없이 고정서명재료 재생. CAS 경쟁은 동일 attempt/자격의 새 nonce 재준비. 자격 digest key ID를 attempt에 고정하고 attempt/key ID 조회 뒤 digest를 계산해, Business 키 교체 뒤에도 PENDING 재개와 COMPLETED 응답 유실 재생을 보장 | 장부㊑/㊔/㊙; 현재 main 구현 완료로 오인 금지 |
| FR04 | 원자 저장 미지원 또는 정상 회전 응답 전체 유실 복구 미확정이면 회전 비활성·원 RT 만료 유지. 동일 sub/sid/gen만으로 쌍 검증 금지.  회전 없음과 정상 sid RT 회전 CAS0행을 구분. CAS0행은401 REFRESH_TOKEN, 구 RT 부활 금지. 최초 legacy 승격 응답 유실은 원 RT 증명의 전용 인증 receipt로 동일 sid AT/RT를 제한 재생. 서버 복구·Q06 검증 뒤 AT/RT 타입·subject·sid·authGeneration을 함께 대조. sidless 및 새 AT+원 legacy RT 혼합도 Ready 전에 원 RT receipt 복구하고 묶음 원자 교체 | 장부㉮/ⓠ |
| FR05 | 비게스트 계정 전환과 동일 사용자·다른 sid 재로그인도 원 기기 삭제 큐를 전환 전 내구 준비하고 새 세션 commit 뒤 실행; rollback은 이전 등록/RT 보존.  RT는 사용자+세션 축; 개별 로그아웃은 세션/bootstrap 폐기만. 기기 삭제 실패에도 원 RT 폐기·로컬 정리 진행, 미완료 기기 자격/원 키 큐 보존. 검증된 sid/bootstrap 연결 등록은 내구 세션 폐기 fence로 비활성화하며 미연결 legacy 전환은 활성 조건. 삭제·등록의 토큰별 tombstone/최대 ownershipVersion 유지. 토큰/ownership 기기 DELETE와 분리하여 다른 기기를 끝내지 않음. 새 앱 삭제는 고정 멱등 키를 직접 전달·outbox relay 끝까지 유지하고 완료 재생을 과거 ownership 거절보다 먼저 판정 | 장부㋣/㋪ 및1659 통합 의존 |
| FR06 | character_generation 본인 전체 이력의 중앙 TX hard delete와 기존 users 배타 잠금 writer 직렬화·rollback 검증. character_equipment 장착 hard delete 및 setup/update/복원 태그 writer 직렬화로 개인 태그·세션 재귀속 부활을 방지. group_invites의 inviter/invitee 양방향 기존 행·user_blocks 양방향·본인 user_streaks를 같은 TX에서 삭제하고 차단/스트릭 writer와 직렬화. nickname/name·catColor 등 신규 프로필과 기존 인증 PII·group_announcements.user_id nullify를 탈퇴 목록에 포함하고 공지 생성과 직렬화. group_challenge_members 측정 원본도 검증된 증거 동결 뒤 같은 TX에서 hard delete하고 보고와 직렬화 | LLD 파기/보존 전수 표 |
| FR07 | 정상 활동 로그 UUID·실제 복사본 파기/비식별화와 sink별 지연 writer fencing·완료 검증.  GA4 User-ID·app_instance_id 삭제 작업, 탈퇴 뒤 앱 식별자 해제·재설정과 지연 이벤트 재요청.  초대 클릭 UUID 익명화 뒤에도 claimed_at 소진 표지를 유지해 재귀속/추가 보상 차단.  claim 클릭의 기기·GA4·IP 해시·UA 식별자 파기와 보존 멤버십의 알림·공지 권한·상태·역할 초기화.  탈퇴 확정 때만 기기 로컬 사용자 버킷·UUID 마커·누끼 파일을 writer drain 뒤 제거(일반 로그아웃 보존 정책 불변).  내기 참가 행의 열람/표시 lease 3열 nullify·claim/renew/ack 생명주기 fencing, 정산 증거 보존.  상대 탈퇴 시 활성 수신자의 추월 알림은 target만 nullify하여 기존 주간 상한 보존.  본인 group_invite_links.inviter_id 비식별화와 폐기 링크 재사용 차단, 타인 링크/클릭 귀속 보존·발급 writer 직렬화.  리그 일간/주간 개인 이력 파기·최소 정산 완료 마커 및 랭킹 user.withdrawn 내구 제거(tombstone/version·모든 주차 ZSET/presence)를 포함하고 탈퇴의 환불·증거 보존·익명화·지갑/설정·양방향 friendships/pin hard delete(status·기존 soft delete 무관)·PII 순서와 단일 TX 유지. chat/realtime의 개인 읽음 커서는 user.withdrawn 내구 전달 뒤 로컬 tombstone·DELETE와 모든 cursor writer fencing을 같은 TX에 적용하며 위성별 완료를 확인 | 기존 AccountWithdrawalService 및 LLD 채팅 읽음 이력 파기 |
| FR08 | 탈퇴 후 신규7개 경로의 오류 우선순위를 하나로 고정: 만료·위조·타입 오류 자격은401, 서명이 유효한 옛 AT/RT라도 계정이 비활성이면 세션 폐기보다 우선해404 USER_NOT_FOUND, 활성 계정의 폐기 세션은401. 앱은 401을 refresh 흐름으로, DELETE /me 재시도의404를 탈퇴 확정으로 처리 | 신규 조회에도 활성 검사, 레거시 읽기창과 구분 |
| FR09 | notifications만 서버 동기화, 음량/음소거/진동/동작 줄이기는 기기 로컬 | 원본 설정 계약 |
| FR10 | 기존 soundEnabled/nightMode를 새1필드 PATCH가 덮어쓰지 않음 | 알림 서버 원자 부분변경과 내구 전달 |
| FR11 | 미지원 provider는 기존 400 UNSUPPORTED_PROVIDER를 보존. 제공자 6종의 *_TOKEN401과 refresh/logout의 REFRESH_TOKEN401도 각각 보존하고 제공자 자격 종류 오류와 분리 | 기존 AuthService·AuthErrorCode |

프로필의 수용 조건은 신규 PATCH와 legacy POST/PATCH /api/v1/users/me 모두에 적용한다. 공통 users 배타 잠금·변경 전후 판정·동일 TX outbox 경계에서 승인된 완료 판정 false→true의 `user.onboarded`와 실제 이름 변경의 기존 `user.displayNameChanged` 경로 위임을 포함한다. 프로필·receipt와 같은 TX에 outbox를 저장하고 rollback·동일 키 재생·중복/역순·탈퇴 후 지연 전달을 검증한다. 온보딩 전 점수의 주차별 절대 재적재와 공유 slug의 최신 표시 갱신을 기존 아키텍처대로 연결하며 Q03/Q04나 랭킹 제품 정책을 이 문서가 대신 정하지 않는다. 내부 사건 두 종류는 공개 7종/전체66종·섬 실시간14종에 추가로 세지 않는다.

## 범위와 검토 상태

이 티켓은 설계다. 실제 7종 통합 테스트·마이그레이션·서비스 배포는 후속1757의 책임이다. 현재 증거 동결의 판정 target 부재 skip은 탈퇴 완료 근거가 아니며, 필요한 증거 확정이 불가능하면 전체 TX를 롤백해야 한다. 최소 내기 정산 증거 보존을 원본 측정 이력 보존으로 확대하지 않는다. `catColor` 6종의 정확한 자산 목록, 기존 사용자 기본색/온보딩 승계, 실제 약관 문서 버전은 추가 입력이 필요하다. 최초 legacy 게스트 승격의 결과 복구는 현재 미구현이고, 복구창 및 창 밖 장기 실패 처리(Q06)와 응답 유실 검증 전 강제 전환을 출시하지 않는다. 소셜 재인증이나 신규 게스트 자동 생성으로 기존 게스트 자산의 복구를 대신했다고 주장하지 않는다. 제공자 자격 호환과 RT 전용 헤더 로그아웃은 기존 보안 의도를 보존하는 기술 결정으로 정했다. [정책의 결정 대기 표](policy.md#결정-대기)는 구현 gate이며 그 답을 문서의 샘플 값으로 대신하지 않는다.

배치 전체 정책 질문과 별개로 기존 닉네임 유일성·길이, 탈퇴 방장 위임, KST, RT 해시 보관, 로컬 설정 구분은 기존 정책을 유지하는 방향으로 먼저 문서화한다. 새로운 자산 승계·경제·공동소비 정책은 계정 스키마를 빌미로 결정하지 않는다.
