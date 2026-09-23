# HLD — 맵·경로·시뮬레이션·표시

상태: 구현 제안. [전송 계약](protocol.md)과 [데이터 흐름](data-flow.md)을 함께 읽는다.

## 1. 모듈과 인터페이스

| 위치 | 모듈 | 핵심 인터페이스 / 책임 |
| --- | --- | --- |
| 공통 산출물 | MapContract | `MapManifest`, `NavArtifact`, 좌표·규칙 버전, 공통 경로 fixture |
| 서버 | MapCompiler | `compile(baseMap, layout, rules) → NavArtifact`; 충돌·진입점·반경 합성 |
| 서버 | Admission | `join(ticket, readyRevision)`, 권한 lease·jti·기존 세션 교체 |
| 서버 | RoomRuntime | `accept(intent)`, `tick(50ms)`, `applyLayout(revision)`, 단일 작성자 |
| 서버 | Pathfinder | `find(nav, authoritativeStart, goal) → path/resolvedGoal/reason` |
| 서버 | SnapshotPublisher | 구독별 최신 상태, 바이너리 codec, 송신 backpressure |
| 앱 | WorldTransform | 터치↔이미지↔월드 변환. 카메라·줌·letterbox 반영 |
| 앱 | MovementController | 명령 순서, 로컬 A*, pending 입력, 서버 경로 수신·재조정 |
| 앱 | MovementTransport | 네이티브 QUIC 수명·stream/datagram·TLS 검증. 엔진과 소켓 분리 |
| 앱 | SnapshotBuffer | 세대·버전·순서 검사, 서버 시간 추정, 보간·한정 외삽 |
| 앱 | ActorRenderer | foot anchor 위치·방향·걷기/정지 스프라이트. 캐릭터 크기와 통행 반경 구분 |

게임 종속 사항은 `MovementRules`(속도·반경·통행 비용·입구·맵 키)와 Business 제어 어댑터에 둔다. 핵심 엔진은 Fishcat 시설 enum, 집중 세션, 재화 타입을 import하지 않는다. 앱 예측기와 서버 탐색기는 같은 fixture를 사용하되 서로 다른 언어 구현이다.

## 2. 좌표와 통행 산출물

### 좌표 변환

```text
screenPoint → inverse(camera × imagePlacement) → imagePoint
worldX = imageX / imageWidth  × 100
worldY = imageY / imageHeight × 100
wireX  = round(worldX × 100), wireY = round(worldY × 100)
```

원점은 좌상단, 오른쪽 +x, 아래쪽 +y. 현재 그림의 `imageWidth=1536`, `imageHeight=1024`는 맵 메타데이터로 읽는다. 바깥 탭은 앱에서 무시하고 서버는 범위 밖 입력을 거부한다. NaN·Infinity·음수도 거부한다. 경계 100은 마지막 셀로 매핑하며, 셀 인덱스는 `min(cols-1, floor(x/100*cols))`다.

서버 거리·속도 단위는 world unit/second로 고정한다. 비정방형 그림에서는 같은 월드 거리의 화면 픽셀 길이가 축별로 다르다. **96×64 격자에서 셀 한 칸을 양축 동일 거리로 취급하지 않는다.** 셀 중심 간 월드 거리로 이동 비용·휴리스틱을 계산하고, 그림 비율에 따른 속도 체감을 별도로 검증한다. 기존 픽셀 이동 코드의 수치를 그대로 새 월드 속도로 사용하지 않는다.

### MapManifest / NavArtifact

| 필드 | 의미 |
| --- | --- |
| gameId, mapId, mapVersion | 게임·원본 맵의 불변 식별 |
| roomId, layoutRevision | 섬 배치 정본 버전 |
| navRevision, contentHash | 방 안에서 증가하는 통행 버전과 전체 artifact의 SHA-256 |
| rulesVersion, coordinateVersion | 속도·반경·탐색 규칙과 좌표 계약 버전 |
| worldWidth/Height, navCols/Rows | 100×100 좌표 범위와 별도 탐색 해상도 |
| walkable, traversalCost | bitset 통행과 양의 셀 비용 |
| entrances, spawns, collisionRadius | 시설 진입점, 검증된 입구, 에이전트 반경 |

