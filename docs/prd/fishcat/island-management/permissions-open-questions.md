# 권한 행렬 TBD — 결정표

> GROMO-1803 · 2026-09-17 · [권한 행렬](./permissions.md) · [PRD](./prd.md) · [LLD](./low-level-design.md)

**이 문서는 결정문이 아니다.** 각 빈칸의 선택지와 그 결과를 정리해 재영님이 고를 수 있게 만든 표다.
[권한 행렬](./permissions.md)의 `TBD`는 여기서 지우지 않는다 — 결정이 내려진 뒤 그 표에 값을 적고
이 문서의 해당 절을 「확정」으로 닫는다. 미정 칸을 「방장만」이나 「모두」로 자동 확정하지 않는다는 것은
[PRD](./prd.md)의 명시 조건이다.

## 1. 지금 열려 있는 것 — 4행 8칸 + 표에 없는 1건

| # | 행 | 위치 | 열린 칸 | 소유 문서의 미결 ID | 권한 이름 |
|---|---|---|---|---|---|
| 1 | 건설 실행 | `permissions.md:30` | 방장·주민 | 건설 `policy.md` **P-D01** | 미정 |
| 2 | 퀘스트 작성/수정 | `permissions.md:31` | 방장·주민 | 퀘스트 `policy.md` **QQ04** | 미정 |
| 3 | 공지 작성/수정/삭제 | `permissions.md:32` | 방장·주민 | 게시판 `policy.md` **BQ01** | 미정 |
| 4 | 공동 상품 구매 | `permissions.md:33` | 방장·주민 | 상점 `policy.md` **S02** | `SHARED_PURCHASE` (예약됨) |
| — | **댓글** | **행 없음** | — | 게시판 `policy.md` **BQ02** | 미정 |

방문자 열은 네 행 모두 이미 `거절`이다. 열려 있는 것은 방장·주민 두 열뿐이다.
「공동 테마 적용」(`permissions.md:34`)은 GROMO-1909 가 이미 확정했다 — 결정 대상이 아니다.
티켓 서술과 어긋나는 지점은 전부 §6 에 모았다.

## 2. 선택지가 실제로 뜻하는 비용 — 레포에 있는 네 계열

권한 이름은 표의 행과 1:1 이지만 **새 인가 계층을 만든다는 뜻이 아니다**(`permissions.md:11~14`).
레포에 이미 존재하는 판정 모양은 넷이고, 「설정 가능」이 **두 종류**라는 점이 중요하다.

### 계열 A — 「방장만」: 새 컬럼·마이그레이션 0

역할 비교 한 줄. 스키마가 늘지 않는다. 레포에서 가장 흔한 모양이고 **실패 코드도 하나로 통일**돼 있다 —
`group/exception/GroupErrorCode.java:20` `NOT_OWNER(HttpStatus.FORBIDDEN, "그룹장만 수행할 수 있습니다.")`.

현행 OWNER 게이트 전량(`server/data-api/src/main/java/com/oneorthree/phone/` 기준):

| 파일:줄 | 메서드 | 막는 행동 |
|---|---|---|
| `group/service/GroupService.java:690~691` | `updateGroup` | 그룹 정보 수정 |
| `group/service/GroupService.java:745~746` | `getGroupSettings` | 권한 설정 **조회** |
| `group/service/GroupService.java:787~788` | `updateGroupSettings` | 멤버별 공지권한 부여/회수 |
| `group/service/GroupService.java:573~574` | `renewGroupCode` (@Deprecated) | 참가 코드 재발급 |
| `group/service/GroupChallengeService.java:446~447` | `createChallenge` | 챌린지 생성 |
| `group/service/GroupChallengeService.java:746~747` | `deleteChallenge` | 챌린지 삭제 |
| `group/service/GroupChallengeService.java:791~792` | `endChallenge` | 챌린지 종료 |
| `group/service/GroupBetQueryService.java:208~209` | `getDeletionPreview` | 삭제 미리보기 |
| `group/service/GroupMemberService.java:79~81` | `transferOwnerAndRecord` | 방장 위임 |
| `group/service/GroupMemberService.java:111~113` | `kickMember` | 주민 강퇴 |

