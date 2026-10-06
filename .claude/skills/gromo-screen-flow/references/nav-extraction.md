# 화면 이동 지도 뽑기

코드를 읽어 "화면, 무엇을 누르면, 도착 화면"을 데이터로 만든다. 화살표를 추측이 아니라 코드에서 뽑기 위한 단계다.

## gromo 코드 구조 (2026-10-05 기준 — 바뀌었는지 먼저 확인)

- 네비게이션 라이브러리가 없다. 화면 주소는 `Route` 유니온 타입(`src/services/model.ts`), 이동은 `src/App.tsx`의 `go('route')` / `setRoute` / `reset` / `replace`.
- 화면 분배는 `src/screens/island/CurrentScreens.tsx`(App.tsx가 `RedesignScreens`로 import). **여기가 먼저 가로채기 때문에 `src/screens/island/Screens.tsx`의 같은 route 분기는 실행되지 않는다.** 그 코드를 근거로 이동을 뽑으면 틀린 화살표가 나온다. 확인된 죽은 구간: hall/stats/ledger/manage/members/construction/board/quest/notice 분기(3299~4494줄 근처), mail 시트(4787줄~), travel·arrival(2356줄), focus 계열(2519~3221줄), 옛 로그인(1230~1449줄).
- 실제로 그리는 곳:
  - 홈: `src/screens/island/WorldMap.tsx`의 `FinalIsland` (`Screens.tsx`가 `IslandHome`이라는 이름으로 가져다 씀)
  - 회관: `src/screens/island/Hall.tsx`
  - 게시판·우체통: `src/screens/interiors/BuildingInteriors.tsx`
  - 도서관: `src/screens/island/Library.tsx`, `src/screens/island/library/Diary.tsx`
  - 집중: `src/screens/island/CurrentScreens.tsx`의 `FocusFlow`, `src/screens/focus/FishingIsland.tsx`, `src/screens/focus/RestGroup.tsx`
  - 상점·뗏목·프로필·설정·친구·전망대: `src/screens/island/Screens.tsx`의 시트들
- 공용 시트는 **×·바깥 탭이 직전 화면이 아니라 홈으로** 간다. ‹ 뒤로만 직전 화면이다.
- iOS에서 `board`·`quest`로 가는 이동은 최초 1회 `permission`으로 우회한다.
- 연습용 모드(웹 `?review`·`?demo`, 네이티브 `EXPO_PUBLIC_DEMO=1`)와 서버 모드가 공존한다. 판정은 `src/services/demoMode.ts` — 2026-10-05에는 아직 커밋되지 않은 파일이었다.
- 몽돌 튜토리얼은 `state.tutorial.step` 0~21(13은 없음). 0~3 `guide`, 4 `home`, 5~6 `fishingArrival`, 7~8 `focusSetup`, 9~18 `focus`(15는 `rest`), 19~21 `focusResult`.

## 담당 나누기

파일이 수천 줄씩이라 한 에이전트가 다 읽을 수 없다. route 묶음으로 나눈다.

| 파일 이름 | route |
|---|---|
| `nav-onboarding-home.json` | login, character, chooseIsland, createIsland, joinIsland, approval, arrival, guide, home, permission |
| `nav-focus.json` | focusSetup, focus, rest, focusResult, sound, travel, focusTravel, returnTravel, fishingArrival, focusVisit, visitIslandFocus, screenTimeApps |
| `nav-hall-board-library.json` | hall, stats, manage, members, ledger, construction, board, notice, noticeEdit, quest, questEdit, library, diary |
| `nav-tower-mail-friends.json` | tower, explore, visit, visitIsland, mail, friendMail, friends, friendSearch, chat |
| `nav-shop-boat-settings.json` | shop, product, orders, boat, mainIsland, profile, settings, blockedUsers, wardrobe |

새 route가 생겼으면 `Route` 타입을 읽어 어느 묶음에 넣을지 정하고 `scripts/sections.cjs`도 고친다.

## 에이전트 지시문 (묶음마다 route 목록과 파일 이름만 바꿔 쓴다)

핵심은 세 가지다: 죽은 코드를 근거로 삼지 말 것, 핸들러를 실제로 읽을 것, id 규칙을 지켜 결과가 기계적으로 합쳐지게 할 것.

