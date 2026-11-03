# Cattus 서버

## 바로가기

| 구분 | 내용 |
| --- | --- |
| 서버 이해 | [서버 구성 한눈에 보기](#1-서버-구성-한눈에-보기) · [시스템 구성도](#2-시스템-구성도) · [주요 구현과 설계 포인트](#3-주요-구현과-설계-포인트) · [기술 스택](#4-기술-스택) |
| 개발·운영 | [로컬에서 시작하기](#5-로컬에서-시작하기) · [검증 · 배포](#6-검증--배포) |

> 집중한 시간이 캐릭터의 성장과 함께하는 섬의 활동으로 이어지도록 만드는 백엔드입니다.

Cattus는 집중 세션과 스크린타임을 기록하고, 캐릭터·아이템·재화·친구·그룹 활동을 연결하는 앱입니다. 이 폴더는 앱의 요청을 처리하는 API부터 실시간 채팅, 푸시 알림, 배포와 관측까지 담습니다.

[전체 프로젝트](../README.md) · [설계 결정](../docs/architecture/decisions.md) · [기능 문서](../docs/README.md) · [부하 테스트](../loadtest/README.md)

## 1. 서버 구성 한눈에 보기

| 구성 | 담당하는 일 | 저장소 · 의존성 | 문서 |
| --- | --- | --- | --- |
| Business API | 앱 요청 인증·조합 | 상류 HTTP, 폐기 세션 표지용 전용 Redis | [README](business-api/README.md) |
| Data API | 계정·집중·섬·재화의 상태와 트랜잭션, 정산 | PostgreSQL, Redis, 선택적 outbox relay | [README](data-api/README.md) |
| Notification | 기기·설정·예약 알림·발송·운영 관리 | 전용 PostgreSQL, Kafka, FCM | [README](notification/README.md) |
| Realtime | 섬 채팅·집중 관전·응원·이동·바다 방 | 전용 PostgreSQL, Redis Pub/Sub | [README](realtime/README.md) |
| Observability | 요청·쿼리·리소스·로그·트레이스 관측 | Prometheus, Grafana, Loki, Datadog | [README](observability/README.md) |
| Scripts | 환경별 Compose, 서비스별 설정 생성, 데이터 이관 | Docker Compose, Python, Bash, PostgreSQL 도구 | [README](scripts/README.md) |

네 JVM 서비스는 **각자 Gradle Wrapper와 Dockerfile을 가진 독립 프로젝트**입니다. 루트에서 한 번에 빌드하는 Gradle 멀티모듈 구조가 아니므로 해당 서비스 폴더에서 명령을 실행합니다.

## 2. 시스템 구성도

### 현재 코드의 주요 연결

아래는 코드에 존재하는 연결입니다. 위성 서비스와 relay의 실제 사용 여부는 배포 구성·프로파일·기능 플래그에 따라 달라집니다.

```mermaid
flowchart LR
  app["Cattus 앱"] -->|"공개 API·인증 발급"| business["Business API"]
  app -->|"WebSocket /ws/realtime"| realtime["Realtime"]
  business -->|"섬 채팅 내부 REST"| realtime
  business -->|"내부 HTTP"| data
  business -->|"기기·설정·알림 확인"| notification["Notification"]
  business -->|"링크 발급·귀속"| link["Link / MMP · 별도 저장소"]
  business --> bizRedis[("전용 Redis · 폐기 세션 표지")]
  data --> coreDb[("코어 PostgreSQL")]
  data -->|"집중 상태 기록"| redis[("공유 Redis")]
  realtime -->|"집중 상태 조회·팬아웃"| redis
  realtime -->|"현재 멤버십 조회"| data
  realtime --> chatDb[("gromo_chat")]
  data -.->|"focus/rest · 기본 HTTP"| realtime
  data -.->|"알림 outbox · 선택 Realtime transport"| kafka["Kafka"]
  kafka --> notification
  kafka -.->|"Kafka transport 선택 시"| realtime
  notification --> notiDb[("알림 PostgreSQL")]
  notification --> fcm["FCM"]
```

우체통의 친구 편지는 Business → Data의 `/letters` 경로로 저장합니다. 섬 단체 채팅은 Business → Data 인가 → Realtime 저장 경로이며, 현재 앱은 REST로 발송하고 활성·전면 상태에서 10초마다 이력을 갱신합니다. 서버 STOMP 채팅 경로와 구분합니다.

알림의 HTTP 이벤트 수신과 Data를 향한 제한된 조회 등 세부 연결은 각 서비스 README를 참고합니다. Link/MMP는 [별도 저장소](https://github.com/OneOrThree/mmp-custom)에서 관리합니다.

### 서비스 분리 목표

목표는 **앱의 일반 API 진입점을 Business로 모으고, 코어 데이터 변경을 Data에 집중하는 구조**입니다. 현재 앱의 일반 API와 인증은 Business가 받고(루트 경로, 접두사 없음: `/auth/sessions`·`/me`·`/screens/*`·`/focus-sessions`), Data는 `/internal/**`로만 호출됩니다. Data의 공개 컨트롤러는 `/health` 하나입니다(`data-api/.../common/api/HealthController.java:13`). Realtime은 focus/rest·응원·섬 소식·이동·바다 방을 제공하며 채널마다 인가 조건이 다릅니다. 다음 그림은 별도로 유지하는 Target-1 설계이며 현재 구현 목록은 위 연결과 각 서비스 README를 기준으로 확인합니다.

[![Target-1 서비스 구성](../docs/architecture/diagrams/01-service-target1.svg)](../docs/architecture/service-architecture.md)

[서비스 아키텍처](../docs/architecture/service-architecture.md) · [시스템·배포 아키텍처](../docs/architecture/system-architecture.md)

## 3. 주요 구현과 설계 포인트

| 사용자 경험 · 운영 과제 | 서버에서 구현하는 내용 | 더 보기 |
| --- | --- | --- |
| 집중 기록과 보상이 일관되게 남기 | 집중 세션·재화 원장·정산을 코어 트랜잭션에서 관리 | [집중·휴식 설계](../docs/prd/fishcat/focus-rest-session/README.md) |
| 응답을 놓쳐도 명령을 중복 실행하지 않기 | 같은 요청 키로 확정 결과를 재생하고 상태·receipt·outbox를 함께 저장 | [Business 공통 계층](business-api/README.md) |
| 섬 안에서 대화하고 집중 중에는 채팅 제한하기 | 멤버십·집중 상태 검사, Redis 팬아웃, 채팅 이력과 읽음 위치 | [Realtime](realtime/README.md) |
| 알림을 적절한 시점과 기기에 보내기 | 수신 중복 제거, 수신 동의·조용한 시간·확인 여부·발송 적격 검사 | [Notification](notification/README.md) |
| 문제가 생긴 구간을 찾고 배포를 재현하기 | 요청·DB·리소스 지표와 로그, digest 기반 이미지, 서비스별 환경변수 | [관측](observability/README.md) · [배포 도구](scripts/README.md) |

## 4. 기술 스택

| 영역 | 저장소에서 사용하는 기술 |
| --- | --- |
| 런타임 | Java 17, Spring Boot 4.0.6, Gradle Wrapper |
| HTTP · 인증 | Spring MVC, JWT, 서비스 간 토큰 |
| 데이터 | PostgreSQL, JPA/Hibernate 또는 JDBC, Flyway |
| 비동기 · 실시간 | Kafka, WebSocket/STOMP, Redis Pub/Sub, ShedLock |
| 테스트 · 검사 | JUnit 5, Testcontainers, Checkstyle, SpotBugs, JaCoCo |
| 운영 | Docker Compose, GitHub Actions, Prometheus/Grafana/Loki, Datadog |

## 5. 로컬에서 시작하기

내부 Data API를 먼저 실행하는 예시입니다. 앱의 공개 API를 쓰려면 Business와 서비스 간 인증 설정도 필요합니다. **저장소 루트 기준**입니다.

```bash
docker compose -f server/scripts/docker-compose.local.yml up -d db
cd server/data-api
# 최초 설정 시에만 복사합니다. 기존 로컬 설정이 있으면 유지합니다.
test -f src/main/resources/application-local.yml || cp src/main/resources/application-local.yml.example src/main/resources/application-local.yml
./gradlew bootRun --args='--spring.profiles.active=local'
```

Data 주소는 `http://localhost:8080`, Swagger UI는 `http://localhost:8080/swagger-ui/index.html`입니다. Business도 기본 포트가 8080이므로 호스트에서 함께 실행할 때는 포트를 구분합니다([Business 단독 Compose](business-api/compose.yml)는 8082에 바인딩). Realtime은 별도 DB·Redis, 각 서비스는 내부 인증 토큰과 환경변수가 필요합니다. 각 README의 실행 절차를 이어서 확인합니다.

## 6. 검증 · 배포

운영 V2는 앱·Kafka·Redis·백오피스를 네 EC2 호스트로 나눕니다. 서버·Kafka·Redis는 release 발행 뒤 수동 CD, 백오피스는 main 머지 뒤 별도 승인·배포입니다. 현재 배치와 복구 절차는 [prod V2 파이프라인](../docs/engineering/prod-v2-pipeline.md)을 따릅니다.

서비스 폴더에서 `./gradlew build`로 테스트·정적 검사·패키징을 수행합니다. 통합 테스트에는 실행 중인 Docker가 필요합니다.

- Data API: [dev CI](../.github/workflows/data-api-ci.dev-v2.yml). 운영 발행·배포는 [prod V2 파이프라인](../docs/engineering/prod-v2-pipeline.md)을 따릅니다.
- Realtime: [독립 CI](../.github/workflows/realtime-ci.dev-v2.yml).
- Business·Notification: [위성 서비스 CI](../.github/workflows/satellite-check.yml).
- 배포·이관: [Scripts 실행 안내](scripts/README.md).
- 배포 후 스모크: [전체 실행 흐름](../smoke/README.md#전체-실행-흐름) · [로그인 재시도 AS IS / TO BE](../smoke/server/login-retry.md) · [TC 명세](../smoke/server/TCL.md).

---

문서 구성은 [EDGE README](https://github.com/alphaeveryday/edge)의 소개·구성도·구현 결과·운영 설명 흐름을 참고했습니다. 서비스 역할과 구현 상태는 이 저장소의 코드·설정·설계 문서를 기준으로 작성했습니다.
