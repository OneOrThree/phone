# 섬 소속·탐색 — 상세 계약

> GROMO-1758 · 2026-09-12 · 정책 일부 미정인 검토 초안
> [PRD](./prd.md) · [HLD](./high-level-design.md) · [관리 LLD](../island-management/low-level-design.md)

## 1. 기존 코드 근거와 격차

코드 경로의 기준은 조사 시작 main `529a396e5f0f88cb78c172110920e1fa6b9388a9`다. `data/`는 `server/data-api/src/main/java/com/oneorthree/phone/` 축약이다.

| 근거 | 원문/사실 | 적용 방식 |
|---|---|---|
| `data/group/service/GroupService.java:115` | `MAX_JOINED_GROUPS = 10` | 신규 생성/즉시 가입/승인도 계정 소속 상한 검사 |
| 같은 파일 136~180 | createGroup, maxMembers 미입력10, OWNER 생성, 아직 코드 발급 | 그룹+OWNER 원자 생성 선례. currentIsland/승인방식/시설은 없음 |
| 같은 파일 307~366 | joinGroup: 활성 사용자·과거KICKED·상한·정원·password 후 rejoin/insert | 기본 규칙 유지. 초대 slug는 자격이 아니라 부가 attribution으로만 사용 |
| 같은 파일 859~864 | `@Deprecated generateUniqueCode()`; 8자 코드 | 코드 조회가 폐기됐다는 명시. 새 resolve로 연결만 하는 것은 복원 정책을 몰래 확정하는 것 |
| `data/group/repository/domain/GroupJoinCode.java:76~77` | renew는 ACTIVE와 now+3h | **옛 코드 사실**이지 새 초대 TTL 확정값 아님 |
| `data/group/repository/domain/Group.java:29~72` | groups, isPrivate, maxMembers, @Version | 동일 섬ID 사용. approvalRequired/current context/growth/theme 없음 |
| `data/group/repository/domain/GroupMember.java:39~40,112~118` | unique(user,group), 같은 행 rejoin | membership 이력과 현재 소속 구분. membershipEpoch는 별도 추가 기반 |
| `data/group/repository/GroupRepository.java:46~48` | `findByIdForUpdate` 존재 | 정원/마지막주민을 직렬화할 그룹 lock primitive 후보 |
| 같은 파일 76~94 | name trgm / createdAt순 공개목록, ENDED 미제외 | 검색 인덱스 재사용, 신규 생존필터·동률키·cursor는 추가 |
| `data/group/service/GroupService.java:471~508` | getGroupOverview 별도 공개 DTO | 새 PublicIslandSummary도 별도 whitelist. 기존 DTO의 미션 필드를 무심히 승계하지 않음 |
| `data/invitelink/service/InviteLinkService.java:69` | 발급 그룹·멤버 확인 후 기존 inviter 링크 재사용 | 링크 수명 정책 선례. main에는 문서 목표인 모든 revoke/epoch 검증이 다 있다고 가정하지 않음 |
| `data/group/dto/CreateGroupRequest.java` | 이름50/소개200/정원1~10, 개행·bidi 등 이름 검증 | 신규 이름/소개 검증 재사용; 새 DTO에 없는 password/maxMembers를 client가 주입하지 못함 |

기존 그룹 획득 문서는 private invite-only를 서버가 아직 보장하지 못한다고 명시한다. 신규 private 승인/가입의 보안조건은 새 계약에 맞춰 검증해야 하며 과거의 'slug 불일치면 무시하고 가입'을 초대 자격 검증에 재사용하지 않는다. 옛 공개/비공개·password의 승계 정책 미정은 임의 해제하지 않는다.

## 2. 값 타입과 공개 DTO

공통 HTTP 규약은 참고 티켓 1750 설계와 합류한다. 성공은 `{data:...}`, 실패는 `{error:{code,message,field,retryable},requestId}`다. X-Request-Id는 현재 시도와 연결한다. 이 문서가 main에 없는 공통 문서를 링크하거나 구현 완료라고 주장하지 않는다.

