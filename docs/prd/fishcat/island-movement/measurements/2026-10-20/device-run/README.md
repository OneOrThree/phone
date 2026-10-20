# 2026-10-20 실기기 이동 동기화 측정 (티켓 2250) — 기록

실기기에서 1단계 이동 동기화를 처음 쟀다. 해석·요약은 [validation.md §7-3](../../../validation.md). 이 폴더는 방법·조건·수치 사본이다(앱 집계는 Metro 콘솔 출력이라 정형 JSON 원본이 없다 — 아래 표가 사본이다).

## 기기·서버

- 기기: iPhone 16 Pro Max, iOS 27.0.1, Wi-Fi.
- 앱: 개발 전용 계기 빌드 `afeat/GROMO-2250-movement-device-stats` `325e7214c`(`movementStats` + 자동 걷기 + `EXPO_PUBLIC_MOVEMENT_MEASURE=1` 자동 시작). 정의는 서버 측 스크립트(`scripts/measure-movement.mjs`)와 같다: RTT = intent 송신 → 같은 commandSeq·내 userId 의 PathAccepted, Snapshot 간격 = 직전 Snapshot 에 MOVING entity 가 있을 때의 다음 Snapshot 까지(정지 공백 제외), 점프 = 서버 위치 보정 시 화면 px 거리.
- 서버: **dev 가 아니라** 로컬 풀 스택 `phone-*-local`, realtime 2270 jar(10-20 main 재측정과 같은 이미지). 앱은 로컬 nginx `http://<맥 IP>:8088` 를 본다.

## 공존(봇 5명)

앱은 자기 소속(홈) 섬에서만 이동 채널을 연다 — 방문 섬에선 열리지 않는다. 그래서 공존은 봇을 **폰의 홈 섬에 멤버로** 넣어 만든다(폰 홈 섬은 개방 가입이라 즉시 가입).

```sh
NODE_PATH=<앱 node_modules> node scripts/measure-movement.mjs \
  --island <폰 홈 섬 id> --users 5 --duration 720 --base http://127.0.0.1:8088 \
  --state <레포 밖>/bots-state.json --json <레포 밖>/bots-5.json
```

방 인원 6명(폰 + 봇 5). 봇 게스트는 로컬 DB 에 멤버로 남지만 로컬은 버려도 되는 데이터다.

## 수치

앱(폰) 집계 — 봇 5명 공존 약 12분(리셋 토글 미사용, 누적 약 21분이나 공존이 지배):

| 항목 | 값 |
| --- | --- |
| RTT (intent→내 PathAccepted) | p50 64 · p99 202 · 최대 277 ms (452건) |
| Snapshot 수신 간격 | p50 51 · p99 126 ms · ≥100 ms 5.2% (18,000+건) |
| 보정 점프 최대 | 화면 260 px (이미지 324 px × 배율 0.80) |
| 재접속 / FullState 첫 수렴 | 0회 / 38 ms |
| 배터리 | 68% → 53% (15%p, 약 21분 연속 자동 걷기) |
| 이동 체감 (MV-D05, 오너) | 꽤 자연스러움 |

혼자(봇 없음) 대비: 같은 세션의 WS 연결 직후 혼자 구간(약 1분, 표본 ≈240)에서 Snapshot p99 106 ms·≥100 ms 1.8% → 봇 공존 126 ms·5.2%. 다만 Snapshot 간격은 「직전에 MOVING entity 가 있을 때」만 세 공존에서 집계 구간 자체가 늘고, 서버 측 같은 정의 값은 p99 59.7 ms·≥100 ms 0.14% 라 폰 상승분엔 Wi-Fi·기기 JS 스레드 지연 몫이 크다. 공존 시 p99 상승이 관찰되었으나 단일 세션·표본 구성 차이·기기/망 지연이 섞여 인과는 단정하지 않는다.

서버 측 교차(같은 섬 봇 5명 — 방 6명(폰 포함). `measure-movement.mjs --users 5` 결과. 1,800건 = 봇 5 × 2초 간격 720초):

| 항목 | 값 |
| --- | --- |
| 세션당 수신량 | 평균 25,262 B/s ≈ 90.9 MB/시간 (Snapshot 본문 평균 880 B) |
| Snapshot 수신 간격 | p50 50.0 · p99 59.7 ms · ≥100 ms 0.14% (표본 71,905) |
| 왕복(intent→PathAccepted) | p50 30.3 · p99 63.9 · 최대 470.2 ms (1,800건) |
| 실행 유효성(서버 틱 진행) | 100.0% · close/ERROR/오류 큐 0 |

## 남은 것

공개 dev 서버 빌드 + 수동 조작이 필요해 이번에 못 한 것:

- dev 서버 RTT·LTE 망(로컬 Wi-Fi 로만 쟀다).
- T10 재접속(배경 종료·Wi-Fi 전환·동일 계정 다른 기기). 단일 세션·망 전환 없이 재접속 0회였다.

## 접속 함정 (측정 중 해소)

홈 섬에 들어가도 RTT·Snapshot·WebSocket 이 0이었다. 원인은 로컬 realtime 이 **옛 IP 허용 목록**을 들고 있어 폰 WebSocket 핸드셰이크(`GET /ws/realtime`)를 403 으로 막은 것이다. 403 은 nginx 가 아니라 realtime 이 낸다 — nginx 는 그 경로를 `172.24.0.5:8085`(측정 당시 로컬 네트워크 `phone_default` 의 고정 IP, 환경 바뀌면 다르다)로 프록시만 한다.

- **환경변수 위치**: realtime 의 `CHAT_WS_ALLOWED_ORIGINS`. 로컬 스택에선 `doc/local/stack/docker-compose.full.yml`(gitignored, MAIN 정본)의 realtime 서비스 env 에서 온다.
- **처치(이번)**: 그 compose 파일을 만든 워크트리가 삭제돼 compose 로 재생성할 수 없어서, 실행 중인 컨테이너의 env 를 덤프해 현재 맥 IP(`http://<ip>:8088`)를 `CHAT_WS_ALLOWED_ORIGINS` 에 더한 뒤 `docker run` 으로 재생성했다 — 같은 네트워크 `phone_default`·같은 고정 IP `172.24.0.5`·별칭 `realtime`, 이미지 `phone-local/realtime`(2270 jar) 그대로(jar 재빌드 없음). compose 파일이 있으면 그 키를 고치고 `docker compose -p phone -f <local.yml> -f <full.yml> up -d --no-build realtime` 로 족하다.
- **확인**: `docker logs --since 1m phone-nginx-local | grep /ws/realtime` 가 `403` → `101` 로 바뀐다. 폰 오버레이의 RTT·Snap 이 0 을 벗어나는 것으로도 보인다.

빌드 메모(함정과 무관): Xcode 빌드 멈춤은 이날 재현되지 않았다. 첫 빌드만 ReactCodegen 입력 파일 경합(rc 65)이라 `pod install` 재실행으로 코드젠을 다시 깔아 풀었다. 앱 계기 커밋 `325e7214c`(`afeat/GROMO-2250-movement-device-stats`)는 이 PR 에 없다 — 앱 PR 은 별도(미개설).
