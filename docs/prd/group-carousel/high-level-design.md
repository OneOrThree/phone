# HLD — 내 그룹 캐러셀·카드 플립: 하이레벨 설계

| 항목 | 내용 |
| --- | --- |
| 상위 | [PRD.md](./prd.md) · [UX-Design.md](./ux-design.md) |
| 하위 | [LLD.md](./low-level-design.md) (치수·코드 스켈레톤) |
| 제품 정본 | [design-mockup-flip.html](./design-mockup-flip.html) · 공용 목업 모듈 [design-mockup-shared.js](./design-mockup-shared.js) |
| 범위 | 컴포넌트 구조 · 앞/뒷면 데이터 흐름 · 개인 카드 이모지/뒷면 정보/현재 챌린지 목록/순서 계약 · 설정 권한 · 영향 범위 |
| 상태 | **v0.8 제품 정본** — 앞면 탭은 같은 자리의 카드 플립, 전체 방은 뒷면 CTA route, 챌린지는 현행 목록 계약을 카드와 전체 방이 함께 사용 |

---

## 1. 설계 원칙

1. **앞면 탭과 라우트를 분리.** 앞면 탭은 같은 카드의 뒷면으로 flip하며 navigation을 일으키지 않는다. 기존 `onSelect(groupId)`는 뒷면 `방 전체 보기`에서만 호출한다.
2. **의존성 추가 회피.** 전용 캐러셀 라이브러리(`react-native-reanimated-carousel` 등)를 새로 넣지 않는다 — 사내에 네이티브 페이징 선례가 있고(`FocusSessionScreen`의 `pagingEnabled` ScrollView, `DrumPicker`의 `snapToInterval` FlatList), reanimated 4.5.0이 이미 설치돼 있어 peek 모션까지 자급 가능.
3. **기존 API 네 개를 조합한다.** 카드 뒷면을 처음 열 때 해당 `groupId`의 detail·announcements·challenges 세 요청을 lazy 병렬 조회하고, category를 보내지 않은 기존 `GET /api/v1/league/me/ranking?date`의 전체 사용자 현재 집중 상태 원본 응답은 화면 전체에서 날짜별 한 번만 조회·캐시한다. 카드 전용 endpoint는 추가하지 않는다.
4. **카드 표현은 개인 로컬 설정.** 앞면 배경은 모든 그룹이 `#5E6AD2`; 그룹별 색·그라데이션·선화 아이콘은 없다. `내 카드 아이콘`은 현재 계정이 이 기기에서 보는 카드에만 적용하며 그룹의 서버 속성이나 OWNER 권한이 아니다.
5. **서버 계약을 늘리지 않는다.** 이모지는 Create/Update request와 Summary/Detail/Search/Overview response, DB, OpenAPI 어디에도 추가하지 않는다. 앱은 userId별 AsyncStorage 값만 읽고, 미설정·손상·신규·가입 그룹은 `🎯`로 fallback한다. 집중 인원도 기존 그룹 상세 멤버 ID와 기존 전체 사용자 현재 집중 상태 응답을 앱에서 join하므로 이 기능의 서버 변경은 0건이다.
6. **제품 계약을 하나로 유지.** 앞면 탭은 같은 자리에서 카드를 뒤집고, 뒷면 `방 전체 보기`만 `GroupRoom` route를 연다. `GroupChallengeResponse[]`, `ACTIVE|INACTIVE`, `createdAt DESC`와 role별 설정 허브는 현행 정본이다. 없는 `UPCOMING` 상태나 챌린지 제목·연속일·단일 항목 tie-break를 설계로 만들어내지 않는다.
7. **규모 가정을 임시 계약으로 명시한다.** 현재 `is_deleted=false AND is_guest=false` 사용자는 100명 미만이므로 전역 주간 상위 100명 응답이 전체 대상자를 포함한다. 이 가정은 영구 계약이 아니며 90명부터 경고하고, 100명 도달 전 pagination·그룹 상세 현재 집중 상태 필드 또는 batch endpoint로 전환하는 release gate를 둔다.
8. **멤버십과 표시 순서를 분리.** `GET /groups` 응답이 소속 그룹과 DTO의 정본이다. AsyncStorage는 현재 `userId`에 해당하는 stable `groupId[]`만 기기 로컬 표시 순서로 보관하며, 서버에 없는 그룹을 복원하거나 권한 판정에 쓰지 않는다.

---

## 2. 화면 컴포넌트와 소유권

```mermaid
flowchart TB
    SCREEN["그룹 화면<br/>상태 · 전환 · 화면 이동 소유"]
    HEADER["헤더<br/>찾기 · 생성"]
    DECK["카드 덱<br/>캐러셀 · 순서 변경 · 페이지 표시"]
    CARD["그룹 카드"]
    FRONT["앞면<br/>이름 · 개인 아이콘 · 순서 변경 손잡이"]
    BACK["뒷면<br/>그룹 요약"]
    SECTIONS["정보 영역<br/>집중 · 챌린지 · 공지 · 멤버"]
    ACTIONS["행동<br/>집중 시작 · 방 전체 보기 · 설정"]
    FIND["마지막 카드<br/>그룹 찾기"]

    SCREEN --> HEADER
    SCREEN --> DECK
    DECK --> CARD
    DECK --> FIND
    CARD --> FRONT
    CARD --> BACK
    BACK --> SECTIONS
    BACK --> ACTIONS
```

상위 그룹 화면이 상태와 화면 이동을 소유하고, 카드 덱과 앞·뒷면은 표시와 사용자 행동을 위임받는다. 따라서 카드 한 장의 실패가 화면 전체나 다른 카드의 상태를 소유하지 않는다. 아래 컴포넌트 이름은 이 개념 구조를 실제 코드 경계로 옮길 때의 계약이다.

- **캐러셀 로컬 컴포넌트**:
  - `CarouselHeader` — 타이틀 + 진입점 아이콘 2개. `onCreate`/`onFind` 위임.
  - `GroupFlipCard` — 앞/뒷면과 접근성 상태를 묶는다. 동시에 하나만 flipped.
  - `GroupCardFront` — 목록 응답 데이터만 소비한다. 그룹 이름은 2줄 line clamp + 시각적 ellipsis, 카드 몸체는 flip, grip은 reorder.
  - `GroupCardBack` — 집중 중 인원, 현재 챌린지 목록, 공지 1개와 멤버 정보의 독립 로딩 상태를 렌더하고 전체 방·집중·설정 액션을 위임. 좁은 카드 헤더의 그룹 이름은 1줄 ellipsis다.
  - `GroupChallengeList` — `GroupChallengeResponse[]` 전체와 서버 순서를 보존한다. 카드에서는 compact row로 투영하고, 전체 방에서는 기존 `ChallengeCard`를 렌더한다.
  - `PageIndicator` — 활성 index + 총 페이지 수를 받는 순수 표시 컴포넌트. 실제 indicator/container 폭에서 좌우 20pt gutter를 뺀 공간에 44pt hit width의 dot과 4pt gap이 모두 들어가면 dots, 아니면 `n / total`을 렌더한다.
  - `FindMoreCard` — 그룹 데이터를 모르는 고정 footer.
  - `GroupEmojiPicker` — 생성 화면의 local draft와 OWNER·MEMBER 공용 `내 카드 아이콘` 편집 화면에서 재사용. 서버 요청 body를 만들지 않는다.