`Id`는 UUID, `Version`은 0~9007199254740991 안전 정수, `Instant`는 UTC ISO 문자열, `Cursor`는 공통 서명 opaque 토큰이다. 원본의 `soda`, `join-1`은 예시이며 실제 UUID 유효성 검증을 생략할 근거가 아니다. ThemeId/BuildingId/GrowthStage/AssetVersion은 소유 도메인의 불투명 문자열이다.

### PublicIslandSummary

필수 필드: `id:Id`, `name:string`, `intro:string`, `visibility:public|private`, `approvalRequired:boolean`, `memberCount:integer>=0`, `membershipStatus:none|pending|active`, `growthStage:string`, `themeId:string`.

`joinRequestId:Id?`를 본인 최신 신청 연결용으로 추가하는 **기술 설계 확장**이다. 본인의 최신 요청이 있으면 ID를, 없으면 null을 준다. 승인/거절/취소의 상세 상태는 본인 join-status 계약에서 읽는다. 자신의 archived 요청 존재를 다른 사용자에게 보여주지 않는다. pending 요청자도 role/관리 데이터를 받지 않는다.

방문 외관에 필요한 `assetVersion:string`·`buildingThemes:object<BuildingId,ThemeId>`를 상세 공개 DTO에서 추가할 수 있다. 아래 필드는 방문자 응답에 키 자체가 없어야 한다: `role`, `permissions`, `initialConstruction`, `constructionTarget`, 지갑/원장/보유품, focus/session/통계, 편지/읽음, 주민 개인 목록, 다른 신청자/가입코드. 초기 기여량은 경제 진행 데이터이므로 방문자에게 노출하지 않는다.

### MemberIslandDetail

PublicIslandSummary의 공통 표시 필드에 `role:host|member`, `buildings:BuildingId[]`, `assetVersion:string`, `initialConstruction:InitialConstruction?`, `constructionTarget:ConstructionTarget?`, `buildingThemes:object`, `version:Version`를 추가한다. 여기서 version은 `(island,islandId)`의 상태 축이다. 별도 외양 aggregate를 채택하면 외양 소유 설계에서 이름이 구분된 버전을 함께 제공해야 한다. island.version을 다른 aggregate의 version으로 무단 대체하지 않는다. `InitialConstruction={nextBuildingId,contributedFish,requiredFish}`는 건설 도메인의 정본 값이다. `ConstructionTarget`은 건설 도메인의 공개 DTO이며 이 초안에서 임의 구조/가격을 발명하지 않는다. 건설·테마 재료 계약 확정 전 해당 신규 상세 응답은 완성된 것으로 계산하지 않는다.

최초 hall→board의 고정 순서, board 완성 후 initialConstruction=null과 이후 constructionTarget 구분은 원본을 따른다. **초기 빈 섬에 hall을 샘플로 지어 주지 않는다.** 필요한 설정/자산 projection이 없으면 예시 숫자로 대체하지 않고 해당 기능 준비 상태를 드러낸다.

### 입력 공통

- 신규 create는 `name:string`, `approvalRequired:boolean` 필수, `intro:string` 선택(누락 시 빈 소개). 이름·소개는 기존 검증값 50/200과 이름 안전 문자 규칙을 재사용한다. 명시 null은400, 빈 이름/도메인 범위 위반은422. 저장 전 임의로 잘라 성공시키지 않는다.
- 초대 코드는 `InviteCode`라는 정책 value object로 다룬다. 구체 형식/대소문자 정규화/기간은 IM-D01~03 미정이다. 형식이 확정되기 전 샘플 `SODA`를 고정 길이4로 구현하지 않는다.
- 이 11종 중 create/join/switch/invite/join-cancel 변경 명령은 Idempotency-Key 필수. invite-resolve는 조회 성격이며 범용 명령 키 대상이 아니다. GET에도 변경 키를 요구하지 않는다.
- 원본에 없는 expectedVersion을 일괄 추가하지 않는다. 서버의 조건부 전이·DB 유일성·receipt가 동시성을 담당한다. 공개 version을 반환하는 것과 client expectedVersion을 받는 것은 별개다.

