# 우리 섬 / 낚시섬 분리 — 웹 UI (GROMO-2786)

일반 섬(우리 섬)과 집중 섬(낚시섬)의 화면과 기능을 나눈 웹 UI 기록이다. 상태·서버 계약은 `island-split-state.md`, 3D 에셋은 `island-split-assets.md`에 있다.

## 앱에서 참조한 흐름

읽기 전용으로 참조했다. 운영 계정·물고기·집중 API·앱 차단은 웹에 만들지 않았다.

| 앱 | 웹에 옮긴 것 |
| --- | --- |
| `FocusFlow.tsx` 준비(`focusSetup`) | 「오늘의 할 일」 입력, 최대 40자, 빈 값이면 「집중」, 자리표시자 「할 일 입력 (선택)」 |
| `FocusFlow.tsx` 집중(`focus`) 하단 | 「휴식하기」(주 버튼) + 「종료하기」(1.5초 길게 누르기) |
| `FishingIsland.tsx` `FiButton holdToConfirm` | 누르는 동안만 진행, 떼면 취소. 화면 읽기는 한 번 누르면 1.5초 뒤 종료, 다시 누르면 취소. 짧게 누르면 「1.5초 동안 길게 누르면 집중을 종료해요. 중간에 손을 떼면 취소돼요.」 |
| `FishingFocusHud.tsx` | 할 일 한 줄 + 큰 `HH:MM:SS` |
| `RestGroup.tsx` | 휴식 중 하단 버튼은 「집중 이어가기」 하나 |
| 결과창(`focusFlow.result`) | 제목 「이번 집중 결과」, 「다시 집중하기」. 물고기·퀘스트 칸은 웹에 없다 |
| `DESIGN.md` | semantic 색 토큰, 고운돋움, 44px 터치 영역, 모달 포커스 복원, 홈 왼쪽 위 얇은 반투명 Paper 표면 |

## 화면 단계

`main`의 `data-phase`는 `home | prepare | focusing | resting`이다. 단계는 `pose.island`와 `session.status`로만 정한다. 도착이나 섬 이동만으로 세션을 시작하지 않는다.

| 단계 | 섬 | 위쪽 | 아래 패널 |
| --- | --- | --- | --- |
| home | 우리 섬 | 칩 「우리 섬」, 「느긋한 오후의 섬」 | 산책 · 인사(Space) · 쉬기 · **낚시섬으로 가기** |
| prepare | 낚시섬 | 칩 「낚시섬」, 「물가의 낚시섬」. 「섬 둘러보기」 없음 | 오늘의 할 일 · **자리 고르기** · 우리 섬으로 |
| focusing | 낚시섬 | 같음 | 할 일 + 시간 + 「낚시하며 집중하는 중 · N번 의자 · ○쪽 물가」 / 자리 바꾸기 · **휴식하기** · 종료하기(길게) |
| resting | 우리 섬 | 칩 「우리 섬」 | 할 일 + 멈춘 시간 + 「모닥불 곁에서 쉬는 중 · N번 의자 맡아 둠」 / **집중 이어가기**만 |

