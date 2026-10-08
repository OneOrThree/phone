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