- **훅/컨트롤러**:
  - `useCarousel` — scrollX·activeIndex·snap 계산.
  - `useGroupFlipState` — `flippedGroupId`와 face 전환.
  - `useGroupCardBackData` — 카드 뒷면을 처음 열 때 현행 detail·announcements·challenges의 lazy fetch·독립 오류·retry·invalidate를 조정한다.
  - `useGroupFocusStatus` — `getMyRanking(undefined, date)`의 **전체 사용자 현재 집중 상태 원본 최대 100행**을 날짜별 한 번 조회하고 in-flight를 합치며, 모든 카드가 공유할 `userId → isFocusing` index를 제공한다. 12명만 남기는 `useSessionLeagueMembers`는 재사용하지 않는다.
  - `useGroupReorder` — grip gesture·낙관적 순서 상태·서버 목록/AsyncStorage hydration·계정별 저장을 조정한다.
  - `groupCardOrderStore` — `STORAGE_KEYS.groupCardOrder`의 계정별 map 읽기·검증·직렬화 쓰기를 담는다.
  - `useGroupCardEmoji` — 성공한 전체 그룹 목록과 현재 `userId`를 기준으로 이모지 hydrate/reconcile·낙관적 표시·오류 상태를 조정한다.
  - `groupCardEmojiStore` — `STORAGE_KEYS.groupCardEmoji`의 계정별 map 읽기·검증·직렬화 read-modify-write를 담는다.
- 그룹 전용 UI는 `screens/group/components/`에 콜로케이션한다. 다만 통계 카드와 그룹 카드가 함께 쓰는 grip 표현·접근성·불변 순서 이동은 `components/reorder/`로 먼저 추출한다.
- 현행 `screens/stats/CardOrderEditor.tsx` 전체를 수평 캐러셀에 import하지 않는다. 이 컴포넌트는 가변 높이 카드, `ScrollView`, Y축 좌표·auto-scroll·absolute freeze를 함께 소유해 수평 `FlatList`와 직접 호환되지 않는다.

---

## 3. 시스템/API 경계와 데이터 흐름

화면 진입에는 기존 `GET /api/v1/groups` 한 개를 사용하고, 카드 뒷면을 처음 열 때 아래 **기존 read API 네 개**를 추가로 조합한다. 카드 전용 endpoint, 그룹 상세의 현재 집중 상태 필드, DB·OpenAPI 변경은 추가하지 않으므로 서버 변경은 **0건**이다.

```mermaid
flowchart LR
    subgraph MOBILE["모바일 앱"]
        UI["그룹 화면 · 카드 덱"]
        COMBINE["앱에서 데이터 조합<br/>그룹 멤버 ID + 원본 집중 상태"]
        UI <--> COMBINE
    end

    subgraph SERVER["기존 서버 · 변경 0건"]
        GROUPS["그룹 서비스<br/>목록 · 상세 · 공지 · 챌린지"]
        FOCUS_SERVICE["집중 상태 서비스<br/>전체 사용자 현재 집중 상태 응답"]
    end

    LOCAL[("기기 로컬 설정<br/>계정별 카드 순서 · 개인 아이콘")]

    UI <-->|"기존 그룹 정보"| GROUPS
    FOCUS_SERVICE -->|"raw userId · isFocusing"| COMBINE
    COMBINE -->|"기존 조회"| FOCUS_SERVICE
    UI <-->|"읽기 · 저장"| LOCAL
```

- 화면 진입 API: `GET /api/v1/groups` — 소속 그룹 summary와 stable groupId의 정본.
- 카드 뒷면을 처음 열 때 사용하는 그룹 서비스 API: `GET /api/v1/groups/{groupId}?date`, `GET /api/v1/groups/{groupId}/announcements`, `GET /api/v1/groups/{groupId}/challenges?date`.
- 카드 뒷면을 처음 열 때 사용하는 집중 상태 API: category를 보내지 않은 `GET /api/v1/league/me/ranking?date`의 원본 응답.
- AsyncStorage는 네트워크 응답을 대체하지 않는다. 화면 진입의 `GET /api/v1/groups`로 확정한 소속 groupId에 대해 현재 계정의 표시 순서와 개인 카드 아이콘만 reconcile한다.
- 그룹 상세는 멤버십과 `members[].userId`의 정본이다. `isFocusing`을 그룹 상세 DTO에 추가하지 않는다.
- 현재 집중 상태 데이터는 `getMyRanking(undefined, date)`의 원본 배열을 사용한다. 포커스 세션 화면용 `useSessionLeagueMembers`가 본인을 제외하고 12명으로 자른 결과는 그룹 집계에 사용하지 않는다.
- `/api/v1/league/me/ranking?date` 재사용은 그룹 화면에 리그 UI나 리그 기능을 추가하는 것이 아니다. 기존 응답의 `isFocusing` 값만 현재 집중 상태 판단에 재사용한다.

### 3.1 카드 뒷면을 처음 열 때와 화면 공유 현재 집중 상태 데이터

```mermaid
flowchart TD
    ENTER["화면 진입"] --> INIT["그룹 목록 + 기기 로컬 설정 읽기"]
    INIT --> DECK["소속 그룹 카드 덱 표시"]
    DECK --> FLIP["카드 뒷면을 처음 열기"]

    FLIP --> GROUPINFO["그룹 정보 조회<br/>상세 · 공지 · 챌린지"]
    FLIP --> FOCUSING["집중 상태 조회<br/>전체 사용자 현재 집중 상태 응답"]

    GROUPINFO --> COMPOSE["앱에서 조합<br/>members userId와 raw userId를 연결"]
    FOCUSING --> COMPOSE
    COMPOSE --> DISPLAY["카드 뒷면 섹션 표시<br/>집중 · 챌린지 · 공지 · 멤버"]

    GROUPINFO -.->|"일부 실패"| PARTIAL["성공한 섹션은 유지<br/>실패한 섹션만 재시도"]
    FOCUSING -.->|"실패 또는 범위 불확실"| PARTIAL
    PARTIAL --> DISPLAY

    FOCUSING -.-> SCALE["사용자 규모 경계 도달 전<br/>후속 서버 계약으로 전환"]
```

### 3.2 기존 그룹 상세 + 현재 집중 상태 응답의 client join

