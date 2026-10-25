# 혼합 부하의 중단 결과와 종료 진단

`loadtest/scripts/aws-mixed.py`는 기존 k6 HTTP 여정과 Node WebSocket 단계를 함께 실행한다. 대상 URL과 fixture 경로는 반드시 인자로 지정한다. fixture·토큰·운영 보고서를 저장소에 넣지 않는다. Python 3, Node 22 이상, k6가 필요하며, 실행 전에 전용 시험 계정과 정리 범위를 확인한다.

```bash
python3 loadtest/scripts/aws-mixed.py \
  --url http://127.0.0.1:8080 \
  --ws-url ws://127.0.0.1:8080/ws/realtime \
  --users /tmp/dedicated-users.json --out /tmp/mixed-results \
  --home-rate 5 --focus-rate 1 --chat-connections 300 --chat-frequency 0.1 \
  --common-seconds 120 --seconds 180 --chat-seconds 210 --runtime-seconds 300
```

HTTP만 실행할 때는 `aws-capacity.py --url ... --users ... --out ... --cases account --rates 1,2,5`를 사용한다. WebSocket만 실행할 때는 `node loadtest/scripts/aws-realtime.mjs --url ... --users ... --out /tmp/ws.json --connections 10 --mode chat`를 사용한다. 두 도구 모두 `--run-id UUID`를 받으며, 혼합 감독자는 같은 UUID를 모든 자식에게 전달한다.

`--common-seconds`는 반드시 명시하는 공통 측정 목표다. 위 예시는 목표 120초, HTTP 180초, 채팅 210초, 전체 실행 상한 300초다. `--seconds`와 `--chat-seconds`를 생략하면 각각 120초·150초이며 공통 목표를 자동으로 낮추지 않는다. HTTP 사전 정리·3초 워밍업·10초 휴지와 WebSocket 연결 준비에는 공통 시작 장벽이 없다. 따라서 home과 focus의 시작 시차도 있으므로 실제 공통 구간이 각 구성요소 실행 시간보다 짧을 수 있다. `commonMeasurementOverlapSeconds`가 계획 `commonMeasurementPlannedSeconds`보다 0.1초 이상 짧으면, 세 구성요소가 각각 통과했더라도 `incomplete_window`와 종료 코드 1을 반환한다. 공통 목표를 만족하려면 home·focus·chat 모두의 실제 준비 시간을 고려해 각 실행 구간을 공통 목표보다 충분히 길게 지정해야 한다. 채팅 시간만 늘려도 두 HTTP 여정의 시작 시차는 해결되지 않는다. 여유보다 시차가 크면 계속 실패한다. HTTP 공통 구간은 도착률 계획 종료까지로 제한하고 종료 유예를 포함하지 않는다. 개별 RPS/TPS의 분모는 raw의 `testRunDurationMs`로 종료 유예를 포함하며(`measurementWindows`의 HTTP 항목에 `basis: 'testRunDuration'` 표기), 공통 구간 값이 아니다. `commonWindowThroughput`은 계산하지 않고 항상 `null`이다. 전 구간 집계의 요청 수를 짧은 공통 구간으로 다시 나누지 않으며 `commonWindowThroughput`은 별도 시계열이 없으므로 null이다.

fixture는 최소 `300 + --chat-connections` 명이 필요하다(채팅 300이면 600명 이상). 섬당 인원은 최대 15명이다. 기존 시험과 비교할 때는 **10명/섬을 고정하고 섬 개수**를 늘린다. 혼합 시험은 첫 60개 계정을 집중용으로, offset 300 이후 계정을 채팅용으로 사용하고 두 집합의 중복을 거절한다. 조회 여정의 VU는 실제 접속자 수와 같지 않다.

## 보존하는 증거

- `mixed-meta.json`: run ID, 시작·종료 UTC, 자식별 상태와 중단 사유, 실제 측정 구간 및 교집합, 혼합 판정.
- `home|focus/*-checkpoint.json`: 자식 시작 전 계획과 원시 경로. 종료 중 정규화가 빠져도 감독자가 재수거한다.
- `home|focus/*-status.json`, `results.json`: 단계별 관측 집계. SIGINT/SIGTERM은 k6 종료 유예 후 `PARTIAL`로 남긴다. 자식 실패·강제 종료 후 raw가 없으면 요청·오류·TPS를 null로 남긴다.
- `startedJourneys`/`finishedJourneys`/`completedJourneys`: 시작, 함수 종료, 전체 단계 성공을 구분한다. 시작과 종료의 차이는 미확인 진행 중 여정의 하한이다. 서버 반영·보상 여부는 이 집계로 확정할 수 없다. 카운터가 없거나 유예 소진으로 여정이 남으면 PASS를 주지 않는다.
- `ws/chat.json`: 첫 10개 close/error 관측, connection UUID, UTC, close code, 제한된 reason 및 상대 선언 사유. 임의 본문·close reason은 `UNKNOWN` 또는 `REDACTED`로 바꾼다.

