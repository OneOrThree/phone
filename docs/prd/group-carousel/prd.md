# PRD — 내 그룹 카드 덱: 카드 플립 방 요약

| 항목 | 내용 |
| --- | --- |
| 상태 | **v0.8** — 카드 플립·기기 로컬 순서·사용자별 `내 카드 아이콘`·기존 리그 API 재사용 계약 확정 |
| 작성일 | 2026-08-08 |
| 티켓 | GROMO-XXXX (미배정) |
| 선행 | 그룹 3차 A-9: 소속 1개부터 항상 목록 |
| 한 줄 | `카드 탭 → 같은 자리에서 뒤집기 → 방 요약 확인 → 집중 또는 전체 방` 흐름을 내 그룹의 제품 정본으로 제공한다. |

> 문서 세트
>
> - [IA.md](./information-architecture.md) — 화면·상태·정보 구조
> - [UX-Design.md](./ux-design.md) — 제스처·모션·상태·접근성
> - [HLD.md](./high-level-design.md) — 컴포넌트·데이터 흐름·API 경계
> - [LLD.md](./low-level-design.md) — 구현 계약·DTO·제스처 중재·테스트
> - [design-mockup-flip.html](./design-mockup-flip.html) — 제품 정본: 같은 카드 플립 방 요약
> - [design-mockup-shared.js](./design-mockup-shared.js) — 단일 목업이 사용하는 공용 reorder handle 모듈

---

## 0. 결정 요약

### 0.1 확정한 제품 구조

내 그룹의 1건 이상 분기는 **가로 페이지형 카드 덱**으로 제공한다. 사용자가 카드 본문을 탭하면 같은 자리에서 뒷면으로 뒤집어 방 요약을 보여준다. 뒷면의 `이 그룹으로 집중`은 해당 그룹을 선택한 집중 흐름으로, `방 전체 보기`는 전체 화면 `GroupRoom`으로 이동한다.

다음 시각·조작 조건도 제품 계약으로 고정한다.

- 카드 앞면 배경: 전 그룹 **`#5E6AD2` 고정**
- 개인 카드 구분 단서: 현재 `userId`가 **이 기기에서만** 고르는 `내 카드 아이콘` 1개
- 캐러셀 크기·peek·인디케이터
- 우상단 공용 `ReorderHandle` 직접 drag/drop
- 헤더의 그룹 찾기·만들기
- 글로벌 하단바와 그룹 전용 하단바

### 0.2 현실성 전제

작성 시점의 실제 행동 표본은 **0명**이다. 행동 기준선, 그룹 수 분포, 전환율, 재방문율, 리텐션 데이터가 없다. 또한 현재 리그 조회 대상인 `is_deleted=false AND is_guest=false` 사용자는 100명 미만이다. 이 운영 규모 전제 안에서 이미 라이브 정보를 내려주는 전역 리그 top100 응답을 재사용한다.

따라서 이 문서는 다음을 약속하지 않는다.

- 리텐션·재방문·체류시간 상승
- 그룹 생성·참여·집중 시작 전환율 상승
- 소속감 또는 몰입감 향상
- 출시 전 사용성 확인만으로 성장 효과를 단정하는 것

지금 확인할 수 있는 것은 과업 이해도, 제스처 충돌, 상태 안정성, 접근성, 구현 비용이다. 사업 효과는 실제 사용자가 생겨 행동 기준선과 판단 가능한 표본이 확보된 뒤 별도 PRD에서 정의한다.

---

## 1. 배경과 제품 판단

### 1.1 현행

현재 앱의 내 그룹은 `GroupListScreen`의 세로 `FlatList`다. 그룹을 탭하면 `onSelect(groupId)`를 통해 전체 화면 `GroupRoom`으로 이동한다. 목록 응답은 이름, 인원, 역할, 공개 여부 등 최소 정보만 제공한다.

### 1.2 해결 방향과 확인할 리스크

1. 큰 카드에 그룹 이름·공개 여부·인원·내 카드 아이콘을 함께 배치해 현재 기기에서의 그룹 구분 단서를 제공한다.
2. peek와 인디케이터로 가로 이동 가능성을 전달한다. 그룹 수와 화면 폭에 따라 탐색성이 달라지므로 320·390·430·768pt에서 1·5·6·7·10개 상태를 출시 전에 확인한다.
3. 카드의 뒷면 요약으로 캐러셀 맥락을 유지한다. 한 단계가 추가되므로 카드 탭 결과와 전체 방 CTA가 오해되지 않는지 확인한다.
4. 고정 배경과 12개 로컬 아이콘으로 제작 범위를 제한한다. 같은 그룹도 사용자·기기마다 다른 아이콘으로 보일 수 있으며, 그룹의 공용 프로필이나 정체성으로 취급하지 않는다.

---

## 2. 목표, 기대점, 판단 기준

### 2.1 목표