카드 전용 request/response와 그룹 상세 필드 확장을 만들지 않는다. 현행 그룹 상세의 `members[].userId`를 멤버십 정본으로, category를 생략한 현행 `GET /api/v1/league/me/ranking?date=YYYY-MM-DD`의 원본 `LeagueMemberResponse[]`를 현재 집중 상태 정본으로 사용한다. 현재 eligible 사용자(`is_deleted=false AND is_guest=false`)가 100명 미만이므로 이 top-100 응답에 eligible 사용자 전원이 포함된다는 **임시 규모 가정** 아래 앱에서 join한다.

- `getMyRanking(undefined, date)`는 기존 endpoint에 category를 보내지 않아 전역 주간 상위 100명과 각 행의 기존 `isFocusing`을 그대로 받는다. 날짜 일관성을 위해 `getMyRanking(category?, date = todayStr())`처럼 앱 wrapper에 optional date 인자만 더할 수 있으며 이는 서버 계약 변경이 아니다.
- 포커스 세션 UI용 `useSessionLeagueMembers`는 본인 제외·핀 우선 정렬 뒤 12명으로 `slice`한다. 그룹 count는 그 결과를 재사용하지 않고, `getMyRanking()`의 원본 배열을 보존하는 전용 `useGroupFocusStatus`를 GroupScreen에서 한 번만 사용한다.
- 완전한 현재 집중 상태 데이터에 없는 `userId`는 `false`로 본다. 단, 이는 **eligible 사용자 수와 응답 길이가 모두 100 미만이라 데이터가 완전하다는 게이트를 통과했을 때만** 유효하다. 요청 loading/error나 100행 coverage-unknown 응답은 0명으로 강하하지 않고 집중 섹션을 독립 loading/error로 표시한다.
- 조회 결과가 90~99행이면 운영 warning/계측을 남긴다. 100행은 실제 총원이 100인지 그 이상인지 구분할 수 없으므로 coverage-unknown telemetry를 남기고 count를 미산출한다. eligible 사용자 100명 도달 전 TODO로 그룹 상세 현재 집중 상태 필드, userId batch 현재 집중 상태 endpoint 또는 pagination 중 하나를 배포한다.
- `/api/v1/league/ranking`은 `isFocusing` 값을 채우지 않으므로 사용하지 않는다. 대상은 이름이 비슷한 이 endpoint가 아니라 반드시 `/api/v1/league/me/ranking`의 category 없는 원본 응답이다.
- 이 설계의 백엔드 DTO·service·DB·migration·OpenAPI 변경은 **0건**이다.
- 최신 공지는 서버가 `createdAt DESC`로 주는 기존 `GroupAnnouncementResponse[]`의 `announcements[0] ?? null`이다. 빈 배열과 요청 실패를 구분한다.
- 멤버 현재 인원은 `detail.members.length`, 최대 인원은 `detail.maxMembers`다.
- member preview는 최대 5명이다. `myUserId`와 일치하는 나를 먼저 두고, 나머지는 **기존 detail 응답의 상대 순서**를 보존한다. `joinedAt`이나 별도 preview 정렬 계약을 추가하지 않는다.
- detail·현재 집중 상태·announcements·challenges 중 하나가 실패해도 성공한 섹션은 표시한다. 집중 count는 detail과 완전한 현재 집중 상태 데이터가 모두 ready일 때만 계산하며, 각 실패는 해당 섹션의 retry로만 복구한다.

### 3.3 현재 챌린지 목록 — 현행 API 재사용

```ts
GET /api/v1/groups/{groupId}/challenges?date=YYYY-MM-DD

type GroupChallengeStatus = 'ACTIVE' | 'INACTIVE';

interface CompactChallengeRow {
  challenge: GroupChallengeResponse;
  label: string;
}

function toCompactChallengeRows(
  challenges: readonly GroupChallengeResponse[],
): CompactChallengeRow[] {
  return challenges.map((challenge) => ({
    challenge,
    label: missionLabel(challenge) ?? categoryLabel(challenge),
  }));
}
```

- 앱 서비스는 현행 `getChallenges(groupId, date)`와 `GroupChallengeResponse[]`를 그대로 사용한다. `date`를 전달해야 `memberProgress`가 포함된다.
- 백엔드는 soft-delete되지 않은 챌린지를 `createdAt DESC`로 반환한다. 앱은 `ACTIVE|INACTIVE` 전체를 **필터·재정렬하지 않고** 렌더한다.
- 현재 백엔드에는 `UPCOMING` 상태가 없다. 카드가 예정 챌린지를 합성하거나 `startsAt/endsAt` 기반으로 한 개를 고르지 않는다. `INACTIVE`도 현행 전체 방과 동일하게 목록에 남는다.
- compact row의 기본 문구는 현행 `missionLabel(challenge) ?? categoryLabel(challenge)`를 재사용한다. 서버에 없는 고유 제목·연속일·단일 진행률을 만들지 않는다.
- 카드 뒷면은 `GroupChallengeList variant="compact"`로 응답 전건을 표시한다. 전체 방도 같은 배열을 기존 `ChallengeCard`에 전달한다. 두 화면의 정보 밀도는 달라도 목록 신원·상태·순서는 같다.
- 전체 방의 어제 챌린지 조회는 결과 모달 후보 계산 전용으로 유지하며, 화면의 현재 챌린지 목록에는 섞지 않는다.

### 3.4 로딩·캐시·무효화

- detail·announcements·challenges와 화면 공유 현재 집중 상태 데이터는 각각 `idle → loading → ready|error` 상태를 갖고, 현재 집중 상태 데이터에는 별도 `coverage-unknown` 상태가 있다. detail/challenges cache key는 `groupId + date`, announcements key는 `groupId`, 현재 집중 상태 key는 `userId + date`다.
- `useGroupFocusStatus`는 같은 날짜의 in-flight promise와 ready 원본 배열을 공유한다. 여러 카드의 뒷면을 빠르게 처음 열어도 `/api/v1/league/me/ranking`은 refresh cycle당 한 번만 호출하며 카드별 요청으로 증폭시키지 않는다.
- 같은 화면 세션에서 앞/뒤를 반복할 때 각 ready cache를 즉시 사용한다. 카드 전용 cache type은 만들지 않는다.
- 날짜가 바뀌면 detail·challenges와 현재 집중 상태 데이터를 새 date key로 조회한다. 앱 foreground·집중 시작/종료·pull-to-refresh에서는 화면 공유 현재 집중 상태 데이터를 한 번 갱신하고, detail/challenges와 필요한 공지를 기존 규칙대로 갱신한다.
- 요청 중 다른 카드로 이동해도 응답은 groupId key에만 쓴다. 현재 카드에 낡은 응답을 덮어쓰지 않는다.
- 한 요청의 실패는 해당 섹션에서만 retry한다. 현재 집중 상태 loading은 집중 영역 skeleton, 최초 error는 `집중 현황을 불러오지 못했어요 · 다시 시도`, 100행 coverage-unknown은 `집중 현황을 확인할 수 없어요`로 분리하며 모두 `0명`으로 표시하지 않는다. refresh 실패에 이전의 완전한 ready 데이터가 있으면 stale 표시와 함께 count를 유지할 수 있다.