방장의 단일 원천은 `group_members.role = OWNER` 다 — `groups.host_id` 는 V7 에서 드롭됐다
(`db/migration/V7__user_blocks_drop_deprecated.sql:26`).

**비용: 0.** 서비스 메서드에 `if (role != OWNER) throw new GroupException(NOT_OWNER)` 한 줄.

### 계열 B — 「방장 + 멤버별 부여」: 멤버 단위 컬럼 + 마이그레이션 + 설정 API

레포에 선례가 **정확히 하나** 있다 — 공지다. `group_members` 의 14개 컬럼 중 grant 성격은 이것 하나뿐이다.

- 판정: `group/repository/domain/GroupMember.java:251~252`
  `return role == GroupMemberRole.OWNER || announcementPermission == GroupAnnouncementGrant.ALLOW;`
- enum: `group/repository/domain/GroupAnnouncementGrant.java:6~11` — `DISALLOW`(기본)·`ALLOW`
- 컬럼: `GroupMember.java:94~97`, 기본값 `DISALLOW`
- 스키마: `server/data-api/docs/db/schema.dbml:780`
- 마이그레이션: `V7__user_blocks_drop_deprecated.sql:15` (ALTER ADD COLUMN) + `:16~19` (CHECK 제약)
- 부여/회수: `GroupService.java:810~812` — `updateGroupSettings` 안의 항목별 upsert.
  방장 행은 건너뛰고(`:803` `.filter(role != OWNER)`), 탈퇴자도 제외한다(GROMO-1220)
- 재가입 초기화: `GroupMember.java:178` `rejoin()` 이 `DISALLOW` 로 되돌린다

**비용**: 마이그레이션 1건(ALTER + CHECK) · enum·엔티티 필드 · 부여/회수 경로 · 설정 조회 응답 확장 ·
재가입/강퇴/위임 시 초기화 규칙 · **그 권한을 편집하는 앱 화면**.

> **이미 한 번 비싸게 배운 자리다.** 공지 권한은 모양이 세 번 바뀌었다 —
> `groups.notice_permission`(섬 단위 스코프, `V1__baseline.sql:269`) →
> `group_notice_grants`(별도 grant 테이블, `V1__baseline.sql:241`) →
> `group_members.announcement_permission`(멤버 단위 인라인 컬럼). 앞의 둘은 V7 이 드롭했고
> (`V7:24`, `V7:31`), 기존 grant 는 **이관하지 않고 전원 DISALLOW 로 초기화**했다(`V7:2`, `V7:14`).
> 새로 계열 B 를 고르는 행이 생기면 별도 grant 테이블을 만들지 말고 이 컬럼 모양을 따른다.

### 계열 B' — 「섬 단위 스코프 설정」: 섬당 한 값, 멤버 컬럼 없음

**계열 B 와 혼동하기 쉬운 별개의 선례다.** 초대 권한이 이 모양이다.

- `schema.dbml:734` `invite_permission group_permission_scope [not null, default: 'OWNER_ONLY']`
- `group/repository/domain/Group.java:140` `private GroupPermissionScope invitePermission = GroupPermissionScope.OWNER_ONLY;`
- enum: `group/repository/domain/GroupPermissionScope.java:9` — `OWNER_ONLY`, `ALL_MEMBERS`

이 enum 의 Javadoc(`GroupPermissionScope.java:5`)이 두 계열의 차이를 직접 기록해 뒀다:
*"공지 작성 권한은 멤버 단위라 이 범위가 아니라 `GroupAnnouncementGrant` 를 쓴다."*

**비용**: 마이그레이션 1건(`groups` 에 컬럼 1개) + 설정 토글 하나. **계열 B 보다 싸다** —
멤버별 목록 UI·재가입/강퇴 초기화 규칙이 필요 없다. 「방장만 vs 주민 전체」를 섬마다 고르게 하고 싶은데
「특정 주민만」까지는 필요 없다면 **이쪽이 맞는 모양**이다.

### 계열 C — 「주민 누구나」

역할 검사 없이 활성 주민 확인만 한다. 표에 이미 이 값인 행이 둘 있다 —
「초대 발급」(`permissions.md:26`)과 「공용 곡 변경」(`permissions.md:36`, *원본은 누구나 변경 확정*).