## 3. 계약 11종

### 3.1 create — POST /islands

입력 `{name,intro?,approvalRequired}`. 성공201 `{data:{id,membershipStatus:"active",role:"host",currentIslandId}}`.

새 groups 행 + 생성자의 OWNER membership + 초기 current context + 승인방식/빈 섬 기본 projection을 하나의 Data 명령으로 만든다. 생성자의 활성 계정/소속 상한을 검사한다. 원본대로 현재 섬을 새 섬으로 설정하므로 **기존 active/paused 세션이 있으면 생성으로 이동 가드를 우회하지 못하게409**. 첫 소속이면 출발 전망대 조건은 없다. 기존 섬에서 새 섬으로 바로 이동할 때의 출발 시설 조건은 switch와 같은 공통 guard를 적용한다. 생성만 하고 이동하지 않는 별도 동작을 임의 추가하지 않는다.

기본 정원 10/최대 소속 10은 기존 제한 유지안이다. 공개 여부 수정 UI가 없다는 원본과 기존 create 기본 공개를 따라 신규 create는 공개 섬으로 시작하는 출발안이며 승계/공개 정책 변경은 별도 명시한다. 초기 건설비·보상값은 여기서 정하지 않는다. 성공 시 island.updated와 island.members.updated를 outbox에 저장하고 조회/재시도에는 새 사건을 만들지 않는다.

### 3.2 islands — GET /islands

Query `q:string?`, `cursor:Cursor?`, `limit:integer=20`(1~100). 성공200 `{data:{items:PublicIslandSummary[],nextCursor:Cursor?}}`.

기본 접근은 로그인+현재 섬 전망대 해금. 첫 소속 발견은 discover, 코드 입력은 resolve를 사용하므로 이 검색의 시설 가드를 풀어 우회시키지 않는다. 이름 결과는 public·생존 그룹만. q가 비어 있으면 최신 생성 순, 이름이 있으면 trgm 거리+id 동률 키로 결정적 정렬한다. 필터·사용자·페이지 크기를 cursor scope에 고정한다.

이름/초대코드를 같은 입력에서 찾는 원본 요구를 위해 **정확 코드 히트와 이름 검색을 별도 분기**한다. 유효성 검증을 통과한 코드 히트가 있으면 그 섬 공개 요약 한 건만 반환하는 우선순위를 기술 제안으로 둔다. 비공개 이름 부분일치는 금지한다. 코드 결과에는 invitationToken을 넣지 않고 가입 전 resolve를 호출한다. 이 흐름은 IM-D01의 코드/slug 관계 결정 후 활성화한다. 일반 이름과 만료 코드의 문자열 충돌·검색 우선순위는 코드 형식 결정 시 계약 테스트로 고정한다.

### 3.3 island-discover — GET /islands/discover

Query `cursor:Cursor?`, `limit:integer=1`(1~100). 성공200 `{data:{items:PublicIslandSummary[],nextCursor:Cursor?}}`.

공개·approvalRequired=false·미소속·미삭제·미종료·실제 가입 가능 정원 후보를 무작위로 고른다. 현재 강퇴 이력으로 가입 불가능한 후보도 '즉시 가입 가능'이라고 표시하지 않는다. 진행 집중에 대한 이동 제한은 후보의 공개/가입방식과 별개이며 실제 가입 커밋에서 검증한다. 첫 소속 탐색은 전망대가 없으므로 search의 전망대 가드를 가져오지 않는다.

아래 §5의 고정 탐색 순서를 사용한다. 빈 결과는 items=[]/nextCursor=null. 한 명뿐인 섬도 후보가 될 수 있으며 전망대 랭킹 최소 2명과 섬 발견 조건을 섞지 않는다.

### 3.4 island — GET /islands/{islandId}