---

## 4. 렌더 구현

캐러셀은 **Animated `FlatList` + `snapToInterval` + Reanimated**로 구현한다. 새 캐러셀 의존성을 추가하지 않고, 고정 카드 폭·간격에서 snap offset과 peek transform을 직접 계산한다.

- **가상화 경계**: 그룹 최대 10개 + 끝 카드 = 최대 11페이지다. 기본값에서 시작하되 양면 렌더와 detail·announcements·challenges cache가 추가되므로 저사양 기기 프로파일링 뒤 `windowSize`를 확정한다. 화면 공유 현재 집중 상태 데이터는 카드마다 복제하지 않고 상위 화면에서 한 벌만 보유한다.

### 4.1 끝 찾기 카드 — `ListFooterComponent`

`FindMoreCard`는 `ListFooterComponent`로 렌더한다. `data`에는 실제 그룹만 유지하며 sentinel이나 별도 트랙 아이템을 합성하지 않는다. footer는 index 밖이므로 마지막 페이지 이동은 `scrollToOffset`을 사용한다.

- footer 폭·높이·간격은 카드와 **동일하게** 준다. 어긋나면 `SNAP` 배수가 깨져 마지막 페이지에서만 스냅이 어긋난다(§9 H-7).
- `gap`으로 간격을 주면 footer에도 적용된다(컨텐츠 컨테이너의 flex 자식이므로). 아이템 마진 방식으로 갈 경우 **footer에 같은 마진을 직접 줘야 한다**.

### 4.2 카드 flip

- 앞면과 뒷면은 같은 card shell 안에서 동일한 width/height를 차지한다. flip 중 레이아웃 치수를 바꾸지 않는다.
- Reanimated의 shared value 하나(`0=front`, `1=back`)로 회전·opacity를 구동한다. 중간 프레임에서 두 face의 텍스트가 동시에 읽히지 않게 접근성 상태는 애니메이션 시작과 함께 전환한다.
- 앞면 탭은 `flippedGroupId`만 바꾸며 `onSelect`를 호출하지 않는다.
- 뒷면이 active면 앞면 전체를 접근성 트리·포인터에서 제외하고, 앞면이면 반대로 한다.
- Reduce Motion에서는 3D 회전 대신 짧은 cross-fade 또는 즉시 교체하되 상태와 포커스 순서는 동일하다.
- 페이지 swipe 시작 시 현재 카드를 앞면으로 정규화한다. full GroupRoom에서 돌아오는 경우만 source group의 뒷면을 복원한다.

### 4.3 grip drag/drop

- gesture 시작점은 `GroupCardFront` 우상단 grip뿐이다. 카드 몸체의 pan은 carousel, tap은 flip으로 예약한다.
- 프로덕션 grip은 공용 `components/reorder/ReorderHandle`을 사용한다. 현행 통계 화면과 같은 `MaterialCommunityIcons name="drag-vertical"`과 36×36 hit box를 렌더하고 색상 토큰·접근성 action을 한곳에서 관리한다.
- grip pan이 활성화되면 FlatList `scrollEnabled=false`, 해당 카드 lift/translate, 인접 카드 shift를 적용한다.
- drop index는 안정적인 `orderedGroupIds`로 계산한다. visual index나 `GroupSummaryResponse[]` mutation에 의존하지 않는다.
- drop 직후 로컬 `orderedGroupIds`를 낙관적으로 갱신하고, 해당 `userId` bucket에 best-effort로 저장한다. 저장 실패는 현재 세션 순서를 rollback하지 않고 non-blocking inline 실패 상태로 전달한다. 성공 문구는 노출하지 않는다.
- keyboard/screen-reader custom action도 같은 `moveGroup(groupId, targetIndex)` 명령을 호출한다.

`CardOrderEditor` 전체 재사용은 금지한다. 공용 추출 경계는 다음과 같다.

| 공용 `components/reorder/` | 통계 전용 | 그룹 캐러셀 전용 |
| --- | --- | --- |
| `ReorderHandle`의 아이콘·hit target·접근성, `moveStableId()` | 가변 높이 측정, Y축 slot, 세로 auto-scroll, absolute freeze | 동일 폭 카드 중심점, X축 target, 가로 edge scroll, `FlatList.scrollEnabled` 중재 |

이 경계면 수직·수평 알고리즘의 좌표계를 억지로 일반화하지 않으면서 사용자에게는 같은 grip과 같은 순서 변경 의미를 제공한다. `CardOrderEditor`도 추출 후 공용 handle·pure move 함수를 소비하도록 바꾼다.

### 4.4 긴 그룹 이름

- 카드 앞면 이름은 최대 2줄, 검색 결과·일반 목록행과 좁은 카드 뒷면 헤더는 최대 1줄로 고정하고 넘치는 시각 텍스트에 tail ellipsis를 적용한다. 긴 이름 때문에 카드 높이·CTA·grip 위치를 밀지 않는다.
- line clamp는 표시 규칙일 뿐 데이터 절단 규칙이 아니다. 접근성 label·flip/reorder/route announcement에는 서버에서 받은 `group.name` 원문 전체를 사용하고 ellipsis 문자나 잘린 문자열을 넣지 않는다.
- 동일 interactive parent가 카드 전체 접근성 label을 소유하면 자식 이름 Text는 중복 announcement에서 제외한다. 검색·목록행처럼 이름 Text가 label을 소유하는 경우에도 `accessibilityLabel`은 원문 전체다.

---

## 5. 상태 관리

