# 웹 연습용 모드로 캡처하기

## 왜 웹인가

웹 빌드에 `?review=1`을 붙이면 앱이 검수용 손잡이 `window.__gromoReview`를 연다(`src/App.tsx`의 REVIEW 블록). 가짜 데이터 상태를 받아 고치고, 원하는 화면을 바로 열 수 있다. 시뮬레이터에는 이 손잡이가 없어서 화면마다 실제로 눌러 가야 한다. 그래서 웹을 기본으로 하고, 웹에서 안 뜨는 화면만 시뮬레이터로 보완한다.

- `fixture(true)` → 목업 상태. `open(route, { state, detail, tab, text, body, travel, guideStep, failNext })` → 그 상태를 넣고 화면으로 이동.
- 팝업·시트 안쪽은 그 뒤 실제 버튼을 눌러 연다.

## 준비

```sh
SK=<레포>/.claude/skills/gromo-screen-flow/scripts; WF=<작업 폴더>; export GROMO_APP=<레포>/app/app-dev
# 웹 빌드 (코드가 바뀌었을 때. 10여 초)
cd $GROMO_APP && CI=1 npx expo export --platform web --output-dir $WF/web-dist
# 서버 — 백그라운드로. 18762 는 레포의 기존 검수 스크립트들이 쓰던 포트
python3 -m http.server 18762 --bind 127.0.0.1 --directory $WF/web-dist
```

레포의 `scripts/capture-phone-screens.cjs`는 낡아서 중간에 죽는다. 쓰지 않는다. 레포의 `dist/`도 오래된 것이다.

## 하네스

`scripts/capture.cjs` — 설정 파일의 한 줄이 한 장이다. 예시는 `scripts/capture-example.cjs`.

```sh
CAPTURE_CONFIG=$WF/capture/cfg-tower-mail.cjs CAPTURE_OUT=$WF/shots/tower-mail node $SK/capture.cjs
node $SK/contact-sheet.cjs $WF/shots/tower-mail     # 모아보기 _sheet-*.png
```

지난 실행의 설정을 다시 돌릴 때는 **그 설정 파일 머리말에 적힌 명령**을 쓴다. 담당에 따라 공용 하네스가 아니라 사본(`capture-hall.cjs` 등, 브라우저 안에서만 번들을 고치는 패치가 들어 있다)으로 돌려야 하거나, 순번을 골라 여러 번 돌려야 한다.

| 종류 | 옵션 |
|---|---|
| 화면 지정 | `route`(필수), `detail`, `tab`, `text`, `body`, `travel`, `failNext` |
| 튜토리얼 | `guideStep` — 기본 99(안내 끝). 0~21을 주면 그 단계 |
| 상태 프리셋 | `fresh`, `stage`, `session`, `paused`, `owned`, `pending`, `noPermission`, `records: false`, `npcGuide: true`, `name`, `night: true` |
| 임의 상태 | `mutate: (s, is) => { is.fish = 500 }` — 소스 문자열로 브라우저에 넘어가므로 바깥 함수를 부르지 못한다 |
| 조작 `steps` | `click`(글자), `label`(접근성 이름), `fill`, `tap`, `zoom`, `drag`, `scroll: 'bottom'`, `wait`, `waitText`, `dispatch`, `js` |
| 기타 | `delay`(기본 450ms), `name_`(파일명 = 화면 id), `expectRoute` |
| 환경변수 | `CAPTURE_SCALE`(기본 2 → 804×1748), `CAPTURE_IDS`(화면 id가 아니라 **순번** — `007,008`), `CAPTURE_URL`, `CAPTURE_SAFE_AREA`(기본 62,34), `CAPTURE_LOGIN_PROVIDERS` |

