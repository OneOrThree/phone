# Cattus 3D 산책

Cattus의 고양이로 일반 섬을 산책하고, 별도 낚시섬의 물가 의자 30개에서 앉아서 집중하는 3D 웹이다. 공개 웹 주소는 <https://try.oneorthree.world/>이며 배포 구성은 [배포 문서](docs/deployment.md)에 있다.

## 실행

Node.js 24에서 검증했다. 저장소 루트에서:

```sh
cd app/metaverse-web
npm ci
npm run dev
```

[로컬 섬 열기](http://127.0.0.1:4173).

같은 주소를 두 브라우저에서 열면 서로 다른 고양이로 접속한다. 같은 섬의 고양이만 화면에 보이며 위치·방향·털색·이름·행동을 공유한다. 집중 의자는 30개이며 휴식 중인 예약도 포함한다. 두 섬을 합친 로컬 방의 연결 한도는 60명이다. 새로고침할 때 고양이와 집중 시간은 초기화된다. 같은 컴퓨터의 탭·브라우저 검토용이며 서버 기본 바인딩은 `127.0.0.1`이다.

```sh
npm run typecheck
npm test
npm run build
npm run preview  # dev 서버를 먼저 종료한다
npm run test:browser  # 별도 터미널에서 dev 또는 preview를 켠 뒤 실행한다
npm run test:recovery
npm run test:touch
npm run test:experience
npm run test:focus
npm run test:visual
npm run test:controls
npm run format:check
```

Playwright Chromium이 없으면 `npx playwright install chromium`으로 설치한다. 브라우저 검증은 localhost만 사용한다. `tests/browser-options.mjs`는 full Chromium을 사용하고 macOS에서는 ANGLE Metal로 3D를 렌더링한다. 스크린샷·JSON 증거는 gitignored `artifacts/`에 남는다.

## 조작

- WASD / 방향키: 현재 카메라 기준 이동. 한글 입력 상태·대문자에서도 물리 키 위치로 인식한다. 입력창에서는 이동하지 않으며 장면을 누르면 다시 이동 입력을 받는다. 땅 클릭·탭: 장애물을 돌아 목적지까지 이동.
- 모바일 발바닥 조이스틱: 이동. 왼쪽 드래그: 회전. 우클릭 또는 Shift+드래그: 카메라 평면 이동. 휴대폰 두 손가락 밀기: 카메라 이동. 휠·핀치·± 버튼: 확대·축소. R / 시점 버튼: 초기 구도. 키보드 +/−로도 줌을 조절한다.
- 카메라만 옮겨 둘러본 구도는 유지된다. 따라가기 모드에서 다시 걸으면 고양이 중심으로 부드럽게 복귀한다. 줌과 전체/추적 전환은 보간하며 동작 줄이기에서는 즉시 적용한다. 드래그·핀치를 끝내며 땅이나 의자를 잘못 누르지 않도록 같은 제스처의 클릭을 막는다.
- 기본은 고양이를 따라가는 가까운 시점이다. `섬 전체`로 전체 지도를 보고 `따라가기`로 돌아온다. 추적 시점에서 고양이를 가리는 건물·나무는 옅어진다.
- `낚시섬으로 가기`: 별도 집중섬으로 이동한다. 오늘의 할 일을 선택적으로 적고 `자리 고르기`에서 의자를 선택하거나 물가의 빈 의자를 직접 누르면 즉시 앉아 낚시 집중을 시작한다. 다른 주민이 사용·예약한 의자는 선택할 수 없다. 집중 중 이동은 차단하고 자리 변경 시 주제·누적 시간을 유지한다.
- `휴식하기`: 일반 섬 모닥불로 돌아가 쉬며 집중 시간을 멈춘다. 낚시 의자는 예약한 채 유지하고 `집중 이어가기`로 같은 자리에 복귀한다.
- `종료하기`를 1.5초 길게 누르면 집중 결과를 표시한다. 휴식 시간은 제외한다. `다시 집중하기`는 준비 단계로 돌아가며 새 집중을 자동 시작하지 않는다.
- 일반 섬의 인사 / Space: 손 흔들기. 쉬기: 바닥에 앉기. `뗏목 부두`는 부두로 걸어가는 산책 목적지다.
- 첫 클릭·키 입력 뒤 숲바람이 들리고, 의자에서 집중하면 모닥불 ASMR로 0.8초 동안 전환된다. 모닥불 휴식 중에도 ASMR을 유지하며 집중 종료 후 숲바람으로 돌아온다. 소리 버튼과 설정의 볼륨으로 조절한다. 음소거는 행동·자리 변경 뒤에도 유지한다.
- 섬 둘러보기: 일반 섬의 마을회관·강아지 상점·모닥불·뗏목 부두 앞까지 이동하거나 낚시섬으로 건너간다. 건물 내부 기능은 이번 범위에 포함하지 않는다.
- 내 고양이와 설정: 이름, 털색 여섯 가지, 동작 줄이기, 가벼운 화면.

## 구현 경계

- React + React Three Fiber + Three.js. Orca CLI의 Claude 작업자가 고양이·건물·나무·의자·모닥불 등 장면 에셋을 절차적 geometry로 재제작했다. 외부 모델·텍스처·CDN을 런타임에 불러오지 않는다. [기존 에셋 기록](docs/asset-rebuild.md)과 [낚시섬 제작 기록](docs/island-split-assets.md)에 모델·리깅·생성 방법을 기록했다.
- `layout.ts`: 초기보다 약 6.5배 넓어진 일반 섬, 별도 낚시섬의 연못·30개 의자·지형의 공통 배치. `focus-water.ts`: 렌더와 이동 판정이 공유하는 물길·다리 배치. `world.ts`: 지형·충돌·A* 경로. `simulation.ts`: 프레임별 이동과 행동. React는 HUD만 저빈도로 갱신한다.
- `Scene.tsx`, `Island.tsx`, `FocusIsland.tsx`, `Scenery.tsx`, `Cat.tsx`: 렌더·애니메이션. `CameraRig.tsx`: 카메라 추적·회전·평면 이동·줌·제스처 판정. `keyboard.ts`: 입력 언어와 무관한 이동키 해석. 고양이의 큰 눈·곡선 꼬리는 앱 원화를 참고했다. 걸음 위상은 실제 이동 거리로 진행하며 자세 전환을 보간한다. 정적 섬은 메모해 HUD 갱신 때 geometry를 재생성하지 않는다.
- `CameraOcclusion.tsx`: 추적 카메라와 고양이 사이의 건물·나무를 감지해 해당 물체를 옅게 표시한다.
- `assets3d/ocean.tsx`: Claude가 구현한 수심별 수면 색·잔물결·반짝임·해안과 바위 포말. 동작 줄이기를 켜면 반복 애니메이션을 멈춘다.
- `server/room-engine.ts`: 로컬·공개 방이 공유하는 상태 전이. `server/room.ts`: 개발·로컬 preview용 WebSocket 방. 10Hz 스냅샷, 최대 60개 연결, 메시지 크기·입력 검증, 같은 Origin 검사, heartbeat, 퇴장 정리. 섬 이동·자리 예약·휴식·이어가기·집중 종료를 서버 응답으로 확정하며 유효 집중 시간도 서버에서 센다. 연결 실패 시 세션·예약을 해제하고 일반 섬으로 돌아가 중단을 알린 뒤 자동 재연결한다.
- `realtime.ts`: 명령별 응답과 요청 ID, 연결 수명, 스냅샷. 다른 고양이는 같은 섬에서만 표시하고 프레임 사이를 보간한다. `focus-session.ts`는 휴식 제외 시간과 좌석 예약 타입을 공유한다. [상태 계약](docs/island-split-state.md)과 [화면 흐름](docs/island-split-ui.md)에 세부 사항을 기록했다.
- 앱 디자인 토큰은 Vite 가상 모듈에서 원본 TypeScript를 읽는다. 기존 Expo 의존성을 설치하지 않고도 같은 값을 사용한다. 폰트는 앱 원본 고운돋움을 글리프 제거 없이 WOFF2로 압축했다. 재생성은 `scripts/compress-font.py`, 라이선스는 `public/fonts/OFL.txt`다.
- 로컬 실시간 검토는 `npm run dev` 또는 `npm run preview`를 사용한다. 공개 빌드는 `VITE_ROOM_URL`로 별도 방 주소를 지정한다. `server/worker.mjs`는 Origin·메시지 크기·빈도 제한과 절전 복원을 맡는다.

공개 버전은 별도 Cloudflare Durable Object 방을 사용한다. 운영 앱의 인증·계정·섬 통장·집중 기록과 연결하지 않는다. 연결이 종료되면 체험의 집중·예약은 끝나며 계정별 기록을 저장하지 않는다. 기존 앱 WebSocket에 이 프로토콜을 연결하지 않는다.

기존 모닥불·숲바람 파일을 그대로 사용하며 출처와 재생 규칙은 [음원 기록](docs/audio-sources.md)에 있다.

## 참고 자료

2026-11-07 열람. 동작·구도 참고이며 외부 그래픽은 복제하지 않았다.

- [React Three Fiber — Basic animations](https://r3f.docs.pmnd.rs/tutorials/basic-animations): `useFrame`과 ref 기반 프레임 갱신.
- [React Three Fiber — Hooks](https://r3f.docs.pmnd.rs/api/hooks): 렌더 루프와 카메라 상태.
- [Three.js — OrbitControls](https://threejs.org/docs/pages/OrbitControls): 회전·확대·터치 제어.
- `../app-dev/DESIGN.md`, `../app-dev/src/assets/redesign/island-whole-warm.jpg`, `../app-dev/src/screens/island/WorldMap.tsx`: Cattus의 색·고양이·회관·상점·모닥불·부두.

검토 과정과 결과는 [QA.md](QA.md)에 기록한다.