- `scrollX`(reanimated shared value) + `activeIndex`(파생) — carousel 로컬.
- `flippedGroupId: string | null` — 동시에 한 장만 뒷면. face 자체는 navigation history에 넣지 않는다.
- `detailByKey: Map<groupId:date, AsyncState<GroupDetailResponse>>` — 멤버 ID·인원·preview의 현행 상세 응답 캐시. `isFocusing` 필드를 추가하지 않는다.
- `focusStatusByUserAndDate: Map<userId:date, FocusStatusState>` — category 없는 `/api/v1/league/me/ranking`의 전체 사용자 현재 집중 상태 원본 최대 100행을 화면 전체에서 공유하는 캐시. 인증 계정 변경 시 폐기한다.
- `focusStatusByUserId: Map<userId, boolean>` — 완전한 현재 집중 상태 데이터의 `isFocusing === true`를 index한 파생값. loading/error/coverage-unknown 상태에서는 만들지 않는다.
- `announcementsByGroupId: Map<groupId, AsyncState<GroupAnnouncementResponse[]>>` — 현행 최신순 공지 응답 캐시. 카드에는 첫 1개만 투영.
- `challengesByKey: Map<groupId:date, AsyncState<GroupChallengeResponse[]>>` — 현행 챌린지 응답 캐시. 카드 compact projection 외 필터·정렬을 적용하지 않는다.
- `orderedGroupIds: string[]` — 서버 목록과 현재 계정의 기기 로컬 순서를 reconcile한 현재 표시 순서.
- `orderHydrated: boolean` — 서버 목록과 AsyncStorage 읽기가 끝나 reconcile된 순서를 안전하게 그릴 수 있는지 표시.
- `orderSaveError: boolean` — 마지막 로컬 쓰기 실패를 캐러셀 상단 inline 상태와 polite live region에 한 번 전달. 다음 저장 성공 시 조용히 해제.
- `cardEmojiByGroupId: Record<GroupId, GroupEmoji>` — 성공한 전체 서버 목록과 현재 계정 bucket을 reconcile한 개인 카드 표현. 조회 시 미설정 값은 `🎯`로 파생한다.
- `emojiHydrated: boolean` — 성공한 전체 `GET /groups`와 현재 계정의 로컬 read가 함께 끝났는지 표시. 목록 실패·부분 응답으로 reconcile하지 않는다.
- `emojiSaveErrorByGroupId: Record<GroupId, boolean>` — 로컬 저장 실패 시 현재 화면 선택은 유지하고 해당 편집 화면의 inline polite 오류만 한 번 노출한다.
- `pendingEmojiByGroupId: Record<GroupId, GroupEmoji>` — 쓰기 실패 뒤 현재 실행에만 남는 최신 재시도 값. 다음 아이콘 변경·그룹 화면 활성화 성공 시 제거하며 앱 프로세스가 끝나면 마지막 정상 저장값으로 돌아간다.
- `reorderDrag` — active groupId·from/to index·translation. drop/cancel 뒤 반드시 해제한다.
- 화면 폭은 `useWindowDimensions()`(회전/스플릿 대응) 또는 컨테이너 `onLayout`으로 취득 → 카드 폭/스냅 계산의 입력.
- detail·announcements·challenges·현재 집중 상태 cache는 화면 로컬로 유지하고 AsyncStorage에 저장하지 않는다. AsyncStorage에는 계정별 `groupId[]` 순서와 별도 key의 `{[groupId]: emoji}` 개인 설정만 저장한다.
- GroupRoom route를 열 때 source `{ groupId, face: 'back', index }`를 화면 로컬에 보존하고, 정상 복귀 시 그 카드가 여전히 존재하면 뒷면과 위치를 복원한다.

---

## 6. API·props·권한 계약

### 6.1 계정별·기기 로컬 카드 이모지

`내 카드 아이콘` 선택값은 그룹 속성이 아니라 **현재 계정의 개인 카드 표현**이다. 같은 그룹도 계정이나 기기가 다르면 다른 이모지를 볼 수 있다.

```ts
export const GROUP_EMOJI_WHITELIST = ['🌅','📚','💻','⚡','🧘','🎨','🏃','✍️','🧠','🎯','🌿','🔥'] as const;
export type GroupEmoji = (typeof GROUP_EMOJI_WHITELIST)[number];
export const GROUP_EMOJI_FALLBACK: GroupEmoji = '🎯';

type GroupCardEmojiByUser = Record<UserId, Record<GroupId, GroupEmoji>>;

export const STORAGE_KEYS = {
  // 기존 key 유지
  groupCardEmoji: 'gromo:groups:cardEmoji:v1',
} as const;
```

1. 현재 `userId`와 성공한 **전체** `GET /groups` 응답을 받은 뒤 로컬 bucket을 읽고 reconcile한다. 전체 서버 목록에 속한 groupId의 정확한 12개 allowlist 값만 유지하며, stale·비문자열·미허용 값은 제거한다.
2. 저장값이 없는 신규 생성·새 가입 그룹과 손상·읽기 실패는 `🎯`로 렌더한다. 목록 요청이 실패했거나 부분 목록만 확보한 경우에는 membership 정본이 아니므로 로컬 key를 prune·수리 저장하지 않는다.
3. 선택 변경은 화면 상태에 즉시 반영하고, `gromo:groups:cardEmoji:v1`의 계정별 map을 직렬화된 read-modify-write로 best-effort 저장한다. 연속 선택과 다른 계정 bucket을 덮지 않도록 key 단위 Promise queue를 사용한다.
4. 쓰기 실패 시 현재 UI 선택을 rollback하지 않는다. `내 카드 아이콘을 저장하지 못했어요. 앱을 다시 열면 이전 아이콘으로 돌아갈 수 있어요.`를 해당 화면의 non-blocking inline 상태와 polite live region으로 한 번 알린다. 최신 실패값은 메모리 pending으로 두고 다음 아이콘 변경 또는 그룹 화면 활성화 때 다시 저장하며, 성공 시 오류만 조용히 지우고 성공 toast는 표시하지 않는다.
5. 같은 계정·같은 기기의 앱 재시작에서는 복원된다. 다른 계정 bucket과 섞이지 않으며 다른 기기, 앱 삭제·재설치, 앱 데이터 초기화에는 동기화·복구되지 않는다.
6. 생성 화면 picker는 local draft다. `CreateGroupRequest` body에는 넣지 않고, `POST /groups` 성공으로 새 `groupId`를 받은 뒤에만 그 계정 bucket에 persist한다. 생성 취소·실패에는 저장하지 않는다.
7. `GroupSettings`의 `내 카드 아이콘`은 OWNER와 MEMBER 모두에게 보이며 같은 로컬 editor를 연다. `GroupProfileEdit`, OWNER PATCH, 서버 role 검증과 분리하고 `이 기기에서 나에게만 보여요`를 고정 안내한다.
8. `CreateGroupRequest`, `UpdateGroupRequest`, `GroupSummaryResponse`, `GroupDetailResponse`, `GroupSearchResponse`, `GroupOverviewResponse`에 emoji나 `isFocusing`을 추가하지 않는다. 백엔드 `Group`/DTO/service, `groups` 테이블, migration, OpenAPI, `INVALID_GROUP_EMOJI`를 변경하지 않는다.

앞면 배경색 역시 DTO가 아니다. 모든 카드가 로컬 토큰 `#5E6AD2`를 사용하며 `tone`, `gradient`, `lineIcon` 같은 그룹별 필드를 추가하지 않는다.

### 6.2 `GroupListScreenProps`와 navigation 의미

```ts
export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  onSelect: (groupId: string) => void; // 뒷면 '방 전체 보기' 전용
  onFocus: (groupId: string) => void;
  onOpenSettings: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
}
```

