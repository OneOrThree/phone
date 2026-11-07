# 일반 섬·낚시섬 분리: 상태·로컬 방

GROMO-2786 상태 작업 기록이다. 일반 섬(`home`)과 낚시섬(`focus`)의 이동 지형, 내 고양이 상태, 로컬 방 서버, `useRoom` 계약을 다룬다. 운영 계정·재화·집중 API와 연결하지 않는다. 모든 검사는 `127.0.0.1`에서만 했다.

소유 파일: `src/world.ts`, `src/simulation.ts`, `src/realtime.ts`, `server/room.ts`, `src/focus-water.ts`(후속 수정에서 새로 만든 순수 배치 모듈), `tests/movement.test.ts`, `tests/seat.test.ts`, `tests/room.test.ts`, `tests/room-client.test.ts`, `tests/focus-water.test.ts`, `tests/room-harness.ts`(검사 도구, `*.test.ts` 아님). `src/layout.ts`, `src/focus-session.ts`는 읽기만 했다. 후속 수정에서 에셋 파일 `src/assets3d/pond.ts`는 re-export만 바꿨다(1절 「물길·소·다리」).

## 1. 지형

`walkable(p, island = "home")`, `moveSafe(from, to, island = "home")`, `pathTo(start, target, island = "home")`. 섬 인자를 빼면 일반 섬으로 본다(기존 호출 호환).

| 섬 | 걸을 수 있는 곳 | 막는 것 (몸 여유 0.25) |
| --- | --- | --- |
| `home` | 타원 `ISLAND.radiusX 22 × radiusZ 20.4` 안, 뗏목 부두(`|x| < 1.5`, `18 ≤ z < 25.3`) | `BUILDINGS` 4개, `CAMPFIRE`, `TREE_POSITIONS`(반경 0.6). 낚시 의자 30석은 없다. |
| `focus` | 같은 타원 안. 부두 없음. 물길은 다리 두 곳 위로만 건넌다 | 연못 둑 `FOCUS_POND` 중심에서 `bankRadius 11.4` 안, 폭포 아래 소와 물길(아래 「물길·소·다리」), `FOCUS_SEATS` 30석(반경 0.48), `FOCUS_LANDMARKS`(폭포 2, 축음기 0.8, 쉼터 1.5), `FOCUS_TREE_POSITIONS`(0.6), 외곽 바다 |

- 낚시섬은 둑(11.4)과 의자 안쪽 끝(13.2 − 0.73) 사이에 폭 약 1.07의 물가 길이 있다. 의자 사이 틈(약 1.3)으로 드나든다.
- 경로는 연못을 가로지르지 않고 물가를 돈다. 연못·의자 안 목적지는 빈 경로를 준다.
- `homeObstacles`, `focusObstacles`, `focusTrees`를 export한다. `obstacles`는 기존 호환용 일반 섬 장애물이다.
- `moveSafe`는 직선을 5cm(`MOVE_STEP 0.05`)마다 확인한다. 이전 값은 15cm였다. 15cm 간격으로는 물가 길에서 다리 입구로 비스듬히 들어갈 때 판자 폭 바깥 물 위를 몇 mm 스치는 구간을 건너뛰었다. 낚시섬 의자 출구 30곳 경로 합계가 약 330ms에서 430ms로 늘었고, 가장 긴 경로 하나는 약 40ms다.

### 물길·소·다리 (2026-11-07 후속 수정)

에셋 보고(`docs/island-split-assets.md`)에서 걷는 판정에 물길이 없어 다리 밖에서도 물 위를 걸을 수 있다고 했다. 코디네이터 결정에 따라 다리 두 곳을 뺀 물길과 소를 막았다.

- **한 정본:** 소·물길·다리의 평면 값은 새 순수 모듈 `src/focus-water.ts`에 있다. 그래픽 의존성 없이 `layout.ts`만 읽는다.
  - `FOCUS_PLUNGE`, `FOCUS_STREAM`, `focusStreamX`, `FOCUS_STREAM_Z0`, `FOCUS_STREAM_Z1`, `FOCUS_BRIDGES`