- 우리 섬 「섬 둘러보기」: 마을회관 · 강아지 상점 · 모닥불(걸어가서 앉아 쉬기) · 뗏목 부두(걸어가기만) · 낚시섬(뗏목으로 건너가기). 자리 선택·집중 예약·낚시 집중은 우리 섬에 없다.
- 낚시섬: 빈 3D 의자를 누르거나 「자리 고르기」의 버튼 30개 중 하나를 누르면 바로 앉아 집중을 시작한다. 확인창은 없다. 버튼은 `SEAT_SECTIONS` 세 구역(동쪽·북쪽·서쪽 물가)에 10개씩 있다.
- 자리 고르기 안내: 빈 의자 수, 전부 사용 중, 쉬러 간 주민의 의자를 맡아 둔다는 안내, 오프라인 안내.
- 자리 바꾸기: 같은 창에서 다른 빈 의자를 고른다. 할 일과 시간은 이어진다. 집중 중 빈 3D 의자를 눌러도 옮긴다.
- 휴식하기: 서버가 `pauseFocus`를 승인한 뒤에만 우리 섬 모닥불 곁으로 바뀐다. 시간이 멈추고 의자는 예약된 채 남는다. 새 집중 시작, 섬 이동, 「섬 둘러보기」는 휴식 중에 없다.
- 집중 이어가기: `resumeFocus` 승인 뒤 같은 낚시섬 의자로 돌아가고 누적 시간이 이어진다.
- 종료하기: `finishFocus`가 돌려준 `subject`와 `elapsedMs`만 결과창에 보인다. 「다시 집중하기」는 낚시섬 준비 단계로 돌아가 의자를 새로 고르게 한다. 「우리 섬으로」는 `travel("home")`이 성공해야 창을 닫고, 실패하면 창 안에 오류를 보인다.
- 연결이 끊기면 세션이 있었을 때 「연결이 끊어졌어요」 창을 띄운다. 상태 쪽 `seatError`도 같은 내용을 짧은 안내로 보인다. 다시 연결되면 우리 섬에서 시작한다.
- 그래픽 오류(`SceneBoundary`, WebGL context lost)는 `leaveSeat()`로 결과 없이 자리를 비우고 열린 창을 닫는다. 오디오는 즉시 숲바람 모드로 돌아간다. 다시 불러오기 창과 로딩 화면은 그대로다.

## 상태 연결

- `useRoom(sim)` 계약을 그대로 쓴다. 성공한 명령은 `await` 뒤 `setPose({ ...sim.actor })`로 맞춘다.
- `Scene`에 `island={pose.island}`를 넘긴다.
- `occupied`는 `reservations`로 만든다(휴식 중 예약 포함). 내 자리는 `session.seatId`로 구분한다.
- `activeSeatId`는 낚시섬에서 내 고양이가 실제로 `focus` 동작일 때만 값이 있다. 휴식 중 우리 섬에는 의자를 그리지 않는다.
- 시간은 `focusElapsedMs(session, now)`이다. `now`는 200ms마다 갱신하고, `paused`면 멈춘다.
- 버튼 잠금: 걷기 동작은 화면 준비·그래픽 상태만 본다. 섬 이동·자리·휴식·이어가기·종료는 `busy`, 연결 상태, 그래픽 상태를 함께 본다.
- 오디오: `useIslandAudio(Boolean(session) && !failed && !lost)`. 집중·휴식은 기존 모닥불 ASMR, 세션이 없으면 기존 숲바람이다. 음원 파일은 바꾸지 않았다. 음소거·볼륨 저장, 첫 입력 때 잠금 해제, `[data-audio-control]` 캡처 제외는 기존대로다.
- 입력 막기: 세션 중(집중·휴식)에는 WASD·방향키와 Space 인사를 받지 않고 조이스틱을 숨긴다. 휴식 중 땅을 눌러 걷기 시작하면 바로 멈추고 다시 앉힌다(`Simulation.moveTo`가 `sit`을 막지 않아서다). 시점 회전은 계속 된다.
- 포커스: 단계가 바뀌어 누른 버튼이 사라지면 새 단계의 주 버튼(`data-autofocus`)으로 옮긴다. 모달은 연 자리로 포커스를 돌려준다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `src/App.tsx` | 단계 판정, 명령 연결, 위쪽·아래 패널, 안내·설정·둘러보기·자리·결과·연결 끊김 창 |
| `src/FocusControls.tsx` | `FocusPrepare`, `FocusHud`, `SeatPicker`, `FocusResultSummary`, 시간 표기 |
| `src/HoldButton.tsx` | 1.5초 길게 누르기 버튼 |
| `src/Dialog.tsx` | App에 있던 모달을 옮겼다. 제목 id를 `useId`로 만들어 창이 겹쳐도 이름이 섞이지 않는다 |
| `src/Icon.tsx` | `raft`, `home`, `pause`, `play`, `seat`, `stop` 추가 |
| `src/style.css` | 섬 칩, 준비 카드, HUD, 길게 누르기 채움, 자리 창, 결과 창, 휴대폰 배치 |