**비용 0.** 다만 **되돌리기가 불가능한 방향**이다 — 나중에 좁히면 이미 쓰던 주민이 권한을 잃는다.
GROMO-1909 가 A01 을 방장만으로 고른 근거가 정확히 이것이다(외양 `policy.md:38`).

### 결정이 늦어도 코드는 멈추지 않는다 — 하드 게이트 선례

정책 미정인 경로를 상수 하나로 막아 두는 모양이 이미 있다 —
`focus/support/FocusRewardPolicyGate.java:27~29` `public static boolean isOpen() { return false; }`.
`V58__focus_session_lifecycle.sql:62~64` 가 *"보상 정책(FR-D01~06)이 미확정이라 지급 경로가 비활성이고,
이 표는 아직 쓰는 코드가 없다"* 고 남겼다. 이 표의 TBD 행도 같은 방식으로 저장·동시성까지 만들어 두고
실행만 닫아 둘 수 있다.

## 3. 목업이 이미 그리고 있는 그림 (서버 정책 승인 아님)

앱 목업은 역할 게이팅을 **리듀서 한 곳의 허용목록**으로 모아 뒀다 —
`app/app-dev/src/services/model.ts:1107~1120`:

```
const hostOnly = ['MANAGE','KICK','TRANSFER','ADD_MEMBER','REJECT_MEMBER','CAPACITY',
  'QUEST_SAVE','NOTICE_SAVE','NOTICE_DELETE','SELECT_BUILDING','BUILD'];
```

| 행동 | 목업 값 | 근거 |
|---|---|---|
| 공지 작성·삭제 | **방장만** — 멤버별 부여 개념이 아예 없다 | `model.ts:1428`·`:1449` |
| 퀘스트 작성 | **방장만** | `model.ts:1377` *"일일 퀘스트: 방장이 만들고 수정한다"* |
| 건설 목표 선택·실행 | **방장만** (이중 가드) | `model.ts:1284`·`:1302`, `model.ts:754` *"방장만 건설할 수 있어요."* |
| 공동 구매 | **주민 누구나** (`joinedOnly` 목록) | `model.ts:1121~1134` |
| **댓글 삭제** | **방장 또는 본인** | `model.ts:1468` + 주석 `:1467` *"방장은 모든 댓글을, 주민은 자기 댓글만 지운다"* |

목업에는 **섬 단위 잔액이 있다**(`model.ts:294` `balance = i.fish ?? i.contribution + i.points`).
건설(방장)과 구매(아무 주민)가 같은 잔액을 깎는다(`model.ts:1305`·`:1498`).

**목업은 서버 현행과 두 곳에서 어긋난다**: ① 서버 공지에는 멤버 단위 위임이 **있다**(목업엔 없다),
② 서버에는 섬 공용 잔액이 **없다**(목업엔 있다). 그래서 목업을 그대로 정책으로 채택할 수 없다 —
게시판 `policy.md` B03·상점 `policy.md:38` 이 이미 같은 경고를 적어 뒀다.

## 4. 행별 결정표

### 4.1 공지 작성/수정/삭제 (`permissions.md:32` · BQ01 · 막는 티켓 GROMO-1771)

**이 칸은 코드가 이미 답을 갖고 있다.** 새로 만들 것이 아니라 표에 적는 일에 가깝다.

현행 동작(legacy, 운영 중) — 세 경로가 **같은 단일 판정**을 쓴다:

| 동작 | 서비스 | 컨트롤러 | 판정 |
|---|---|---|---|
| 작성 | `GroupAnnouncementService.java:58` | `GroupController.java:117~118` | `canWriteAnnouncement()` 실패 → `NOTICE_FORBIDDEN` |
| 수정 | `GroupAnnouncementService.java:115` | `GroupController.java:190~197` | 같음 |
| 삭제 | `GroupAnnouncementService.java:140` | `GroupController.java:202~208` | 같음 |