- 시그니처는 유지하지만 **`onSelect` 호출 의미가 바뀐다.** 앞면 탭은 로컬 flip이고, 뒷면 `방 전체 보기`만 `onSelect(groupId)`를 호출한다.
- `onRefresh`는 시그니처만 유지하고 캐러셀에서 직접 호출하지 않는다. 포커스 재조회가 목록 갱신을 담당한다.
- 설정·집중 진입은 `GroupScreen`이 소유한 `onOpenSettings(groupId)`·`onFocus(groupId)` callback으로 위임하고 기존 navigation contract를 사용한다.
- 헤더와 끝 카드의 찾기는 같은 `onFind()`를 호출한다.

### 6.3 계정별 기기 로컬 그룹 순서

`GET /groups`는 멤버십·DTO 정본으로 남기고, grip drag/drop으로 바꾼 표시 순서만 AsyncStorage에 기기 로컬로 유지한다.

- 중앙 key는 `STORAGE_KEYS.groupCardOrder: 'gromo:groups:cardOrder:v1'`, 값은 `{ [userId]: string[] }`다. 통계의 기기 전역 `statsCardOrder` 패턴을 그대로 복사하지 않고 현행 장비·보유 아이템·캐릭터와 같은 계정별 map 관행을 따른다.
- 서버 목록과 현재 `userId` bucket을 모두 읽은 뒤 reconcile한다. 남아 있는 ID의 상대 순서를 유지하고, 새 ID는 서버 순서대로 뒤에 붙이며, 사라진·중복 ID를 제거한다. `FindMoreCard`는 저장 값에 들어가지 않는다.
- reconcile 결과가 저장값과 다르면 수리된 `groupId[]`를 해당 계정 bucket에 best-effort로 다시 저장한다. 손상된 JSON·타입·읽기 실패는 서버 순서로 fallback한다.
- drop과 보조기술 이동 action은 동일하게 낙관적 `orderedGroupIds`를 먼저 갱신하고, 계정별 map read-modify-write를 직렬화해 저장한다.
- 저장 실패는 현재 세션 순서를 rollback하지 않고 non-blocking inline 실패 상태로 알린다. UI는 `저장됨`이나 `다른 기기에도 반영됨` 같은 완료 문구를 표시하지 않는다.
- 순서는 앱 삭제·기기 데이터 초기화 시 소실되고 다기기 동기화되지 않는다. 서버 order API를 추가하지 않는다.

### 6.4 설정 권한 — 현행 GroupSettings 재사용

| 역할 | 설정 항목 | 권한·저장 |
| --- | --- | --- |
| OWNER | 내 카드 아이콘 · 그룹 프로필 설정하기 · 방장 넘기기 · 멤버 관리 · 공지 권한 · 그룹 나가기 | 카드 아이콘은 개인 로컬, 다음 4개 OWNER only, 나가기는 멤버 공용 |
| MEMBER | 내 카드 아이콘 · 그룹 나가기 | 카드 아이콘은 개인 로컬, 나가기는 멤버 공용 |

- 카드 뒷면과 전체 방의 `⋯`는 모두 현행 root stack `GroupSettings({ groupId })`로 이동한다. 별도 role sheet를 새로 만들지 않는다.
- `내 카드 아이콘`은 역할과 무관하게 `GroupCardEmojiEdit({ groupId })`로 이동하며 AsyncStorage만 갱신한다. 설명 `이 기기에서 나에게만 보여요`를 행 또는 편집 화면에 노출한다.
- 그룹 프로필 설정은 `GroupProfileEdit`와 기존 `PATCH /groups/{id}`를 사용하며 이름·소개·정원·공개 범위만 다룬다.
- 방장 넘기기는 `PATCH /groups/{id}/members/{targetUserId}/owner`, 멤버 관리는 기존 상세 조회와 `DELETE /groups/{id}/members/{targetUserId}`를 사용한다.
- 공지 권한은 `GET/PATCH /groups/{id}/settings`의 `announcementGrants` 계약을 사용한다.
- 그룹 나가기는 `DELETE /groups/{id}/members/me`를 사용한다. OWNER는 서버의 `HOST_WITHDRAW` 응답을 받으면 현행 `GroupOwnerTransfer(source:'withdraw')`로 유도한다.

---

## 7. 영향 범위 & 회귀

| 대상 | 영향 |
| --- | --- |
| `GroupScreen.tsx` | `onSelect` 시그니처는 유지. 뒷면 CTA route·방 복귀를 연결하고, 성공한 전체 서버 목록과 계정별 로컬 순서·이모지를 hydrate/reconcile |
| `GroupListScreen.tsx` | 캐러셀 + flip + 카드 뒷면을 처음 열 때 기존 detail·announcements·challenges lazy 조회 + 화면 공유 현재 집중 상태 데이터와 그룹 멤버 ID 조합 + grip reorder. 앞면 탭에서 `onSelect` 제거, reconcile 완료 전 순서 hydration 상태 처리 |
| `screens/group/components/` | `GroupFlipCard`·앞/뒷면·`GroupChallengeList` compact variant·공용 `GroupEmojiPicker`·가로 reorder controller 추가 |
| `components/reorder/` | 통계에서 공용 `ReorderHandle`·`moveStableId` 추출. 그룹과 통계가 함께 소비 |
| `screens/stats/CardOrderEditor.tsx` | 세로 drag controller는 유지하고 직접 아이콘·배열 이동만 공용 모듈로 교체 |
| `GroupCreateScreen.tsx` | 공용 12개 picker를 local draft로 유지. POST body에서는 제외하고 create 성공의 새 groupId에만 로컬 persist; 취소·실패에는 저장하지 않음 |
| `GroupSettingsScreen`·`GroupCardEmojiEditScreen` | OWNER·MEMBER 공용 `내 카드 아이콘` 행과 로컬 editor 추가. `이 기기에서 나에게만 보여요` 안내, 낙관적 표시·inline 저장 오류 처리 |
| `GroupProfileEditScreen.tsx` | `내 카드 아이콘`과 무관. 기존 서버 그룹 프로필 필드와 OWNER 권한만 유지 |
| `types/storage.ts`·그룹 local store | `groupCardOrder`와 별도로 `groupCardEmoji: 'gromo:groups:cardEmoji:v1'` 추가. `{[userId]: {[groupId]: emoji}}` 검증·reconcile·직렬화 쓰기 |
| `types/dto/group.ts`·`services/groupApi.ts` | emoji·`isFocusing` 변경 없음. 현행 `getGroupDetail`·`getAnnouncements`·`getChallenges` 재사용 |
| `services/leagueApi.ts`·`useGroupFocusStatus` | 기존 `getMyRanking()` 원본 응답을 category 없이 사용. 동일 날짜를 명시할 optional client 인자와, 전체 사용자 현재 집중 상태 원본 100행을 보존하는 그룹 전용 화면 캐시/in-flight dedupe 추가. `useSessionLeagueMembers`의 12명 slice 결과는 재사용하지 않음 |
| 백엔드 `Group`·DTO·service | 변경 없음. 그룹 상세 `members[]`에는 기존 필드만 유지하고 `FocusLiveInfoLookup`·`@JsonProperty` mapping을 추가하지 않음 |
| DB migration·OpenAPI | 변경 없음. emoji·현재 집중 상태 컬럼·schema·새 API path 모두 추가하지 않음 |
| 기존 그룹 조회 API | controller/service 경로 추가 없음. detail·announcements·challenges의 권한·정렬·부분 실패 계약을 카드와 전체 방에서 함께 회귀 검증 |
| `GroupSettingsScreen` 및 하위 route | 기존 허브에 공용 로컬 `내 카드 아이콘` route만 추가. OWNER는 기존 관리 4항목+나가기, MEMBER는 기존 나가기를 유지 |
| `GroupRoomScreen` | 현행 detail·announcements·오늘/어제 challenges `Promise.allSettled`와 응답 전건 `map`을 유지. 카드도 같은 API 계약과 부분 실패 원칙을 따름 |
| 테스트 | 카드 뒷면을 처음 열 때 기존 3 API 병렬 호출·독립 실패/캐시, 화면 공유 현재 집중 상태 원본 1회 조회·ID join·90/100 규모 게이트·공지 첫 행·멤버 preview, 계정별 순서·로컬 이모지, create draft, 챌린지·role 회귀 |
| 계측 | 카드 데이터 전용 loaded/action 이벤트는 만들지 않는다. `group_card_flipped`·`group_card_reordered`와 기존 GroupRoom 진입 계측의 중복/누락만 QA |