- 확정된 카드 플립 구조를 제품 목업과 구현 계약에 일관되게 반영한다.
- 사용자가 설명 없이 카드 탭 결과를 이해하는지 확인한다.
- 플립 뒷면에서 오늘 필요한 정보와 다음 행동을 빠르게 찾는지 확인한다.
- 생성 시 `내 카드 아이콘`을 고르고, OWNER·MEMBER 모두 그룹 설정에서 자신의 이 기기용 아이콘을 바꿀 수 있게 한다.
- 구현 전에 데이터·접근성·계측 계약을 고정한다.

### 2.2 현실적인 기대점

| 기대점 | 지금 확인 가능한 효과 | 확인 방법 |
| --- | --- | --- |
| 그룹 구분 단서 | 같은 배경에서도 이름·공개 칩·이 기기에서 고른 아이콘으로 카드를 구분할 수 있음 | 첫 노출 이해 질문 |
| 맥락 보존 | 플립 후에도 같은 카드와 캐러셀 위치를 인지할 수 있음 | 앞면→뒷면→앞면 과업 |
| 요약 탐색 | 현재 집중 인원, 챌린지 목록, 공지 1개를 찾을 수 있음 | 정보 찾기 과업 |
| 행동 분기 | 집중 시작과 전체 방 보기의 차이를 이해하고 원하는 CTA를 선택함 | 상황별 행동 선택 과업 |
| 로컬 아이콘 결과 예측 | 생성·내 카드 아이콘 설정에서 선택한 값이 현재 계정·기기의 카드에만 표시됨 | 아이콘 선택→저장→재실행 과업 |

### 2.3 출시 전 사전 통과 기준

| 영역 | 사전 통과 기준 |
| --- | --- |
| 플립 발견 | 안내 없이 카드 탭으로 요약을 열고 앞면으로 돌아감 |
| 요약 이해 | 현재 집중 인원, 챌린지 목록, 최신 공지를 정확히 찾음 |
| 행동 선택 | 주어진 상황에서 `집중`과 `방 전체 보기`를 구분해 선택 |
| 전체 방 왕복 | 전체 방에 들어갔다가 같은 그룹·같은 뒷면으로 복귀 |
| 내 카드 아이콘 | 생성 시 선택값을 생성된 `groupId`에 로컬로 연결하고, 역할과 관계없이 설정에서 변경·재실행 복원·다른 계정 격리를 확인 |

### 2.4 출시 후 판단

최초 4주는 효과 판정이 아니라 기준선 수집 기간이다.

- 절대 이벤트 수, 오류, 지연, 그룹 수 분포를 저장한다.
- 표본 기준을 정하기 전에는 전환율 상승·하락을 주장하지 않는다.
- 사용자 수가 계속 0명 또는 극소수면 정량 결론을 내리지 않는다.
- 이후 효과 목표를 세울 때는 관찰 기간·최소 표본·판단 규칙을 먼저 합의한다.

---

## 3. 기능 요구사항