**작성자 본인 검사가 없다.** 클래스 Javadoc(`GroupAnnouncementService.java:24~26`)이 명시적 결정으로 적어 뒀다:
*"권한은 방장이거나 `announcement_permission=ALLOW` 인 멤버이고, **수정·삭제도 작성자 본인 여부를 보지 않는다**:
권한만 있으면 남의 공지도 손댈 수 있다."* 권한 통과 후의 조회(`:120`·`:145` `findByIdAndGroup`)는
**작성자 가드가 아니라 섬 범위 가드**다. 실패 코드는 `GroupErrorCode.java:55` `NOTICE_FORBIDDEN`.
게시판 `policy.md` B02 와 `high-level-design.md:35` 가 같은 내용을 legacy 정본으로 기록해 뒀다.

| 선택지 | 결과 | 구현 비용 |
|---|---|---|
| **B-1. 현행 유지** — 방장=허용, 주민=설정 가능(`announcementPermission`), 타인 공지도 수정·삭제 | 신규 API 가 legacy 와 같은 규칙. 1.x·2.0 사이 권한 역전이 없다. 신규 목업의 「방장만」은 표시일 뿐 서버 정책이 아니게 된다 | **0.** 컬럼·마이그레이션·부여 API·재가입 초기화가 전부 이미 있고 동작 중. 신규 경로가 `canWriteAnnouncement()` 를 그대로 호출 |
| B-2. 방장만 (목업과 일치) | 목업과는 맞지만 **legacy 경로는 그대로** 둬야 하므로(`permissions.md:16`) 같은 데이터에 두 규칙이 붙는다. 이미 ALLOW 를 받아 쓰던 주민이 신규 화면에서만 못 쓴다 | 0 (컬럼을 안 쓰면 됨). 대신 **두 규칙 공존을 문서·테스트로 영구 관리**하는 비용이 남는다 |
| B-3. 주민 누구나 | 가장 넓다. `announcementPermission` 컬럼이 죽은 코드가 된다 | 0. 되돌릴 수 없음(계열 C) |
| B-4. 삭제만 작성자 본인으로 좁힘 | 「남의 공지 삭제」 사고를 막는다 | **신규 분기.** 현행에 작성자 검사가 없으므로 추가 + legacy 회귀 테스트. 작성자 `user` 가 nullable 이라(B04) 탈퇴자 공지의 삭제 주체를 따로 정해야 한다 |

**추천: B-1 (현행 유지).** 근거 — ① 컬럼·부여 API·재가입 초기화까지 이미 다 있고 운영 중이다.
② BQ01 자체가 *"기존 OWNER/ALLOW와 타인 수정·삭제 유지 권고"* 로 같은 값을 권고한다.
③ `permissions.md:16` 가 *"기존 legacy API의 현재 grant/권한을 이 표의 TBD 때문에 바꾸지 않는다"* 이므로
B-2·B-3 는 어차피 legacy 를 못 바꾸고 규칙만 둘로 쪼갠다.
**표에 적을 값은 「방장 허용 / 주민 설정 가능」**, 권한 이름은 기존 `announcementPermission` 을 그대로 쓴다 — 새 이름을 만들지 않는다.

### 4.2 공동 상품 구매 (`permissions.md:33` · S02 · 막는 티켓 GROMO-1781)

`island/village_points` 를 쓰는 공동 지갑 차감이다(상점 `policy.md:26`).

**근거 없음 — 섬 공동 지갑은 서버에 없다.** 오늘 포인트는 전부 **유저 1:1** 이다:
`user/repository/domain/UserWallet.java:26~39`(PK `user_id`), `schema.dbml:332`·`:1271`,
`currency/service/CurrencyLedgerService.java:51~60` 의 `WalletOwner{CALLER,TARGET}` 는 **둘 다 유저**다.
`currency_transactions` 도 `user_id` 축이라(`schema.dbml:1348`) 기존 그룹 내기조차 **유저 지갑 사이**로만 돈을 옮긴다.
`groupWallet|island_point|group_point|sharedWallet` 전수 grep 0건.
따라서 이 행은 어느 쪽으로 결정하든 **지갑·원장 신설이 선행**이고, 권한 결정이 만드는 비용 차이는
「멤버 단위 컬럼 1개」 또는 「섬 단위 컬럼 1개」뿐이다.