- **렌더 쪽:** `assets3d/pond.ts`는 기존 export 이름(`PLUNGE`, `STREAM`, `streamX`, `STREAM_Z0`, `STREAM_Z1`, `BRIDGES`)을 유지한다. 이 값을 그대로 다시 내보내고, `PLUNGE.level`·`STREAM.level`·`STREAM.bed` 높이만 붙인다. geometry·셰이더는 바꾸지 않았다. 바꾸기 전과 뒤의 export 값, 물길 중심선 81점, `focusHeight` 12,960점(x −2~2, z −18~−10, 약 5cm 격자)이 바이트 단위로 같다.
- **`world.ts`·`server`:** `focus-water.ts`만 가져온다. `assets3d`·three는 가져오지 않는다.

| 막는 것 | 규칙 (몸 반경 `BODY 0.25`) |
| --- | --- |
| 소 | 중심 `(0, −16.6)`에서 `1.02 + 0.25` 안. 폭포 바위 장애물(반경 2.25) 밖으로 나온 소 가장자리도 막는다. |
| 물길 | `z`가 `−16.039 − 0.25`부터 `−10.25 + 0.25` 사이이고, 중심선 `focusStreamX(z)`까지의 수직 거리(기울기 보정)가 `0.31 + 0.25` 미만인 곳. 수면 폭은 0.62다. |
| 다리 예외 | 몸이 판자 폭 안에 다 들어가는 띠 `|z − bridge.z| ≤ width/2 − 0.25`이고, 판자 길이 안 `|x − focusStreamX(bridge.z)| ≤ length/2`인 곳은 물길에서 뺀다. |

| 다리 | 가운데 | 걸을 수 있는 z 띠 | 판자 x 범위 | 0.4m 경로 격자 행 |
| --- | --- | --- | --- | --- |
| 물가 길 | `(−0.149, −12.02)`, 길이 1.5, 폭 0.95 | −12.245 ~ −11.795 | −0.899 ~ 0.601 | z = −12.0 |
| 의자 뒤 | `(0.141, −14.55)`, 길이 1.4, 폭 0.85 | −14.725 ~ −14.375 | −0.559 ~ 0.841 | z = −14.4 |

- 판자 길이가 막는 폭(중심선 양쪽 0.56)보다 길다. 그래서 다리 양 끝 땅에서 판자로 바로 올라선다.
- `onFocusBridge(p)`와 `inFocusWater(p)`를 export한다.

## 2. Actor·Simulation

```ts
type Actor = { island: IslandId; x; z; yaw; action; color; name; seatId?: number };
```

- `island`는 필수다. `seatId`는 `action === "focus"`일 때만 있고, 그때는 낚시섬의 실제 의자 좌표·방향과 정확히 같아야 한다(`validActor`).
- 이전의 `focusStartedAt`은 지웠다. 집중 시간은 서버가 가진 `FocusSession`에만 있다.
- 이름은 trim 후 1~16자, 털색은 기존 6색, 좌표는 유한하고 해당 섬에서 걸을 수 있어야 하며, `|yaw| < 100`이다.

`Simulation`은 `actor.island`를 `moveTo`, `step`(키·조이스틱·경로), `action("fish")`에 넘긴다.

| 함수 | 동작 |
| --- | --- |
| `applyAuthoritativeActor(actor)` | 서버가 확정한 섬·좌표·방향·행동·좌석을 반영한다. 이름·털색은 내가 고른 값을 유지한다. 경로·키 입력·도착 행동·인사 시간을 지운다. 잘못된 값이면 `false`를 돌려주고 아무것도 바꾸지 않는다. |
| `resetToHome()` | 일반 섬 `SPAWN_POINT`, `yaw 0`, `idle`. 겉모습만 유지한다. 새 연결·연결 끊김에 쓴다. |
| `leaveSeat()` | 비상 취소용 로컬 처리. 의자에 있었다면 `seatExit`(연못 바깥쪽 물가 길)로 일어서고, 아니면 현재 섬 제자리에서 `idle`. |
| `action("fish")` | 일반 섬에서만 뗏목 부두로 걸어간다. 낚시섬에서는 `false`(낚시 집중은 의자 명령으로만). |

- `sim.actor` 객체 참조는 바꾸지 않고 필드만 바꾼다. 장면의 `Cat`이 같은 객체를 매 프레임 읽기 때문이다.
- `sitAtSeat`은 없앴다. 착석은 서버 응답으로만 한다.

`world.ts`에 추가한 도구: `arrivalActor(island, appearance)`, `seatExit(seatId)`, `restSpot(seatId)`, `normalizeSubject(value)`, `validName`, `validColor`, `isIsland`, `ISLAND_SPAWN`, `FOCUS_SPAWN`, `SUBJECT_MAX = 40`, `NAME_MAX = 16`.