휴대폰(700px 이하)에서는 App이 아래 패널 높이를 재서 `--bottom-h`로 넣고, 조이스틱·시점 버튼·「섬 둘러보기」를 그 위에 둔다. 위쪽은 섬 칩과 이름 한 줄만 두고 소개 문장은 숨긴다.

## 검사용 속성과 이름

- `main[data-island="home|focus"]`, `[data-focus="idle|active|paused"]`, `[data-phase]`, `[data-camera]`, `[data-motion]`
- `.connection.online`, `.sound-status[data-audio-state][data-audio-mode]`, `output.coordinates[aria-label="고양이 위치"]`
- 집중 시간: `role="timer"`, 이름 「집중 시간 N분 N초」(휴식이면 「· 멈춤」)

| 단계 | 버튼 접근 이름 |
| --- | --- |
| 공통 | 소리 켜기/소리 끄기/소리 다시 재생, 내 고양이와 설정, 조작 안내, 섬 전체 보기/고양이 따라가기, 시점 되돌리기 |
| home | 산책, 인사, 쉬기, 낚시섬으로 가기, 섬 둘러보기 |
| 둘러보기 | 마을회관 …, 강아지 상점 …, 모닥불 …, 뗏목 부두 …, 낚시섬 … (이름 + 설명) |
| prepare | 입력 「오늘의 할 일」, 자리 고르기, 우리 섬으로 |
| 자리 창 | 「N번 의자 · 비어 있음」「· 내 자리」「· 앉는 중」「· 사용 중 · 이름」「· 휴식 중 · 이름」 |
| focusing | 자리 바꾸기, 휴식하기, 종료하기(보조 기술로 시작하면 「집중 종료 취소」) |
| resting | 집중 이어가기 |
| 결과 | 다시 집중하기, 우리 섬으로, 닫기 |
| 연결 끊김 | 확인, 닫기 |

화면 문구에는 프로토콜 같은 구현 설명이 없다. 로컬 체험 범위는 「조작 안내」 창의 안내 한 곳에만 있다.

## 실제로 확인한 것 (2026-11-07)

모두 `127.0.0.1` 로컬이다. 4173·4174·4175는 건드리지 않고, 내 개발 서버를 4186에 따로 띄웠다(`vite.config.ts` 그대로 + `FocusIsland`가 없을 때만 쓰는 임시 대체). 브라우저는 `tests/browser-options.mjs`(full Chromium, Metal)다. 스크립트와 결과는 `artifacts/island-split-ui-qa/`에 있다.

- `tsc --noEmit`: 내 파일 오류 0. 남은 오류는 `src/assets3d/preview/preview.tsx`의 `Actor.island` 누락 5건(에셋 작업 범위).
- `tsx --test tests/*.test.ts`: 44/44 통과(오디오 5개 포함).
- `vite build --outDir artifacts/island-split-ui-preview`: 성공.
- Prettier: 내 소유 파일 6개 통과.
- `flow.mjs`(1440×900, 실제 `FocusIsland` 연결 뒤 다시 실행): 53/53 통과, 페이지 오류 0.
  - 우리 섬 버튼, 의자 버튼 없음, 둘러보기 목적지 5개, 뗏목 부두가 걷기만 함
  - 낚시섬 도착 때 세션 없음, 둘러보기 숨김, 할 일 `maxlength=40`
  - 의자 30개·세 구역, 앉으면 바로 `active`, 시간 증가, W 이동 막힘, 조이스틱 숨김
  - 자리 바꾸기 후 할 일·시간 유지
  - 0.3초 누름 유지, 누른 채 버튼 밖으로 나가면 취소
  - 휴식: 우리 섬, 시간 멈춤, 하단 「집중 이어가기」만, 오디오 `focus`, 키 이동 막힘
  - 두 번째 창: 12번 의자가 「휴식 중 · 이름」으로 비활성, 쉬러 간 주민 안내, 창 닫으면 「자리 고르기」로 포커스 복귀
  - 이어가기: 같은 의자, 누적 이어짐
  - Space 1.75초 누르기로 종료, 결과 창에 할 일·시간만 있고 물고기·저장 문구 없음
  - 「다시 집중하기」 뒤 낚시섬 준비와 「자리 고르기」 포커스
  - Enter 0.4초는 유지, 보조 기술 클릭(`detail 0`)이면 「집중 종료 취소」로 바뀐 뒤 1.5초에 종료, 「우리 섬으로」 뒤 숲바람