| 선택지 | 결과 | 구현 비용(지갑 신설분 제외) |
|---|---|---|
| **P-1. 방장만** | 공동 재화 유출 경로가 한 명이다. 주민은 상점을 보되 구매 버튼이 `available=false`. 나중에 넓히기 쉽다 | 계열 A — 0 |
| P-2. 주민 누구나 | 목업이 그리는 모습(`model.ts:1121~1134`, 상점 `policy.md:38` *"원본은 주민 누구나인 목업"*). 방장 부재에도 섬이 돌아간다. 주민 1명이 공동 잔액을 다 쓸 수 있다 | 계열 C — 0. 되돌릴 수 없음 |
| P-3. 섬 단위 스코프 설정 (`OWNER_ONLY`/`ALL_MEMBERS`) | 섬마다 운영 방식을 고른다. 기본값을 `OWNER_ONLY` 로 두면 P-1 로 시작해 섬이 스스로 넓힌다 | 계열 B' — `groups` 컬럼 1개 + 토글 1개 |
| P-4. 방장 + 멤버별 부여 | 「이 주민만 구매 가능」까지 | 계열 B — 멤버 컬럼 + 목록 UI + 초기화 규칙 |

**추천: P-1 (방장만).** 근거 — ① 공동 지갑을 만드는 것과 **동시에** 열어야 하는데, 가장 좁게 열고
필요하면 넓히는 것이 되돌릴 수 있는 유일한 방향이다(GROMO-1909 A01 이 쓴 논리와 같다).
② 상점 `policy.md:30` 이 *"방장이 공동 상품을 구매해도 물건 주인은 방장 계정이 아니다"* 로
**결제자와 소유자를 이미 분리**해 놨으므로, 방장만 결제해도 자산은 섬 것이다 — 주민이 손해 보지 않는다.
③ P-4 는 아직 아무 데이터도 없는 기능에 멤버별 설정 화면부터 만드는 일이라 이르다.
**P-1 이 부담스러우면 차선은 P-3** — 초대 권한이 쓰는 모양 그대로라 새 개념이 없고, 기본값을 좁게 둘 수 있다.
**표에 적을 권한 이름은 `SHARED_PURCHASE`** — 상점 `policy.md:38`·`low-level-design.md:201` 이 이미 그 이름을 기다린다.

> 주의: 이 행의 값을 「공동 테마 적용」(`SHARED_APPEARANCE`, 방장만)에서 자동으로 베껴 오지 않는다.
> 외양 `policy.md:61~63` 이 *"두 권한은 별개"* 라고 못박았다. 값이 같아지더라도 **따로 결정한 결과**여야 한다.

### 4.3 건설 실행 (`permissions.md:30` · P-D01 · 막는 티켓 GROMO-1767)

같은 `island/village_points` 를 쓴다(건설 `policy.md` C05). 목표 선택(PUT)은 항상 차감 0 이고(C03),
실제 차감은 건설 실행(POST)이다. **서버에 건설 구현은 없다** — 엔티티·테이블·서비스·엔드포인트 전무.
예약된 것은 비활성 테이블의 컬럼 하나뿐이다(`V58__focus_session_lifecycle.sql:73` `construction_fish_added`,
`focus/dto/session/FocusFinishView.java:36`).

| 선택지 | 결과 | 구현 비용 |
|---|---|---|
| **C-1. 방장만** (목표 선택·건설 실행 둘 다) | 마을 발전 방향을 한 명이 정한다. 주민은 GET options 에서 `selectable=false` + 사유를 본다 — 이 조회 동작은 C08 이 이미 정의해 뒀다. 목업과 일치(`model.ts:754`) | 계열 A — 0 |
| C-2. 주민 누구나 | 아무나 300~500P 를 쓴다. 「회관→게시판→전망대/우체통→상점」 단계 그래프(C01)가 합의 없이 진행된다 | 계열 C — 0. 되돌릴 수 없음 |
| C-3. 목표 선택은 주민, 건설 실행은 방장 | 주민이 원하는 걸 제안하고 방장이 결제한다. 차감 0 인 PUT 과 차감하는 POST 를 갈라 놓은 C03 의 구조와 맞는다 | 계열 A ×2. 행이 하나에서 **둘로 쪼개진다** — 표에 「건설 목표 선택」 행을 추가해야 한다 |
| C-4. 섬 단위 스코프 설정 | 섬마다 | 계열 B' — `groups` 컬럼 1개 |