### 휴식 자리 (공통 문서와 다른 점)

공통 문서는 휴식 시 「home `REST_POINT`의 sit」이다. 30명이 모두 한 점에 겹치지 않게, `restSpot(seatId)`는 모닥불 둘레 세 원에 10명씩 둔다. 반지름은 3.6, 4.7, 5.8이다. 0번 의자는 `REST_POINT (0, 3.6)` 그대로다. 모두 모닥불을 보고, 서로 1.2 넘게 떨어져 있으며, 일반 섬에서 걸을 수 있다. 카메라는 `sim.actor`를 따라가므로 UI·장면 변경은 필요 없다. 한 점이 꼭 필요하면 `restSpot`만 바꾸면 된다.

## 3. 로컬 방 프로토콜 (`/island-room`)

### 연결

- 같은 Origin(`new URL(origin).host === Host`)만 받는다. 형식이 틀린 Origin은 끊는다.
- 정원 `ROOM_CAPACITY 60`(두 섬 합계). 핸드셰이크 중인 연결도 센다. 섬별 상한은 따로 두지 않는다. 낚시 의자는 `CAPACITY 30`이다.
- `maxPayload 2048`. 넘으면 서버가 연결을 닫는다(1009 또는 1006).
- heartbeat는 10초마다 ping을 보낸다. 다음 heartbeat까지 pong이 없으면 끊는다. 끊긴 연결의 집중·휴식 예약은 바로 사라진다(예약은 연결 상태에서 계산한다).
- 바이너리, JSON이 아닌 값, 객체가 아닌 값, 모르는 type, 예외는 상태를 바꾸지 않는다.

### 클라이언트 → 서버

| type | 필드 | 성공 조건 | 서버 결과 |
| --- | --- | --- | --- |
| `move` | `actor` | 65ms에 한 번 | 이름·털색이 맞으면 언제든 반영한다. 위치·행동은 의자에 앉아 있지 않고, `actor.island`가 서버의 섬과 같고, `focus`·`seatId`가 없고, 그 섬에서 걸을 수 있을 때만 반영한다. 응답은 없다. |
| `travel` | `island` | 세션 없음, `home`·`focus` | 해당 섬 시작점, `yaw 0`, `idle`. 같은 섬도 시작점으로 다시 보낸다. |
| `claim-seat` | `seatId`, `subject?` | 낚시섬, 실제 의자, 다른 주민 예약 없음, 휴식 중 아님 | 새 집중: `{status: focusing, elapsedMs: 0, startedAt: now}`. 집중 중 자리 변경: 주제·누적·구간 시작 시각 유지, 앞 자리 해제. 같은 자리: 변화 없음. |
| `pause-focus` | | `focusing` | `elapsedMs += now − startedAt`, `startedAt: null`, `paused`. 예약 유지. Actor는 일반 섬 `restSpot(seatId)`에서 `sit`. |
| `resume-focus` | | `paused` | 같은 의자로 돌아가 `focusing`, `startedAt: now`. 누적은 그대로다. |
| `finish-focus` | | 세션 있음 | `result {subject, elapsedMs(휴식 제외), finishedAt}`. 예약 해제. 집중 중이었다면 낚시섬 `seatExit`에서 `idle`, 휴식 중이었다면 일반 섬 제자리에서 `idle`. |
| `cancel-focus` | | 항상 | 결과 없이 세션·예약 해제. Actor는 `finish-focus`와 같은 자리. 세션이 없으면 변화 없음. |

- 명령에는 `requestId`(1~64자 문자열)가 꼭 있어야 한다. 없으면 응답도 상태 변화도 없다.
- `subject`는 없거나 `null`이면 빈값이다. 문자열이면 trim 후 40자 이하다. 그 밖의 값은 거부한다. 자리 변경 때 보낸 `subject`는 무시한다.
- 한 연결의 메시지는 도착 순서대로 처리한다. 그래서 「착석 → 휴식 → 취소」처럼 몰아 보내도 마지막 명령이 최종 상태가 된다.

### 서버 → 클라이언트

| type | 필드 |
| --- | --- |
| `welcome` | `id`, `actor`(일반 섬 시작 상태), `session: null`, `serverNow` |
| `command-result` | `command`, `requestId`, `ok`, 성공이면 `actor`·`session`(`finish-focus`이면 `result`도), 실패면 `reason`, `serverNow` |
| `snapshot` (100ms) | `residents`(두 섬 전체, 나 포함, `id` 포함), `reservations: SeatReservation[]`(휴식 중 예약 포함) |