| ID | 요구사항 | 우선 |
| --- | --- | --- |
| **FR-1** | 내 그룹을 horizontal peek carousel로 렌더한다. 중앙 1장, 이웃 peek, 한 장 단위 snap을 제공한다. | P0 |
| **FR-2** | 페이지 수는 `표시 그룹 수 + 끝의 그룹 찾기 카드 1장`이다. `PageIndicator`는 실측 컨테이너 폭에서 좌우 20pt gutter를 뺀 `availableWidth = containerWidth - 40`을 사용한다. `requiredDotWidth = pageCount × 44 + (pageCount - 1) × 4`가 `availableWidth` 이하이면 dots, 초과하면 `현재 / 전체` compact를 표시한다. 고정 페이지 수 임계값은 두지 않는다. | P0 |
| **FR-3** | 모든 그룹 카드 앞면의 아트 배경은 `#5E6AD2`로 고정한다. 그룹별 tone·gradient·선화 mark를 만들지 않는다. | P0 |
| **FR-4** | 앞면 중앙에는 현재 `userId`의 기기 로컬 `groupId → emoji` 값 1개를 표시한다. 저장값이 없거나 손상·허용 밖이면 `🎯`를 쓴다. | P0 |
| **FR-5** | 앞면의 본문을 탭하면 route push가 아니라 **같은 card shell의 뒷면으로 flip**한다. `aria-expanded`와 앞·뒷면 `inert`를 함께 갱신한다. | P0 |
| **FR-6** | 뒷면의 집중 현황은 그룹 상세 `members[].userId`와 카테고리를 보내지 않은 전역 `GET /api/v1/league/me/ranking?date=YYYY-MM-DD` 원본 응답을 합성해 `isFocusing === true`인 그룹원 수를 `n명 집중 중`만 표시한다. 완전성이 확인된 성공 응답(`<100`행)에 없는 멤버 ID는 `false`로 본다. 팀 누적·오늘 합계·개인 집중 시간과 `HH:MM` 타이머는 표시하지 않고, 0명도 `0명 집중 중`으로 숨기지 않는다. | P0 |
| **FR-7** | 뒷면과 전체 방은 현행 `GET /api/v1/groups/{groupId}/challenges?date=YYYY-MM-DD` 응답을 같은 순서의 챌린지 목록으로 표시한다. 대표 1개를 고르거나 `UPCOMING`을 합성하지 않는다. 공지는 뒷면에 최신 1개만 표시한다. | P0 |
| **FR-8** | 뒷면의 primary CTA는 `이 그룹으로 집중`, secondary CTA는 `방 전체 보기`다. 전체 방만 `GroupRoom` route를 push한다. | P0 |
| **FR-9** | 전체 방에서 돌아오면 stable `groupId`를 기준으로 이전 carousel index, scroll offset, back face, focus 대상을 복원한다. | P0 |
| **FR-10** | 카드 우상단은 공용 `components/reorder/ReorderHandle`을 사용한다. 시각·핸들 규격은 현행 통계 카드와 같은 `drag-vertical` 20pt·`T.inkSub` 아이콘, 36×36 투명 hit box다. 그룹 캐러셀은 별도 horizontal axis adapter로 좌우 drag/drop을 처리하며, grip tap은 no-op이고 grip pointer는 swipe와 flip을 시작하지 않는다. | P0 |
| **FR-11** | 서버 `GET /groups`는 현재 사용자의 소속 집합과 DTO의 정본이다. 앱은 별도의 순서 저장소에 `userId`별 stable `groupId[]`만 저장해 같은 기기의 화면 재진입·앱 재실행 후 복원한다. 저장 순서에는 현재 서버 목록에 있는 ID만 한 번씩 남기고 신규 ID는 서버 순서대로 뒤에 붙이며, 끝의 찾기 카드는 포함하지 않는다. 서버 order API와 다기기 동기화는 제공하지 않는다. | P1 |
| **FR-12** | 그룹 만들기에서 12개 중 `내 카드 아이콘`을 고르되 `CreateGroupRequest`에는 보내지 않고, 생성 성공 응답의 `groupId`에 현재 `userId`의 선택값을 기기 로컬로 연결한다. OWNER·MEMBER 모두 기존 그룹 설정의 `내 카드 아이콘`에서 같은 12개 중 변경할 수 있고, `이 기기에서 나에게만 보여요`를 표시한다. 저장 실패 시 현재 선택값과 화면을 유지하고 inline 오류로 재시도를 제공하며, 성공 toast는 표시하지 않는다. | P0 |
| **FR-13** | 만들기·찾기는 헤더 우측에 유지한다. 트랙 마지막 찾기 카드는 `그룹 찾기`만 제공한다. | P0 |
| **FR-14** | 뒷면과 전체 방의 `⋯`는 현행 `GroupSettingsScreen`을 연다. `내 카드 아이콘`은 OWNER·MEMBER 모두에게 표시한다. OWNER에는 추가로 그룹 프로필 설정하기, 방장 넘기기, 멤버 관리, 공지 권한을 표시하고, 양쪽 모두 그룹 나가기를 본다. 그룹 삭제는 표시하지 않는다. | P0 |
| **FR-15** | 그룹 나가기는 별도 확인 dialog를 거친다. OWNER가 바로 나가려 해 `HOST_WITHDRAW`를 받으면 현행처럼 `방장 넘기고 나가기` 흐름으로 연결한다. 그룹 알림, 초대 링크, 내 활동 설정 행은 이번 설정 목록에 넣지 않는다. | P0 |
| **FR-16** | 글로벌 하단바의 `그룹`을 누르면 별도 그룹 전용 바(`뒤로`, `내 그룹`, `초대`, `발견`, `피드`)로 전환한다. 아이콘 하나의 의미를 morph하지 않는다. | P1 |
| **FR-17** | 로딩·에러·빈·게스트와 초대 overlay의 소유권은 `GroupScreen`에 둔다. 목록/카드 덱은 소속 그룹 1건 이상 분기만 담당한다. | P0 |
| **FR-18** | Reduce Motion에서는 3D 회전 대신 짧은 cross-fade를 사용한다. inactive 카드·숨은 면의 control은 focus/tab order에서 제외한다. | P0 |
| **FR-19** | 긴 그룹 이름은 카드 앞면에서 최대 2줄까지 표시하고 넘치면 두 번째 줄 끝에 시각적 `…`를 반드시 표시한다. 검색 결과·목록형 행과 폭이 좁은 카드 뒷면 헤더는 최대 1줄이며, 넘치면 첫 줄 끝에 `…`를 표시한다. 접근성 이름은 축약된 표시 문자열이 아니라 서버가 준 원문 전체를 사용한다. | P0 |

---

## 4. `내 카드 아이콘` 계약

### 4.1 허용 집합

```text
🌅 📚 💻 ⚡ 🧘 🎨 🏃 ✍️ 🧠 🎯 🌿 🔥
```