성공200 active 주민이면 MemberIslandDetail, 비소속이면 PublicIslandSummary 기반 외관 요약. 조회 시작에 사용자·섬·활성 membership을 확인하고 단일 읽기 snapshot에서 범위를 고른다. 그룹 종료/삭제는404, private 비소속 ID 직접 조회는403이다.

private 초대 resolve가 반환한 공개 요약은 초대 흐름에서 사용하되 이 GET에 토큰 없는 예외 권한을 만들지 않는다. `X-User-Id`, `role`, `isMember` query/header로 분기를 고를 수 없다. 읽기 캐시를 둘 때도 사용자·섬·권한 revision을 분리하며 공통 no-store를 기본으로 한다.

### 3.5 memberships — GET /me/islands

성공200 `{data:{items:PublicIslandSummary[],nextCursor:null,currentIslandId:Id?}}`. 원본 items와 nextCursor에 **본인 currentIslandId를 기술 확장**해 재실행 시 현재 선택을 식별한다. 현재 소속 상한10을 보존하는 동안 목록은 전량이며, 향후 상한 변경은 페이지 계약을 함께 개정한다.

활성 membership이더라도 종료/삭제 그룹은 반환하지 않는다. 목록 정렬은 membership 생성시각+id로 안정화하되 앱의 로컬 카드 순서를 이 API가 덮어쓰지 않는다. currentIslandId는 여전히 활성 소속인 섬 또는 null이다. 무효 context 처리 정책은 IM-D06 확정에 맞추고 권한 없는 대상을 그대로 표시하지 않는다.

### 3.6 switch — PUT /me/current-island

입력 `{islandId:Id}`, 성공200 `{data:{currentIslandId:Id}}`. 목적 섬은 본인의 활성 소속이어야 하고 생존해야 한다. 새 변경은 active/paused가 없어야 하며 첫 소속 이후 출발 섬 전망대가 필요하다. 같은 섬 PUT는 실질 이동이 없는 상태확인으로 처리하고 이벤트/새 membership을 만들지 않는다.

서버의 current context와 live session을 같은 직렬화 경계로 검사한다. 과거 성공의 receipt 재생이 최신 current context를 되돌려 쓰지 않는다. 재생 응답은 당시 성공결과이며 앱은 최신 화면 context를 재조회한다. `currentIslandId` 개인 선택 변경을 island.members.updated 가입/이탈로 방송하지 않는다.

### 3.7 join — POST /islands/{islandId}/memberships

입력 `{invitationToken:string?}`; 없으면 null. 성공200은 다음 판별 가능한 두 형태다.

- 즉시 가입: `{data:{status:"active",requestId:null,islandId,currentIslandId,version}}`.
- 승인 대기: `{data:{status:"pending",requestId,islandId,version}}`. pending 응답에는 currentIslandId를 새로 설정하지 않는다.

public/privacy/password/approvalRequired는 독립 축이다. 유효 초대가 있어도 강퇴 이력·정원·계정 상한·계정 활성을 우회하지 않는다. 초대가 승인을 우회하는지는 IM-D03 대기다. 승인제 pending을 만들 때 실제 자리를 예약하는지는 IM-D05 대기지만 승인 커밋의 정원 검사는 항상 필요하다.

이미 active이면 새 키의 신규가입은409, 같은 성공 receipt는 저장 결과 재생. 같은 사용자·섬의 pending 요청이 이미 있으면 같은 pending 자원 반환을 제안하며 DB 부분 유일성으로 중복을 막는다. terminal 뒤 새 요청 정책은 IM-D05를 따른다. 즉시 가입의 current 이동은 switch와 같은 guard. **pending 신청만 만드는 것과 실제 이동을 구분**하며 신청자 집중 상태만으로 UI 원격승인을 현재 섬 이동으로 바꾸지 않는다.

### 3.8 join-status — GET /me/join-requests/{requestId}

성공200 `{data:{id,islandId,status:pending|approved|rejected|cancelled,version}}`. 요청자 본인 소유 검사 `id+applicantId`로 읽는다. 남의 요청은404로 범위 밖임을 처리하고 개인정보를 반환하지 않는다. 승인 상태를 읽었다고 현재 섬을 변경하지 않는다.