- 세션은 서버가 갖고, 해당 연결의 `command-result`로만 보낸다. 다른 주민의 세션 시간은 보내지 않는다.

## 4. `useRoom(sim)` / `RoomClient`

`useRoom`은 `RoomClient`(React 없이 검사 가능)를 `useSyncExternalStore`로 감싼다. 반환값은 공통 문서 계약과 같다.

```ts
{ status, residents, reservations, session, pendingSeatId, busy, seatError,
  claimSeat(seatId, subject?): Promise<boolean>, travel(island): Promise<boolean>,
  pauseFocus(): Promise<boolean>, resumeFocus(): Promise<boolean>,
  finishFocus(): Promise<FocusResult | null>, leaveSeat(): void }
```

- **명령 상관:** 명령마다 새 `requestId`를 붙인다. 응답의 `requestId`와 `command`가 기다리는 명령과 둘 다 같아야 반영한다. 그 밖의 응답(취소했거나 끝난 명령의 늦은 응답)은 버린다.
- **busy:** 명령 하나가 응답을 기다리는 동안(`leaveSeat`의 취소 응답 포함) `busy = true`다. 그동안 다른 명령은 `false`/`null`과 「앞선 요청을 기다려 주세요.」를 준다.
- **사전 검사:** 연결 전, 일반 섬에서 착석, 휴식 중 착석, 40자 초과, 세션 중 여행, 상태에 맞지 않는 휴식·이어가기·종료는 보내지 않고 `seatError`를 채운다. 서버도 같은 규칙을 다시 판정한다.
- **성공 응답 검증:** `actor`가 `validActor`를 통과하고 명령과 맞아야 반영한다. 예를 들어 착석이면 요청한 의자의 `focus`, 휴식이면 일반 섬 `sit`이어야 한다. `session`·`result` 형식도 검사한다. 하나라도 어긋나면 반영하지 않고 연결을 다시 시작한다.
- **동기화:** 성공하면 `sim.applyAuthoritativeActor(actor)` 뒤에 Promise가 끝난다. UI는 `await` 뒤 `setPose({...sim.actor})`를 하면 된다.
- **시계:** `session.startedAt`·`result.finishedAt`은 `serverNow`와의 차이로 이 기기 시계에 옮긴다. `focusElapsedMs(session, Date.now())`가 서버 판정 구간 길이를 따른다.
- **reservations:** 스냅샷의 다른 주민 예약을 검증한다(실제 의자, 의자당 1건, 이름 규칙, 상태, 최대 30). 내 예약은 스냅샷 값 대신 내 `session`으로 덧씌운다. 그래서 취소 직후 늦은 스냅샷이 내 자리를 되살리지 않는다.
- **residents:** 나를 빼고 두 섬을 모두 준다. 검증·중복 id 제거 후 최대 59명(기존 29명 제한을 고쳤다). 섬별 필터는 UI·Scene이 한다.
- **`leaveSeat()`:** 기다리던 명령을 `false`/`null`로 끝내고 timer를 지운다. 내 세션·예약과 `pendingSeatId`를 바로 지우고 `sim.leaveSeat()`를 부른다. 연결 중이면 `cancel-focus`를 보내고 응답까지 busy다. 취소 응답은 섬이 어긋났을 때만 위치를 맞춘다(예: 여행 응답 전에 취소한 경우). 같은 섬이면 내 자유 이동을 덮지 않는다.
- **타임아웃:** 5초 안에 응답이 없으면 명령을 실패로 끝내고 소켓을 닫는다. 서버는 닫힌 연결의 예약을 해제한다.
- **연결 끊김:** 기다리던 명령을 실패로 끝내고 세션·예약·주민을 비운다. 세션이 있었거나 낚시섬에 있었다면 일반 섬 시작점으로 돌리고 `seatError`로 중단을 알린다(「연결이 끊어져 집중을 멈추고 자리를 비웠어요. 우리 섬에서 다시 시작해요.」 또는 「연결이 끊어져 우리 섬으로 돌아왔어요.」). 3초 뒤 다시 연결한다.
- **새 연결(`welcome`):** 늘 `resetToHome()`과 빈 세션으로 시작한다. 이전 좌표·좌석은 남기지 않는다. 중단 안내(`seatError`)는 다음 명령까지 남긴다.
- **move:** 100ms마다 `sanitizeActor(sim.actor)`를 보낸다.