**추천: C-1 (방장만), 단 C-3 를 같이 물어봐야 한다.** 근거 — ① 4.2 와 **같은 지갑**이므로 같은 값을 주는 것이
*"공동 소비 5행의 답변은 한 정본"*(`permissions.md:48`)에 맞는다. ② 목업이 이미 방장만이고 이중 가드까지 걸어 뒀다.
③ C-3 는 제품적으로 더 나을 수 있다(주민 참여감) — 다만 그건 표에 **행을 하나 더 만드는** 결정이라
구현 비용 문제가 아니라 제품 판단이다. **근거 없음**: 목표 선택을 주민에게 열어야 한다는 서술은 원본·목업·문서 어디에도 없다.
④ 건설 `policy.md:40` 이 *"방송기 100P 확정은 공유 돈을 누가 쓸 수 있는지까지 확정하지 않는다"* 로
가격과 권한을 분리해 뒀으므로, 권한만 정해도 P-D03(실제 가격)은 따로 남는다.

### 4.4 퀘스트 작성/수정 (`permissions.md:31` · QQ04 · 막는 티켓 GROMO-1773)

**작성/수정과 보상 수령(claim)은 다른 권한이다.** QQ04 가 *"원본 claim 은 주민 요청·서버 판정이며
관리자만으로 임의 축소하지 않는다"* 로 claim 을 이미 주민 쪽에 묶어 놨다. 열려 있는 것은 **작성/수정**뿐이다.

선례가 직접적이다 — 퀘스트는 기존 챌린지의 후신이고, `createChallenge` 는 **방장만**이다
(`GroupChallengeService.java:446~447`, 실패 `NOT_OWNER`). 퀘스트 `low-level-design.md:209` 가 그 줄을 명시로 인용한다.
삭제·종료도 같은 게이트다(`:746~747`, `:791~792`). **서버에 퀘스트 구현은 없다** — DTO 필드
(`focus/dto/session/FocusFinishView.java:21` `questProgress`)와 이벤트 이름
(`realtime/event/RealtimeEventType.java:12` `QUEST_PROGRESS_UPDATED`)만 예약돼 있고 생산 로직이 없다.

| 선택지 | 결과 | 구현 비용 |
|---|---|---|
| **Q-1. 방장만** | 기존 챌린지와 같은 정책 — 1.x 사용자가 겪는 변화가 없다. 목업과도 일치(`model.ts:1377`). 퀘스트는 섬 전체에 목표를 부과하고 village_points 를 지급하므로(Q05) 아무나 만들면 보상 남발이 된다 | 계열 A — 0. 기존 코드 모양 재사용 |
| Q-2. 주민 누구나 | 참여감은 높지만 활성 4개 상한(기존 제약)을 누가 소진할지 경쟁이 생긴다 | 계열 C — 0. 되돌릴 수 없음 |
| Q-3. 섬 단위 스코프 설정 | 섬마다 | 계열 B' — `groups` 컬럼 1개 |

**추천: Q-1 (방장만).** 근거 — ① 기존 챌린지가 이미 방장만이고 퀘스트가 그 자리를 대신한다.
넓히는 건 언제든 되지만 좁히면 쓰던 사람이 잃는다. ② 퀘스트 작성은 **보상 지급 의무를 섬 지갑에 만든다**
(Q05: owner=섬, currency=village_points) — 4.2/4.3 과 같은 「공동 재화를 쓰는 행동」 범주다.
③ QQ04 가 요구하는 *"새 공통 권한 질문 답과 일치시켜야 함"* 을, 공동 소비 3행을 같은 값으로 두어 만족시킨다.

### 4.5 댓글 — 표에 행이 없다 (BQ02 · 막는 티켓 GROMO-1771)

티켓은 「댓글 작성 권한과 삭제 정책」을 완료 조건에 넣었는데 `permissions.md` 에 댓글 행이 없다
(`grep 댓글 permissions.md` → 0건). 실제 상태는 둘로 갈린다.