```
## 목표
gromo 2.0 앱(<레포>/app/app-dev)의 "화면 이동 지도"를 코드에서 뽑는다. 피그마에 "화면 → (무엇을 누르면) → 화면"
화살표 흐름도를 그리는 데 쓴다. 여러 에이전트가 묶음을 나눠 맡았고 너는 <묶음 이름>만 맡는다.

## 네 묶음의 route
<route 목록> — <이 묶음에서 특히 빠뜨리기 쉬운 것>

## 코드 구조
<위 "gromo 코드 구조"에서 이 묶음에 해당하는 것을 붙인다>
파일이 매우 크다. grep 으로 찾고 필요한 범위만 읽어라. 세로 화면만. 개발용 화면(route 'demo', 미리보기)은 제외.

## 기록할 것
nodes — 사용자가 별개의 화면으로 인식하는 것: route 기본 화면, 의미 있는 상태(탭, 비었음/채워짐, 방장/주민/방문자,
권한 없음), 바텀시트, 팝업, 확인창, 전환 장면. 토스트는 어떤 동작의 유일한 결과일 때만.
edges — 버튼 탭, 탭 전환, 자동 전환(trigger 를 "자동"으로 시작). 단순 뒤로/닫기로 직전 화면에 돌아가는 것은 제외
(직전이 아닌 곳으로 가면 기록). 각 간선은 실제 핸들러를 읽고 확인. 확신 없으면 unsure 에.

## ID 규칙
route 기본 상태 = route 이름 그대로("board"). 하위 상태·팝업 = "<route>.<camelCase>"("board.noticeTab").
묶음 밖 route 로 가는 간선의 to 는 route 이름만 쓰고 그 노드는 설명하지 않는다.

## 출력 — 이 파일 하나만 쓴다 (레포 수정 금지, git 상태 변경 금지)
<WF>/nav-<묶음>.json
{ "domain": "...",
  "nodes": [{ "id", "route", "kind": "screen|state|sheet|popup|confirm|cutscene|toast", "title": "한국어 짧은 이름",
              "source": "src/...:줄", "reach": "도달 방법 한 줄", "condition": "보이는 조건 또는 빈 문자열",
              "uiText": ["화면을 식별할 실제 문구 1~3개"] }],
  "edges": [{ "from", "to", "trigger": "누르는 대상의 실제 라벨", "source": "src/...:줄", "condition": "" }],
  "unsure": ["확신하지 못한 것"] }
쓴 뒤 JSON 이 파싱되는지, 모든 edge 의 from 이 nodes 에 있는지 확인하라.

## 최종 보고 (짧게)
kind 별 노드 수, 간선 수, unsure 목록, 다른 묶음 담당이 알아야 할 것.
```

`uiText`와 `reach`는 다음 단계(캡처)에서 그 상태에 도달하는 단서가 되고, `trigger`는 버튼을 찾는 단서가 된다. 실제 화면 문구를 그대로 적게 한다.

## 합치기

`node $SK/merge.cjs` 가 하는 일과, 손볼 수 있는 곳:

- **빼는 것**: id가 `.loading` `.error` `.listError` `.forbidden` `.sendFailed`로 끝나거나 제목에 "불러오는 중/불러오기 실패"가 든 노드, kind가 toast인 노드(출발 화면의 메모로 옮김), `unusedRoutes`(들어가는 길이 없다고 확인된 route — 현재 `members`, `stats`, `friendSearch`). 이 목록과 아래 `alias`는 스킬의 `scripts/merge.cjs` 안에 있고, 앱이 바뀌면 거기를 고친다.
- **합치는 것**: 여러 건물에 똑같이 걸리는 공용 가드 팝업은 `guard.noIsland` / `guard.residentsOnly` / `guard.notBuilt` 하나씩으로. 묶음마다 다른 id로 적힌 같은 전역 팝업은 `alias`에 추가한다(예: 회원 전환 시트).
- **출력의 `orphans`**: 들어오는 화살표가 없는 화면이다. 진짜 진입점인지, 조건에 따라 보이는 상태인지, 죽은 화면인지 본다. 상태는 그림에서 기본 화면에 점선으로 붙는다.
- `dangling`이 0이어야 한다. 0이 아니면 어떤 묶음이 없는 id를 가리킨 것이다.

각 에이전트의 "다른 묶음 담당이 알아야 할 것"을 읽고, 묶음 사이에 빠진 간선이 없는지 한 번 본다. 지난번에는 "홈 쪽지 → quest.homeList", "구경 중 홈 → manage.visitor"처럼 도착 id가 미묘하게 다른 것들이 있었다.