## 5. 검사 결과 (2026-11-07)

`npm test`(= `tsx --test tests/*.test.ts`): 51개 통과, 0개 실패, 약 0.8초. 후속 수정 뒤 세 번 반복해도 같다(처음 작업 때는 44개, 다섯 번 반복). 기존 21개 중 상태 검사 16개는 새 사양에 맞춰 바꾸고 검증을 늘렸다. `audio.test.ts` 5개는 그대로다.

| 파일 | 수 | 확인한 것 |
| --- | --- | --- |
| `movement.test.ts` | 13 | 일반 섬 바다·건물·나무·부두. 일반 섬에는 의자 장애물이 없다. 낚시섬 연못 둑 안(반경 0~11.39)·의자·랜드마크·나무·외곽 바다·부두. 연못을 돌아가는 경로의 모든 구간(0.05 간격 재검사). 연못을 뚫지 않는 큰 이동. `Simulation`이 섬별 지형을 쓰는지. 낚시섬 부두 낚시 거부. 섬·이름·털색 위조 거부. |
| `seat.test.ts` | 6 | 30석 3구역 10석, 연못 방향, 서버 Actor 반영 시 입력 초기화·참조 유지·겉모습 유지, 잘못된 Actor 거부, 휴식 자리 30곳, 의자 출구, 할 일 trim·40자. |
| `room.test.ts` | 12 | 일반 섬 착석 거부. 여행 시 겉모습 유지·시작점 도착. 늦은 이전 섬 move 거부. move로 섬·좌석·집중·시간 위조 거부. 31명이 0번을 동시에 고를 때 1명만 성공. 30석 배타성. 두 섬 60명 수용, 61번째 거부. 자리 변경 시 주제·시간 유지, 앞 자리 해제. 휴식 중 시간 정지·예약 유지·다른 주민 착석 거부·일반 섬 안 이동만 허용. 이어가기 누적. 종료 결과(쉰 시간 제외). 휴식 중 종료. 취소. 몰아 보낸 명령의 순서. 잘못된 형식·requestId·바이너리·큰 메시지. Origin. 연결 종료 정리(서버 스냅샷으로 확인)와 새 연결 초기 상태. heartbeat 만료 시 집중·휴식 예약 해제. pong 연결 유지. |
| `focus-water.test.ts` | 7 | `pond.ts` export가 `focus-water.ts` 값과 같은 객체·함수이고 브리프 수치와 같다. 소~둑 사이 물길 중심선 양쪽 0.54m는 다리 띠 밖에서 모두 막힌다. 다리 띠 안쪽·바깥 경계. 소만으로 막히는 자리. 낚시섬 0.2m 격자 22,388점 전부: 몸 둘레 32점이 물(렌더와 같은 가로 거리 기준)에 닿지 않고, `focusHeight`가 땅(0.1)이 아닌 20점은 모두 다리 위. 두 다리를 양쪽에서 건너는 12가지 경로(교차 1회, 다리 띠 안, 길이 4 미만). 판자 19곳으로 비스듬히 들어가는 경로. 다리 밖 직선 횡단 정지. 물길이 가장 비스듬한 곳 1mm 훑기(몸 둘레 720점). 키보드 이동: 다리는 건너고 물길 앞에서는 멈춤. 30석 출구·시작점 경로, 휴식 자리, 물길 양쪽 14·15번 출구 사이를 다리 하나로 오감. |
| `room-client.test.ts` | 8 | 실제 로컬 서버에서 여행·착석·busy·휴식·이어가기·종료·비상 취소(늦은 착석 응답 무시, 서버 예약 해제). 가짜 소켓과 가짜 시계로: 5초 타임아웃 뒤 재연결·초기화, 취소 뒤 늦은 응답·스냅샷 무시, 같은 종류의 다른 `requestId` 응답 무시, 연결 끊김 정리·안내, 스냅샷 검증·59명 제한·내 예약 덧씌우기, 명령과 맞지 않는 성공 응답 거부, 기기·서버 시각 차이, `stop()` 정리. |

- 시간 검사는 오래 기다리지 않는다. 서버 시계는 `attachRoom(server, { now })`로 넣고, heartbeat·타임아웃·재연결은 `t.mock.timers`로 돌린다.
- **돌연변이 검사:** 아래 9곳을 하나씩 일부러 고장 낸 뒤 매번 최소 1개 검사가 실패하는 것을 확인했다(스크래치 스크립트, 원본은 복구함).
  - 좌석 배타성
  - 휴식 중 시간 정지
  - move 섬 위조 거부
  - 클라이언트 끊김 초기화
  - 서버 close 정리
  - 연못 충돌
  - 세션 중 여행 거부
  - 내 예약 덧씌우기
  - 늦은 응답 requestId 검사