- **작성 권한은 이미 닫혀 있다.** 게시판 `policy.md` B01: *"주민만 읽기/댓글, 게시판 완공 후 접근.
  방문자는 거절"* — 원본 6계약에서 온 확정 규칙이다. 결정이 필요 없고 **표에 행만 추가하면 된다**
  (방장 허용 / 주민 허용 / 방문자 거절 + 조건 「게시판 완공」).
- **삭제·파기 정책은 열려 있다** — BQ02. 권한 행렬 칸 하나가 아니라 네 가지 묶음이다:
  ① 삭제 주체, ② 공지 삭제 시 달린 댓글 처리, ③ 계정 탈퇴 후 댓글 원문 보존 여부,
  ④ 댓글 DELETE 엔드포인트를 이번 범위에 넣을지.

①(삭제 주체)의 선택지:

| 선택지 | 결과 | 구현 비용 |
|---|---|---|
| M-1. 본인만 | 가장 좁다. 부적절한 댓글을 방장이 못 지운다 — 신고/차단 경로가 따로 필요해진다 | 작성자 비교 한 줄 |
| **M-2. 본인 + 방장** | 섬 운영이 가능하다. **목업이 이미 이 규칙이다** | 작성자 비교 ∨ OWNER — 한 줄 |
| M-3. 공지와 동일 (`canWriteAnnouncement()` 재사용) | 판정이 하나로 통일된다. 대신 ALLOW 받은 특정 주민이 남의 댓글을 지운다 | 0 — 기존 메서드 호출 |

**추천: M-2 (본인 + 방장).** 근거 — ① **목업에 이미 있는 유일한 「본인 또는 방장」 규칙**이다:
`model.ts:1468` + 주석 `:1467` *"방장은 모든 댓글을, 주민은 자기 댓글만 지운다"*. 발명이 아니라 채택이다.
② 댓글은 공지와 달리 **주민 전원이 쓰는 글**이라, 공지 권한(ALLOW 받은 특정 주민)이 남의 댓글을 지우는 M-3 는 과하다.
③ M-1 은 운영 수단이 0 이라 부적절한 댓글에 대응할 길이 없다. `user_blocks` 테이블은 V7 에 신설돼 있으나
*"기능 로직은 별도 티켓"*(`V7:4`)이라 차단으로 대체할 수 없다.

**단 ②③④ 는 별도 답이 필요하다.** BQ02 가 *"본문/사용자FK/프로필 사본/receipt·outbox 의 파기 범위를
함께 결정하기 전 댓글 writer 출시 금지"* 라고 걸어 놨으므로, **삭제 주체만 정해서는 1771 이 열리지 않는다.**

## 5. 결정이 늦어지면 못 나가는 것

설계 티켓 **1766·1770·1772·1780·1782 는 전부 「완료」**이고, 구현 티켓들이 「해야 할 일」에서 이 표를 기다린다.

| 막힌 티켓 | 내용 | 걸린 절 | 결정 없이 할 수 있는 것 |
|---|---|---|---|
| GROMO-1767 | 건설 3종 구현 | 4.3 | 비용 publication·조회 골격까지. 목표 PUT/건설 POST 는 비활성(건설 P-D01) |
| GROMO-1771 | 공지·댓글 6종 구현 | 4.1 · 4.5 | 저장/동시성/receipt 까지. writer 활성화 금지(게시판 B03·BQ02) |
| GROMO-1773 | 퀘스트 5종 구현 | 4.4 | 거의 없다 — QQ01~05 가 함께 닫혀야 새 생산 데이터를 만든다 |
| GROMO-1781 | 상점 5종 구현 | 4.2 | 카탈로그·조회. 공유 변경은 `SHARED_PURCHASE` 제공자 없이 불가(상점 `low-level-design.md:201`) |
| GROMO-1783 | 외양 4종 구현 | **없음** | 공동 테마 적용은 GROMO-1909 가 확정했다. 남은 블로커는 외양 A02 뿐이라 이 표 소관이 아니다 |