- `offline.mjs`(375×667): 집중 중 내 4186 서버를 멈추면 「연결이 끊어졌어요」 창이 뜨고 `data-focus=idle`, `data-island=home`. 서버를 다시 켜면 우리 섬에서 다시 연결된다.
- `layout.mjs`(320×568, 375×667, 768×1024, 1440×900 각각 home/prepare/focusing/resting): 위쪽·상태·소리·둘러보기·시점·아래 패널·조이스틱 사이 겹침 0, 가로 스크롤 0, 44px 미만 버튼 0. 자리 창은 화면 안에 있고 320에서 안쪽 세로 스크롤, 의자 버튼 최소 45px. 1024×768도 겹침 0.

## 아직 못 한 검사

- 실제 휴대폰 기기(iOS Safari, Android Chrome)의 터치 길게 누르기·키보드가 뜰 때의 배치. Playwright 모바일 에뮬레이션만 했다.
- VoiceOver·TalkBack 실제 낭독. 보조 기술 클릭은 `detail 0` 클릭으로만 흉내 냈다.
- 그래픽 오류 중 집중 취소. 기존 `tests/recovery-qa.mjs`를 새 흐름으로 고치지 않아 다시 돌리지 않았다.
- 3D 의자를 직접 눌러 앉기는 수동으로 보지 않았다. 의자 클릭 경로는 `FocusSeats`(에셋)→`Scene`→`selectSeat`이고, 버튼 경로와 같은 함수를 쓴다.
- 30명이 모두 앉은 상태의 「모두 사용 중」 안내. 문구와 조건만 넣었고 서른 창을 띄워 보지 않았다.
- 오디오 실제 재생(검사 브라우저는 `--mute-audio`). `data-audio-mode` 전환만 확인했다.

## 다른 작업자·통합에 넘길 것

- `Scene.tsx`의 같은 key 경고는 코디네이터가 `local:`/`occlusion:`/`runtime:` 키로 고쳤다(2026-11-07).
- `tests/focus-qa.mjs`, `visual-qa.mjs`는 코디네이터가 새 이름으로 고쳤다. 아래 후속 검사에서 둘 다 통과했다.
- 한 번은 `TypeError: Cannot read properties of undefined (reading 'scale')`가 CDP 네트워크 오프라인 흉내 중에 나왔다. 서버를 멈추는 방식에서는 나오지 않았다. 원인은 찾지 못했다.

## 후속 수정 (2026-11-07): 터치 뒤 결과창 닫힘, 30명 이름표 겹침

### 결과창이 터치를 떼자마자 닫히던 문제

- 재현: 320px에서 실제 CDP `touchStart`로 「종료하기」를 누르면 1.5초 뒤 결과창이 열린다. `touchEnd` 때 브라우저가 만든 클릭이 새 모달의 막(`dialog` 자신)에 떨어져 `e.target === dialog` 닫기가 실행됐다. 터치 위치가 창 안이었다면 「다시 집중하기」·「우리 섬으로」를 누를 수도 있었다.
- 수정(`src/Dialog.tsx`): 창이 열린 뒤 이 창에서 `pointerdown`이 없었던 포인터 클릭(`detail ≥ 1`)은 막·버튼 모두 무시한다. 막 닫기는 누름과 뗌이 모두 막에서 일어났을 때만 한다. 키보드·화면 읽기 클릭(`detail 0`), Escape, 닫기 버튼은 그대로다. 누름 정보는 다음 `pointerdown`에서만 바꾸므로 라벨이 체크박스로 넘기는 클릭도 통과한다.