- **후속 수정 돌연변이 검사:** 아래 7곳도 하나씩 고장 내 보았다. 모두 최소 1개 검사가 실패했다.
  - 물길·소 차단 끄기
  - 다리 예외 끄기
  - 물길 몸 여유 빼기
  - 소 끄기
  - 이동 확인 간격 15cm로 되돌리기
  - 다리 띠에서 몸 여유 빼기
  - 기울기 보정 없이 가로 거리만 쓰기
- 응답의 `command` 비교는 `requestId`가 늘 새 값이라 두 번째 방어선이다. 이것만 없애면 실패하는 검사는 없다.
- **Vite 연결 확인:** 비어 있는 것을 확인한 `127.0.0.1:4291`에 `vite`를 따로 띄웠다. Node ws로 다음을 확인한 뒤 종료했다.
  - welcome(home)
  - 일반 섬 착석 거부
  - 낚시섬 여행
  - 할 일 「 스모크 」 → 「스모크」 착석
  - 스냅샷 예약 `[0, focusing]`
  - 다른 Origin 거부
- `npx tsc --noEmit`: 후속 수정 시점에는 프로젝트 전체 오류 0개다. 처음 작업 때 남았던 `Scene.tsx`·`preview.tsx` 오류는 다른 작업자가 해결했다.
- `vite build --outDir artifacts/state-water-preview`가 성공했다. 기존 chunk 크기 경고만 있다.
- `prettier --write`는 내 소유 파일에만 실행했다.

## 6. 제약과 남은 일

- 브라우저 QA(`tests/*.mjs`)와 화면 캡처는 돌리지 않았다. 후속 수정은 렌더 값이 같다는 것을 숫자로만 확인했다. `.mjs` 스크립트에는 이전 프로토콜 이름이 없다.
- 다리 양 끝 말뚝(반경 약 0.06)은 장애물로 넣지 않았다. 판자 띠 끝에서 몸이 말뚝과 약 4cm 겹쳐 보일 수 있다. 말뚝까지 막으면 의자 뒤 다리의 걸을 수 있는 띠(±0.175)가 ±0.135로 줄어 0.4m 경로 격자 행(z −14.4, 다리 가운데에서 0.15)이 빠진다. 그러면 `pathTo`가 그 다리를 못 쓴다.
- `pathTo`는 0.4m 격자를 쓰므로, 각 다리의 걸을 수 있는 z 띠 안에 격자 행이 하나는 있어야 한다. 다리 위치나 폭을 바꾸면 `focus-water.test.ts`의 양방향 횡단 검사가 깨져 알려 준다.
- `moveSafe`는 5cm 간격으로 확인한다. 그보다 짧은 모서리 스침(몇 mm 깊이)은 남을 수 있다.
- `src/FocusIsland.tsx`(에셋 작업자 소유)의 물길 옆 조약돌 배치는 다리 z(`−(bank + 0.62)`, `−14.55`)를 직접 적는다. `BRIDGES`를 쓰면 다리를 옮길 때 같이 따라온다. 소유 범위 밖이라 고치지 않았다.
- `restSpot`이 공통 문서의 「REST_POINT 한 점」과 다르다(2절).
- 같은 섬 `travel`은 시작점으로 다시 보낸다. 낚시섬 「다시 집중하기」에는 쓰지 않아도 된다.
- 휴식 중에는 서버가 일반 섬 안 자유 이동을 받는다. 휴식 화면에서 걷기를 막을지는 UI(`sim.blocked`)가 정한다.
- 이름·할 일에서 제어 문자를 따로 걸러 내지 않는다. React 텍스트로만 그린다는 전제다.
- 사고 기록: 첫 Vite 확인 때 4186 포트에 다른 작업자의 Vite(pid 4113, 같은 폴더, 별도 config)가 먼저 떠 있었다. 내 Vite는 `strictPort`로 바로 종료됐고, 확인 스크립트가 그 서버에 약 0.5초 접속했다. 낚시섬 0번 착석 1건을 만든 뒤 연결을 닫았고, 연결 종료로 예약은 해제된다. 그 프로세스는 건드리지 않았다. 4173·4174도 건드리지 않았다.