현재 96×64 통행 셀·48×32 길 비용은 마이그레이션 입력이다. 셀은 중심점만으로 통행 여부를 판정하지 않고 반경만큼 팽창시킨 충돌체와 셀/연결 선분의 교차를 보수적으로 검사한다. 얇은 벽도 노드 사이를 통과하지 못해야 한다. 서버 컴파일러가 지형+완공 시설+반경을 합성하고 클라이언트는 **같은 산출물**을 받는다. 클라이언트 시설 목록만으로 별도 충돌 맵을 만들어 authoritative 모드에서 사용하지 않는다. 파일의 hash는 인증된 manifest의 기대값과 비교한다. 맵 파일이 크면 CDN으로 받고 명령 스트림에 실어 보내지 않는다.

`navRevision`은 mapVersion/layoutRevision/rulesVersion/반경 조합 하나에만 대응한다. 컴파일 실패 시 이전 버전을 새 배치라고 발표하지 않는다. 새 배치 활성화는 준비 완료를 기다리거나 해당 방 이동을 일시 중단한다. 새 방 소유자는 동일 입력을 다시 합성한다.

## 3. A* 계약

1. 입장·세대·권한·맵 버전·명령 순서·좌표 범위를 검사한다.
2. 출발점은 해당 actor의 **현재 서버 위치**다. 셀 중심으로 강제 순간 이동하지 않고 반경을 고려한 선분 검사로 시작 노드와 연결한다.
3. 목적지 셀이 통행 가능해도 출발점에서 다른 연결 영역이면 유효 목적지가 아니다. 출발점 영역 안의 유효 후보 중 탭 좌표까지 월드 거리 최소점을 선택한다. 동률은 셀 index 순으로 고정한다. 기본 후보는 셀 중심이며 도착 오차는 해당 셀 반대각선 길이로 설명한다. 건물 탭은 등록된 진입점 후보를 같은 규칙으로 고른다.
4. 같은 연결 영역이 없거나 시작점이 유효하지 않으면 `NO_REACHABLE_GOAL` 또는 재동기화로 응답한다. 새 맵 전환의 안전 위치 처리는 일반 탭 보정과 구분한다.
5. 8방향 A*를 사용한다. 대각선은 양옆 직교 셀이 모두 통행 가능할 때만 허용한다. edgeCost는 실제 월드 거리 × 이동 대상 셀의 양의 비용이다. 길 0.8·잔디 2.7은 현재 코드에서 가져온 초기 비용 제안이다.
6. 휴리스틱은 월드 직선 거리 × 맵의 최소 비용으로 두어 과대평가를 피한다. 비용 계산은 공통 고정소수점 스케일(초안 10⁶)로 통일하고 edge 비용은 올림, 휴리스틱은 내림한다. TS/Go의 계산·반올림 규칙을 fixture로 고정한다. 우선순위 동률은 `(f,h,nodeIndex)`로 고정한다. 공통 fixture는 경로·비용·도착점과 장애물 비관통을 검사한다.
7. 경로 단순화는 캐릭터 반경까지 포함한 선분 검사를 통과할 때만 허용한다. 시각적으로 짧아 보인다는 이유로 모서리를 자르지 않는다.

맵 크기·확장 노드 수·경로 노드 수는 제한한다. 1차는 통행 셀 ≤ 16,384, 방문 노드 ≤ 셀 수, 결과 waypoint ≤ 4,096을 제안한다. 한도 초과는 명시적 `PATH_LIMIT`으로 종료한다. 도달할 수 있다는 것과 최소 비용 경로를 계산했다는 것을 구분하며, 시간 초과를 성공 경로로 위장하지 않는다.

A*는 제한된 worker pool에서 실행한다. 입력에는 `(epoch, navRevision, actorGeneration, commandSeq, startTick)`을 붙인다. 최신 명령이 아니거나 맵/세대가 바뀐 결과는 폐기한다. 계산 중 actor가 움직였으면 적용 틱의 위치에서 첫 구간을 다시 연결·충돌 검사하고, 불가능하면 최신 출발점으로 재계산한다. 변경이 반복되면 최신 명령 하나만 남겨 연산 폭주를 막는다.

## 4. 서버 틱

```text
매 50ms:
  소유 lease와 권한 lease / liveness 확인
  준비된 제어 변경과 최신 경로 결과를 순서대로 적용
  각 actor의 path 위에서 speed × 0.05만큼 이동
  끝점 도달이면 정지 + Arrived를 신뢰성 있게 발행
  활성 수신자에게 최신 Snapshot 발행 기회 제공
```