### 3.9 join-cancel — DELETE /me/join-requests/{requestId}

본문 없음. Idempotency-Key 필수. 성공200 `{data:{id,status:"cancelled"}}`. 본인의 pending→cancelled만 신규 전이. 같은 명령 결과 재생은 허용하지만 이미 approved인 요청을 취소해 membership을 없애지 않는다. terminal 충돌409. 취소 시 가입 요청 version/outbox/receipt를 함께 저장한다. 실제 취소로 좌석을 반환할지 여부는 pending 예약 정책이 채택된 경우만 정의된다.

### 3.10 invite-resolve — POST /invitations/resolve

입력 `{code:InviteCode}`, 성공200 `{data:{island:PublicIslandSummary,invitationToken:string}}`. 인증된 요청자의 초대 해석이며 가입·현재 섬 변경·클릭 귀속 확정을 하지 않는다. 토큰은 불투명한 전달값으로 표시하고 로그/URL/query에 복사하지 않는다.

기존 링크 아키텍처의 서명 자격을 재사용한다: slug/groupId/inviterId/membershipEpoch/만료 등 정본 필드를 검증한 evidence를 Business가 Data 가입 명령에 싣는다. token에 client가 적은 islandId로 가입할 수 없고 group 일치·issuer 활성·epoch·만료를 Data TX에서 다시 확인한다. 구체 서명 format/audience/linkVersion 규칙은 내부 링크 계약과 일치시켜 중복 서명 체계를 만들지 않는다.

형식 오류422, 없음404, 만료/폐기410의 원본 도메인 의미를 유지한다. 정확 code 형식/TTL이 정해져야 validator가 완성된다. token 검증의 기술 TTL과 사용자 공유 code 수명을 혼동하지 않는다.

### 3.11 invite — POST /islands/{islandId}/invitations

본문 없음, Idempotency-Key 필수. 성공200 `{data:{code:InviteCode,url:string,expiresAt:Instant?}}`. 활성 주민만 발급한다. url은 실제 링크 서비스가 발급한 URL이며 `gromo.example` 예시를 운영에 하드코딩하지 않는다.

반복 발급의 동일 active초대 재사용과 이탈 후 새 버전이라는 기존 링크 수명은 보존한다. 새 코드 alias와 expiresAt=null 허용 정책은 IM-D01/02 확정 전 가정하지 않는다. 발급자 membershipEpoch가 변한 뒤 지연 발급이 active 초대를 되살리지 않도록 내부 링크 최대 epoch/version 계약을 따른다. 발급 그 자체는 island.updated/island.members.updated가 아니다.

## 4. 저장 모델과 원자 명령

아래는 논리 모델이다. 실제 테이블/컬럼명·migration 번호는 Data와 내부기반 담당이 기존 1659 추가분과 대조해 할당한다.

| 모델 | 키/불변식 | 기존과 관계 |
|---|---|---|
| Group | 기존 groups.id, 생존=(deletedAt=null AND status!=ENDED), maxMembers | approvalRequired와 성장/외양은 별도 소유 projection 또는 추가 필드. password 보존 |
| Membership | 기존 unique(userId,groupId), isLeft/leftReason, role | rejoin행 재사용. epoch는 이탈/강퇴/재가입 때만 증가, 역할/닉네임 수정으로 초대 무효화 금지 |
| JoinRequest | requestId, islandId, applicantId, status, version, createdAt/resolvedAt | pending에 대해 `(islandId,applicantId)` 부분유일성. terminal 이력과 재신청 분리 |
| UserIslandContext | userId PK, currentIslandId nullable, contextVersion | 새 영속 선택. 실제 FK 존재만으로 활성 membership을 보장하지 않아 TX 검증 필요 |
| DiscoverSession | 무작위 sessionId, ownerScopeDigest, filterDigest, orderedCandidateIds, expiresAt | 조회용 유한 수명 상태. 권한·정원 예약 아님 |
| Command receipt/outbox | 기존 내부 명령의 user/operation/key + fingerprint/result | 새 이름의 중복 receipt/outbox를 만들지 않음 |