---

## 8. testID 매핑 (테스트 연속성)

현행 루트 ID는 유지하되 양면·액션·grip은 서로 다른 ID를 갖는다.

| testID | v0.8 대상 |
| --- | --- |
| `group.list` | 유지(루트) |
| `group.list.items` | 캐러셀 트랙에 유지 |
| `group.list.card.<groupId>` | 양면 card shell |
| `group.list.card.<groupId>.front` | 앞면 flip target |
| `group.list.card.<groupId>.grip` | 재정렬 시작점 |
| `group.list.card.<groupId>.back` | 카드 뒷면 |
| `group.list.card.<groupId>.detail.retry` | 상세 멤버·인원 섹션 재시도 |
| `group.list.card.<groupId>.live.retry` | 화면 공유 현재 집중 상태 조회 재시도(동일 date in-flight dedupe) |
| `group.list.card.<groupId>.announcements.retry` | 공지 섹션 재시도 |
| `group.list.card.<groupId>.challenges.retry` | 챌린지 섹션 재시도 |
| `group.list.card.<groupId>.focus` | 집중 CTA |
| `group.list.card.<groupId>.room` | full GroupRoom CTA |
| `group.list.card.<groupId>.settings` | role별 설정 |
| `group.list.create` / `group.list.find` | 헤더 아이콘 버튼 |
| `group.list.find.card` | 끝 찾기 footer |

앞면 `group.list.card.<groupId>.front` press는 flip만, 뒷면 `*.room` press는 `GroupRoom` route 진입만 정확히 한 번 수행해야 한다.

---

## 9. 리스크(설계 레벨)

| # | 리스크 | 완화 |
| --- | --- | --- |
| H-1 | scale 애니메이션이 스냅 치수를 흔듦 | **폭은 불변, scale만**(UX §4). 스냅은 레이아웃 폭 기준 |
| H-2 | 화면 회전/폭 변화 시 스냅 어긋남 | 폭을 `useWindowDimensions`로 반응 취득 → 파생 재계산 |
| H-3 | 카드 tap·carousel swipe·grip drag가 충돌 | 시작 영역과 gesture priority를 분리하고 기기 테스트로 인식 임계를 확정 |
| H-4 | flip 중 양면이 동시에 보조기술에 노출 | active face만 접근성 트리·pointer에 남기고 포커스를 새 face의 제목으로 이동 |
| H-5 | 카드마다 기존 API 세 호출이 발생 | 활성 카드의 뒷면을 처음 열 때만 detail·announcements·challenges를 `Promise.allSettled`로 병렬 호출하고 각 응답 cache 사용. 현재 집중 상태 데이터는 date별 화면 공유 query 한 번으로 dedupe |
| H-6 | 현재 집중 상태 snapshot이 오래됨 | foreground·집중 시작/종료·pull-to-refresh에서 화면 공유 현재 집중 상태 데이터를 한 번 무효화·재조회. 시간 tick은 표시하지 않음 |
| H-7 | footer 치수가 아이템과 어긋남 | footer 폭/높이/간격을 카드와 같은 상수에서 파생; 마지막 페이지 스냅 QA |
| H-8 | footer는 `scrollToIndex` 대상이 아님 | 마지막 점 이동만 `scrollToOffset({ offset: SNAP * groups.length })` |
| H-9 | 로컬 순서가 다기기 동기화로 오해됨 | 성공·동기화 문구를 쓰지 않고 기기 로컬 범위를 테스트·문서에 고정 |
| H-10 | 전역 emoji key로 다른 계정의 개인 설정이 노출됨 | `{[userId]: {[groupId]: emoji}}` bucket으로 격리하고 `userId` 없이는 읽기·쓰기하지 않음 |
| H-11 | 설정 진입 후 다른 기기에서 role이 바뀜 | 현행 `GroupSettingsScreen`처럼 focus마다 상세 재조회 후 OWNER 행을 다시 판정 |
| H-12 | 사용자 효과를 내부 선호로 오판 | 성장 KPI 금지. §11 사용성·품질·계측 준비 게이트만 적용 |
| H-13 | 현행 36×36 grip이 44pt 권장 target보다 작음 | 공용 컴포넌트에 위험을 명시하고 VoiceOver/TalkBack custom action을 제공. 오탭·미탭 실기 결과 전까지 접근성 충족을 주장하지 않음 |
| H-14 | 전역 order key로 계정 순서가 누출됨 | `{[userId]: groupId[]}` bucket으로 분리하고 `userId` 없이 읽기·쓰기 금지 |
| H-15 | 연속 drop·bucket read-modify-write가 나중 상태를 덮음 | 해당 key 쓰기를 직렬화하고 매 작업마다 최신 map을 재로드 |
| H-16 | 손상·중복·탈퇴 그룹 ID가 렌더됨 | 서버 ID set으로 검증·중복 제거·수리 저장, 읽기 실패는 서버 순서 fallback |
| H-17 | 로컬 emoji write 실패·연속 선택·create 성공 직후 저장이 서로 덮음 | key 단위 직렬화 RMW, 낙관적 UI 유지, inline polite 오류. create는 성공 groupId 확정 뒤만 persist |
| H-18 | 고정 pageCount 임계가 작은 화면에서 overflow하거나 큰 화면 공간을 낭비 | 실제 indicator/container 폭에서 40pt gutter를 뺀 available과 dot hit width/gap의 required를 비교. mode는 carousel 상태와 분리된 파생값 |
| H-19 | 긴 이름이 카드 높이·CTA를 밀거나 보조기술에도 잘린 이름이 전달됨 | 앞면 2줄, 검색/목록행·좁은 뒷면 헤더 1줄 tail ellipsis. 접근성 label은 항상 원문 전체 사용 |
| H-20 | 실패·부분 그룹 목록으로 emoji stale key를 지움 | 성공한 전체 `GET /groups`에서만 reconcile/prune하고, 실패·부분 목록에서는 현재 local bucket을 보존 |
| H-21 | eligible 사용자가 100명에 도달해 top-100 밖 그룹원이 `false`로 오판됨 | 90~99명 warning, 응답 100행은 coverage-unknown telemetry·count 미산출. eligible 사용자 100명 도달 전 pagination·그룹 상세 현재 집중 상태 필드·batch 현재 집중 상태 endpoint 중 하나로 전환하는 release gate 적용 |
| H-22 | 카드마다 `/api/v1/league/me/ranking`을 호출해 요청이 증폭됨 | GroupScreen 소유 date cache와 in-flight promise를 모든 카드가 공유하고, 12명 slice 훅 대신 원본 전용 hook 사용 |