- **4.1(공지)은 결정 비용이 사실상 0** 이다 — 코드가 답을 갖고 있어 먼저 닫으면 1771 의 절반이 바로 풀린다.
- **4.2·4.3·4.4 는 같은 공동 지갑을 쓰는 한 묶음**이라 한 번에 같은 값으로 답하는 것이
  `permissions.md:48`(「공동 소비 5행의 답변은 한 정본」)에 맞는다.
- 4.2·4.3 은 권한을 정해도 **섬 공동 지갑이 없어서** 바로 열리지 않는다 — 지갑 신설이 별도 선행이다.

## 6. 티켓(GROMO-1803) 서술과 실제가 다른 지점

| # | 티켓이 적은 것 | 실제 | 영향 |
|---|---|---|---|
| 1 | 경로가 `docs/prd/island-management/permissions.md` | `docs/prd/`**`fishcat/`**`island-management/permissions.md` | 문서가 `docs/prd/<product>/<feature>/` 로 재편됐다(`docs/README.md`). 본문·산출물 위치 둘 다 틀렸다 |
| 2 | 「공동 테마 적용 권한을 확정한다 (1782)」 | **이미 확정** — GROMO-1909(PR #782, 머지), 값 「방장만」, 이름 `SHARED_APPEARANCE`(`permissions.md:34`, 외양 `policy.md:38`) | 완료 조건 1건이 이미 충족. 이 행을 다시 결정 대상에 올리면 안 된다 |
| 3 | 「댓글 작성 권한과 삭제 정책을 확정한다 (1770)」 | 표에 **댓글 행 자체가 없다**. 작성은 B01 이 「주민만」으로 이미 고정, 남은 건 삭제·파기(BQ02) | 「TBD 칸을 채운다」가 아니라 「행을 새로 만든다」 + 「표 밖 정책 3건을 정한다」 |
| 4 | 「TBD 를 0건으로 만든다」 | TBD 는 **4행 8칸**. 4.3 에서 C-3 를 고르면 행이 **늘어난다**(건설 목표 선택 분리) | TBD 0 이 곧 행 수 유지는 아니다 |
| 5 | 막는 티켓 5건 (1767·1771·1773·1781·1783) | **1783 은 이미 안 막혀 있다** — 공동 테마 적용이 확정됐다 | 이 표가 실제로 막는 것은 4건 |
| 6 | 「출처: 1770·1780·1782 의 미완 완료조건」 | 건설(1766)·퀘스트(1772)도 같은 표를 기다린다 — P-D01·QQ04 | 출처 2건 누락 |
| 7 | 예상 0.5d | 4.1·4.5 는 코드·문서에 답이 있어 짧지만, 4.2·4.3 은 **섬 공동 지갑이 코드에 아예 없어** 결정의 무게가 다르다 | 결정 자체는 짧아도 「무엇을 결정하는지」의 범위가 티켓보다 넓다 |

문서 쪽 오기도 있다 — `low-level-design.md:19` 가 `GroupMember.java:162~163` 을 공지 판정 근거로 적었는데
현재 위치는 `GroupMember.java:251~252` 다. 같은 표의 `GroupService.java:641~675`(updateGroup OWNER 검사)도
현재는 `:690~691` 이다. LLD 가 기준으로 박아 둔 main(`529a396e`) 이후 파일이 움직였다.

## 7. 근거 없음 — 지어내지 않은 것

- **섬 공동 지갑(`island/village_points`)의 서버 구현**: 없다. 지갑은 `user_wallets` 1:1 뿐이고
  `group_wallet|island_point|shared wallet` 전수 grep 0건. 권한을 정해도 지갑·원장은 별도로 만들어야 한다.
- **서버의 건설·퀘스트 구현**: 없다. 비활성 테이블(`focus_settlements`)의 컬럼과 DTO 필드·이벤트 이름만 예약.
- **건설 목표 선택을 주민에게 열어야 한다는 제품 근거**: 원본·목업·문서 어디에도 없다(4.3 C-3).
- **실제 가격표**: 방송기 100P 만 확정(건설 C02). 300/400/500 은 예시다(P-D03).
- **퀘스트 보상 amount**: 10P 는 목업(Q05·QQ05). 운영값 미확정.
- **아이템 마스터 데이터**: 레포에 없다 — 마이그레이션 INSERT 0건·시드 없음(외양 `policy.md:39`).
