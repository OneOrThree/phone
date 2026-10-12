# GROMO-2285 검증 기록

2026-10-13, GCP `oneorthree2` / `asia-northeast3-a` / `gromo-dev-app`에서 실행했다. 공개 진입점은 `https://oneorthree.dev.mooo.com`이며 Node v24.19.0을 사용했다. 로컬 앱·DB를 띄워 얻은 결과가 아니다. 공유 서비스의 재배포·재기동 및 전역 카탈로그 수정은 하지 않았다.

## 최신 공유 dev 전체 실행

게스트 구매 거절 계약으로 변경한 최종 코드에서 **15 PASS / 0 FAIL / 0 SKIP**, 내부·API 실행기 모두 exit 0을 확인했다.

| TC | 결과 | ms |
|---|---|---|
| 001 | PASS | 115 |
| 002 | PASS | 301 |
| 003 | PASS | 262 |
| 004 | PASS | 188 |
| 005 | PASS | 512 |
| 006 | PASS | 161 |
| 007 | PASS | 165 |
| 008 | PASS | 196 |
| 009 | PASS | 493 |
| 010 | PASS | 228 |
| 014 | PASS | 73000 |
| 015 | PASS | 199 |
| 016 | PASS | 215 |
| 017 | PASS | 674 |
| 018 | PASS | 2873 |

014: 실제 집중 62초, `B0=10000 → B1=10001 → B2=10000 → B3=10000`. 회관 비용은 현재 공유 dev 정책의 1을 사용했다. 구매는 `403 SOCIAL_LOGIN_REQUIRED`이며 지갑 version·개인 주문·인벤토리가 요청 전후 동일했다. 빈 카탈로그의 `smoke-guest-denied` ID로 회원 gate 우선 적용을 확인했다.

별도의 GCP 격리 검증에서도 014가 exit 0이었다. `B0=10000 → B1=10001 → B2=9941 → B3=9941`이며 격리 DB의 회관 비용 60을 조회해 사용했다. 배포 이미지 ID는 Data `sha256:113056559fb0c356d620bcf824bc368f8259b23ef021ac01ee835ffd1ec69dc3`, Business `sha256:3b228e7aa10cb306b87c59b410753c7fdcccb8ff0b6f5c8e73a47260ccfa1dfa`였다. 격리 Business의 10초 read timeout·20초 deadline·curl 25초는 cold start 기능 검증용이므로 공유 dev의 시간 조건과 구분한다. 모든 격리 컨테이너·임시 DB·자격 파일이 정리되었고 공유 5개 서비스는 healthy였다.

## 수정 전 공유 dev 실행 기록

계약 수정 후 첫 전체 실행은 **14 PASS / 1 FAIL**이었다. 실패한 014는 DB 초기 준비에서 중단되어 적립·건설·구매·장착을 통과한 것으로 처리하지 않는다.

| TC | 판정 | 검증 내용 |
|---|---|---|
| 001 | PASS | 공개 health 200·시간 제한 |
| 002 | PASS | 게스트 발급 201·응답 계약 |
| 003 | PASS | 계정 ID 동일 |
| 004 | PASS | 섬 생성·조회 |
| 005 | PASS | 홈 필수 조각·주민 목록 |
| 006 | PASS | 집중 시작·current·종료·current null |
| 007 | PASS | STOMP 연결·구독 후 집중 시작 |
| 008 | PASS | 5개 컨테이너 running·healthy |
| 009 | PASS | 가짜 기기 토큰 등록·기존 자격 갱신 |
| 010 | PASS | 사용자·세션이 일치하는 active 집중 이벤트 |
| 014 | FAIL | `구매 가능한 활성 개인 상품 없음`; 공유 DB 활성 개인 상품 수 0 |
| 015 | PASS | 독립 도서관 fixture·UTC 스크린타임 7분 저장·통계 동일 |
| 016 | PASS | 전용 주민·친구 관계 준비·실제 집중 상태 조회·관계와 소속 정리 |
| 017 | PASS | 공유 Redis 임시 키 SET·GET·TTL·DEL |
| 018 | PASS | business Redis 기존 ACL에서 SET·GET·실제 만료·재저장·DEL |

그다음 재실행은 **12 PASS / 3 FAIL**이었다. 001~010·017·018은 모두 통과했고, Origin을 보내는 WebSocket Upgrade 101 검사도 통과했다. 같은 IP에서 테스트 계정을 반복 생성한 결과 016·014의 게스트 발급이 `429 RATE_LIMITED`로 거절되었고, 015의 독립 계정 준비도 실패했다. 레이트리밋을 해제하거나 Redis 제한 키를 삭제하지 않았다. 이 실패를 이전 PASS로 덮어쓰거나 최신 실행의 전체 통과로 보고하지 않는다.

이후 사용자 선택에 따라 014는 게스트 구매 `403 SOCIAL_LOGIN_REQUIRED`·지갑/주문/소유 무변경을 기대값으로 변경했다. 회원 구매·장착 성공은 제외하며 회원 fixture 준비 코드는 제거했다. 빈 카탈로그에서는 문법상 유효한 fixture 상품 ID로 회원 gate를 검증하므로 활성 상품 요구도 제거했다. 중간 실행에서 게스트 발급 429로 선행 실패가 발생하는 경로도 확인했다. 선행 실패 시 선택한 TC를 누락하지 않고 SKIP로 기록하도록 보완했다. 위 실패는 변경 전의 역사적 결과이며 최종 전체 통과와 구분한다.

## 실행기 회귀 검사

- HTTP·Node native WebSocket mock 5개 시나리오 통과: 전체 성공, health 실패, 집중 이벤트 타임아웃 후 세션 정리, 통계 불일치, BASE_URL 기본 모드 9개 TC.
- 내부 health·Redis 회귀 6개 통과: 실패 판정·임시 키 정리·자격 비노출.
- 격리 환경 정리 회귀 3개 통과: opt-in 없으면 Docker 접근 금지, 컨테이너 생성 응답 실패 시 소유 자원 정리, 다른 소유자의 자원 보존.
- Actions 결과 보고 회귀 6개와 checkout 코드 revision 회귀 1개 통과. GitHub 쓰기는 mock으로 검증했으며 실제 자동 알림 실행은 아직 하지 않았다.
- SQL 준비 guard 검사 통과: 비정상 UUID·fixture 이름·모드·친구 준비 대상은 DB 접속 전에 거절.
- Bash 구문 검사, ShellCheck error 단계, `git diff --check` 통과. 전체 스타일 경고가 없다는 의미는 아니다.
- 현재 코드의 Data·Business·Realtime·Notification `bootJar` 빌드 통과. 이 로컬 빌드는 GCP에 배포하지 않았다.

## 자동 실행 검증 범위

수동·정기·재사용 Actions 및 dev CD 호출을 구현했다. 아직 이 브랜치의 실제 GitHub Actions를 실행하거나 공유 dev에 배포하지 않았다. 기본 배포 후·정기 검사는 12개다. 전체 15개는 수동 run_core_flow=true 또는 정기의 repo 변수 SMOKE_CORE_ENABLED=true로 선택한다. 실제 GitHub Actions의 자동 실행까지 운영 검증이 끝났다는 의미는 아니다. PR은 draft로 유지한다.

Actionlint는 구버전 파서가 지원하지 않는 기존 concurrency.queue와 self-hosted dev 라벨 진단만 제외하고 통과했다.