- 생성 picker 기본 선택: `🎯`
- 설정 picker 초기 선택: 현재 `userId`·`groupId`의 로컬 저장값, 없으면 `🎯`
- 새로 참여한 그룹·다른 기기에서 처음 본 그룹·누락·손상 fallback: `🎯`
- 현재 계정의 그룹별로 이 기기에 1개
- 자유 입력, 이미지 업로드, 커스텀 emoji, 카드 색상 선택은 제공하지 않는다.
- 선택 상태는 색상만으로 전달하지 않고 border·pressed state·스크린리더 label을 함께 쓴다.
- 생성 후 변경은 OWNER·MEMBER가 공통으로 보는 기존 그룹 설정의 `내 카드 아이콘`에서 처리한다.
- picker와 설정 행에 `이 기기에서 나에게만 보여요`를 표시해 방 전체의 아이콘을 바꾸는 기능으로 오해하지 않게 한다.

### 4.2 로컬 저장과 서버 경계

아이콘은 그룹 도메인 데이터가 아닌 **사용자별 기기 로컬 표시 선호**다.

```ts
const GROUP_CARD_EMOJI_STORAGE_KEY = 'gromo:groups:cardEmoji:v1';

type GroupCardEmojiStore = {
  [userId: string]: {
    [groupId: string]: GroupEmoji;
  };
};
```

`CreateGroupRequest`, `UpdateGroupRequest`, `GroupSummaryResponse`, `GroupDetailResponse`, `GroupSearchResponse`, `GroupOverviewResponse`에는 `emoji`를 추가하지 않는다. 그룹 API, DB, OpenAPI에도 아이콘 필드나 migration을 만들지 않는다.

- 생성 화면의 선택값은 request body에서 제외한다. 생성 API가 성공해 `CreateGroupResponse.groupId`를 반환한 뒤에만 `store[userId][groupId]`로 저장한다. API 실패 시 로컬 항목을 만들지 않는다.
- 생성 성공 후 로컬 쓰기만 실패하면 생성 API를 다시 호출하지 않는다. 현재 세션의 선택값은 메모리에 유지하고 inline으로 저장 실패와 로컬 재시도를 알린다.
- 기존 그룹에 참여하거나 이 기기에서 처음 본 `groupId`는 저장 항목이 없으므로 `🎯`를 표시한다. 기본값은 렌더 시 적용하며 반드시 모든 그룹을 저장소에 미리 쓰지 않아도 된다.
- `userId`를 아직 확정하지 못한 게스트·전이 상태에서는 아이콘 저장소를 읽거나 쓰지 않고 `🎯`를 사용한다.
- `내 카드 아이콘`에서 저장하면 현재 계정 bucket의 해당 `groupId`를 현재 화면 카드에 먼저 낙관 반영한 뒤 로컬 쓰기를 시도한다. 성공 toast는 보이지 않는다. 실패해도 현재 실행의 picker·선택·카드는 유지하고 마지막 정상 저장값은 훼손하지 않으며, `내 카드 아이콘을 저장하지 못했어요. 앱을 다시 열면 이전 아이콘으로 돌아갈 수 있어요.`를 inline·polite로 알린다. 다음 아이콘 변경 또는 그룹 화면 활성화 때 최신 pending 값만 다시 저장하고 성공하면 오류만 조용히 없앤다.
- 성공한 전체 `GET /groups`를 reconcile 정본으로 삼아 현재 `userId` bucket에서 서버 목록에 없는 stale `groupId`를 제거한다. 목록 실패·부분 응답으로는 정리하지 않고, 다른 `userId` bucket은 건드리지 않는다. 허용 집합 밖 값은 제거하고 `🎯`로 방어 렌더한다.
- 같은 기기·같은 `userId`는 화면 재진입과 앱 재실행 후 복원한다. 다른 계정, 다른 기기, 앱 재설치·데이터 초기화 후에는 동기화·복원하지 않는다.
- 계측은 서버 그룹 설정 성공과 섞지 않는다. 필요하면 `group_card_icon_save_result { surface: 'create' | 'card_icon_settings', result: 'success' | 'failure' }` 정도만 사용하고 선택한 glyph는 싣지 않는다. `group_settings_updated.fields`에도 `emoji`를 넣지 않는다.

---

## 5. 카드 앞·뒷면 정보 계약

### 5.1 앞면

위에서 아래 순서:

1. 공개방/비밀방 chip
2. 공용 `ReorderHandle`
3. 내 카드 아이콘
4. 그룹 이름
5. OWNER일 때 `방장` badge
6. 그룹 소개
7. `현재/정원`
8. `뒤집어 방 보기` 어포던스

`내가 방장`이라는 문장을 방 헤더에 중복 표기하지 않는다. 역할은 앞면 badge와 역할별 설정에서 전달한다.

그룹 이름은 앞면에서 최대 2줄이다. 이름이 두 줄의 가용 폭을 넘으면 마지막 노출 줄인 두 번째 줄 끝에 `…`가 보여야 하며, 단순 clipping이나 ellipsis 없는 절단은 허용하지 않는다.

### 5.2 뒷면