### 30명 이름표 겹침

- 수정(`src/Label.tsx`): 라벨마다 매 프레임 화면 좌표만 계산한다. 그 프레임의 모든 라벨 배치는 그리기 전 microtask 한 번에 한다. 크기는 ResizeObserver가 바뀔 때만 알려 주므로 프레임마다 DOM을 재지 않는다.
- 순서: 내 이름표 → 장소 이름(항상 보임, 의자 hover 라벨 포함) → 다른 고양이 이름(내 이름표와 화면 거리가 가까운 순). 다른 고양이 이름은 제자리 → 한 줄 위 순서로 빈 곳을 찾고, 없으면 `visibility: hidden`으로 숨긴다. DOM은 그대로 남아 `.cat-label` 개수는 바뀌지 않는다.
- 깜빡임 방지: 이미 보이는 라벨은 맞닿기만 해도 유지하고, 새로 보일 라벨은 3px 여유가 필요하다. 한 줄 위로 올라간 라벨은 8px 여유가 생겨야 제자리로 돌아온다.
- 화면 밖·위쪽 머리글 아래 라벨을 숨기는 기존 규칙은 그대로다.

### 확인 (로컬 4187 production preview, `artifacts/island-split-ui-preview`)

- `artifacts/island-split-ui-qa/regression-dialog-labels.mjs`: 25/25 통과, 페이지 오류 0.
  - 320·375px 실제 CDP 터치 종료 뒤 0.8초 지나도 결과창 유지, 「다시 집중하기」→ 낚시섬 준비, 두 번째 터치 종료 뒤 「우리 섬으로」→ 우리 섬, 막을 실제 터치로 짧게 누르면 닫힘
  - 1440px: 막 클릭 닫기, Escape 닫기와 포커스 복원, 닫기 버튼, 창 안에서 누르고 막에서 떼면 유지, 열리기 전 시작한 잔여 클릭(`pointerdown` 없는 `detail 1`)은 버튼·막 모두 무시, 창에서 누른 일반 클릭 동작, 라벨 글자 클릭으로 체크박스 전환
  - 두 창: 같은 시작점에 선 다른 고양이 이름 「물가 친구」가 보임
  - 로컬 주민 29명 + 이 창 1명: `.cat-label` DOM 31개, 내 이름표 보임, 보이는 라벨끼리 겹침 0. 가까운 시점은 고양이 이름 21개, 섬 전체는 13개, 시점을 돌린 뒤 14개, 375px 섬 전체는 3개(+장소 4개). 휴식 중 우리 섬 `.cat-label` 2개
  - 스크린샷: `thirty-fishing-close.png`, `thirty-fishing-overview.png`, `thirty-fishing-rotated.png`, `thirty-fishing-375.png`, `result-touch-320.png`, `result-touch-375.png`, `two-window-names.png`
- 코디네이터 검사를 고치지 않고 스크래치 작업 폴더에서 4187로 실행했다. `tests/focus-qa.mjs` 13/13, `tests/visual-qa.mjs` 전체 통과, 오류 0. 결과 사본: `artifacts/island-split-ui-qa/coordinator-tests-4187/` (`result-320.png`에 결과창이 남아 있다).
- `tsc --noEmit` 오류 0, `tsx --test tests/*.test.ts` 50/50, 내 파일 Prettier 통과.

### 아직 못 한 것

- 실제 휴대폰에서 길게 누른 뒤의 클릭·contextmenu 순서. CDP 터치만 확인했다.
- 375px 섬 전체 보기에서는 섬이 작아 주민 이름이 3개만 보인다. 확대하거나 따라가기 시점으로 바꾸면 더 보인다. 겹치지 않게 하는 쪽을 택했다.