---

## 10. 범위 경계

- `내 카드 아이콘`은 서버 그룹 속성이 아니다. OWNER·MEMBER 모두 `GroupSettings → 내 카드 아이콘`에서 현재 계정·기기의 카드 표현을 바꿀 수 있고, 다른 사용자·기기에는 보이지 않는다.
- 생성 picker는 local draft이며 그룹 생성 성공 뒤 반환된 groupId에만 저장한다. 신규·가입 그룹의 미설정 기본은 `🎯`다.
- 카드 순서는 계정별·기기 로컬로 재실행 후에도 유지하지만 앱 삭제·데이터 초기화 시 소실되고 다기기 동기화는 제공하지 않는다.
- member preview는 최대 5명이며, 앱이 요청 사용자를 먼저 분리한 뒤 나머지는 기존 detail 응답의 상대 순서를 그대로 유지한다. `joinedAt` 계약은 추가하지 않는다.
- 카드는 완전한 전체 사용자 현재 집중 상태 데이터에서 `isFocusing === true`인 userId와 그룹 상세 `members[].userId`를 join해 `${n}명 집중 중`만 표시한다. 해당 데이터에 없는 ID는 100명 미만 게이트 안에서만 false다.
- 챌린지는 `ACTIVE|INACTIVE` 전건을 서버 `createdAt DESC` 순서 그대로 표시한다.

---

## 11. 출시 전 검증 게이트

카드 기능의 행동 baseline은 아직 없고 현재 eligible 사용자는 100명 미만이다. 아래는 사업 효과가 아니라 구현 가능성, 규모 가정, 과업 이해를 확인하는 게이트다.

- **사용성:** 앞면 탭→뒷면, 뒷면→전체 방, grip 재정렬을 설명 없이 수행하는지 관찰.
- **상태:** 그룹 1·5·10개, local emoji 미설정/무효/읽기·쓰기 실패/연속 변경, detail/현재 집중 상태/announcements/challenges 독립 loading/error/empty, 현재 집중 상태 0/N명 및 userId join, 챌린지 0/1/복수 및 ACTIVE/INACTIVE 혼합, 공지 없음.
- **순서 저장:** 계정 A/B 분리, 신규·탈퇴·중복·손상 저장값 reconcile, 읽기/쓰기 실패 fallback, 재실행 복원, 다기기 미동기화를 검증한다.
- **이모지 저장:** 계정 A/B·그룹 ID 격리, 성공한 전체 목록에서만 reconcile, 실패·부분 목록에서 무삭제, 같은 계정·기기 재실행 복원, 타기기·재설치 미동기화, create 성공 후 저장·취소/실패 무저장을 검증한다.
- **권한:** `내 카드 아이콘`은 OWNER·MEMBER 모두 노출되고 로컬에서만 동작한다. OWNER에는 그 밖의 관리 4항목과 그룹 나가기, MEMBER에는 그 밖에 그룹 나가기만 노출되며 서버 관리 API는 기존 권한을 강제한다.
- **접근성:** face 전환 포커스, grip custom action, Reduce Motion, 현행 36×36 grip의 미탭 위험, route 복귀.
- **responsive indicator:** 320/390/430/768pt에서 폭 공식을 검증하고, dots↔`n / total` 전환이 active index/groupId·scroll offset·announcement를 바꾸지 않는지 확인한다.
- **긴 이름:** 긴 한글, 공백 없는 영문, 연속·조합 이모지 이름이 앞면 2줄/검색·목록행·좁은 뒷면 1줄을 넘지 않고, VoiceOver/TalkBack에는 원문 전체가 전달되는지 확인한다.
- **호환:** 기존 Create/Update/Summary/Detail/Search/Overview DTO가 emoji·`isFocusing` 추가 없이 그대로 동작하고, 현행 공지 최신순·`ACTIVE|INACTIVE` 챌린지 응답을 검증한다.
- **회귀:** 앞면 press에서 GroupRoom이 열리지 않고, 뒷면 `*.room`에서만 정확히 한 번 열린다.
- **기존 API 회귀:** category 없는 `/api/v1/league/me/ranking?date` 원본에 `isFocusing` 값이 있고, 그룹 detail의 기존 멤버 필드, announcements 최신순, challenges의 date·상태·정렬 계약이 카드 도입 뒤에도 유지된다.
- **규모 게이트:** eligible 사용자 수와 raw response 길이를 관측한다. 90~99명은 warning과 전환 작업 착수, 100행 응답은 coverage-unknown telemetry와 count 미산출 상태다. 이를 `0명`으로 표시하지 않는다.
- **전환 TODO:** 100명 도달 전에 그룹 상세의 멤버별 현재 집중 상태 필드, userId batch 현재 집중 상태 endpoint, 또는 `/api/v1/league/me/ranking` pagination 중 하나의 서버 계약을 선택·배포한 뒤 top-100 join을 제거한다.
- **계측 준비:** flip·full-room·reorder 이벤트의 중복/누락과 속성만 staging에서 검증한다. 카드 데이터 전용 loaded/action 이벤트는 추가하지 않는다.

리텐션·재방문·전환율 개선은 이 HLD의 성공 기준이 아니다. 실제 사용자 데이터가 쌓인 뒤 별도 제품 지표로 정의한다.
