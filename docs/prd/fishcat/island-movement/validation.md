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
| T10 재접속 | MV-11 | 배경 종료·Wi-Fi 전환·동일 계정 다른 기기 | 새 actor/generation, 이전 입력 차단, 전체 상태 수렴 |
| T11 소유권 | MV-12 | worker kill·네트워크 분할·저장소 quorum 상실·긴 프로세스 정지 | lease 만료 전에 이전 owner 정지, 새 epoch에서만 처리 |
| T12 배치 | MV-02, MV-12 | 이동 중 건물 완공·역순 이벤트·맵 다운로드 실패 | 원자 전환, 무효 경로 재계산·안전 재배치, 옛 맵 입력 거부 |
| T13 부하 | MV-06, MV-08, MV-12 | PRD의 1,500연결·30분·기준 자원 | A*·틱 지연·CPU·메모리·NIC 송신·drop 지표와 결과 파일 |
| T14 운영 | MV-13 | 입장→탭→보정→취소 1건 추적 | 상관 ID로 연결, 티켓/토큰/키 미기록, 고카디널리티 메트릭 방지 |
| T15 재사용 | MV-12 | Fishcat 외 합성 gameId·다른 맵·다른 속도 | 게임 간 actor·맵·권한 격리, 엔진의 Fishcat 도메인 의존 0건 |

성능 테스트에서 실패하면 수치를 낮춰 통과했다고 기록하지 않는다. 병목·수용 가능 부하·필요 자원과 변경한 목표의 근거를 남긴다.

## 3. 구현 순서와 완료 증거

| 단계 | 작업 범위 | 완료 증거 / 다음 단계 조건 |
| --- | --- | --- |
| 0. 계약 | 100×100 의미·좌표 metric·반경·맵 스키마·직접 연결 경계 결정 | 결정 로그, MapManifest fixture, 승인된 호출·공개 면 표 |
| 1. 전송 POC | Java/Netty QUIC ↔ iOS/Android quiche adapter, stream+datagram | 실기기 암호화 연결·인증서 검증·망 전환·20Hz 측정. 실패하면 대안 비교 후 진행 |
| 2. 맵·코어 | 기존 아트 변환, 서버 A*·고정 틱·안전 도착점 | TS/Java fixture, headless 시뮬레이션, 통행/코너 회귀 |
| 3. 수직 연결 | Business 입장→worker 경로→앱 표시, 실제 주민 2명 | 서로의 경로·좌표가 같은 방에서 일치하는 화면 녹화와 상관 로그 |
| 4. 상태 변화 | 취소·배치 변경·재접속·소유권·드레인 | 장애 주입 T09~T12와 lease 경계 재현 |
| 5. 부하·운영 | 관측·큐 한도·팬아웃·버전 기능 플래그·롤백 | T13~T15, 자원·비용 표, 운영 runbook |
| 6. 배포 | 사내 섬→제한 사용자→확대, 앱 native 배포 | iOS/Android 빌드와 실제 연결 검증, 정해진 지표 충족 |

계약 fixture 작업과 전송 POC는 서로 독립적으로 시작할 수 있지만, 네이티브 전송 검증 전에 전체 앱 연결 방식을 확정하지 않는다. 서버 구현은 기존 아키텍처 8단계와 소유 저장소·JVM 서비스 모듈 등록을 함께 수행한다.

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