### 직렬화 범위

1. **계정 소속 상한 및 현재 섬/집중**: 같은 사용자의 create/join/approve/context 변경/focus-start를 직렬화하는 공통 user/context aggregate가 필요하다. 사용자 공유 락만으로 동시 가입의 상한을 보장할 수 없다.
2. **섬 정원/마지막 주민**: 같은 섬의 즉시 가입/승인/rejoin/이탈/정원 변경/종료가 동일 group aggregate 잠금을 사용한다. membership 삽입마다 groups 행이 자동 갱신된다고 가정하지 않는다.
3. **요청 전이**: group/applicant 관계 확인 후 pending 상태를 조건부 갱신하거나 잠근다. 승인 membership 생성·요청 terminal·outbox가 같은 TX다.
4. **초대**: 발급자의 현재 membership과 group 상태를 잠근 상태에서 서명 자격의 epoch를 대조한다. Business의 사전 resolve 결과만 믿지 않는다.
5. **기존 경로**: legacy join/create/update/withdraw/account-withdraw/내기 경로도 같은 자원을 쓰므로 잠금 순서를 함께 검토한다. 새 경로만 잠그면 기존 writer가 정원을 우회한다.

전역 후보 순서는 `대상 users/context(ID 정렬) → groups(ID 정렬) → memberships/requests → 세션/정산 행 → 지갑`이다. 이는 **내부 기반에 합류할 설계 후보**이며 현재 모든 경로가 이 순서라는 뜻은 아니다. 기존 내기/계정 탈퇴의 `user → membership → bet → wallet`과 group 잠금 취득 위치를 대조하고 순서를 통일한 뒤 도입한다. 잠금 중 반대 순서로 새 사용자/섬을 찾아 잡지 않는다. 대상 키를 발견한 뒤 정렬해 전체 TX를 재시작하고 다시 검증한다. DB 경합 재시도는 전체 명령 단위이며, rollback된 TX에서 예외를 잡아 재조회하지 않는다.

### 멱등 재생

인증 주체·작업·실제 경로 자원과 키가 receipt 범위다. token 등 본문의 의미 fingerprint를 보존한다. 처음 Data가 확정한 current context는 receipt에 고정하고, 재시도 때의 currentIsland를 새 fingerprint로 혼합하지 않는다. 확정 결과 재생은 새 도메인 전이를 실행하지 않으며 현재 응답 재노출 인가를 통과해야 한다. 성공 자체로 실행 권한이 소멸하는 leave/transfer의 비민감 본인 명령 증거는 관리 LLD의 제한 재생 규칙을 따른다. 실패 4xx를 성공 receipt로 꾸미지 않는다.

## 5. 발견과 검색 cursor

공통 cursor 규약(참고 티켓 1750)은 기본 TTL 15분, 사용자 scope/filter/정렬/limit 서명, limit 1~100이다. 빈 cursor는400, 만료는409 CURSOR_EXPIRED, 위조·다른 사용자·필터 변경은400 INVALID_CURSOR다. 서명은 암호화가 아니므로 q 원문/code/개인 ID 목록을 그대로 토큰에 넣지 않는다.

discover 초기 요청은 유한한 후보 집합을 구성해 한 번 shuffle하고 서버의 조회 세션에 순서를 고정한다. cursor에는 무작위 세션 핸들과 경계 index를 서명한다. 매 페이지에서 후보 조건을 재검증하고 탈락한 후보는 건너뛰며 새 순서를 발급하지 않는다. 서버 조회 세션 TTL은 cursor보다 짧지 않고, 세션 만료는 같은 CURSOR_EXPIRED다. 후보 최대 수는 설정/부하 검증에서 정하며 전체 목록을 무한 저장하지 않는다. 후보 상한 안의 탐색이라는 계약이며 전역 모든 섬을 항상 빠짐없이 둘러본다고 표현하지 않는다.

