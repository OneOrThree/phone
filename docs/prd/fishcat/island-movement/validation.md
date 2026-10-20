# 검증 계획·작업 로그

## 1. 이번 PR의 범위

2026-09-23에 작성한 **설계 문서 PR**이다. 런타임 구현, QUIC 연결 테스트, 성능 실측, TestFlight 업로드를 수행한 결과가 아니다. 아래 제품 검증 표는 후속 구현의 수용 기준이다.

## 2. 요구사항 추적과 구현 검증

| 검증 | 요구사항 | 입력·조건 | 기대 결과 / 증거 |
| --- | --- | --- | --- |
| T01 좌표 | MV-01 | 화면 크기·줌·이동·letterbox·경계 0/100·다양한 원화 비율 | 같은 탭의 월드 좌표 일치, wire 왕복 축당 오차 ≤ 0.005 |
| T02 맵 | MV-02, MV-12 | hash 오류·구버전 앱·배치 누락·컴파일 실패 | 이동 잠금/명시적 거부, 새 맵 준비 후 동일 navRevision |
| T03 탐색 | MV-04 | 길/잔디 비용·바다·건물·모서리·교량·다른 연결 영역·같은 셀 | TS/Java 공통 fixture에서 유효 경로·비용·도착점 일치 |
| T04 입력 경합 | MV-05, MV-10 | 연속 10회 탭, A* 결과 역순, 이전 seq 재전송 | 최신 목적지만 적용, 이전 응답으로 되돌림 없음 |
| T05 틱 | MV-06, MV-08 | 서버 정지/재개·긴 waypoint·한 틱 다중 구간·경로 변경 | 속도 상한 준수, 고정 스텝, 틱당 A* 없음 |
| T06 화면 | MV-07 | path보다 좌표 먼저 도착·지터·손실·JS stall | 장애물 통과 없음, 제한 시간 뒤 정지, 프레임·보정 거리 기록 |
| T07 바이너리 | MV-08, MV-09 | 잘린 프레임·과대 count·미지원 버전·예약 필드·uint64 epoch | TS/Java golden bytes 일치, fuzz 시 크래시·과대 할당·상태 변경 없음 |
| T08 인증 | MV-03, MV-09 | 다른 방 티켓·만료·jti 재사용·변조·인증서 불일치·0-RTT | 입장 거부, 위치 정보 노출 0건 |
| T09 취소 | MV-03, MV-11 | 강퇴/로그아웃과 입장/갱신 경합, 취소 이벤트 유실 | tombstone 우선, 권한 lease 만료 후 송수신·이동 0건 |
| T10 재접속 | MV-11 | 배경 종료·Wi-Fi 전환·동일 계정 다른 기기 | 새 actor/generation, 이전 입력 차단, 전체 상태 수렴 (2단계 QUIC. 1단계는 MV-D11 — 같은 actor 유지, 이전 세션 commandSeq·intent 차단, FullState 로 수렴) |
| T11 소유권 | MV-12 | worker kill·네트워크 분할·저장소 quorum 상실·긴 프로세스 정지 | lease 만료 전에 이전 owner 정지, 새 epoch에서만 처리 |
| T12 배치 | MV-02, MV-12 | 이동 중 건물 완공·역순 이벤트·맵 다운로드 실패 | 원자 전환, 무효 경로 재계산·안전 재배치, 옛 맵 입력 거부 |
| T13 부하 | MV-06, MV-08, MV-12 | PRD의 1,500연결·30분·기준 자원 | A*·틱 지연·CPU·메모리·NIC 송신·drop 지표와 결과 파일 |
| T14 운영 | MV-13 | 입장→탭→보정→취소 1건 추적 | 상관 ID로 연결, 티켓/토큰/키 미기록, 고카디널리티 메트릭 방지 |
| T15 재사용 | MV-12 | Fishcat 외 합성 gameId·다른 맵·다른 속도 | 게임 간 actor·맵·권한 격리, 엔진의 Fishcat 도메인 의존 0건 |
| T16 맵 배포 | MV-02, MV-16 | manifest 갱신·부분 다운로드·해시 불일치·오프라인·앱 배경 전환 중 수신 | 검증된 파일만 사용, 새 버전 전부 준비 전 이전 버전 유지, 빈 섬·깨진 타일 0건, 재시도 뒤 수렴 |
| T17 폴백 | MV-14 | UDP 차단망·연결 실패 3회·연결 중 망 전환 | 로컬 연출로 전환, 「실시간 이동 꺼짐」 표시, 다른 주민 추측 위치 0건, 다음 입장에서 재시도 |
| T18 데이터 예산 | MV-15 | Wi-Fi/셀룰러·포그라운드/배경·AFK, 15명 방 30분 | 수신 payload 시간당 ≤ 30 MB(20Hz)·≤ 8 MB(5Hz), 배터리 소모 기록, 송신 주기 전환 지연 ≤ 2초 |

성능 테스트에서 실패하면 수치를 낮춰 통과했다고 기록하지 않는다. 병목·수용 가능 부하·필요 자원과 변경한 목표의 근거를 남긴다.

## 3. 구현 순서와 완료 증거

| 단계 | 작업 범위 | 완료 증거 / 다음 단계 조건 |
| --- | --- | --- |
| 0. 계약 | 100×100 의미·좌표 metric·반경·맵 스키마·직접 연결 경계 결정 | 결정 로그, MapManifest fixture, 승인된 호출·공개 면 표 |
| 1. 전송 POC | **1단계(확정)**: Realtime JVM 안 이동 엔진 + 기존 STOMP/WSS 로 20Hz 스냅샷 · 2단계: Java/Netty QUIC ↔ iOS/Android quiche adapter | 1단계: 틱 p99·송신 큐 길이·GC pause·앱 배터리·HOL 지연을 실기기 1대로 측정해 2단계 착수 기준을 만든다. 2단계: 실기기 암호화 연결·인증서 검증·망 전환·20Hz 측정 |
| 2. 맵·코어 | 기존 아트 변환, 서버 A*·고정 틱·안전 도착점 | TS/Java fixture, headless 시뮬레이션, 통행/코너 회귀 |
| 3. 수직 연결 | Business 입장→worker 경로→앱 표시, 실제 주민 2명 | 서로의 경로·좌표가 같은 방에서 일치하는 화면 녹화와 상관 로그 |
| 4. 상태 변화 | 취소·배치 변경·재접속·소유권·드레인 | 장애 주입 T09~T12와 lease 경계 재현 |
| 5. 부하·운영 | 관측·큐 한도·팬아웃·버전 기능 플래그·롤백 | T13~T15, 자원·비용 표, 운영 runbook |
| 6. 배포 | 사내 섬→제한 사용자→확대, 앱 native 배포 | iOS/Android 빌드와 실제 연결 검증, 정해진 지표 충족 |

계약 fixture 작업(Phase 0)과 맵·코어(Phase 2)는 아키텍처 8단계와 무관하게 시작한다. 전송 POC(Phase 1)는 dev VM 에서 출발지 IP 허용목록으로 닫힌 UDP 포트로 먼저 수행하고, 공개망 노출은 §6-6(MV-D06) 승인 뒤에만 한다. 네이티브 전송 검증 전에 전체 앱 연결 방식을 확정하지 않는다. Phase 3 이후는 8단계(소유 저장소·JVM 서비스 모듈 등록 포함)를 전부 반영한 뒤 착수한다 — 아키텍처 §6 의 규칙과 같다.

| 열린 결정 | 막는 Phase |
| --- | --- |
| MV-D01 좌표 해석 | 확정(2026-10-07, 100×100 셀). 맵 재생성이 Phase 0 작업 |
| MV-D02 직접 연결 A 결정 · MV-D06 공개 UDP 면과 Cloudflare 경계 | Phase 1 공개망 단계, Phase 3 이후 |
| MV-D03 라이브러리 고정 | Phase 1 완료 조건 |
| MV-D05 월드 속도·반경 | Phase 2 |
| MV-D07 폴백 표시·재시도 | Phase 3 |
| MV-D04 동접·취소 지연·복귀 정책 | Phase 5·6 |
| MV-D08 집중섬 전환 · MV-D09 정적 서빙 위치 | 둘 다 확정(2026-10-07). 집중섬은 홈 섬 전환 뒤, 정적 서빙은 Nginx 직접 |

### 기기·망 매트릭스 (Phase 1·3·6 공통)

| 축 | 값 |
| --- | --- |
| 1차 측정 | **단일 기기 가정**(결정 2026-10-07): 조재영 기기 1대로 Phase 1·타일 섬 프레임 측정. 아래 매트릭스는 출시 전 |
| iOS | 지원 최소 버전(배포 타깃 16.4) 기기 1대 + 최신 1대 |
| Android | 저사양(RAM 4 GB) 1대 + 최신 1대 |
| 망 | Wi-Fi, LTE/5G, 3G 대역 제한(1 Mbps·RTT 150 ms), UDP 443 차단망 |
| 상태 | 포그라운드, 배경 전환 후 복귀, Wi-Fi↔셀룰러 전환, 기내 모드 토글 |

## 4. 문서 검증 기록

검증 환경: macOS, Google Chrome headless, Mermaid 11.12.0. Mermaid는 `/tmp`에 설치해 앱 의존성을 변경하지 않았다. `.mmd`를 단일 원본으로 두고 `.svg`를 함께 커밋한다.

- 설계 도식 7개: 전체 구조, 배포, 이동, 입장, 맵 변경, 복구·취소, 좌표/도메인 이벤트 경로.
- 문서 상대 링크와 그림 참조, SVG XML, 패킷 필드 길이·오프셋·대역폭 산술을 검사한다.
- 도식을 실제 렌더링하고 글자·화살표·잘림을 시각 점검한다.
- 최종 결과는 아래 작업 로그에 남긴다.

### 도식 재생성 예

격리된 임시 작업 디렉터리에서 Mermaid CLI를 준비한 뒤 아래 명령을 각 `.mmd`에 적용한다. CLI 버전은 실제 사용 환경에서 Mermaid 11.12.0 호환 여부를 확인한다. 이 예는 재생성 방법이며 이번 검증은 Playwright에서 Mermaid 11.12.0의 `parse`/`render`를 직접 호출했다.

```sh
mmdc -i docs/prd/fishcat/island-movement/diagrams/01-architecture.mmd \
  -o docs/prd/fishcat/island-movement/diagrams/01-architecture.svg \
  -c /tmp/movement-mermaid-config.json -b white
```

설정은 `theme: neutral`, `fontFamily: Apple SD Gothic Neo, Noto Sans KR, sans-serif`, `htmlLabels: false`, `flowchart.htmlLabels: false`, `flowchart.curve: linear`를 사용한다. 사용한 Mermaid 버전·폰트·렌더러가 다르면 시각 점검을 다시 한다.

## 5. 근거

### 저장소 확인