| 영역 | 규칙 |
| --- | --- |
| 헤더 | 앞면으로 돌아가기, 그룹 이름, 공개 여부·인원, 역할별 설정. 좁은 헤더의 이름은 1줄, overflow 시 줄 끝 `…` |
| 실시간 | **`n명 집중 중` 한 줄만 표시**. 팀 총 집중시간·누적시간·타이머·섹션 제목은 두지 않음 |
| 챌린지 | 현행 GroupRoom과 같은 `GroupChallengeResponse[]` 목록. 서버 최신순을 그대로 사용하고 클라이언트가 대표 1개를 선정하거나 상태로 거르지 않음 |
| 공지 | `createdAt` 기준 최신 1개 |
| 멤버 | `현재/정원`, 최대 5명 preview, 자리가 있을 때 초대 action |
| CTA | `이 그룹으로 집중`, `방 전체 보기` |

챌린지는 목록 자체가 중요한 현재 구현 기능이므로 뒷면에서도 단일 대표 카드로 축약하지 않는다. 목록 영역은 카드 높이 안에서 세로 스크롤하며, 각 항목은 현행 `ChallengeCard`의 데이터 의미를 유지한다. 공지 전체, 전체 멤버 관리, 챌린지 생성·삭제와 내기 같은 관리·변경 기능은 `방 전체 보기`에서 제공한다.

### 5.3 데이터 API

카드 flip 시 해당 그룹의 **현행 상세·공지·챌린지 API**를 병렬 lazy load한다. 집중 현황은 이미 포커스 세션에서 사용하는 **전역 리그 원본 응답**을 `localDate`별로 한 번만 받아 모든 카드가 공유한다. 그룹 목록을 받은 직후 모든 방을 선조회하지 않으며 카드 전용 endpoint를 추가하지 않는다.

```http
GET /api/v1/groups/{groupId}?date=YYYY-MM-DD
GET /api/v1/groups/{groupId}/announcements
GET /api/v1/groups/{groupId}/challenges?date=YYYY-MM-DD
GET /api/v1/league/me/ranking?date=YYYY-MM-DD
```

- 앱은 `leagueApi.getMyRanking()`의 **category 미전달 원본 배열** 또는 동일한 전용 query hook을 사용한다. `useSessionLeagueMembers` 결과는 자기 자신을 제외할 수 있고 `MAX_MEMBERS=12`로 slice하므로 재사용하지 않는다.
- 앱은 리그 원본 배열을 `userId -> isFocusing` map으로 바꾼 뒤 그룹 상세 `members[].userId`와 client join/filter한다. 매칭 행의 `isFocusing === true`만 세고, 완전성이 확인된 성공 응답(`<100`행)에 없는 ID만 `false`로 본다. `focusTimeMinutes`로 라이브 여부를 추정하지 않는다.
- 이 판단이 현재 정확한 이유는 서버 `LeagueRankingQueryRepository` 쿼리가 `users LEFT JOIN daily_focus_stats`로 집중 기록이 0인 사용자까지 포함하고, `is_deleted=false AND is_guest=false` 전체 사용자가 100명 미만이어서 top100 응답이 해당 모수 전원을 포함하기 때문이다.
- 리그 요청이 loading·error이면 성공 응답의 ID 누락과 구분한다. 집중 현황 블록만 skeleton 또는 `정보를 불러오지 못했어요`·재시도를 표시하고 `0명`으로 바꾸지 않는다. **성공한 원본 응답**에서만 absent `userId=false` 규칙을 적용한다.
- 상세 응답은 멤버 preview와 정원을, 공지 응답은 서버 최신순 배열의 첫 항목을 제공한다. 공지 목록이 비면 빈 상태를 표시한다.
- 그룹별 세 요청은 독립 상태와 cache를 갖는다. detail·challenges는 `groupId + localDate`, announcements는 `groupId`, 공유 리그는 `localDate`를 key로 사용하며 한 요청 실패가 다른 섹션과 CTA를 숨기지 않는다.

#### 전역 top100 재사용의 운영 경계와 TODO

- 서버 변경은 **0건**이다. 기존 그룹·리그 API, DTO, DB, OpenAPI를 바꾸지 않고 새 endpoint도 만들지 않는다.
- 운영 지표 `eligible_user_count = COUNT(users WHERE is_deleted=false AND is_guest=false)`를 관찰한다. **90명**에서 경고를 울리고 대체 안을 착수하며, **100명 도달 전**을 정확한 방식으로 전환하는 release gate로 둔다.
- 리그 원본 응답이 `length === 100`이면 응답만으로 전체 coverage를 증명할 수 없는 신호로 telemetry를 남기고 TODO를 점검한다. 앱을 런타임에서 강제 차단하는 규칙은 두지 않는다.
- TODO: `eligible_user_count >= 100`에 진입하기 **전** 그룹 상세 멤버의 live 필드, 그룹 멤버 batch live endpoint, 또는 라이브 정보를 포함한 리그 pagination 중 하나로 전환한다. 전환 전에는 현 전제를 운영 체크리스트에서 검증한다.

챌린지 계약의 정본은 현행 `app/src/types/dto/group.ts`와 `app/src/services/groupApi.ts#getChallenges`다.