정원은 예약하지 않으므로 발견 직후 다른 사람이 가입하면 실제 join에서409가 가능하다. 후보 세션이 존재해도 public→private/종료/강퇴 변화 후의 섬을 노출하지 않는다. 같은 cursor 재시도는 고정된 후보 순서와 경계에서 재평가하며, 결과가 보안상 제거될 수 있음을 허용한다. 이전 페이지는 클라이언트 보관용이며 과거 미리보기가 현재 가입 허가가 아니다.

이름 검색은 trgm 거리+ID 또는 createdAt+ID keyset으로 처리한다. 검색 q 정규화와 정렬 키가 cursor 발급/검증에서 같아야 한다. 검색어/탭/선택 섬/limit 변경은 첫 페이지부터 시작한다. q에 code가 들어올 수 있으므로 access log와 APM query 수집에서 민감값 마스킹이 필요하다.

## 6. 오류와 검증

신규 도메인 wire code의 구체명은 공통 code 등록과 합류한다. 여기서는 HTTP 의미를 정의하고 옛 코드를 자동 rename하지 않는다.

| 상황 | 신규 의미 | 검증 |
|---|---|---|
| 인증 없음/만료 | 401 | 외부 X-User-Id 위조 불가 |
| 현재 비소속/시설 미해금/private 무자격 | 403 | 역할·초대·시설 각 축 테스트 |
| 없는/종료/삭제 섬, 남의 신청 | 404 | 민감 DTO 포함 0건 |
| 정원/상한/이미 가입/처리된 요청/진행 중 이동 | 409 | 경합 중 한 전이만 성공, 후속 조회 정합 |
| 잘못된 범위/이름/코드 형식 | 422 | 길이·문자·enum 경계, 본문 가격/role 주입 거절 |
| 코드 만료/폐기 | 410 | expiresAt 경계·폐기·발급자 이탈·늦은 token |
| cursor 오류 | 공통400/409 | 사용자·필터·limit·서명·TTL |

실제 DB 통합 검증에는 마지막 자리 동시2가입, 동시 승인과 즉시 가입, 계정9소속에서 동시2가입, 승인과 취소/거절, 재가입 unique/epoch, 발급자 이탈과 초대 가입, 마지막 주민 이탈과 신규 가입을 포함한다. 현재 섬 이동과 focus-start/paused, 생성/가입을 통한 이동 우회, legacy/new writer 혼합도 검증한다.

공개 범위 검증은 비소속 응답에서 민감 필드의 값이 null인지에 그치지 않고 **키 부재**를 검사한다. private 이름 검색0건, 정확 code 검증, 다른 사용자의 requestId/current context 비노출, discover cursor 권한 재검증, 자격 검증 중 상류 실패가 허용으로 바뀌지 않음도 포함한다. 이 초안 작성에서는 테스트/빌드를 실행하지 않았다.

## 7. 이번 초안에서 확인한 결과

2026-09-12, 정본 contract-coverage.json의 참고 티켓 1759/1760/1762를 추출해 이 두 설계의 계약 ID·HTTP method·접두어 없는 path를 대조했다. **18/18개가 각각 한 번씩 상세 계약에 대응**한다. 두 디렉터리의 문서 7개에서 상대 링크 34개(제목 anchor 포함)가 존재함을 확인했고, Mermaid 블록 5개의 fence 짝도 확인했다. Mermaid의 실제 렌더링이나 구현 코드는 검증하지 않았다.

추가로 1750의 멱등/버전 입력 규칙, 1754의 세 사건 payload와 버전 축, 기존 Group/GroupMember/InviteLink 코드의 역할·정원·수명 선례를 대조했다. members snapshot version과 leave/transfer의 제한된 본인 성공 증거 재생은 공통 설계와 조정했다. 제품 결정 대기 항목은 PRD에 남아 있으며 이 결과가 해당 정책 승인이나 구현 완료를 뜻하지 않는다.