하네스가 이미 처리하는 것(끄지 말 것): 브라우저 시계를 낮으로 고정(낮/밤이 기기 시각을 따름), 안전영역 위 62 / 아래 34, 펠리컨·강아지 첫 안내 끄기(`npcGuide: true`로 켠다), 로그인 소셜 버튼 끼워 넣기, 파란 포커스 테두리 제거, 실패한 장은 `-FAILED.png`로 남기고 계속.

기본으로 집중 기록 7개를 넣기 때문에 **게시판에 들어가면 퀘스트 보상 팝업이 뜬다.** 보상 팝업을 찍는 장이 아니면 `records: false`를 준다.

캡처마다 화면 글자가 `catalog.json`에 저장된다. 버튼 이름은 거기서 찾는다.

## 담당 나누기와 지시문

`node $SK/gen-targets.cjs` → `capture/targets-<담당>.json`(onboarding-home, focus, hall, board-library, tower-mail, shop-boat). 몽돌 튜토리얼은 별도 담당.

```
## 목표
gromo 2.0 웹 빌드에서 지정된 화면 상태를 세로 폰 크기로 한 장씩 캡처한다. 피그마 화면 흐름도에 들어간다.
너는 <담당> 묶음. 대상: <WF>/capture/targets-<담당>.json (id, title, kind, reach, condition, uiText, source, inbound).

## 검증된 방법 (다시 조사하지 말 것)
- 웹 빌드가 http://127.0.0.1:18762/ 에 떠 있다. 죽이거나 다시 띄우지 말 것. 응답이 없으면 멈추고 보고.
- ?review=1 → window.__gromoReview. 하네스 <SK>/capture.cjs, 예시 <SK>/capture-example.cjs 를 먼저 읽어라.
- 지난 실행의 설정이 <WF>/capture/cfg-<담당>.cjs 에 있으면 그것부터 다시 돌리고, 깨진 장만 고쳐라.

## 할 일
1. 설정 파일 <WF>/capture/cfg-<담당>.cjs (name_ = 대상 id), 출력 <WF>/shots/<담당>/.
   공용 하네스는 수정 금지. 변경이 필요하면 capture-<담당>.cjs 로 복사해서 고친다.
   문법 확인은 `node --check` 로 한다 — require 하면 그대로 실행돼 남의 폴더를 덮어쓴다.
2. 대상마다 그 상태에 도달하는 설정을 쓴다(reach·inbound·uiText·source 가 단서).
3. 모든 장을 직접 열어 확인한다: 제목·uiText 와 화면이 맞는가, 빈 화면·에러·잘림이 없는가, 엉뚱한 팝업이 덮지 않았는가.
   같은 화면이 두 대상에 똑같이 찍혔으면 둘이 정말 다른 상태인지 다시 본다.
4. 통과한 장을 <WF>/shots/final/<대상 id>.png 로 복사한다.
5. <WF>/shots/report-<담당>.json: [{ "id", "status": "ok" | "approx" | "uncaptured", "note" }]
   ok = 설명대로 / approx = 찍었지만 다른 점이 있음(무엇이 다른지) / uncaptured = 도달 불가(이유)

## 제약
레포 수정 금지, git 상태 변경 금지, 쓰기는 <WF> 아래만. 다른 담당의 파일을 건드리지 말 것.
내가 띄우지 않은 프로세스를 죽이지 말 것. 의존성 설치 금지.

## 최종 보고 (짧게)
ok/approx/uncaptured 개수와 이유, 화면에서 본 이상한 점(버그로 보이는 것), 확인 못 한 것.
```

**튜토리얼 담당**에게는 추가로: 0단계부터 실제 버튼을 눌러 끝까지 따라가며 단계마다 찍을 것, `shots/final/tutorial.sNN.png`와 회관 안내 `home.hallGuide.png`, 그리고 `shots/tutorial-steps.json`(단계별 `id`·`step`·`route`·`title`·`line`(대사)·`next`(다음으로 가는 조작)·`status`, `after`, `unusedSteps`, `exits`)을 쓸 것. `layout.cjs`가 이 파일로 튜토리얼 줄을 만든다.