- 서버는 삭제되지 않은 챌린지를 `createdAt DESC`로 반환한다.
- 앱은 응답 순서를 그대로 그리고 `status`로 목록을 필터링하지 않는다.
- `date`를 보내면 ACTIVE 챌린지의 멤버별 당일 진행률을 받을 수 있다. `INACTIVE`, 목표가 없는 시간대 챌린지, 미집계 값은 `memberProgress` 또는 그 안의 값이 `null`일 수 있다.
- 앱에 존재하지 않는 `UPCOMING`, 단일 `title`, `progressPercent`, 연속일수 필드를 카드 플립을 위해 새로 만들지 않는다.
- 카드 뒷면과 전체 방이 같은 `groupId + date` 챌린지 cache와 같은 응답을 사용해 내용과 순서가 어긋나지 않게 한다.
- 공지는 현행 announcements 응답의 서버 순서를 유지하고 첫 항목 1개만 뒷면에 표시한다. 카드용 정렬이나 limit 계약을 새로 만들지 않는다.

---

## 6. 상호작용 규칙

### 6.1 우선순위

| 입력 | 결과 |
| --- | --- |
| grip pointer down | reorder 전용; carousel pan·flip 차단 |
| 앞면 본문 tap | 같은 카드 flip |
| 앞면 본문 horizontal drag | carousel page 이동; flip하지 않음 |
| 뒷면 button tap | 해당 action만 수행; 카드 전체 tap으로 전파하지 않음 |
| 뒷면 turn-back | 앞면 복귀 |
| 전체 방 back | 이전 groupId·index·back face·focus 복원 |

하나의 transform에 peek scale, reorder translate, flip rotate를 덮어쓰지 않는다. shell 아래에 reorder, peek, flipper layer를 분리한다. 상세 구조는 LLD를 정본으로 한다.

### 6.2 reorder

- pointer가 grip에서 시작할 때만 reorder한다.
- 끌기 중 대상 위치를 표시하고 pointer up에서 한 번 commit한다.
- pointer cancel은 원래 위치로 돌아가며 순서를 바꾸지 않는다.
- grip을 짧게 탭해 sheet나 한 칸 이동 UI를 열지 않는다.
- 키보드·스크린리더 사용자는 accessibility move actions로 동일 결과를 수행한다.
- 공용 `components/reorder/ReorderHandle`은 아이콘(`MaterialCommunityIcons`의 `drag-vertical`, 20pt, `T.inkSub`), 36×36 투명 hit box, pan/accessibility handler 전달만 소유한다. 카드 순서·좌표·scroll lock·dragging card shadow는 소유하지 않는다.
- 현행 `src/screens/stats/CardOrderEditor.tsx`의 feature-local `PanResponder`는 세로 `pageY`, 서로 다른 카드 높이, 위·아래 자동 스크롤을 전제로 한다. 이를 가로 캐러셀에 그대로 import하지 않는다.
- 통계 화면은 기존 세로 controller를 유지하되 핸들 렌더만 공용 컴포넌트로 교체한다. 그룹 캐러셀은 별도 horizontal axis adapter가 `pageX`, 카드 슬롯 폭, carousel swipe lock, drop index를 계산하고 동일한 `ReorderHandle`에 pan handlers를 주입한다.

순서 저장과 reconcile 계약은 다음과 같다.

- 카드 **순서 key**에는 `{ [userId]: groupId[] }` 형태의 순서만 저장한다. 그룹 DTO와 `FindMoreCard` sentinel은 저장하지 않으며 `userId`가 없으면 읽거나 쓰지 않고 서버 순서를 쓴다. 카드 아이콘은 §4.2의 별도 key를 사용한다.
- 성공한 전체 `GET /groups`의 ID를 중복 제거한 집합이 멤버십 정본이다. 저장 배열은 첫 등장만 남기고 서버에 없는 stale ID를 제거한다. 저장 배열에 없는 신규 ID는 서버 응답의 상대 순서대로 끝에 붙인다.
- 저장값이 손상됐거나 읽기에 실패하면 서버 순서로 렌더하고 그 정상 배열로 repair를 시도한다. 목록 조회 실패·부분 응답에는 저장값을 정리하지 않는다.
- drop 직후 현재 세션 UI 순서를 먼저 반영하고 저장을 best-effort로 수행한다. 쓰기 실패에도 현재 세션 순서는 유지하되 `순서를 저장하지 못했어요. 앱을 다시 열면 이전 순서로 돌아갈 수 있어요.`를 non-blocking inline 상태로 한 번 알린다. 성공 시 `저장됨` 문구는 표시하지 않으며 다음 진입에서는 마지막 정상 저장값 또는 서버 순서로 돌아갈 수 있다.
- 그룹 생성은 다음 성공 목록에서 신규 ID로 뒤에 붙는다. 탈퇴·강퇴로 사라진 ID는 다음 성공 목록에서 제거한다. 같은 기기의 다른 계정은 별도 `userId` bucket을 사용해 순서를 섞지 않는다.
- 앱 삭제·앱 데이터 초기화 뒤의 복원과 기기 간 동기화는 지원하지 않는다. 서버에는 순서를 쓰지 않으며 order API도 추가하지 않는다.

### 6.3 전체 방과 설정