경로가 변하지 않으면 A*를 다시 실행하지 않는다. 한 스텝에서 waypoint를 여러 개 지나면 남은 거리를 다음 구간에 계속 적용한다. 렌더 시간·클라이언트 clock으로 속도를 정하지 않는다.

시간은 서버 monotonic clock을 사용한다. 틱이 밀려도 거대한 delta로 벽을 건너뛰지 않는다. 최대 2회 catch-up 후 지연을 계측하고 신규 입장/경로 작업을 제한한다. 수용 불가능한 지연이면 방 재동기화·부하 분산으로 회복한다. 송신 큐는 수신자별 최신 스냅샷으로 덮어쓰며, 신뢰성 메시지 큐도 바이트·개수 상한을 두고 지속 초과 연결을 종료한다.

## 5. 앱 예측·보간·보정

![앱과 서버의 이동 책임](diagrams/03-movement.svg)

[Mermaid 원본](diagrams/03-movement.mmd)

### 내 캐릭터

- 탭마다 commandSeq를 올리고 예측 A*를 시작한다. 명령에는 목적지와 navRevision만 보내며 서버가 신뢰할 출발 좌표를 보내지 않는다.
- 서버 `PathAccepted`의 pathId·startTick·확정 출발점·도착점을 채택한다. snapshot의 lastCommandSeq 이하 pending 입력을 제거한다. 아직 처리되지 않은 최신 목적지는 확정 위치에서 다시 예측한다.
- `lastCommandSeq`는 거절까지 포함해 처리 완료된 명령이다. 명시적 reject 결과도 받는다. 서버 tick 기준 위치로 시뮬레이션 상태를 즉시 맞추고, 오차가 작은 경우 표시 offset만 짧게 감쇠한다.
- 시작 보정 기준은 0.25 world unit 이내에서 최대 100ms로 제안한다. 보정 선분이 장애물을 가로지르거나 오차가 크면 확정 위치로 즉시 맞춘다. 카메라 완화는 가능하지만 내부 물리 위치를 느리게 보정하지 않는다.
- 300ms 동안 유효한 snapshot을 받지 못하면 추가 예측을 중단하고 연결 상태를 표시한다. 전송 실패를 숨긴 채 도착 처리를 하지 않는다.

### 다른 주민

- heartbeat 왕복 시간과 서버 tick으로 서버 시간을 추정한다. 사용자 기기 wall clock은 신뢰하지 않는다.
- 서버 시간보다 100ms 뒤인 시점을 렌더링하고, 해당 path의 segment를 따라 거리로 보간한다. 직선으로 두 좌표를 연결해 건물 모서리를 통과하지 않는다.
- 새 pathId의 좌표가 신뢰성 있는 경로 메시지보다 먼저 오면 경로 도착까지 정지하고 한 번의 경로 재요청으로 합친다. 알 수 없는 경로를 추측하지 않는다.
- 손실 시 알려진 경로 위에서 최대 100ms 외삽하되 도착점·권한 종료를 넘어가지 않는다. 이후 정지·재동기화한다.
- epoch/navRevision이 다른 데이터는 합치지 않는다. actor별 tick/sequence가 오래되면 버린다. 입장·퇴장·맵 전환은 신뢰성 메시지로 처리한다.

네이티브 어댑터는 네트워크 I/O·복호화·패킷 검증을 담당하고 JS에는 묶은 상태를 전달한다. React state를 actor별 20Hz마다 갱신하는 구조 대신 버퍼/animation 루프에서 읽는다. 앱 배터리·JS stall·네이티브 큐 적체는 POC의 실제 측정 항목이다.

## 6. 맵 변경과 복구

배치 변경은 새 artifact를 컴파일한 뒤 `MapChanged`로 알리고 지정 틱에 방 전체가 전환한다. 기존 경로는 재검사·재탐색한다. 준비되지 않은 앱의 입력은 `MAP_NOT_READY`로 거부하며 맵 준비 ack 이후 재개한다. 전환 직후 충돌 영역에 있는 actor는 지정 안전 입구로 옮기고 `Relocated(reason=MAP_CHANGED)`를 전달한다.

재접속은 기존 commandSeq를 새 연결에 재사용하지 않는다. 새 sessionId·actorGeneration을 만들고 전체 상태·시간 기준을 받는다. 지연된 이전 연결의 명령은 actorGeneration 검사로 거부한다. 서버 장애는 새 roomEpoch이므로 모든 경로·예측·버퍼를 비우고 입구에서 시작한다. [복구 흐름](data-flow.md)을 따른다.