## 버튼 자리 뽑기

캡처가 다 끝난 뒤, 같은 설정을 훅을 끼워 한 번 더 돌린다. 스크린샷을 찍는 순간 화면의 "누를 수 있는 것"의 자리를 `.hotspots.json`으로 저장한다.

```sh
cd $WF/capture
CAPTURE_CONFIG=$PWD/cfg-hall.cjs CAPTURE_OUT=$WF/hot/hall node -r $SK/hot-hook.cjs capture-hall.cjs
node $SK/gen-hotspots.cjs      # → hotspots.json, hotspots-misses.txt, hotspots-low.txt
```

캡처 때 쓴 명령을 그대로 쓰되 앞에 `-r $SK/hot-hook.cjs`를 끼우고 출력만 `hot/<담당>`으로 바꾼다. 명령이 여러 개인 담당은 전부 같은 `hot/<담당>`으로 반복한다. 튜토리얼은 `hot/tutorial`로 내야 파일 이름(`s04`)이 화면 id(`tutorial.s04`)로 풀린다.

`gen-hotspots.cjs`는 이동마다 "도착 화면을 열려고 마지막에 누른 것"(캡처 설정)과 trigger의 따옴표 안 글자를 단서로 출발 화면에서 버튼을 찾는다. 짧은 글자가 엉뚱하게 걸린 적이 있어서(예: "공지 항목 탭"이 배경의 "공지" 종이에 걸림) 느슨한 맞춤에 제한을 뒀다. 그래도 `hotspots-low.txt`(70점 미만)는 한 번 훑고, 틀린 것은 `hotspots.json`에서 그 항목을 지운다.

## 함정

- **`TESTFLIGHT_ALL_BUILDINGS = true`** (`App.tsx`): 목업 섬을 항상 전 건물 완공으로 되돌린다. `stage`·`mutate`로 건물을 빼도 즉시 돌아온다. 건설, 청사진, 건물 잠금, 회관 안내가 필요한 담당은 하네스 사본에서 브라우저가 받는 번들의 그 dispatch 한 줄만 끈다(파일은 안 건드림).
- **서버 모드 전용 화면**(회원 전환 시트, 서버 건설 카드, 차단 목록, 신고·차단 시트 등)은 목업에서 서버 명령이 꺼져 있어 안 뜬다. 번들 조건을 풀거나 가짜 응답을 끼워 찍고 **approx**로 표시한다.
- **상태를 싣는 순간 지워지는 것**: 구경 상태(`visitingIslandId`)와 서버 홈 스냅샷은 `mutate`로 넣어도 사라진다. 화면을 연 뒤 dispatch 한다.
- **걸어서 건물에 들어간 뒤 `open('home')`으로 건너뛰면** 홈 지도 카메라가 밀리고 건물이 안 눌린다. 전환 장면은 맨 끝에 두고 새 페이지에서 찍는다.
- **담당별 특수한 사정**(일기장은 날짜를 주말로 밀어야 막대가 7개 나온다 등)은 각 설정 파일 머리말에 적혀 있다.
- **목업 모드에서 건설 화면의 건물 카드를 누르면 앱이 죽었다**(`Hall.tsx`의 `liveCopy`). 고쳐졌는지 확인하고, 아니면 사본 하네스에서 우회한다.
- **웹 빌드에는 약관 버전이 비어 있다.** 로그인 화면의 약관 버전 머리말이 없고 회원 전환 시트가 아예 안 뜬다.
- **검색어는 `open()`이 지우지 않는다.** 검색어를 넣는 장은 맨 뒤에 모은다.
- **네이티브 전용**: 스크린타임 창, 공유 창, 메일 앱, 키보드가 올라온 상태, Apple 로그인 버튼. 웹에서는 uncaptured로 두고 시뮬레이터로 넘긴다.