JSON은 같은 디렉터리의 임시 파일에 fsync한 뒤 rename한다. 감독자가 살아 있는 자식에게 먼저 SIGINT를 보내고 유예 후 프로세스 그룹에 SIGTERM/SIGKILL을 보내므로 Python과 k6가 중복 SIGINT로 집계를 잃는 것을 피한다. 정전·커널 패닉에서는 rename 뒤 디렉터리 fsync가 없어 마지막 저장이 사라질 수 있다. 감독자 자체가 SIGKILL되거나 머신이 사라지는 경우 최종 집계 보존은 보장하지 못한다. 남아 있는 체크포인트와 raw를 이용해 회수해야 한다.

> 아래 Realtime 서버 쪽 서술(`server_socket_id`·`cleanup=NOT_OBSERVED`·`WebSocketConnectionDiagnosticsTest`)은 **Realtime 서버 PR(티켓 2417 키, 2419 진단 로그 포함)이 머지된 뒤에만 유효**하다. 이 loadtest PR 이 먼저 머지되면 서버 쪽 대조 로그는 Realtime 서버 PR 이 머지·배포된 뒤에 생긴다 — 머지 순서 제약이 아니라 AWS 재실행(30섬×10명) 착수의 선행조건이다.

WebSocket URL에는 `loadtestRunId`와 `loadtestConnectionId` UUID만 추가한다. nginx의 기존 요청 로그와 Realtime의 `websocket_connection` 이벤트를 시간·UUID로 맞출 수 있다. `server_socket_id`는 서버 WebSocket 세션 ID이며 기존 소켓 로그와의 연결에 사용한다. 인증 세션 ID는 기록하지 않는다. `CLOSED`는 종료 콜백을 관측한 시점이고 뒤따르는 정리 완료는 별도 확인한다(`cleanup=NOT_OBSERVED`). 이 값은 클라이언트가 제시한 **상관관계 힌트**이며 인증된 신원이나 원인 증거가 아니다. Realtime는 UUID 둘이 유효할 때만 관측하고 원문 URL·reason·예외 메시지를 기록하지 않는다. `initiator`는 `CLIENT`/`UNKNOWN`/`PEER`뿐이며, `PEER`는 프록시/서버 중 어느 쪽인지 구분하지 않고 1011·1012 같은 서버 오류 종료도 `PEER`로 묶는다. 클라이언트 `finish()`가 서버 close 프레임 처리 중에 겹치면 `CLIENT`로 기록될 수 있다. `closeEvents`는 첫 10개만 남기고 총 종료 수는 `closeCount`에 기록한다. `HEARTBEAT_TIMEOUT` 선언이 없으면 코드·경과 시간만으로 heartbeat 장애라고 단정하지 않는다. 실제 운영 원인은 서버·nginx·kernel 로그와 함께 판정한다.

## 회귀 검증

```bash
python3 -m unittest discover -s loadtest/tests -p 'test_*.py' -v
node loadtest/tests/test_ws_evidence.mjs
server/realtime/gradlew -p server/realtime test \
  --tests com.oneorthree.realtime.config.WebSocketConnectionDiagnosticsTest \
  checkstyleMain spotbugsMain
```

테스트는 임시 synthetic fixture와 localhost HTTP/WebSocket 서버만 사용한다. SIGINT/SIGTERM/자식 실패, raw 유실, 공통 구간 부족, 실제 k6 카운터, 5가지 종료 관측, 임의 secret 본문 비노출을 검증한다. 실제 heartbeat 협상이나 프록시 종료를 재현한 운영 검증은 아니다. 동일한 30개 섬 × 10명 혼합 조건의 운영 3회 재시험은 아직 수행하지 않았으며, 코드 변경만으로 최대 용량이나 원인 해결을 선언하지 않는다.
