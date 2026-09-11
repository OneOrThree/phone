# 섬 관리·주민 — 상세 계약

> GROMO-1761 · 2026-09-12 · 정책 일부 미정인 검토 초안
> [PRD](./prd.md) · [HLD](./high-level-design.md) · [권한 행렬](./permissions.md) · [소속 LLD](../island-membership/low-level-design.md)

## 1. 기존 코드와 변경 지점

`data/`는 `server/data-api/src/main/java/com/oneorthree/phone/`, 기준 main은 `529a396e5f0f88cb78c172110920e1fa6b9388a9`다.

| 근거 | 현재 동작 | 새 계약 적용 |
|---|---|---|
| `data/group/service/GroupMemberService.java:57` transferOwner | 두 사용자의 활성 상태를 검사한 뒤 role 교체. group_members가 정본 | 동일 섬 membership·현재 OWNER 검사를 직렬화. 자기/타섬/이탈 대상 거절 |
| 같은 파일 kickMember | OWNER 전용, 자기 강퇴 불가, KICKED 마킹, 내기 판돈 유지 | 새 집중/퀘스트 보상 정책까지 구현됐다고 보지 않음 |
| 같은 파일 withdrawGroup | 다인 OWNER는 HOST_WITHDRAW, 마지막 1인은 close, OPEN 내기 정리 | 기존 정책 유지. current context/live 세션/링크 epoch 연계 추가 |
| 같은 파일 detachWithdrawnUser | 계정 탈퇴의 방장 검사·내기 정리·membership 이탈 | 섬 나가기와 계정 삭제를 같은 명령으로 통합하지 않음. 지갑 삭제/통계 익명화 전 순서 유지 |
| `data/group/service/GroupService.java:641~675` updateGroup | OWNER 확인 후 이름/소개/정원/공개/password 수정 | 신규 manage는 name/intro/approvalRequired만. 기존 password/정원 기능 보존 |
| `data/group/repository/domain/GroupMember.java:39~40` | unique(userId,groupId), @Version 없음 | 행 존재만으로 활성 판정 금지. 역할/이탈 경합은 서버에서 직렬화 |
| `data/group/repository/GroupMemberRepository.java:128~133` | 이탈 연계 membership PESSIMISTIC_WRITE | 공통 잠금 기반 재사용. 새 승인/정원/위임까지 저절로 보장하지는 않음 |
| `data/group/repository/domain/GroupMember.java:162~163` | OWNER 또는 announcementPermission=ALLOW | 기존 공지 grant는 legacy 정본. 새 공지 권한 TBD로 기존 동작을 덮어쓰지 않음 |

main의 현 메서드가 참고 문서 목표인 모든 초대 폐기·권한 철회·집중 종료까지 구현했다는 뜻은 아니다. users 공유 락은 계정 삭제와의 직렬화 근거지만, 동시에 실행되는 두 역할 변경을 직렬화하는 충분조건은 아니다.

## 2. 공통 입력과 결과