- `방 전체 보기`는 route다. 닫을 때 카드 덱을 새로 초기화하지 않는다.
- 방 전체보기는 공지 전체, 챌린지 상세, 멤버 전체를 제공한다.
- 설정은 뒷면과 전체 방에서 같은 역할 규칙을 사용한다.
- `내 카드 아이콘`은 역할과 무관한 로컬 설정 행이다. OWNER·MEMBER 모두 같은 12개 picker와 `이 기기에서 나에게만 보여요` 안내를 본다.
- OWNER의 `그룹 프로필 설정하기`는 기존 이름·소개·정원·공개 설정만 다루고 카드 아이콘을 포함하지 않는다.
- OWNER와 MEMBER 모두 `그룹 나가기` 확인을 거친다. OWNER의 서버 거절(`HOST_WITHDRAW`)은 방장 위임 후 나가기 흐름으로 이어진다.

---

## 7. 비목표

- 사용자 성과나 성장 지표의 사전 보장
- 사용자별 카드 색상·그룹별 gradient·선화 아이콘 생성
- 자유 emoji 입력·커스텀 이미지·emoji 검색
- 뒷면에 팀 총 집중시간·개인별 집중시간·실시간 타이머 표시
- 챌린지 대표 1개 선정·`UPCOMING` 합성·별도 챌린지 요약 DTO
- 뒷면에서 챌린지 생성·삭제·내기 등 변경 동작 제공
- 뒷면에 공지를 여러 개 표시
- 그룹 설정에서 그룹 삭제 제공
- 카드 뒷면에 전체 GroupRoom 기능 복제
- reorder 서버 영속화·다기기 동기화·앱 삭제/데이터 초기화 후 복원
- 내 카드 아이콘의 서버 저장·다기기 동기화·다른 사용자에게 공유
- 그룹 알림·초대 링크·내 활동 설정 행
- 로딩·에러·빈·게스트 화면의 전면 재설계

---

## 8. 티켓 분해안

| ID | 작업 | 산출물 |
| --- | --- | --- |
| T-1 | horizontal peek carousel와 가용 폭 기반 indicator | `GroupCarousel` · responsive `PageIndicator` · 끝의 `FindMoreCard` |
| T-2 | 통일 인디고 앞면·사용자별 로컬 카드 아이콘·화면별 이름 ellipsis 렌더 | `GroupCardFront` + 2줄/1줄 이름 projection |
| T-3 | 생성·공통 설정의 `내 카드 아이콘` picker, userId×groupId 로컬 저장·reconcile | create 성공 `groupId` 연결 + `GroupSettings` + AsyncStorage |
| T-4 | 공용 `ReorderHandle` 추출 + 가로 axis adapter + userId별 order 저장/reconcile | 통계·그룹 동일 핸들, 축별 drag, 같은 기기 순서 복원 |
| T-5 | 기존 detail·announcements·challenges 병렬 cache + 전역 `getMyRanking()` 원본 공유 cache + `userId` client join | 서버 변경 없는 뒷면 데이터 |
| T-6 | 뒷면 정보·empty/error/loading·두 CTA | `GroupCardBack` |
| T-7 | 전체 방 route 왕복·state/focus 복원 | stable groupId 복귀 |
| T-8 | 역할별 settings·프로필 편집 권한·destructive confirm | 양 역할의 로컬 아이콘 행 + OWNER 전용 관리 + 공통 나가기 |
| T-9 | 그룹 전용 하단바 | 내 그룹·초대·발견·피드 |
| T-10 | 접근성·Reduce Motion·계측·화면 폭×그룹 수·순서·아이콘 로컬 복원 test matrix | QA gate |

`1·5·6·7·10개`는 T-1의 구현 산출물이 아니라 `GET /api/v1/groups` 응답을 흉내 낸 테스트 fixture다. 운영 코드에는 그룹 데이터를 하드코딩하지 않는다. 320·390·430·768pt indicator container fixture와 교차해 2·6·7·8·11페이지(끝의 `FindMoreCard` 포함)의 peek·snap·dots/compact 전환을 검증하고, 0개 응답은 기존 빈 상태를 검증한다. 390pt에서 7페이지는 dots, 8페이지는 compact지만 이는 계산 결과의 예시일 뿐 제품 임계값이 아니다. 회전·분할 화면으로 컨테이너 폭이 바뀌면 mode를 다시 계산하되 현재 `groupId`와 index를 유지한다.

---

## 9. 수용 기준