- [현재 섬 A*](../../../../app/app-dev/src/utils/village-world.ts): 길 비용 0.8·잔디 2.7, 대각선 모서리 차단, 완공 시설별 scene 합성.
- [현재 맵](../../../../app/app-dev/src/assets/village-world/map.json): 원화 1536×1024, navigation 96×64, road 48×32.
- [현재 섬 화면](../../../../app/app-dev/src/screens/island/WorldMap.tsx), [현재 실시간 연결](../../../../app/app-dev/src/services/islandRealtime.ts): 로컬 연출과 도메인 이벤트를 분리해 조사.
- [서비스 추가 규칙](../../../architecture/README.md): 직접 연결·호출 관계·저장소·공개 면의 후속 승인 필요.
- [제품 결정 로그](../decision-log.md): 정원 관련 기존 문서 차이를 새 제품 정책으로 덮어쓰지 않고, 15 actor는 부하 시나리오로만 사용.

### 외부 1차 자료 — 2026-09-23 열람

- [RFC 9221](https://www.rfc-editor.org/rfc/rfc9221.html): QUIC DATAGRAM의 전달·크기 제약.
- [RFC 9001](https://www.rfc-editor.org/rfc/rfc9001.html): QUIC TLS 보호와 0-RTT 고려사항.
- [RFC 9147](https://www.rfc-editor.org/rfc/rfc9147.html): DTLS 대안 검토 근거.
- [Netty QUIC API](https://netty.io/4.2/api/io/netty/handler/codec/quic/package-summary.html) · [DATAGRAM 설정](https://netty.io/4.2/api/io/netty/handler/codec/quic/QuicCodecBuilder.html): Java 서버 전송 후보. 구체 버전·네이티브 호환·성능은 POC로 검증.
- [KafkaConsumer 공식 문서](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html): 같은 consumer group 안에서의 분배와 앱 구독자 팬아웃을 구분하는 근거.
- [quiche upstream](https://github.com/cloudflare/quiche): C FFI와 모바일 빌드 후보. 문서에 모바일 빌드 예가 있다는 사실은 최신 앱 빌드 성공을 보장하지 않음.
- [React Native Networking](https://reactnative.dev/docs/network): 기존 JS 네트워크 표면과 네이티브 어댑터 필요 판단.
- [etcd API guarantees](https://etcd.io/docs/v3.6/learning/api_guarantees/): 선형화 가능한 소유권 저장소 후보. lease 운영·장애 성질은 별도 POC 항목.

## 6. 작업 로그

| 날짜 | 작업 | 결과 |
| --- | --- | --- |
| 2026-09-23 | 기존 사용자 제안·로컬 A*·맵·서버 경계 조사 | 사용자 요구와 신규 기술/정책 제안을 구분 |
| 2026-09-23 | 문서 작업 티켓 생성, 최신 main 기반 문서 전용 브랜치 생성 | GROMO-2110, 기존 앱·TestFlight 로컬 변경은 포함하지 않음 |
| 2026-09-23 | PRD·정책·전체 아키텍처·HLD·전송·데이터 흐름 작성 | 구현 순서·측정 목표·미확정 게이트·재접속/취소/맵 변경 계약 기록 |
| 2026-09-23 | Mermaid 11.12.0 parse/render·Chrome 시각 점검 | 도식 6/6 렌더 성공. HTML 라벨의 XML 비호환을 SVG text 라벨로 수정, 겹치는 전체 구조 화살표 단순화 |
| 2026-09-23 | 상대 링크·SVG XML·패킷 산술·요구 추적 검사 | 기능 폴더의 상대 링크 51개 정상, SVG 6개 파싱 성공, header 32B/entity 24B·전송 예산 일치, 요구사항 13개 모두 검증 표에 연결 |
| 2026-09-23 | Plannotator 피드백 1건 수신 | architecture.md의 앱↔Movement 행에 Java 계산·Kafka 앱 소비·직접 연결/C++·기존 Realtime 연결 통합 비교 요청 |
| 2026-09-23 | 코드와 1차 자료 재검토 후 설계 추천 수정 | Go/quic-go 출발안을 Java 코어+Netty QUIC 후보로 변경. 직접 연결·언어·배포 경계를 구분하고 Kafka 서버 소비 및 Realtime 통합 대안 비교 추가. 사용자 확정으로 기록하지 않음 |
| 2026-09-23 | 피드백 반영 후 문서 재검증 | Mermaid/SVG 7개 렌더·파싱 성공, 변경 도식 시각 점검, 상대 링크 59개 정상, 요구사항 13개 추적·32B/24B 패킷 계약 유지 |
| 2026-09-23 | 학습 자료 추적 제외 | 사용자 요청으로 학습 문서·전용 도식을 Git 제외 경로 doc/island-movement/로 이동. 공유 설계 문서의 학습 링크 제거 |

## 7. 1단계 측정 (2026-10-09, 로컬)

1단계(Realtime JVM 안 이동 엔진 + 기존 STOMP/WSS)의 **서버 측** 측정이다. 앱은 띄우지 않았다. [측정 스크립트](scripts/measure-movement.mjs)가 앱 `islandRealtime.ts`(`e6e9b6920`, 피처 `f17856bcf` 와 같은 파일)의 이동 채널과 같은 연결·구독·intent 를 보내는 사용자 N명을 흉내 낸다. 기기 전용 행은 실기기 측정(티켓 2250 잔여, 오너)으로 채우고, 2단계 판단([아키텍처 §7](architecture.md#7-java--kafka--realtime-선택-검토))은 그 뒤에 한다.

- 환경: 맥 한 대(Apple M5 Pro)의 Docker Desktop(8 CPU · 7.65 GiB, aarch64) 로컬 스택. nginx `:8088` 뒤에 business-api(게스트·섬 API)와 realtime(`/ws/realtime`)이 있다. 측정 클라이언트도 같은 맥이라 왕복에 실제 망 지연은 거의 없다.
- 서버: realtime 컨테이너만 브랜치 `bfeat/GROMO-2247-movement-stomp` 의 `7af884d` jar 로 재기동(20:35 KST)했다. 나머지 컨테이너는 그대로다.
- 부하: 게스트 N명이 가입 승인 없는 한 섬에 사용자당 세션 1개로 들어간다. 60초 동안 사용자마다 2초 간격(+0~1틱 무작위 지터, 사용자끼리는 2초를 N 등분해 엇갈림)으로, 스폰과 같은 연결 영역의 통행 셀 3,181개 중 무작위 셀 중심으로 intent 를 보낸다. 경로의 23~29%만 다음 intent 전에 도착했다(세션이 받은 Arrived ÷ PathAccepted) — 전원이 거의 쉬지 않고 걷는 부하다. N 사이에 60초 쉰다. 방(섬)은 1개다 — N 은 한 방의 세션 수이고, 방 수가 늘 때의 영향은 재지 않았다.
- 시각(KST): N=1 23:46:27 · N=5 23:48:32 · N=15 23:50:36.

모든 값은 재현 명령 ①, 서버 `7af884d` 기준. 평균 = Δsum/Δcount, 최대 = 뒤 스크레이프의 `_max`.

| 항목 | N=1 | N=5 | N=15 | 측정 방법 |
| --- | --- | --- | --- | --- |
| 실행 유효성(서버 틱 진행) | 99.9% (Δtick 1288 / 벽시계 64.5초) — 정상 | 99.9% (Δtick 1288 / 벽시계 64.5초) — 정상 | 99.9% (Δtick 1290 / 벽시계 64.6초) — 정상 | movement_tick_seconds Δcount ÷ (전후 스크레이프 사이 벽시계 ÷ 50ms) |
| 접속·첫 FullState | 준비 1/1 · 첫 movement 메시지 FullState 1/1 · 자기 actor 포함 1/1 · FullState 전 Snapshot 0건 · 구독→FullState p50 80.2 ms, 최대 80.2 ms | 준비 5/5 · 첫 movement 메시지 FullState 5/5 · 자기 actor 포함 5/5 · FullState 전 Snapshot 0건 · 구독→FullState p50 66.3 ms, 최대 67.6 ms | 준비 15/15 · 첫 movement 메시지 FullState 15/15 · 자기 actor 포함 15/15 · FullState 전 Snapshot 0건 · 구독→FullState p50 120.4 ms, 최대 132.4 ms | CONNECT(Bearer) 뒤 movement → movement/snapshot → /user/queue/errors 순 SUBSCRIBE, 첫 FullState 수신 − movement SUBSCRIBE 송신 |
| intent → 내 PathAccepted 왕복 | p50 31.2 ms · p99 56.8 ms · 최대 56.8 ms (응답 30/보냄 30) | p50 29.5 ms · p99 58.6 ms · 최대 60.7 ms (응답 150/보냄 150) | p50 31.6 ms · p99 56.7 ms · 최대 70.3 ms (응답 450/보냄 450) | 사용자마다 2000ms 간격(+0~1틱 무작위 지터) 무작위 통행 셀(스폰 연결 영역) intent, 송신 직전 → 같은 commandSeq·내 userId PathAccepted 수신. 서버가 다음 틱(≤50ms)에 처리하므로 틱 대기 포함. 최근접 순위 백분위⁽¹⁾ |
| MoveRejected | 0건 | 0건 | 0건 | 요청자 세션에만 오는 MoveRejected 를 reason 별로 |
| 무응답 intent | 0건 (미연결로 못 보냄 0건) | 0건 (미연결로 못 보냄 0건) | 0건 (미연결로 못 보냄 0건) | 부하 끝 + 3초 안에 PathAccepted·MoveRejected 가 없던 intent |
| Snapshot 수신 간격 | p50 50.0 ms · p99 53.6 ms · 최대 64.9 ms · 100ms 이상 0.00% (표본 1110) | p50 50.0 ms · p99 53.8 ms · 최대 74.9 ms · 100ms 이상 0.00% (표본 5995) | p50 50.0 ms · p99 57.2 ms · 최대 75.0 ms · 100ms 이상 0.00% (표본 17985) | 20Hz 기대 50ms. 직전 Snapshot 에 MOVING entity 가 있을 때 다음 Snapshot 까지의 간격(정지 뒤 공백 제외), 전 세션 합산 |
| 세션당 수신량 | 평균 8361 B/s (≈ 30.1 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 203 B | 평균 21964 B/s (≈ 79.1 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 742 B | 평균 54717 B/s (≈ 197.0 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 2090 B | 부하 60초 동안 WebSocket message 바이트(STOMP 헤더·하트비트 포함) ÷ 60. 전 세션이 같은 브로드캐스트를 받아 세션 간 편차는 거의 없다 |
| 끊김·ERROR | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | 의도적 해제 전 WebSocket close code·reason, STOMP ERROR message, /user/queue/errors code |
| movement_tick_seconds | Δcount 1288 · 평균 0.1 ms · 최대 9.4 ms | Δcount 1288 · 평균 0.3 ms · 최대 12.7 ms | Δcount 1290 · 평균 0.3 ms · 최대 6.9 ms | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창)⁽²⁾ |
| movement_pathfind_seconds | Δcount 30 · 평균 0.4 ms · 최대 2.8 ms | Δcount 150 · 평균 0.4 ms · 최대 12.5 ms | Δcount 450 · 평균 0.2 ms · 최대 5.2 ms | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창) |
| movement_outbox_reliable_depth | 표본 38 · 평균 1.00 · 최대 1 | 표본 980 · 평균 1.00 · 최대 1 | 표본 8625 · 평균 1.05 · 최대 13 | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창). reliable 사건을 넣은 직후 세션 큐 깊이 |
| movement_outbox_snapshot_superseded_total | Δ 0 | Δ 0 | Δ 0 | 보내기 전에 더 새 Snapshot 으로 덮어쓴 횟수(전후 델타) |
| movement_outbox_overflow_total · send_failed_total | Δ 0 · Δ 0 | Δ 0 · Δ 0 | Δ 0 · Δ 0 | 큐 상한·넘기기 실패로 닫은 세션 수(전후 델타) |
| movement_recheck_suspended_total | Δ 0 | Δ 0 | Δ 0 | 강퇴 재검사로 멈춘 outbox 수(전후 델타) |
| jvm_gc_pause_seconds | _max 최대 13.0 ms · Δcount 1 · Δsum 13.0 ms | _max 최대 13.0 ms · Δcount 5 · Δsum 39.0 ms | _max 최대 13.0 ms · Δcount 21 · Δsum 70.0 ms | 전 GC 계열 합산. _max 는 뒤 스크레이프 기준 최근 창 |

표는 [측정 스크립트](scripts/measure-movement.mjs)의 `--render`(run3.json) 출력을 그대로 붙였다 — 위 각 셀의 수치는 손으로 옮기지 않았다.

측정 불가:
- 틱 p50·p99 — `measure-movement.mjs` 가 `movement_tick_seconds_bucket` 전후 델타에서 그 분위를 처음 넘는 bucket 의 상한으로 구한다(`pathfind` 도 같다). 값은 7-2 절 표에 채운다.
- 틱 지연·catch-up·Snapshot 건너뜀·토큰 버킷 드롭 — `movement_tick_delayed_total`·`movement_tick_skipped_total`·`movement_snapshot_skipped_total`·`movement_intent_rate_limited_total` 카운터의 전후 델타로 읽는다. 값은 7-2 절 표에 채운다.

**실기기 잔여(티켓 2250)** — 실기기 측정(오너)으로 채운다.

| 항목 | 값 | 측정 방법 | 기준 |
| --- | --- | --- | --- |
| 이동 배터리 % (약 21분) | 68% → 53% = 15%p / 약 21분 ≈ 0.7%p/분 (화면 상시 켜짐·자동 걷기 포함 — 이동 동기화만의 비용 아님) — §7-3 | 이동 동기화 플래그를 켠 빌드로 홈 섬에서 탭 이동, 전후 배터리 % | 실기기 §7-3 (로컬·Wi-Fi) |
| 보정 점프 최대 px | 화면 260 px (이미지 324 px × 배율 0.80) — §7-3 | 서버 위치로 맞출 때(정지 보정·경로 갈아타기·도착) 캐릭터가 한 번에 옮겨지는 최대 화면 거리 | 실기기 §7-3 |
| 실기기 RTT (로컬·Wi-Fi) | p50 64 · p99 202 · 최대 277 ms (452건) — §7-3. **dev 서버·LTE 는 미측정** | 실기기에서 로컬 nginx 로 intent → 내 PathAccepted 왕복(dev 서버·LTE 는 미측정) | 실기기 §7-3 (dev·LTE 남음) |
| MV-D05 체감 | 꽤 자연스러움 — 가로·세로·대각 이동 체감(오너) — §7-3 | 서버 확정 경로를 따라 걷는 가로·세로·대각 이동의 체감(정책 MV-D05) | 실기기 §7-3 |
| 실기기 Snapshot 간격 p99 | 로컬·Wi-Fi p50 51 · p99 126 ms · ≥100ms 5.2% (18,000+건, 봇 5명 공존) — §7-3 | Snapshot 수신 간격 p50·p99·100 ms 이상 비율 — 「실기기 RTT」 와 같은 세션(아키텍처 §7 재검토 조건 ①-a) | 실기기 §7-3 (dev·LTE 남음) |
| T10 재접속 횟수·복구 시간 | 단일 세션·망 전환 없이 재접속 0회·첫 FullState 38 ms. **배경 종료·Wi-Fi 전환·다른 기기(T10) 시나리오는 미수행** — §7-3 | 배경 종료·Wi-Fi 전환·동일 계정 다른 기기(T10)에서 재접속 횟수와 FullState 수렴 시간(아키텍처 §7 재검토 조건 ③) | 실기기 §7-3 (T10 남음) |

⁽¹⁾ PathAccepted 는 방 전원에게 나가는 메시지라(`RoomRuntime` `Target.ALL`) movement 토픽 구독으로 받는다. 서버가 다음 틱에 처리해 틱 대기(0~50 ms)가 들어 있고, 같은 맥이라 망 지연은 거의 없다. 측정 클라이언트가 같은 맥의 Node 단일 이벤트 루프라 N=15 에선 클라이언트 쪽 지터가 p99 에 섞인다 — 서버 처리 시간만으로 읽지 않는다. 표본이 30·150·450 개라 p99 는 경향으로만 읽는다(N=1 의 p99 는 곧 최대).

⁽²⁾ `_max` 는 뒤 스크레이프 직전 약 2분 창(Micrometer 기본 expiry 2분·버퍼 3)의 최댓값이라 60초 부하 구간을 덮는다. 앞 N 의 마지막 기록(부하 끝)은 뒤 N 의 after 스크레이프 시점에 gap 60초 + 준비 시간 + 부하 60초 ≈ 120초 + 준비 시간만큼 지나 있다(이번 실행은 N 시작 간격 약 125초) — 2분 창을 간신히 넘겨 섞이지 않았고, 그 여유가 얇아 이후 기본 `--gap` 을 130초로 늘렸다. N=5 의 틱 최대 12.7 ms 는 N=5 구간 안의 이상치(JIT·GC)로 읽는다. 섞일 수 있는 것은 첫 N 의 창에 든 실행 전 활동뿐인데, 이 실행은 직전 활동(2차 실행 종료 22:03)에서 100분 넘게 지나 시작했다.

재현 명령 ①(레포 루트. 로컬 스택이 떠 있고 realtime 을 측정할 jar 로 재기동한 상태):

```sh
NODE_PATH="$PWD/app/app-dev/node_modules" caffeinate -i \
  node docs/prd/fishcat/island-movement/scripts/measure-movement.mjs \
  --users 1,5,15 --state /tmp/measure-movement-state.json --json /tmp/measure-movement.json
```

- `app/app-dev/node_modules` 가 없는 워크트리는 `npm ci` 한 체크아웃의 경로를 `NODE_PATH` 로 준다(앱과 같은 `@stomp/stompjs` 7.3.0). `--self-check` 는 네트워크 없이 계산 함수만 점검한다.
- 쓰는 공개 경로는 앱과 같다: `POST /auth/sessions/guest`(`X-Device-Id`) · `POST /auth/sessions/current/refresh`(`X-Refresh-Token`) · `POST /islands` · `POST /islands/{id}/memberships`(둘 다 `Idempotency-Key`) · `/ws/realtime` CONNECT(`Authorization: Bearer`).
- 게스트 생성은 Data `GuestLoginRateLimiter` 기본값인 IP당 10회/시간에 걸린다(첫 실행의 11번째가 429). 로컬 data-api 에 `AUTH_GUEST_RATE_LIMIT_MAX=1000000`(application-local.yml.example 의 자리표시자) 또는 완화 바인딩 env `AUTH_GUEST_RATE_LIMIT_MAX_PER_WINDOW` 를 주면 15명을 한 번에 만든다. 운영·dev 기본값(10/300)은 그대로다. 상태 파일에는 로컬 토큰이 들어가므로 레포 밖에 둔다. 만료된 AT 는 스크립트가 갱신 경로로 바꾼다.
- nginx 가 `/actuator/*` 를 404 로 막아, Prometheus 는 `docker exec phone-realtime-local wget -qO- http://localhost:9091/actuator/prometheus`(관리 포트 9091)로 읽는다. `--metrics-cmd` 로 바꿀 수 있다.
- `caffeinate -i` 는 맥 절전을 막는다. 측정 중 맥이 잠들면 서버 틱이 건너뛰어져 값이 틀어진다. 표의 「실행 유효성」이 90% 미만인 N 은 버린다.

실행 기록: 위 표는 세 번째 실행이다. 첫 실행(20:51, N=1·5)은 intent 간격 2초가 틱 50ms 의 배수라 한 세션의 intent 가 같은 틱 위상에 몰려 왕복이 한 값 근처로 굳었다(N=1 p50 52.4 ms · p99 56.3 ms). 그래서 0~1틱 지터를 넣었다. 두 번째 실행(21:52~22:03)은 측정 중 맥이 잠들어 서버 틱 기록이 정상의 일부만 남았다(N=1 Δcount 142, 같은 길이의 정상 실행은 1,288). 이 실행은 버리고 「실행 유효성」 행을 넣었다. 다음 실행부터 기본 `--gap` 130초(여유)·프레임 종류별 바이트 분리를 스크립트가 찍는다.

관찰:

- 전 세션이 첫 movement 메시지로 자기 actor 가 든 대상 전용 FullState 를 받았고, 그 전에 온 Snapshot 은 0건이다.
- N=15 에서도 왕복 p99 56.7 ms(틱 대기 포함), Snapshot 간격 p99 57.2 ms, 100ms 이상 간격 0건이다. 틱 평균 0.3 ms · 최대 6.9 ms, A* 평균 0.2 ms 이고, reliable 큐 최대 13 은 상한 256 아래다. 이 로컬 부하에서 틱과 송신 큐는 병목이 아니었다.

### 데이터 예산

| | 수신 B/s | Snapshot 본문 × 20 Hz | 차이 B/s | reliable 사건/초(세션당) |
|---|---|---|---|---|
| N=1 | 8,361 | 4,060 | 4,301 | 0.62 (PathAccepted 30 + Arrived 7 / 60초) |
| N=5 | 21,964 | 14,840 | 7,124 | 3.22 (150 + 43) |
| N=15 | 54,717 | 41,800 | 12,917 | 9.45 (450 + 117) |

세션당 수신량은 정책 §3·T18 의 30 MB/시간을 N=15 에서 약 6.6배 넘는다. 197 MB/시간은 WebSocket 수신 총량(STOMP 헤더·reliable 사건·하트비트 포함)이고, Snapshot 본문만은 2,090 B × 20 Hz ≈ 150 MB/시간이다. 차이가 N 과 함께 늘어나므로 헤더만으로는 설명되지 않는다 — 차이 = 상수 + 사건당 바이트 × 사건/초 로 두고 N=1·15 로 풀면 상수 ≈ 3.7 KB/s(≈ 13 MB/시간, Snapshot 프레임 20개/초의 STOMP 헤더 ≈ 185 B/프레임), 사건당 ≈ 0.98 KB(경로 waypoints 를 실은 PathAccepted)이고 N=5 는 이 모델과 4% 안에서 맞는다. 즉 N=15 의 차이 약 46.5 MB/시간은 대략 헤더 13 : reliable 사건 33 (MB/시간)이다 — 표의 값에서 역산한 근사이며 건당 바이트는 이 측정에서 직접 재지 않았다(다음 실행부터 스크립트가 프레임 종류별로 나눠 찍는다). **Snapshot 만 줄여서는 목표에 못 간다**: Snapshot 본문을 0 으로 놓아도 약 46.5 MB/시간이 남는다. 바이너리 Snapshot·송신 주기 저감은 Snapshot 프레임의 헤더 몫(≈ 13 MB/시간)도 같이 줄이므로 실제 하한은 이보다 낮지만, reliable 사건 몫 ≈ 33 MB/시간만으로도 목표 30 을 넘는다. 2단계 판단에서 바이너리 Snapshot 과 함께 송신 주기 저감(정지·원거리 주민)과 reliable 사건 크기(PathAccepted 의 waypoints)를 같이 봐야 한다. 이 부하는 전원이 거의 쉬지 않고 걷는 경우라 실제 사용보다 크다(정지한 방에는 Snapshot 을 보내지 않는다).

## 7-2. 2026-10-20 main 재측정

서버 main `6e4857950`(에픽 2335 머지: 이동 단일 소유자 2339 기본 ON·Redis 릴레이, 유한 outbound 실행기, heartbeat 10s, 틱 히스토그램)을 10-09·10-18 과 같은 두 하네스로 다시 쟀다. 원본·해시는 [measurements/2026-10-20/](measurements/2026-10-20/README.md). 표의 값은 스크립트 출력이며 손으로 옮기지 않았다. 앱은 띄우지 않았다(실기기 측정은 §7-3 에서 따로 했다 — §7 잔여 표의 로컬·Wi-Fi·공존 분을 채웠고 dev 서버·LTE·T10 은 남았다).

조건:

- 맥 한 대(Apple M5 Pro, 15코어·48 GB)의 Docker Desktop(8 CPU · 7.65 GiB, aarch64). 발생기(Node 24)도 같은 맥이다.
- 조사 하네스: 스택 `loadtest/infra/local/compose.yml`(프로젝트 `gromo-loadtest-survey`), realtime·data-api·business-api 를 main 소스로 재빌드(10-18 이미지는 `:20261018` 태그 보존), fixture 1만 명 DB(`users` 10,191·Flyway V130), 사용자 파일 `users_uniform.json`. 호스트: run2 시작 loadavg `{ 45.37 17.16 13.86 }`·gradle 프로세스 1개·Xcode 빌드 없음([host-conditions-run2.txt](measurements/2026-10-20/survey/host-conditions-run2.txt)).
- 한 섬: 로컬 풀 스택 `phone-*-local`, realtime 만 2270 브랜치 jar(main + `movement.intent.rate_limited` Counter)로 재기동, 이미지 `903cfb5d146c`, 시작 loadavg `{ 7.33 11.04 11.09 }`(다른 세션 부하, [one-island-conditions.txt](measurements/2026-10-20/one-island-conditions.txt)). 게스트 15명을 한 번에 발급했다(429 없음, 티켓 2271).
- run1 은 다른 세션의 gradle 워커와 구현 에이전트(gradle build·jest·pod install)가 동시에 돌아 지연이 오염됐다([host-conditions-run1.txt](measurements/2026-10-20/survey-run1/host-conditions-run1.txt): gradle 프로세스 3개). run1 은 전달 누락·수신량·Snapshot 수만 참고하고 지연은 run2 를 정본으로 본다.

### ① 조사 하네스 대조 (`survey/` run2, 10-18 대비)

| run | 조건 | 10-18 (전) 수신/기대 · 지연 p50/p95/p99 ms · 수신량 (fixture) | 10-20 run2 (후) | 누락 | Snapshot 수 |
|---|---|---|---|---|---|
| `movement-split-100c-20s` | 100c · 1Hz · 20s · 2 인스턴스 | (10-18 없음) | 19000/19000 · p50 40.6 · p95 149.6 · p99 196.7 · 74 MB | 0 | 35974 |
| `movement-split-10c-10s` | 10c · 1Hz · 10s · 2 인스턴스 | 450/900 · p50 43.7 · p95 53.2 · p99 57.8 · 2 MB (followup) | 900/900 · p50 44.7 · p95 48.3 · p99 49.2 · 3 MB | 0 | 1630 |
| `movement-split-10c-60s` | 10c · 1Hz · 60s · 2 인스턴스 | (10-18 없음) | 5900/5900 · p50 20.0 · p95 55.0 · p99 58.4 · 23 MB | 0 | 11670 |
| `movement-spread-300c` | 300c · 1Hz · 60s · spread | 176950/176950 · p50 55.1 · p95 63.5 · p99 69.0 · 706 MB (followup) | 176940/176940 · p50 50.5 · p95 64.1 · p99 68.6 · 708 MB | 0 | 350230 |
| `ws-movement-100c-10hz` | 100c · 10Hz · 20s | 198840/198840 · p50 53.5 · p95 69.0 · p99 72.6 · 215 MB (1k) | 199000/199000 · p50 52.7 · p95 73.4 · p99 92.0 · 213 MB | 0 | 40440 |
| `ws-movement-100c-1hz-confirm` | 100c · 1Hz · 60s | 59000/59000 · p50 32.3 · p95 68.5 · p99 73.1 · 236 MB (1k) | 59000/59000 · p50 58.5 · p95 76.6 · p99 87.7 · 236 MB | 0 | 116500 |
| `ws-movement-100c-1hz` | 100c · 1Hz · 20s | 19000/19000 · p50 60.8 · p95 73.3 · p99 77.1 · 74 MB (1k) | 19000/19000 · p50 30.0 · p95 43.7 · p99 51.2 · 74 MB | 0 | 36300 |
| `ws-movement-100c-5hz` | 100c · 5Hz · 20s | 99000/99000 · p50 50.0 · p95 69.4 · p99 80.1 · 148 MB (1k) | 99000/99000 · p50 46.0 · p95 71.2 · p99 76.1 · 143 MB | 0 | 39734 |
| `ws-movement-10c-1hz` | 10c · 1Hz · 20s | 1900/1900 · p50 23.3 · p95 75.1 · p99 114.0 · 7 MB (10k) | 1900/1900 · p50 32.2 · p95 47.8 · p99 72.8 · 7 MB | 0 | 3630 |
| `ws-movement-10c-20hz-policy-limit` | 10c · 20Hz · 10s | 11800/19750 · p50 41.6 · p95 53.6 · p99 58.3 · 12 MB (10k) | 11900/19700 · p50 38.7 · p95 53.8 · p99 60.4 · 12 MB | 7800 | 2580 |
| `ws-movement-300c-1hz` | 300c · 1Hz · 20s | 57000/57000 · p50 79.6 · p95 194.2 · p99 232.0 · 211 MB (1k) | 57000/57000 · p50 114.7 · p95 979.8 · p99 1232.1 · 196 MB | 0 | 91966 |
| `ws-movement-50c-1hz` | 50c · 1Hz · 20s | 9500/9500 · p50 53.6 · p95 148.6 · p99 157.2 · 36 MB (10k) | 9500/9500 · p50 54.7 · p95 69.7 · p99 89.5 · 37 MB | 0 | 18240 |

300c 정렬 발신 20 s 재확인(`survey/repeat-300c/`, 같은 조건 3회 + 100c 60 s 1회):

| run | 조건 | 10-18 (전) 수신/기대 · 지연 p50/p95/p99 ms · 수신량 (fixture) | 10-20 repeat (후) | 누락 | Snapshot 수 |
|---|---|---|---|---|---|
| `ws-movement-100c-1hz-confirm-r2` | 100c · 1Hz · 60s | (10-18 없음) | 57721/59000 · p50 52.8 · p95 1301.3 · p99 2900.4 · 210 MB | 1279 | 103529 |
| `ws-movement-300c-1hz-r1` | 300c · 1Hz · 20s | (10-18 없음) | 57000/57000 · p50 76.4 · p95 124.3 · p99 147.7 · 217 MB | 0 | 107205 |
| `ws-movement-300c-1hz-r2` | 300c · 1Hz · 20s | (10-18 없음) | 57000/57000 · p50 100.7 · p95 199.1 · p99 252.7 · 210 MB | 0 | 100172 |
| `ws-movement-300c-1hz-r3` | 300c · 1Hz · 20s | (10-18 없음) | 57000/57000 · p50 110.9 · p95 417.7 · p99 469.2 · 199 MB | 0 | 93127 |

- **두 인스턴스 분산 전달 누락 0**: 10c 10 s 는 10-18 의 450/900 에서 900/900 이 됐고(p95 53.2 → 48.3 ms), 10c 60 s 5,900/5,900 · 100c 20 s 19,000/19,000 이다.
- **단일 입구 조합은 누락 0, 지연은 조합에 따라 갈린다**: 개선은 100c@1Hz p95 73.3 → 43.7 · 50c p95 148.6 → 69.7 · 10c p95 75.1 → 47.8, 악화는 100c 60 s confirm p50 32.3 → 58.5 · p99 73.1 → 87.7, 100c@10Hz p99 72.6 → 92.0 · 100c@5Hz p95 69.4 → 71.2 이다(300c 분산 발신 60 s p95 63.5 → 64.1 은 같은 급). 일관된 회귀·개선은 없고 맥 한 대의 노이즈 범위로 읽는다. confirm 의 p50 상승은 재확인하지 못했다(`survey/repeat-300c/ws-movement-100c-1hz-confirm-r2.json` 은 Xcode 빌드와 겹쳐 폐기). 수신량은(정책 한계 행 제외, 누락 0) 10-18 의 ±8% 이내다(가장 큰 차이는 300c·20s 211→196 MB, −7.1%).
- **300c 정렬 발신 20 s 는 값이 크게 흔든다**: run2 p95 979.8 ms 는 재현되지 않고 3회 재확인이 p95 124.3 / 199.1 / 417.7 ms(p50 76.4 / 100.7 / 110.9, 누락 0)다. 같은 구간 realtime-1 의 `movement_relay_lag` 19,311건 중 99% 가 13 ms 이하(최대 0.09 s)이고 릴레이 줄 깊이 0 이라 릴레이는 원인에서 배제한다. 나머지(발생기 Node 단일 루프·호스트 상태 등)는 확인하지 못했다. 회귀 판정 없이 「변동 큰 조합」으로 기록하고, 전용 호스트 재측정(2347)에 300c 정렬 3회 반복을 넣는다.
- 같은 묶음의 `ws-movement-100c-1hz-confirm-r2`(57,721/59,000 · p95 1.3 s)는 06:38 에 다시 띄운 Xcode 빌드와 겹쳐 오염됐다 — 버리고 파일만 남긴다. 10c@20Hz 정책 상한 run 은 설계대로 일부만 받는다(11,900/19,700).

### ② 한 섬 N=1·5·15 (`one-island.md`, 3회 중앙값)

10-09 표(§7)와 행이 다른 점: 「Snapshot IDLE 비율·PathAccepted 크기」·「틱 p50·p99」·「pathfind p50·p99」 행과 틱 지연·건너뜀·속도제한 드롭 카운터 행이 새로 있고, 세션당 수신량 셀에 프레임 종류별 분해가 붙는다. 값은 N 마다 3회 실행의 중앙값이다. 틱·pathfind p50/p99 는 histogram bucket 의 상한(≤)이라 실제 값보다 크거나 같다.

| 항목 | N=1 (3회 중앙값) | N=5 (3회 중앙값) | N=15 (3회 중앙값) | 측정 방법 |
| --- | --- | --- | --- | --- |
| 실행 유효성(서버 틱 진행) | 99.9% (Δtick 1287 / 벽시계 64.4초) — 정상 | 99.8% (Δtick 1289 / 벽시계 64.6초) — 정상 | 99.8% (Δtick 1288 / 벽시계 64.5초) — 정상 | movement_tick_seconds Δcount ÷ (전후 스크레이프 사이 벽시계 ÷ 50ms) |
| 접속·첫 FullState | 준비 1/1 · 첫 movement 메시지 FullState 1/1 · 자기 actor 포함 1/1 · FullState 전 Snapshot 0건 · 구독→FullState p50 55.9 ms, 최대 55.9 ms | 준비 5/5 · 첫 movement 메시지 FullState 5/5 · 자기 actor 포함 5/5 · FullState 전 Snapshot 0건 · 구독→FullState p50 80.6 ms, 최대 81.8 ms | 준비 15/15 · 첫 movement 메시지 FullState 15/15 · 자기 actor 포함 15/15 · FullState 전 Snapshot 0건 · 구독→FullState p50 101.3 ms, 최대 109.2 ms | CONNECT(Bearer) 뒤 movement → movement/snapshot → /user/queue/errors 순 SUBSCRIBE, 첫 FullState 수신 − movement SUBSCRIBE 송신 |
| intent → 내 PathAccepted 왕복 | p50 30.5 ms · p99 55.5 ms · 최대 55.5 ms (응답 30/보냄 30) | p50 31.3 ms · p99 60.4 ms · 최대 61.3 ms (응답 150/보냄 150) | p50 29.9 ms · p99 60.5 ms · 최대 367.1 ms (응답 450/보냄 450) | 사용자마다 2000ms 간격(+0~1틱 무작위 지터) 무작위 통행 셀(스폰 연결 영역) intent, 송신 직전 → 같은 commandSeq·내 userId PathAccepted 수신. 서버가 다음 틱(≤50ms)에 처리하므로 틱 대기 포함. 최근접 순위 백분위 |
| MoveRejected | 0건 | 0건 | 0건 | 요청자 세션에만 오는 MoveRejected 를 reason 별로 |
| 무응답 intent | 0건 (미연결로 못 보냄 0건) | 0건 (미연결로 못 보냄 0건) | 0건 (미연결로 못 보냄 0건) | 부하 끝 + 3초 안에 PathAccepted·MoveRejected 가 없던 intent |
| Snapshot 수신 간격 | p50 50.0 ms · p99 56.9 ms · 최대 86.6 ms · 100ms 이상 0.00% (표본 1099) | p50 50.0 ms · p99 55.3 ms · 최대 80.5 ms · 100ms 이상 0.00% (표본 5995) | p50 50.0 ms · p99 57.7 ms · 최대 253.9 ms · 100ms 이상 0.08% (표본 17940) | 20Hz 기대 50ms. 직전 Snapshot 에 MOVING entity 가 있을 때 다음 Snapshot 까지의 간격(정지 뒤 공백 제외), 전 세션 합산 |
| 세션당 수신량 | 평균 8270 B/s (≈ 29.8 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 202 B · Snapshot 프레임 7707 B/s · movement 프레임 562 B/s · 기타 0 B/s<br>movement 종류별 PathAccepted 523.7 B/s · Arrived 38.7 B/s · Snapshot 헤더 몫 3955 B/s | 평균 21935 B/s (≈ 79.0 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 741 B · Snapshot 프레임 19097 B/s · movement 프레임 2837 B/s · 기타 0 B/s<br>movement 종류별 PathAccepted 2626.8 B/s · Arrived 210.7 B/s · Snapshot 헤더 몫 4280 B/s | 평균 54572 B/s (≈ 196.5 MB/시간) · 세션 간 편차 0 · Snapshot 본문 평균 2089 B · Snapshot 프레임 45959 B/s · movement 프레임 8625 B/s · 기타 0 B/s<br>movement 종류별 PathAccepted 8032.0 B/s · Arrived 593.6 B/s · Snapshot 헤더 몫 4289 B/s | 부하 60초 동안 WebSocket message 바이트(STOMP 헤더·하트비트 포함) ÷ 60. 전 세션이 같은 브로드캐스트를 받아 세션 간 편차는 거의 없다 |
| Snapshot IDLE 비율·PathAccepted 크기 | IDLE entity 1.3% · waypoints 평균 30.7 · 최대 67 (표본 30) · PathAccepted 본문 평균 843 B | IDLE entity 10.8% · waypoints 평균 30.8 · 최대 79 (표본 150) · PathAccepted 본문 평균 845 B | IDLE entity 10.7% · waypoints 평균 31.8 · 최대 80 (표본 450) · PathAccepted 본문 평균 866 B | 부하 구간 Snapshot entity 중 state=IDLE 몫(전체 entity 수 대비), 내 PathAccepted 의 waypoints.length·본문 바이트(브로드캐스트 중복 제외) |
| 끊김·ERROR | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | close 0건 · STOMP ERROR 0건 · 오류 큐 0건 | 의도적 해제 전 WebSocket close code·reason, STOMP ERROR message, /user/queue/errors code |
| movement_tick_seconds | Δcount 1287 · 평균 0.1 ms · 최대 10.0 ms | Δcount 1289 · 평균 0.1 ms · 최대 57.5 ms | Δcount 1288 · 평균 0.3 ms · 최대 69.4 ms | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창) |
| 틱 p50·p99 | p50 ≤1.0 ms · p99 ≤1.0 ms | p50 ≤1.0 ms · p99 ≤1.0 ms | p50 ≤1.0 ms · p99 ≤1.4 ms | _bucket 전후 델타(누적)에서 그 분위를 처음 넘는 bucket 의 le(상한 보수값 — 표의 ≤, 보간 없음). le=+Inf 에 걸리면 _max(max 표기) |
| movement_pathfind_seconds | Δcount 30 · 평균 0.2 ms · 최대 1.4 ms | Δcount 150 · 평균 0.2 ms · 최대 1.8 ms | Δcount 450 · 평균 0.2 ms · 최대 46.4 ms | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창) |
| pathfind p50·p99 | p50 ≤1.0 ms · p99 ≤1.4 ms | p50 ≤1.0 ms · p99 ≤1.4 ms | p50 ≤1.0 ms · p99 ≤1.4 ms | _bucket 전후 델타(누적)에서 그 분위를 처음 넘는 bucket 의 le(상한 보수값 — 표의 ≤, 보간 없음). le=+Inf 에 걸리면 _max(max 표기) |
| movement_outbox_reliable_depth | 표본 39 · 평균 1.00 · 최대 1 | 표본 972 · 평균 1.00 · 최대 2 | 표본 8580 · 평균 1.03 · 최대 9 | /actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창). reliable 사건을 넣은 직후 세션 큐 깊이 |
| movement_outbox_snapshot_superseded_total | Δ 0 | Δ 0 | Δ 30 | 보내기 전에 더 새 Snapshot 으로 덮어쓴 횟수(전후 델타) |
| movement_outbox_overflow_total · send_failed_total | Δ 0 · Δ 0 | Δ 0 · Δ 0 | Δ 0 · Δ 0 | 큐 상한·넘기기 실패로 닫은 세션 수(전후 델타) |
| movement_recheck_suspended_total | Δ 0 | Δ 0 | Δ 0 | 강퇴 재검사로 멈춘 outbox 수(전후 델타) |
| 틱 지연·틱 건너뜀·Snapshot 건너뜀·intent 속도제한 드롭 | tick.delayed Δ 0 · tick.skipped Δ 0 · snapshot.skipped Δ 0 · intent.rate_limited Δ 0 | tick.delayed Δ 0 · tick.skipped Δ 0 · snapshot.skipped Δ 0 · intent.rate_limited Δ 0 | tick.delayed Δ 1 · tick.skipped Δ 0 · snapshot.skipped Δ 2 · intent.rate_limited Δ 0 | movement_tick_delayed_total · movement_tick_skipped_total · movement_snapshot_skipped_total · movement_intent_rate_limited_total 전후 델타 |
| jvm_gc_pause_seconds | _max 최대 10.0 ms · Δcount 2 · Δsum 17.0 ms | _max 최대 16.0 ms · Δcount 7 · Δsum 60.0 ms | _max 최대 12.0 ms · Δcount 24 · Δsum 64.0 ms | 전 GC 계열 합산. _max 는 뒤 스크레이프 기준 최근 창 |

### 데이터 예산 분해 — 역산 vs 실측

세션당 B/s(3회 중앙값)를 `B/s × 3600 / 1e6` 으로 MB/시간 환산했다. Snapshot 본문 = Snapshot 프레임 − 헤더 몫. 10-09 는 프레임 종류별 바이트를 직접 재지 못해 N=15 값에서 역산했다(위 §7 데이터 예산).

| N | 총 B/s (MB/h) | Snapshot 본문 B/s (MB/h) | Snapshot 헤더 몫 B/s (MB/h) | PathAccepted B/s (MB/h) | Arrived B/s (MB/h) | movement 프레임 B/s (MB/h) | 기타 B/s | FullState |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N=1 | 8,270 (29.8) | 3,752 (13.5) | 3,955 (14.2) | 523.7 (1.9) | 38.7 (0.1) | 562 (2.0) | 0 | 창 안 0 |
| N=5 | 21,935 (79.0) | 14,817 (53.3) | 4,280 (15.4) | 2,626.8 (9.5) | 210.7 (0.8) | 2,837 (10.2) | 0 | 창 안 0 |
| N=15 | 54,572 (196.5) | 41,670 (150.0) | 4,289 (15.4) | 8,032.0 (28.9) | 593.6 (2.1) | 8,625 (31.0) | 0 | 창 안 0 |
| 10-09 역산 N=15 | 54,717 (197.0) | ≈ 150 | ≈ 13 | ≈ 33 (PathAccepted + Arrived) | (합산) | (합산) | — | — |

- movement 프레임 = PathAccepted + Arrived(N=1 523.7 + 38.7 ≈ 562). 기타는 STOMP 하트비트로 0.08 B/s 라 0 으로 반올림됐다(`one-island.json` `bytesPerSecByKind.other`). Snapshot 프레임 = 본문 + 헤더 몫(N=15 41,670 + 4,289 ≈ 45,959).
- 성분 합(≈ 54,585 B/s)이 총량 중앙값(54,572)과 조금 다른 것은 열마다 따로 구한 3회 중앙값이기 때문이다.
- Snapshot 헤더 몫은 N=1·5·15 에서 3,955 → 4,289 B/s 로 거의 일정하다. 엔티티 수가 아니라 프레임 수(≈ 20/s)에 비례하는 고정비라는 뜻이다.
- FullState 바이트는 부하 구간에 0 이다(접속 때 한 번뿐, 60초 구간 밖).
- 10-09 역산(150 / 13 / 33)은 대체로 맞았다. 실측은 헤더 몫이 조금 크고(13 → 15.4) reliable 사건은 조금 작다(33 → PathAccepted 28.9 + Arrived 2.1 = 31.0). 총량은 54,717 → 54,572 B/s 로 같은 급이다.

단위 행(표의 값에서 계산한 단위당 크기 — 출처 열: 측정 = `one-island.md` 셀 그대로, 유도 = 측정값의 나눗셈·차분, 미측정 = 이 측정으로는 못 구함):

| 항목 | N=1 | N=5 | N=15 | 출처 · 산식 |
| --- | --- | --- | --- | --- |
| Snapshot 본문 평균 (B/프레임) | 202 | 741 | 2,089 | 측정 |
| Snapshot 프레임/s (세션당) | 18.57 | 20.00 | 19.95 | 유도 — 본문 B/s ÷ 본문 평균 (3,752/202 · 14,817/741 · 41,670/2,089). N=1 은 정지 구간이 있어 20 에 못 미친다 |
| STOMP 헤더 (B/프레임) | 213 | 214 | 215 | 유도 — 헤더 몫 ÷ 프레임/s (3,955/18.57 …). 10-09 역산 185 보다 크다 |
| JSON entity (B) | — | 134.8 | 134.8 | 유도 — (741 − 202)/4 = (2,089 − 202)/14 = 134.8 (N=5 의 entity 5명 − N=1 의 1명 = 4, N=15 − N=1 = 14) |
| Snapshot 고정 오버헤드 (B/프레임) | 67 | 67 | 67 | 유도 — 202 − 134.8 ≈ 67 (`type`·`serverTick` 등 봉투, entity 0명 기준 외삽) |
| PathAccepted 건/s (세션당) | 0.5 | 2.5 | 7.5 | 유도 — N × 0.5 (전원 2초마다 intent). `one-island.json` counts(60초 PathAccepted 30건 = 0.5/s)와 N=1 에서 일치 |
| PathAccepted 프레임 (B/건, STOMP 헤더 포함) | 1,047 | 1,051 | 1,071 | 유도 — PathAccepted B/s ÷ 건/s (523.7/0.5 · 2,626.8/2.5 · 8,032.0/7.5) |
| PathAccepted 본문 평균 (B) | 843 | 845 | 866 | 측정 |
| PathAccepted waypoints 평균 (최대) | 30.7 (67) | 30.8 (79) | 31.8 (80) | 측정 |
| Arrived (B/s) | 38.7 | 210.7 | 593.6 | 측정 (건당 크기는 미측정) |
| IDLE entity 비율 | 1.3% | 10.8% | 10.7% | 측정 |
| waypoint 당 B | — | — | — | 미측정. `Point` JSON `{"x":12.34,"y":56.78}` ≈ 24 B 로 추정하면 31.8 × 24 ≈ 763 B, 본문 866 − 763 ≈ 103 B 가 waypoints 밖 필드다(추정) |

PathAccepted 프레임(1,071 B) − 본문(866 B) = 205 B 는 STOMP 헤더(Snapshot 의 215 B 와 같은 급)로 보이지만, 헤더 길이를 PathAccepted·Arrived 에서 직접 재지는 않았다.

미측정: Arrived 건당 B · waypoint 당 B · PathAccepted·Arrived 의 STOMP 헤더 B · 5 Hz 모드(서버에 5 Hz 모드 코드가 없다 — `RoomRuntime` 은 MOVING 이 있으면 20 Hz 로 전원 entity 를 보낸다) · 실기기 수신량. 5 Hz 값은 [아키텍처 §7 축소안 비교](architecture.md#7-java--kafka--realtime-선택-검토)에 추정으로만 있다.

관찰:

- N 과 무관하게 왕복 p50 ≈ 30 ms · p99 55~60 ms(N=15 최대 367.1 ms 1회, 표본 450), Snapshot 간격 p99 55~58 ms · 100 ms 이상 0.00~0.08%. 틱 p50·p99 ≤ 1 ms(N=15 p99 는 bucket 상한 1.4 ms), pathfind p99 1.4 ms. 호스트 loadavg 7~11 로 지연은 10-09(서버 `7af884d`)와 같은 급이다.
- 틱·송신 큐는 여전히 병목이 아니다: 끊김·STOMP ERROR·오류 큐 0, outbox 오버플로·송신 실패 0, N=15 에서 `tick.delayed` 1 · `snapshot.skipped` 2 · `intent.rate_limited` 0 · `snapshot_superseded` 30.
- 세션당 수신량 N=15 는 196.5 MB/시간으로 목표 30 의 약 6.5배다. Snapshot 본문 150.0 은 그대로 가장 큰 몫이고, Snapshot 만 줄여서는 목표에 못 간다(헤더는 프레임 수에 묶인 고정비) — 본문을 0 으로 놓아도 헤더 15.4 + reliable 사건 31.0 = 약 46.4 MB/시간이 남는다.
- IDLE entity 는 N≥5 에서 ≈ 11%(N=1 은 1.3%)다. PathAccepted 의 waypoints 는 평균 31(최대 80), 본문 ≈ 845~866 B 다. 정지 주민 생략과 waypoints 축소가 2단계 1차 후보인 근거가 실측으로 확인됐다.
- 한계: 한 방(섬 1개), 전원이 쉬지 않고 걷는 부하, 발생기와 서버가 같은 맥이다. 실기기·손실 망은 §7 잔여 표 그대로 미측정이다.

원본 위치와 재현 명령:

- 원본: [measurements/2026-10-20/](measurements/2026-10-20/README.md) — `survey/`(run2 정본)·`survey-run1/`(오염, 참고)·`survey/repeat-300c/`·`one-island.{json,md,stdout.md,stderr.log}`·`one-island-conditions.txt`·`before-20261018/`(10-18 사본)·파일 해시.
- ① 조사 하네스(레포 루트, 스택 `loadtest/infra/local/compose.yml`): `node loadtest/survey/realtime.mjs --mode movement --connections <N> --frequency <Hz> --seconds <S> --url ws://localhost:18088/ws/realtime --out <json>`. 300c 발신 분산(`movement-spread-300c`)은 `--spread-sends true` 를 더하고, 두 인스턴스 분산은 `--url ws://localhost:18083/ws/realtime,ws://localhost:18085/ws/realtime` 로 바꾼다(연결을 두 주소에 번갈아 배정). 하네스는 gitignored `loadtest/` 에 있다.
- ② 한 섬: 위 재현 명령 ① 의 `--users 1,5,15` 에 `--repeat 3 --json <경로>` 를 더하고, data-api 에 `AUTH_GUEST_RATE_LIMIT_MAX=1000000`(게스트 15명 한 번에 발급, 티켓 2271)을 준다. 표는 `--render` 출력이다.

## 7-3. 2026-10-20 실기기 측정 (티켓 2250, 봇 5명 공존)

실기기에서 1단계 이동 동기화를 처음 쟀다. 개발 전용 앱 계기(`movementStats` + 자동 걷기, 브랜치 `afeat/GROMO-2250-movement-device-stats` `325e7214c`)가 앱 안에서 RTT·Snapshot 간격·보정 점프·재접속·FullState 를 세어 1초마다 Metro 로그(`[GROMO-2250]`)로 찍는다. 정의는 §7 서버 측 스크립트와 같다. 방법·수치 사본은 [measurements/2026-10-20/device-run/](measurements/2026-10-20/device-run/README.md).

조건:

- 기기 iPhone 16 Pro Max(iOS 27.0.1)·Wi-Fi. 서버는 **dev 가 아니라** 로컬 풀 스택 `phone-*-local`, realtime 2270 jar.
- 공존: 측정 스크립트(`measure-movement.mjs --island <폰 홈 섬> --users 5 --duration 720`)로 봇 5명을 폰과 같은 섬에 멤버로 넣어 폰이 그들 이동을 수신했다(방 6명). 앱은 자기 소속(홈) 섬에서만 이동 채널을 연다 — 방문 섬에선 열리지 않아, 공존은 봇을 폰 섬에 넣는 방식이다.
- 리셋 토글을 안 눌러 **약 21분 누적**이고 봇이 함께 있던 시간은 그중 약 12분이다(배터리·표본은 이 누적 기준). 같은 세션의 WS 연결 직후 혼자 구간(약 1분, 표본 ≈240)에서 Snapshot p99 106 ms·≥100ms 1.8% 였고 봇 공존에서 126 ms·5.2% 로 올랐다. 다만 Snapshot 간격은 「직전에 MOVING entity 가 있을 때」만 세므로 공존에선 집계 구간 자체가 늘고, 서버 측 같은 정의 값은 p99 59.7 ms·≥100ms 0.14% 라 폰 수치 상승분에는 Wi-Fi·기기 JS 스레드 지연 몫이 크다. **공존 시 p99 상승이 관찰되었으나 단일 세션·표본 구성 차이·기기/망 지연이 섞여 인과는 단정하지 않는다.**

| 항목 | 값 |
| --- | --- |
| RTT (intent→내 PathAccepted) | p50 64 · p99 202 · 최대 277 ms (452건) |
| Snapshot 수신 간격 | p50 51 · p99 126 ms · ≥100ms 5.2% (18,000+건) |
| 보정 점프 최대 | 화면 260 px (이미지 324 px × 배율 0.80) |
| 재접속 / FullState 첫 수렴 | 0회 / 38 ms |
| 배터리 | 68% → 53% (15%p, 약 21분) |
| 이동 체감 (MV-D05) | 꽤 자연스러움 (오너) |

서버 측 교차(같은 섬 봇 5명 — 방 6명, 폰 포함. `measure-movement.mjs --users 5` 결과): 세션당 수신 90.9 MB/시간, Snapshot 간격 p50 50·p99 59.7 ms, 왕복 p50 30·p99 64 ms(1,800건 = 봇 5 × 2초 간격 720초), 실행 유효성 100%.

남은 것(공개 dev 서버 빌드 + 수동 조작 필요): dev 서버 RTT·LTE 망, T10 재접속 시나리오(배경 종료·Wi-Fi 전환·동일 계정 다른 기기). 이번은 로컬 Wi-Fi·단일 세션이라 재접속이 0이었다.

접속 함정(측정 중 해소): 홈 섬에 들어가도 RTT·Snapshot·WebSocket 이 0이었다. 원인은 로컬 realtime 이 옛 IP 허용 목록을 들고 있어 폰 WebSocket 핸드셰이크(`GET /ws/realtime`)를 403 으로 막은 것이다(403 은 nginx 가 아니라 realtime 이 낸다). 환경변수 위치·재기동 명령·확인 방법은 [device-run README 의 접속 함정](measurements/2026-10-20/device-run/README.md#접속-함정-측정-중-해소).

빌드 메모: Xcode 빌드 멈춤은 이날 재현되지 않았고, 첫 빌드만 ReactCodegen 입력 파일 경합(rc 65)이라 `pod install` 재실행으로 코드젠을 다시 깔아 풀었다. 앱 계기 커밋 `325e7214c`(`afeat/GROMO-2250-movement-device-stats`)는 이 PR 에 없다 — 앱 PR 은 별도(미개설).

## 부록 A. 10/9 타일 전환 체크리스트 (2026-10-08 작성)

에픽 티켓 2227 의 선행 PR(2228 #1081 · 2229 #1082 · 2230 #1084 · 2231 #1085 · 2233 #1086, 서버 2232 #1083)이 모인 브랜치 `afeat/GROMO-2234-tile-island-checklist` 에서 `app/app-dev` 기준으로 돌린 기록이다. 단일 기기 가정이며, 이 환경에서 돌릴 수 있는 것(jest · 생성 스크립트 check · 로컬 정적 서버 + curl · typecheck)만 실행했다. 실기기 측정과 조작이 필요한 항목은 측정값을 적지 않고 「미실행 — 실기기 필요」로 둔다.

실행 기록은 다음과 같다. 기준 커밋은 `2e2b1e610`(브랜치 `afeat/GROMO-2234-tile-island-checklist`, 2233 2라운드 반영 merge 이후)이고 실행 시각은 2026-10-08 11:33~11:34 KST 이다. 스택 PR 이 더 merge 되면 아래 기록은 낡으므로 「머지 뒤 재실행」 표식 항목부터 다시 돌린다.

| 명령 | 결과 |
| --- | --- |
| `npm test` | 126 스위트 / 1,594 테스트 통과, 실패 0 (jest 가 「worker 가 정상 종료하지 않아 강제 종료」 경고를 냈으나 통과 판정에는 영향 없음) |
| `npm run gen:nav-fixture:check` | 통과 (종료 코드 0, 생성 결과가 커밋본과 바이트 동일) |
| `npm run gen:tile-atlas:check` | 통과 (종료 코드 0, 재조립 차이 0, 저장 PNG 슬롯 384개 내부·extrusion 링 일치, 2x→1x MAE 0.3129/255 참고값) |
| `npm run typecheck` | 통과 (종료 코드 0, `tsc --noEmit` 오류 0) |
| `npm run serve:map-assets -- --port 4302` + `curl -I` | `/static/maps/home/manifest.json` 200 `Cache-Control: public, max-age=60` + `ETag`, `/static/maps/home/v1/tileset@2x.png` 200 `Cache-Control: public, max-age=31536000, immutable` (5,871,262 B). 확인 뒤 서버를 종료했고, 종료 뒤 같은 URL 은 연결 실패 |

### 표 1. 체크리스트

실기기 확인 기준 그림 — 타일 섬은 기존 마을 원화를 2배로 올려 자른 것이라 원화와 구분이 안 되므로, 개발 빌드의 `이동 보기` 버튼으로 타일 경계(와 막힌 셀·마지막 걷기)를 켜 확인한다(2026-10-08):

![타일 섬 낮 — 타일 경계](diagrams/08-tile-island-day.png)

![타일 섬 밤](diagrams/08-tile-island-night.png)

| 번호 | 축 | 항목 | 근거 | 확인 방법 | 결과 | 사유·측정값 |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | 좌표 | 탭 → world 불변 (줌 0.35·1·2.6 × 화면 390×844·430×932) | T01, 티켓 2231 | `npm test` 의 `nav-path.test.ts` tapToWorld | 통과 | 같은 이미지 px 가 줌·화면 조합 6종에서 같은 world |
| C-02 | 좌표 | world ↔ wire 왕복 오차 ≤ 0.005 (범위 안 값). `worldToWire` 는 범위 밖·비유한값이면 clamp 없이 `null` | T01, 티켓 2228 | `worldCoords.test.ts` 왕복·`worldToWire` null 케이스 | 통과 | 축당 0.005 이하 단언. 경계 0·100 은 통과, 범위 밖·NaN·±Infinity 는 `null` |
| C-03 | 좌표 | 셀 index 경계: `worldToCell` 만 내부 clamp (`min(99, floor)`, 음수·비유한값은 0, 호출자가 `isInsideWorld` 로 먼저 거름). `screenToImage` 는 비유한 입력(scale 0 포함)이면 `null` | T01, 티켓 2228 | `worldCoords.test.ts` | 통과 | 회관 앵커 (1095,321) → (71.29,31.35) → 셀 (71,31) → wire (7129,3135). `worldToCell(NaN, Infinity)` = (0,0) |
| C-04 | 좌표 | nav.json 100×100 이 생성기와 바이트 동일 | T02, 티켓 2228 | `npm run gen:nav-fixture:check` | 통과 | 통행 3,613 · 길 565 · 차단 6,387 (PR 본문 기록값, `nav.test.ts` 통과) [머지 뒤 재실행] |
| C-05 | 렌더 | 플래그 off 화면 불변 (스크린샷 비교) | 티켓 2230 | 플래그 off 로 기존 빌드와 같은 구도 캡처 후 비교 | 미실행 — 실기기 필요 | 자동 근거는 `WorldMap.test.tsx` 무변경 통과(지형 Image 1장 렌더)뿐이며 픽셀 비교는 하지 않았다 |
| C-06 | 렌더 | 플래그 on 에서 타일 지형 (Atlas 384장, 단일 드로우콜) | 티켓 2230 | `TileTerrainCanvas.test.tsx` (Skia mock) + 실기기 육안 | 미실행 — 실기기 필요 | jest 는 Skia mock 위에서 384개 rect·RSXform 계산만 확인한다. 실제 드로우콜 수와 화면은 보지 못했다 |
| C-07 | 렌더 | 아틀라스 재조립 차이 0 | 티켓 2229 | `npm run gen:tile-atlas:check` | 통과 | 재조립 차이 0 [머지 뒤 재실행] |
| C-08 | 렌더 | 팬 p95 ≤ 16.7 ms | T12 | 실기기 프로파일링 | 미실행 — 실기기 필요 | 표 3 에 기입 |
| C-09 | 렌더 | 줌 p95 ≤ 16.7 ms | T12 | 실기기 프로파일링 | 미실행 — 실기기 필요 | 표 3 에 기입 |
| C-10 | 렌더 | 콜드/웜 스타트 | T12 | 실기기 측정 | 미실행 — 실기기 필요 | 표 3 에 기입. 번들에 아틀라스 5,871,262 B 가 추가됨 |
| C-11 | 렌더 | 팬·줌 중 타일 이음매(seam)·에일리어싱 (bilinear, mipmap 없음, 2.7 텍셀/픽셀 축소) | 티켓 2230 리뷰 #1084 | 줌 0.35 부근과 2.6 에서 팬 | 미실행 — 실기기 필요 | 130px 피치 1px extrusion 은 재조립 검증으로만 확인 |
| C-12 | 렌더 | 소품(VillageScenery)과 지형 캔버스의 1프레임 어긋남 | 티켓 2230 리뷰 #1084 | 빠른 팬·줌 중 소품 발밑과 지형 비교 | 미실행 — 실기기 필요 | 카메라가 Skia Group transform 과 RN 레이어로 나뉘어 있음 |
| C-13 | 렌더 | Android 대형 텍스처 (4096×2048 RGBA ≈ 32 MB, 최대 텍스처 4096 한계 기기) | 티켓 2230 리뷰 #1084 | 저사양 Android 에서 플래그 on 실행 | 미실행 — 실기기 필요 | 단일 기기 가정이라 기기별 한계는 확인하지 못했다 |
| C-14 | 이동 | 입구 7종 경로 존재, 모든 노드 통행 | T01, 티켓 2231 | `nav-path.test.ts` v1 nav.json A* | 통과 | 스폰 → 입구 7종 [머지 뒤 재실행] |
| C-15 | 이동 | 대각 모서리 관통 0 | 티켓 2231 | `nav-path.test.ts` | 통과 | 대각 스텝마다 양옆 직교 셀 통행 확인 |
| C-16 | 이동 | 가로·세로 world/초 동일 | 티켓 2231 | `nav-path.test.ts` stepDurationMs | 통과 | 가로 5칸 = 세로 5칸 duration, 대각 1칸 = √2 배 |
| C-17 | 이동 | 바다 탭 → 최근접 통행 셀 (동률은 index 작은 쪽) | HLD 규칙 ③, 티켓 2231 | `nav-path.test.ts` resolveTarget · tilePath | 통과 | 다른 섬 탭은 출발 영역 안 최근접 셀, 도달 불가는 빈 경로 [머지 뒤 재실행] |
| C-18 | 이동 | 바다 탭이 「무시」에서 「이동」으로 바뀐 것이 스크린리더 자리 선택(DESIGN.md §7.14)·건물 진입·뗏목 hitbox 를 깨지 않음 (`onLand` 에 기대지 않는지) | 티켓 2231 리뷰 #1085 | 플래그 on 에서 해당 조작 | 미실행 — 실기기 필요 | 플래그 on 에서는 `onLand` 검사가 빠진다 (PR #1085 본문) |
| C-19 | 이동 | 대각 스텝 duration(129 ms)과 직선(91 ms)의 가속감 | 티켓 2231 리뷰 #1085 | 실기기 조작 | 미실행 — 실기기 필요 | 환산식은 `MS_PER_UNIT = 91` |
| C-20 | 이동 | 이동 체감 (결정 A: 월드 기준 등방, 화면 1.5:1, 10/9 보정 없음) | MV-D05 | 실기기에서 가로·세로 이동 비교 | 미실행 — 실기기 필요 | 판단 칸은 표 3 의 「이동 체감 판단」 |
| C-21 | 캐시 | curl 헤더 2종 | T16, 티켓 2233 | `serve:map-assets` 후 `curl -I` | 통과 | manifest `max-age=60` + ETag, v1 파일 `max-age=31536000, immutable` [머지 뒤 재실행] |
| C-22 | 캐시 | 두 번째 실행 파일 다운로드 0 | T16, 티켓 2233 | `mapAssets.test.ts` 웜 스타트 | 통과 | jest 메모리 파일시스템 기준. 파일 다운로드 0, manifest 304 1회 |
| C-23 | 캐시 | 해시 불일치 폐기·재시도 | T16, 티켓 2233 | `mapAssets.test.ts` | 통과 | 2회 불일치면 임시 삭제 후 이전 캐시 또는 번들 |
| C-24 | 캐시 | 실패 토글 8조합 (캐시 없음/있음 × manifest·tileset·layout) | T16, 티켓 2233 | `mapAssets.test.ts` | 통과 | 반환 소스가 항상 bundle 또는 온전한 cache |
| C-25 | 캐시 | 서버 끄고 폴백 | T16, 티켓 2233 | `mapAssets.test.ts` 서버 없음 | 통과 | jest 기준 bundle 반환. 실기기 재실행은 데모 5단계에서 확인 |
| C-26 | 캐시 | Skia `useImage` 가 `file://` 를 읽는지, 디코드 실패 시 `onError` 강등이 실제로 도는지 | 티켓 2233 리뷰 #1086 | 실기기에서 캐시 소스로 렌더 | 미실행 — 실기기 필요 | jest 는 Skia mock |
| C-27 | 캐시 | `File.copySync`/`moveSync` 동작, 5.9 MB 순수 JS sha256 시간(JS 스레드 정지), 콜드 설치 첫 다운로드 | 티켓 2233 리뷰 #1086 | 실기기 콜드 설치 | 미실행 — 실기기 필요 | sha256 은 node crypto 대조 테스트만 통과, 소요 시간은 측정하지 않았다 |
| C-28 | 플래그 | `EXPO_PUBLIC_VILLAGE_PREVIEW` 기존 토글 유지 | 티켓 2230 | 플래그 on/off 각각에서 마을 미리보기 토글 | 미실행 — 실기기 필요 | 자동 테스트 없음. `WorldMap.tsx` 의 `CAN_PREVIEW_VILLAGE` 조건 자체는 유지되나 이번 변경에서 토글 식이 다시 쓰여 있어 조작 확인이 필요하다 |
| C-29 | 플래그 | 웹은 `EXPO_PUBLIC_TILE_ISLAND` 무시 | 티켓 2230 | 정적 확인 | 통과 | `WorldMap.tsx` `TILE_ISLAND = Platform.OS !== 'web' && …` (코드 읽기, 웹 실행은 하지 않음) |
| C-30 | 플래그 | 플래그 off 시 맵 에셋 동기화·캐시 경로 비활성 | 티켓 2233 | 정적 확인 | 미실행 — 실기기 필요 | PR 본문 기준 `TILE_ISLAND` 일 때만 승격·동기화. 이번 부록에서는 실행해 보지 않았다 |
| C-31 | 서버 | `/screens/home` 네 필드 (`mapId`·`mapVersion`·`layoutRevision`·`layout`) | 티켓 2232 (#1083) | 서버 기동 후 홈 조회 | 미실행 — 서버 PR 대기 | #1083 은 이 브랜치에 없다 |
| C-32 | 서버 | 구 data-api 폴백 (404 → 필드 생략) | 티켓 2232 (#1083) | 구 서버에 연결해 홈 진입 | 미실행 — 서버 PR 대기 | 앱 쪽 선택 필드 처리는 `island-layout.test.ts` 로 확인 (layout 없으면 입력 그대로) |
| C-33 | 서버 | layout 폴백 (`applyLayout`) | 티켓 2230 | `island-layout.test.ts` | 통과 | layout 없으면 입력 그대로, 있으면 건물 7종 위치만 이동 |
| C-34 | 전체 | 타입 검사 | 공통 | `npm run typecheck` | 통과 | 오류 0 [머지 뒤 재실행] |
| C-35 | 좌표 | 범위 밖 탭 무시 (`worldToWire` null → 이동·서버 전송 없음) | 티켓 2228 | `worldCoords.test.ts` 범위 밖·비유한값 케이스 | 통과 | 범위 [0,100]² 밖과 NaN·±Infinity 는 `null`, 경계 0·100 은 통과. 화면 제스처 연결은 보지 않았다 |
| C-36 | 플래그 | 플래그 off 에서 서버 `layout` 이 와도 `applyLayout` 미적용 (`map.json` 위치 유지) | 티켓 2230 | `WorldMap.tileIslandOff.test.tsx` | 통과(jest, mock) | Skia 를 mock 으로 렌더. 실기기 화면 비교는 C-05 |
| C-37 | 플래그 | 플래그 on 이면 기존 마을 바닥 Image 대신 Skia 타일 캔버스, 서버 `layout` 은 건물별 평행이동(`legacyLayoutOffsets`)으로 적용 — 기본 배치면 픽셀 동일, 옮기면 레이어·문이 같이 이동 · 새 마을 미리보기를 켜면 `applyLayout` 적용 (C-36 의 양성 쌍, 2026-10-08 기존 마을 전환) | 티켓 2230 | `WorldMap.tileIsland.test.tsx` | 통과(jest, mock) | C-36 이 헛통과가 아님을 보이는 쌍. Skia mock 이라 실제 그려진 화면은 아님 (C-06) |
| C-38 | 렌더 | 낚시 화면에서는 타일 지형을 쓰지 않는 가드 | 티켓 2230 | 정적 확인 | 통과(정적 읽기) | `WorldMap.tsx` `const tileTerrain = village && !fishing && TILE_ISLAND`. 이 가드 전용 테스트는 없고 실행도 하지 않았다 |
| C-39 | 이동 | 같은 셀 목적지는 길이 1 경로라 걷기 done 콜백이 불림, 같은 입구를 연속으로 걸어도 두 번째 경로가 비지 않음 | 티켓 2231 | `nav-path.test.ts` `tilePath (walk 의 done 호출 조건)` | 통과 | 입구 7곳 연속 걷기 포함 |
| C-40 | 좌표 | objects 카탈로그가 오브젝트별 `w·h·asset` 을 원본과 같게 보존 (tree 9 vs 12) | 티켓 2228 | `nav.test.ts` | 통과 | fixture 수치 고정 항목 [머지 뒤 재실행] |
| C-41 | 캐시 | 캐시 안전망: 원자 쓰기(`state.json` 은 `.tmp` 경유)·스냅샷(마운트 뒤 승격이 이미 받은 소스에 영향 없음)·빈 섬 방지(JSON 하나라도 깨지면 소스 전체 번들)·나쁜 해시 표식(같은 해시 재채택 없음, 새 해시는 채택) | 티켓 2233 | `mapAssets.test.ts` (g)~(n) | 통과 | rename·state 쓰기 실패 주입 포함, jest 메모리 파일시스템 기준. 실기기 파일 I/O 는 C-27. `objects.json` 은 번들 전용이라 캐시 manifest 는 5개 파일(캐시 소비는 VillageScenery 가 카탈로그를 읽는 후속에서) |
| C-42 | 이동 | 간선 중점이 막힌 인접 통행 셀 쌍 수를 2 로 고정 (입구 셀 예외는 후속 티켓) | 티켓 2231 | `nav.test.ts` | 통과 | fixture 수치 고정 항목 [머지 뒤 재실행] |
| C-43 | 이동 | `loadNav` 입력 검증 (잘못된 nav 입력 거부) | 티켓 2231 | `nav-path.test.ts` `loadNav 입력 검증` | 통과 | |

집계는 항목 43개 중 통과 26, 미통과 0, 미실행 17 (실기기 필요 15, 서버 PR 대기 2)다. 통과 26 은 jest 22, jest(mock) 2 (C-36, C-37), 정적 읽기 2 (C-29, C-38)이며, 지형 렌더 자체(C-05, C-06)는 미실행으로 둔다. 「머지 뒤 재실행」 표식은 생성물 바이트 비교, fixture 수치 고정, typecheck, curl 헤더 항목(C-04, C-07, C-14, C-17, C-21, C-34, C-40, C-42)에 달았다. 스택의 나머지 PR 이 merge 되면 이 항목들의 결과가 바뀔 수 있다.

### 표 2. 시연 순서 5단계

예상 소요는 시연 전 리허설 기준 추정치이며 측정값이 아니다. 복구·건너뛰기 열은 코드 사실에 근거한다.

| 단계 | 조작 | 기대 화면 | 예상 소요(분) | 실패 시 복구·건너뛰기 | 비고 |
| --- | --- | --- | --- | --- | --- |
| ① | `EXPO_PUBLIC_TILE_ISLAND` off → on 으로 앱을 다시 띄워 같은 구도에서 비교 | on 에서 지형이 stretch Image 대신 타일 지형으로 그려지고 소품·건물 위치는 그대로 | 5 | on 이 안 뜨면 `.env` 의 값(`EXPO_PUBLIC_*` 는 번들 시점에 박힘)과 Metro `--clear` 재시작을 확인한다. 그래도 안 되면 off 로 ②~⑤ 를 시연하고 C-05·C-06 은 미실행으로 남긴다 | 웹은 플래그 무시. 실기기 필요 |
| ② | 길 위와 잔디 위를 번갈아 탭, 건물 모서리 근처 대각 탭 | 기존 마을 통행 격자 안에서 걷고 건물 모서리를 가로지르지 않는다(기존 마을은 길이 원화에 그려져 있어 길 우선 없음, 2026-10-08). 바다 탭은 가까운 통행 셀로 이동 | 3 | 이동이 없으면 플래그 on 인지부터 확인한다(off 면 기존 이동 경로). 바다 탭에서 도달 불가면 빈 경로라 가만히 있는 것이 정상이므로 다른 섬 탭은 건너뛴다 | 가로가 화면에서 1.5배 빨라 보이는 것은 의도(결정 A). 보정 없음 |
| ③ | 핀치 줌 0.35 ~ 2.6, 같은 지점을 줌 단계마다 탭 | 줌과 무관하게 같은 world 지점으로 이동. 이음매·소품 어긋남이 없는지 함께 본다 | 3 | 이음매·어긋남이 보여도 시연은 계속하고 C-11·C-12 에 현상만 기록한다(성능 p95 는 표 3 로 별도). 프레임이 심하게 끊기면 줌 단계를 0.35·1·2.6 세 곳으로 줄인다 | C-11, C-12 확인 지점 |
| ④ | 건설 완료 콜백 → 홈 재조회 → `layoutRevision` 증가 | 타일 섬(기존 마을)은 `layout` 을 건물별 평행이동으로 적용한다 — 서버 기본 템플릿이면 위치가 그대로이고, 서버가 셀을 옮기면 그 건물의 레이어·모션·문이 같이 옮겨진다. `layoutRevision` 증가와 건물 위치를 확인한다. 머지 전: `layout` 이 없어 로컬 폴백으로 기존 배치가 그대로 유지된다 | 4 | 서버 2232(#1083) 미머지 환경이면 이 단계는 건너뛰고 C-31·C-32 를 서버 PR 대기로 둔다. 앱은 `layout` 이 없으면 입력을 그대로 쓰므로 건너뛰어도 이후 단계에 영향 없다 | 타일 섬은 그리는 위치·문·공사 스프라이트만 움직이고 통행 셀은 정적 `v1/nav.json` 기준 (새 마을 미리보기는 PR #1084 본문대로 통행·건설 위치가 `map.json` 기준). 서버 PR 대기 |
| ⑤ | `serve:map-assets` 를 끄고 앱 재실행 | 이전 캐시 또는 번들 에셋으로 같은 섬이 뜬다 (실패 시 빈 섬 없음) | 3 | 캐시가 없으면 번들로 바로 간다(`mapAssets.test.ts` (f)). 캐시 소스 렌더가 깨져 강등되면 다음 시작은 번들이므로 앱을 한 번 더 재실행한다. 섬이 비면 시연을 멈추고 C-26 을 미통과로 기록한다 | 캐시 소스 렌더는 C-26 확인 필요. 실기기에서는 `EXPO_PUBLIC_MAP_ASSETS_URL` 에 맥 LAN IP |

합계 예상은 18분이다.

### 표 3. 실기기 기록 (재영님 기입)

아래 칸은 모두 비어 있다. 이 부록 작성 시점에 실기기 측정은 하지 않았다.

| 항목 | 기록 |
| --- | --- |
| 기기 | |
| OS | |
| 빌드 | |
| 팬 p95 (ms) | |
| 줌 p95 (ms) | |
| 콜드 스타트 (s) | |
| 웜 스타트 (s) | |
| 이동 체감 판단 (A 유지 / 화면 등방 보정, MV-D05) | |

이 부록은 10/9 시연 결과로 갱신한다. 코드가 바뀌면 표 1 의 결과 열을 다시 채운다.