Id/Version/Cursor/PublicIslandSummary는 [소속 값 타입](../island-membership/low-level-design.md#2-값-타입과-공개-dto)을 따른다. 성공은 data 봉투, 실패는 공통 error와 현재 requestId다. 기존 REST의 204 성공을 새 경로의 200 JSON과 혼동하지 않고, 전역 응답 필터로 기존 경로를 변경하지 않는다.

신규 manage/request-answer/transfer/kick/leave는 Idempotency-Key 필수, GET은 불필요다. **이 7종에 원본에 없는 expectedVersion을 추가하지 않는다.** 상태·역할·유일성·CAS는 Data에서 검사하고 응답/이벤트의 version은 그 결과를 나타낸다.

관리 입력 name은 기존 50자 및 안전 문자 검증, intro는 200자다. PATCH에서 필드 누락은 미변경, 명시 null은400이며 소개를 비우려면 빈 문자열을 보낸다. 빈 name은422, approvalRequired는 boolean만 받는다. role/memberCount/wallet/growth/password/isPrivate/maxMembers처럼 이 계약 밖 필드로 권한·시설·옛 잠금을 변경하지 못한다. 빈 PATCH는 기존 부분 수정 선례대로 no-op 성공이며 version/outbox를 불필요하게 올리지 않는다.

아래 응답에서 원본에 추가하는 `version`, manage의 `intro`, requests의 `applicantId`와 cursor는 **기술 설계 확장**이다. 새로운 제품 권한이나 expectedVersion 입력을 도입한다는 뜻은 아니다. members의 목록 version은 실시간 무효화와 재연결 시점의 주민 스냅샷을 비교하는 데 필요하다.

## 3. 계약 7종

### 3.1 manage — PATCH /islands/{islandId}

입력 `{name?:string,intro?:string,approvalRequired?:boolean}`. 성공200 `{data:{id,name,intro,approvalRequired,version}}`. 현재 host만 실행할 수 있고 섬 생존을 확인한다. version은 `(island,islandId)` 축이다. 승인 방식 변경이 과거 pending 요청을 자동 승인/거절하지 않는다. 기존 요청은 명시적으로 처리하거나 별도 정책 변경을 거쳐야 한다.

그룹 상태 변경과 island.updated/outbox를 같은 TX에 저장한다. **name의 실제 값이 바뀌면** 같은 TX에서 링크 대상 `group.renamed` outbox도 기록한다. 기존 `GroupService.updateGroup` → `LinkMembershipEventService.recordGroupRenamed`와 [링크 표시정보 갱신 정본](../../architecture/service-architecture.md)의 계약을 재사용한다. 링크는 코어를 조회할 수 없으므로 island.updated만으로 기존 slug의 랜딩 이름을 갱신할 수 없다. 각 활성 발급자에 groupId/inviterId/groupName/snapshotVersion을 기록하고 기존 링크 멤버십 aggregate/relay의 버전 대조로 늦은 이름이 최신 이름을 덮지 않게 한다. 표시정보 변경은 membershipEpoch를 올리지 않으며 이탈한 발급자의 멤버십을 복원하지 않는다. 같은 키 재생은 같은 결과, 새 키 no-op은 새 사건을 만들지 않는다. 늦게 도착한 이전 host의 새 요청은 현재 역할 검사에서403이다. 필드별 업데이트로 미전달 설정을 보존한다. 결과 intro는 기존 description이 null이어도 공개 매퍼에서 빈 문자열로 반환하며 DB의 기존 null을 변경할 필요는 없다.

### 3.2 members — GET /islands/{islandId}/members

Query `{cursor?,limit?}` 기본30/상한100. 성공200 `{data:{items:[{id,name,catColor,role}],nextCursor,version}}`. id는 사용자 ID, role은 host/member다. active 주민만 조회할 수 있고 나간/강퇴된 membership 및 삭제 계정은 목록에서 제외한다.

version은 `(island.members,islandId)`의 주민/역할 목록 버전이며 응답 행들과 같은 읽기 snapshot에서 얻는다. 일반 island.version이나 가장 큰 개별 membership version으로 대체하지 않는다. 다음 페이지에서 목록 version이 달라지면 클라이언트는 기존 페이지를 합쳐 완성된 snapshot이라고 간주하지 않고 첫 페이지부터 갱신한다.

membership.createdAt+membership.id의 안정 정렬과 동률 키를 사용한다. cursor에는 islandId+요청자 scope+정렬/limit digest를 고정한다. 현 정원10이어도 페이지 형식을 유지한다. 반환 프로필은 공개 이름/catColor뿐이며 계정 연결 provider·이메일·재화·알림 설정·초대 epoch를 넣지 않는다.

### 3.3 requests — GET /islands/{islandId}/join-requests

Query `{cursor?,limit?}` 기본30/상한100을 원본 빈 query에 **유한 목록 확장**으로 추가한다. 성공200 `{data:{items:[{id,applicantId,name,status:"pending",version}],nextCursor}}`. 신청자 목록은 현재 host 전용이고 pending만 반환한다. 정렬은 createdAt+requestId다. 처리된 요청의 관리 감사 조회를 임의 탭/상태 filter로 늘리지 않는다.

각 item의 version은 해당 `(join.request,islandId,requestId)` 축이다. 한 요청의 높은 version으로 다른 요청의 이벤트를 버리지 않는다. 재연결 시 목록을 다시 읽고 도중에 받은 신청 이벤트로 목록을 무효화한다. 페이지를 모두 읽는 동안 신청 변화가 생겼다면 dirty 상태를 유지하고 다시 조회한다. 이벤트를 받은 뒤 시작한 재조회는 Data 정본에서 읽는다. 그 조회에서 terminal 요청이 pending 목록에 없음을 확인하면 삭제 무효화를 해소할 수 있다. 지연 replica의 누락이나 과거 페이지의 부재만으로 dirty 상태를 해소하지 않는다.

다른 섬 requestId나 신청자를 합쳐 조회하지 않는다. BFF에서 비host에게 이 조각을 제공하지 않기로 했으면 사전에 조회를 생략한다. 실제403 응답을 일반 optional 실패라며 빈 신청 목록으로 숨기지 않는다.

### 3.4 request-answer — PATCH /islands/{islandId}/join-requests/{requestId}

입력 `{decision:approve|reject}`. 성공200 승인 `{data:{status:"approved",memberId,version}}`, 거절 `{data:{status:"rejected",memberId:null,version}}`. memberId는 사용자 ID다. 원본에 없는 거절 예시의 memberId는 null로 명시한다. version은 해당 요청 버전이다.

공통으로 현재 host 권한과 request.islandId 일치, pending 상태를 검사한다. 신청자 계정 활성, 과거 KICKED/기존 membership/소속 상한/정원 검사는 **approve에만** 적용한다. reject는 가입 자격이나 남은 자리와 무관하게 pending 요청을 정리할 수 있다. approve는 요청 approved 전이와 membership 생성 또는 재활성화, 주민 version/outbox를 한 TX에서 커밋한다. 요청만 먼저 approved로 만들지 않는다. 신청자가 다른 섬에서 집중 중에 원격 승인을 받아도 **currentIslandId는 바꾸지 않는다**. 현재 섬으로 이동하는 시점에 별도 switch 가드를 사용한다.

초대 기반 pending 승인은 [소속 LLD의 초대 증거/커밋 규칙](../island-membership/low-level-design.md#초대-기반-pending과-실제-가입-커밋)을 추가로 적용한다. 저장된 invitationEvidenceRef의 원 서명·그룹·발급자 활성 membership·현재 epoch·폐기/만료를 membership TX에서 재검증한다. 승인 유지/우회 선택(IM-D03)은 아직 미정이며 이 증거 검증을 생략할 근거가 아니다. 유효 초대 승인에는 같은 TX의 link.joined, 실제 pending claim이 있으면 Data 확정 레코드와 link.claimConfirmed outbox가 필요하다.

reject는 membership을 만들지 않고 요청 terminal 상태와 join.request.updated를 남긴다. 같은 키는 기존 결과를 재생하고, 다른 키로 이미 terminal인 요청을 처리하면409다. approve와 cancel/reject 경합에서 한 전이만 승리한다. 승인 시 신청자의 상한과 섬 정원은 사전 snapshot이 아니라 잠금 아래 다시 판정한다.

### 3.5 transfer — POST /islands/{islandId}/host-transfer

입력 `{targetUserId:Id}`. 성공200 `{data:{hostUserId:Id,version}}`, version은 주민/역할 목록 축이다. 현재 host가 본인 아닌 동일 섬 active 주민에게만 위임한다. 자기 자신 위임은409, 비소속/이탈/삭제 대상은404, 현재 host가 아닌 요청은403이다. 대상 사용자의 부재를 요청자의 인증 실패로 바꾸지 않는다.

이전 OWNER→MEMBER와 대상 MEMBER→OWNER를 같은 TX에서 적용한다. 해당 섬의 동시 위임/강퇴/계정 탈퇴와 직렬화하며 최종 활성 OWNER가 한 명임을 검증한다. DB 보조 제약으로 활성 OWNER 한 명의 부분 유일성을 검토하되 UPDATE 순서·기존 데이터 정합성·계정 탈퇴 경로와 함께 migration해야 한다. 현재 DB에 이미 그 제약이 있다는 뜻은 아니다.

membershipEpoch는 이탈/재가입 자격 축이므로 단순 위임 때 올리지 않는다. 이전 host가 active 멤버로 남으면 그가 발급한 링크를 폐기하지 않는다. 주민 이벤트와 내부 권한 변경 제어를 내구화하고 현재 방장 개인 신청 큐를 새 권한에 맞춰 갱신한다.

### 3.6 kick — DELETE /islands/{islandId}/members/{userId}

본문 없음. 성공200 `{data:{removed:true}}`. 현재 host, 같은 섬 active 대상, 자기 자신이 아님을 검사한다. 자기 강퇴409, 권한 없음403이다. 동일 성공 키는 결과를 재생한다. 별도 새 키의 대상 부재는404이며 아무 대상이나 지워졌다고 성공 처리하지 않는다.

이탈 마킹 isLeft/KICKED, epoch 증가, 주민 version, 링크 폐기/outbox, Realtime 권한 철회 제어, 현재 context 상실 처리를 한 명령 경계로 묶는다. DB 상태와 내구 제어자료를 원자 저장하고 실제 외부 철회 전달은 커밋 후 수행한다. 소속 상실 시 개인 자산·완료 기록은 삭제하지 않는다. 기존 내기 판돈 유지 규칙은 보존한다.

**대상의 진행 집중/휴식·새 미수령 보상 분기는 §5의 결정 전에는 미완료**다. 사용자 질문 없이 강퇴를 모든 경우409로 영구 정책화하거나 자동 완료 보상을 발명하지 않는다.

### 3.7 leave — DELETE /islands/{islandId}/memberships/me

본문 없음. 성공200 `{data:{left:true}}`. 본인 활성 membership, active/paused 진행 세션 없음이 필수다. 다인 host는 위임 필요409, 마지막 1인이면 그룹 ENDED로 전이한다. 기존 OPEN 내기 참가 정리/환불 규칙과 순서를 유지한다.

상태 전이·현재 context 무효화·membershipEpoch·초대 폐기 제어·outbox를 같은 TX에 묶는다. 마지막 주민 판정은 동시 가입/승인과 직렬화한다. 이미 나간 상태에서 다른 키로 호출하면 현재 미소속403이며, 앱은 본인 소속 조회로 사후조건을 확인해 안전하게 복귀할 수 있다. 불명확한404를 모두 성공으로 접지 않는다. 같은 성공 키의 제한된 명령 증거 재생은 §4에서 다룬다.

마지막 주민 이탈로 ENDED가 되는 경우에는 같은 TX에 `island.members.updated` 외에 `island.updated`와 링크 대상 `group.closed` outbox를 반드시 기록한다. 발급자별 `link.revoked`가 group.closed를 대신하지 않는다(장부 ㋢). 공개 projection의 종료 상태와 링크 landing/match 폐기가 모두 같은 중앙 종료에 수렴하도록 기존 버전/relay 규칙을 사용한다.

같은 그룹 잠금 아래 남아 있는 모든 pending JoinRequest를 기존 terminal 상태 `cancelled`로 전이하고 내부 `terminalReason=island_closed`, resolvedAt과 요청별 version을 기록한다. 신규 상태 enum을 만들지 않는다. 신청 생성/approve/cancel도 같은 그룹 생존/잠금 경계를 사용하므로 종료 스캔 뒤 pending이 새로 남지 않는다. 각 신청자에게 비민감 `{requestId,applicantId,status:"cancelled",version}`의 join.request.updated 개인 전달 outbox를 같은 TX에 저장한다. 종료 후에는 현재 host 수신자가 없으므로 옛 host/주민 토픽에 요청 상세를 보내지 않는다. 신청자는 그룹 조회가404여도 본인 join-status에서 cancelled를 확인하여 대기를 끝낼 수 있다. 실패하면 ENDED/멤버십/요청 terminal/모든 outbox를 함께 rollback한다. 계정 탈퇴나 legacy 마지막 이탈로 닫히는 경우에도 동일 종료 primitive를 재사용한다.

현재 선택 섬을 잃은 뒤 대체 섬 선택은 소속 IM-D06 결정 대기다. 이미 다른 섬을 현재로 쓰고 있다면 그 선택을 이탈 명령이 null로 덮지 않도록 조건부 갱신한다.

## 4. 권한·잠금·재생 불변식

공통 규약은 [소속 저장 모델](../island-membership/low-level-design.md#4-저장-모델과-원자-명령)을 따른다. 클라이언트 expectedVersion 입력이 없어도 DB에서 오래된 권한 행사를 허용하지 않는다.

- 모든 관리 writer가 동일 group/member 직렬화 경계를 공유한다. users 공유 락만으로 두 위임의 OWNER 검사 경합이 닫히지 않는다.
- 가입 승인은 신청자 user의 소속 상한과 group 정원을 모두 잠금 아래 검사한다. 처리자 host만 잠그면 신청자의 동시 다른 섬 가입을 막지 못한다.
- 계정 탈퇴와 사용자 A/B 역할 변경은 user key 정렬 순서를 공유한다. group close/이탈/내기 정리의 기존 락 취득과 반대 순서가 되지 않도록 내부 기반 담당이 전체 경로를 대조한다.
- 성공 응답과 외부 사건 전달은 커밋 후에만 한다. Data TX 안의 outbox가 relay 복구 정본이다. 여러 원자 쓰기를 Business의 별도 HTTP 호출로 나누지 않는다.
- membership 존재, 계정 활성, 그룹 생존을 각각 본다. isLeft=false라도 삭제 사용자면 주민 수/방장 projection에 포함하지 않는다.
- 주민 목록 version, 일반 island.version, 초대 membershipEpoch, 개인 contextVersion은 별도 축이다. 같은 섬의 최대 version 하나로 다른 자원의 사건을 버리지 않는다.

### 권한 변경 뒤 receipt 재생

확정 receipt의 재생은 새로운 위임/이탈 실행이 아니다. 인증된 동일 사용자·operation·자원·키·fingerprint를 검사하고, 현재 version을 이유로 과거 성공을 실패로 바꾸지 않는다. 다만 지금 권한이 없는 초대 code나 관리자 전용 신청 정보는 재노출하지 않는다.

`leave` 성공 뒤 본인의 `{left:true}`, `transfer` 성공 뒤 본인의 `{hostUserId,version}`는 성공 자체가 원 실행 권한을 없애는 경우다. 이 두 결과에 한해 **활성 사용자 본인의 비민감 명령 증거를 제한 재생**한다. 새로운 권한 행사와 내부 상태 조회를 허용하지 않고, 계정 삭제/인증 상실까지 허용하는 특례로 넓히지 않는다. 참고 티켓 1750과 합의한 자원 권한 상실 후의 제한 재생 규칙이며 구현 시 공통 replay guard에 반영해야 한다. 감사용 원 응답 전체를 그대로 재생하는 일반 허용으로 확대하지 않는다. 다른 명령의 민감 응답은 현재 응답 재노출 권한을 확인한다.

## 5. 이탈·강퇴와 세션/보상 결정 표

| 조건 | 근거와 main 구현 상태 | 신규 분기 처리 상태 |
|---|---|---|
| 자진 탈퇴 + active 집중 | 원본409 신규 요구. main withdrawGroup에는 집중 검사 없음 | 1762에서 같은 잠금 아래 집중 가드를 추가하고 거절, 종료 확인 후 재시도 |
| 자진 탈퇴 + paused 휴식 | 신규 진행 세션 불변식. main 미구현 | active와 같은 가드를 새로 구현. 휴식을 세션 종료로 위장하지 않음 |
| 다인 host 자진 탈퇴 | 기존 HOST_WITHDRAW | 먼저 위임. 위임 성공 뒤 탈퇴 실패는 위임 rollback이 아님 |
| 마지막 주민 탈퇴 | 기존 group ENDED | 동시 가입/승인과 직렬화, 모든 그룹 초대 만료 |
| 강퇴 + 완료 집중/개인 확정 보상 | 강퇴는 계정 삭제가 아님 | 개인 완료 기록/자산/확정 원장 유지 |
| 강퇴 + active/paused | 새 섬 세션 연동 규칙 없음 | **정책 대기**. 서버 시각의 원자 종료+개인 확정 보상 보존 추천, 임의 산식 적용 금지 |
| 미수령 퀘스트 공동 보상 | 기존 내기와 다른 도메인 | **정책 대기**. 회차 자격 기준/분모/중도 이탈을 퀘스트 정본에서 확정 |
| 자진 탈퇴 + 기존 OPEN 내기 | 기존 releaseFromOpenBets | 같은 TX의 정리/허용 환불 유지 |
| 강퇴 + 기존 내기 판돈 | 기존 kick은 판돈 유지 | 기존 정산/환불 엔진에 맡김. 새 퀘스트로 변환 금지 |
| 계정 탈퇴 | 별도 AccountWithdrawalService | 지갑 삭제·통계 익명화 전 내기/멤버십 정리 순서 유지 |

링크 발급자 이탈/강퇴 폐기는 기존 설계에 채택된 목표이고 기준 main의 resolveLanding/match/claim/join이 모두 발급자의 현재 멤버십을 검사하는 상태는 아니다. 1659 선행 통합 후에도 1762는 모든 발급/상환/실제 가입 경로의 membershipEpoch와 현재 활성 멤버십 검사를 대조하고, 이탈 TX의 link.revoked outbox 및 지연 발급 차단을 실행 검증해야 한다. 기존 구현을 보존하는 것만으로 이 요구가 완료되지 않는다.

정책 대기 분기는 TBD 역할 행렬과 함께 출시 조건으로 남긴다. 보상 정책이 없다는 이유로 인가 철회 자체를 무시할 수 없다. 구현은 기능 비활성 또는 아직 지원하지 않는 분기를 명시하고, 활성화 전 집중 종료 TX·현재 context·outbox를 원자적으로 결합해야 한다.

## 6. 공개 결과·이벤트·로그

manage는 island.updated를 기록하고 실제 name 변경에는 같은 TX의 링크 대상 group.renamed를 추가한다. intro/approvalRequired만 바뀌거나 이름이 같으면 group.renamed는 만들지 않는다. 승인/위임/강퇴/탈퇴는 island.members.updated, 요청 생성/처리는 join.request.updated를 발행한다. 마지막 주민 이탈/그룹 종료에는 island.updated와 링크 대상 group.closed를 추가하고 pending의 cancelled 전이마다 신청자 개인 join.request.updated를 함께 기록한다. 초대 근거의 즉시 가입/승인은 link.joined, 실제 pending claim의 확정은 link.claimConfirmed를 같은 membership TX에 기록한다. 거절은 주민 수가 바뀌지 않으므로 불필요한 members 사건을 만들지 않는다. GET은 이벤트를 생산하지 않는다. 공개 Realtime 사건의 payload.version은 해당 envelope.aggregateVersion과 일치해야 한다. 링크 대상 내부 outbox는 기존1659 봉투/version·transition 계약을 그대로 따르며 공개 Realtime 봉투로 바꾸지 않는다.

공개 members 사건은 `{islandId,version}`, join.request 사건은 `{requestId,applicantId,status,version}`이다. 요청 이벤트 수신자는 본인과 현재 host만이며 이를 일반 섬 events 토픽으로 보내지 않는다. 초대 폐기/세션 철회/개인 current context 제어는 신뢰된 내부 자료로 분리한다.

권한 상실 차단의 경계는 최종 프레임 인가 검사다. 이미 네트워크로 전송된 프레임 회수나 DB 커밋과 TCP 송신의 분산 원자화를 약속하지 않는다. 캐시 TTL 만료를 기다리는 방식만으로 탈퇴자/이전 방장 차단이 완성됐다고 표시하지 않는다.

운영 로그는 requestId/commandId/eventId, operation, resultCode, latency, 경합 이유를 남긴다. 가입 신청자 프로필·초대 code/token·편지/집중 subject·보상 원장 본문은 남기지 않는다. 역할·scope 인가 거절은 조사에 필요한 최소 식별자만 감사 정책에 따라 기록하고 메트릭 label에는 넣지 않는다.

## 7. 검증과 완료 판정

| 검증 묶음 | 필수 케이스 |
|---|---|
| 권한 행렬 | 확정 행의 host/member/visitor·pending/다른 섬 host·삭제 계정; TBD를 허용으로 계산하지 않음 |
| 요청 IDOR | 다른 섬 requestId, 남의 own-request, 타섬 targetUserId, 이전 host의 새 요청403 |
| 승인 경합 | 만원·신청자 소속 상한 도달 중에도 reject 성공, approve/reject/cancel 중 한 승자, 마지막 자리 승인/즉시 가입 중 한 승자, 신청자 상한과 동시 가입 |
| 위임 경합 | 동시 두 위임, 위임 vs 대상 탈퇴/계정 삭제/강퇴, 자기 위임, 활성 host 정확히1명 |
| 이탈 경합 | 마지막 주민 leave vs join/approve/pending 생성, pending 전건 cancelled 및 개인 알림, group.closed/island.updated 원자 기록·rollback, leave vs focus-start/pause/resume, legacy/new writer 혼합 |
| 이름 변경·동일 이름·intro만 변경·receipt 재생·relay 역순 | 실제 이름 변경 TX에만 group.renamed, 재생 신규 사건0, 기존 slug의 최신 이름 유지, membershipEpoch 불변; outbox 실패 시 그룹 변경도 rollback |
| 초기/빈/오류 | 이름 null/빈 값/bidi/길이, 미전달 필드 보존, 빈 PATCH no-op, 같은 성공 receipt 재생, 다른 본문409 |
| 목록/이벤트 | 같은 snapshot의 members version, 재연결 중 신규/삭제 주민과 요청, 페이지 간 version 변경, 다른 aggregate의 높은 version |
| 링크 | pending 이후 발급자 이탈/링크 폐기/만료/epoch 변경의 승인 거절, 초대 즉시가입·승인의 joined/claimConfirmed 원자 저장·응답유실 복구, 발급자 이탈 후 늦은 발급/가입 거절, 단순 위임 링크 유지, 재가입 새 epoch, 폐기의 내구 재전달 |
| 실시간 | 이전 host의 신규 신청 프레임 차단, 탈퇴/강퇴자의 보호 프레임 차단, 모든 노드 캐시/구독 정리, 토큰 만료 |
| 보상 | 기존 내기 회귀, 개인 확정 원장 보존, 새 정책 결정 후 진행 세션/회차별 검증 추가 |

문서 검증은 18계약 coverage, 참조 링크, 역할 표와 본문 일치, 기존/추가/미정 구분이다. 이 작업은 문서 초안이며 코드 실행·빌드·테스트 통과·정책 승인 완료를 뜻하지 않는다.