- 제품 목업과 구현의 카드 앞면 배경이 `#5E6AD2`이고 그룹별 tone이 없다.
- 만들기에서 12개 중 `내 카드 아이콘`을 고를 수 있고, 선택값은 `CreateGroupRequest` body에 포함되지 않는다.
- 생성 성공 뒤 반환된 `groupId`에만 현재 `userId`의 선택값이 로컬 저장되어 카드에 표시된다. 참여로 추가되었거나 저장값이 없는 그룹은 `🎯`를 표시한다.
- 긴 이름 fixture는 카드 앞면에서 최대 2줄과 두 번째 줄 끝 `…`, 검색·목록형 행과 좁은 뒷면 헤더에서 1줄과 첫 줄 끝 `…`를 표시한다. 스크린리더는 모든 위치에서 원문 전체 이름을 읽는다.
- OWNER·MEMBER 모두 기존 그룹 설정에서 `내 카드 아이콘`과 `이 기기에서 나에게만 보여요`를 보고 같은 12개 picker를 사용할 수 있다. OWNER 전용 `그룹 프로필 설정하기`에는 아이콘 필드가 없다.
- 로컬 저장 성공 시 같은 세션의 카드가 즉시 바뀌고 성공 toast는 없다. 실패 시 현재 picker·선택값을 유지하며 inline 오류와 재시도를 제공한다.
- 같은 계정·기기에서는 화면 재진입과 앱 재실행 후 아이콘을 복원하고, 다른 계정·기기와 재설치 뒤에는 공유·복원하지 않는다.
- 성공한 전체 그룹 목록과 reconcile할 때 현재 사용자 bucket의 stale `groupId` 및 허용 밖 값을 정리한다. 목록 실패·부분 응답과 다른 사용자 bucket은 정리하지 않는다.
- 그룹 Create/Update 요청과 Summary/Detail/Search/Overview 응답, DB·OpenAPI에는 `emoji` 계약이 없다.
- 앞면 tap은 같은 카드를 뒤집고 즉시 GroupRoom을 열지 않는다.
- `PageIndicator`는 `requiredDotWidth <= availableWidth`일 때만 dots를 쓰고, 320·390·430·768pt × 그룹 1·5·6·7·10개 매트릭스의 mode가 공식과 일치한다. 회전·분할 화면에서 mode가 바뀌어도 현재 groupId/index는 유지된다.
- 뒷면의 집중 현황은 `n명 집중 중`만 표시하고 팀 합계·`HH:MM`은 표시하지 않는다.
- 뒷면과 전체 방은 같은 `GroupChallengeResponse[]`를 서버 최신순 그대로 목록으로 표시하며, 대표 1개·`UPCOMING`·임의 연속일수를 만들지 않는다.
- 뒷면은 최신 공지 1개만 표시한다.
- `방 전체 보기` 후 같은 groupId·index·back face로 돌아온다.
- 통계와 그룹 카드가 공용 `ReorderHandle`의 `drag-vertical`·36×36 규격을 사용하되, 통계는 세로 controller, 그룹은 가로 axis adapter로 순서를 계산한다.
- grip drag/drop만 pointer reorder를 시작하고 grip tap은 아무 sheet도 열지 않는다.
- 재정렬한 순서는 `userId`별 stable `groupId[]`로 같은 기기의 화면 재진입·앱 재실행 후 복원된다. 신규 ID append, 탈퇴·강퇴 ID 제거, 중복/stale 제거, 손상 fallback/repair, 계정 분리가 검증되며 찾기 카드는 저장 배열에 없다.
- 순서 저장 쓰기 실패 시 현재 세션 UI 순서는 유지되고 non-blocking 실패 상태가 한 번 표시되며, 정상 저장에는 `저장됨` 문구가 없다. 다른 기기와 앱 삭제·데이터 초기화 후에는 복원되지 않는다.
- OWNER 설정은 내 카드 아이콘·그룹 프로필 설정하기·방장 넘기기·멤버 관리·공지 권한·그룹 나가기, MEMBER 설정은 내 카드 아이콘·그룹 나가기를 표시하며 그룹 삭제는 없다.
- 카테고리 미전달 전역 `GET /api/v1/league/me/ranking?date=YYYY-MM-DD` 원본 응답을 한 query cycle에 한 번만 받고, 그룹 상세 `members[].userId`와 join해 `isFocusing === true`인 멤버를 센다. 완전성이 확인된 성공 응답(`<100`행)에 없는 ID만 `false`로 처리하고 시간 필드로 추정하지 않는다.
- `useSessionLeagueMembers` 결과는 12명 slice를 포함하므로 사용하지 않고 `leagueApi.getMyRanking()` 원본 또는 전용 query hook을 사용한다.
- `eligible_user_count < 100`을 출시·운영 전제로 검증한다. 90명에서 경고·대체 안 착수, 100명 도달 전에 그룹 live 필드·batch endpoint·live pagination 중 하나로 전환하는 release gate와 TODO를 운영 backlog·담당자에 연결한다. 원본 응답 `length === 100`은 coverage 불명 telemetry 신호로 검증한다.
- 첫 flip은 기존 detail·announcements·challenges를 병렬 조회하고, 공유 리그 cache가 없으면 기존 리그 API도 동시에 한 번 요청한다. 새 endpoint·기존 DTO·DB 컬럼·migration은 추가하지 않고, 각 요청 실패는 해당 섹션에만 표시한다.
- 1·5·6·7·10개, Reduce Motion, keyboard/screen reader 경로의 P0 회귀가 없다.
- 제품 목업·요구사항·구현 테스트가 같은 카드 플립 정보 구조를 사용한다.
