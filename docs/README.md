# 문서 인덱스

팀원이 함께 보는 제품·기술 문서의 인덱스다. git으로 추적·공유되며, 개인 작업 메모는
여기 두지 않는다(개인 스크래치는 gitignored `doc/`).

## 무엇을 찾고 있나요?

| 질문 | 시작할 문서 |
| --- | --- |
| 제품과 저장소를 빠르게 훑고 싶다 | [루트 README](../README.md) |
| 제품 용어를 확인하고 싶다 | [용어집 CONTEXT.md](../CONTEXT.md) |
| 바꾼 경로가 PR·머지 뒤·운영에서 무엇을 부르는지 알고 싶다 | [파이프라인 지도](engineering/pipeline-map.md) |
| 서버 구성과 현재 데이터 흐름을 알고 싶다 | [서버 README](../server/README.md) |
| 특정 서버를 실행하거나 구현을 찾고 싶다 | [Business](../server/business-api/README.md) · [Data](../server/data-api/README.md) · [Notification](../server/notification/README.md) · [Realtime](../server/realtime/README.md) |
| 활성 2.0 앱을 실행하거나 구조를 알고 싶다 | [Cattus 2.0 앱 README](../app/app-dev/README.md) |
| 동결된 1.x 앱을 확인하고 싶다 | [Gromo 1.x 앱 README](../app/legacy/app-dev/README.md) |
| 백오피스를 실행하거나 배포 경로를 알고 싶다 | [백오피스 README](../backoffice/README.md) |
| 목표 아키텍처와 결정 근거를 알고 싶다 | [아키텍처 인덱스](architecture/README.md) · [결정 장부](architecture/decisions.md) |
| 기능별 요구사항·정책·API 설계를 찾고 싶다 | [`prd/`](prd/) |
| 팀 공통 규약을 확인하고 싶다 | [`conventions/`](conventions/) |
| 부하 테스트를 실행하거나 결과를 해석하고 싶다 | [부하 테스트 README](../loadtest/README.md) |
| 큰 API JSON 응답의 gzip 적용 근거와 확인된 성과를 알고 싶다 | [Business API 응답 압축 분석](engineering/api-response-compression.md) |

## 구조

`docs/prd/` 아래에서 제품을 먼저 나누고, 각 제품 폴더 안에 기능 단위 기획·설계 문서를 둔다:

```
docs/
├── README.md                          # 이 파일
├── architecture/                      # 목표 아키텍처 정본 (서비스·시스템·결정 장부·다이어그램)
├── contracts/                         # 서비스 사이 API·이벤트 계약
├── conventions/                       # 팀 전체 규약
│   ├── git-pr-conventions.md          # 브랜치·커밋·PR 제목/본문·담당자·라벨·리뷰·머지
│   ├── jira-conventions.md            # 지라 4축 분류 (도메인·Label·Epic·fixVersion) + 필드 id
│   ├── jira-ticket-template.md        # 지라 티켓 본문 양식 + 생성 게이트
│   ├── date-axis.md                   # 날짜 축(로컬·KST·UTC) 규약
│   ├── error-contract.md              # API 에러 응답 계약
│   ├── backend-layering.md            # 백엔드 레이어링 규약
│   ├── outbox-events.md               # 도메인이 outbox 로 명령·사건을 발신하는 규약
│   ├── server-ci.md                   # 서버 CI 검사와 이미지 입력(dev ci-jar · 운영 발행 분리)
│   ├── android-ci-cd.md               # Android CI 와 Play 내부 테스트 CD
│   ├── ios-testflight-dev-runner.md   # iOS dev TestFlight 자동 빌드 러너 등록
│   └── release-protection.md          # release 브랜치 보호 정책
├── engineering/                       # 저장소 운영·개발 생산성 조사와 검증 기록
├── qa/                                # 공유 QA 시나리오와 결과
├── app-imgs/                          # 앱 화면·카피·디자인 참고 자료
└── prd/
    ├── README.md                      # 제품 세대 구분과 분류 원칙
    ├── gromo/                         # 동결된 Gromo 1.x 기능과 호환 근거
    │   └── <기능-이름>/
    └── fishcat/                       # 활성 Cattus 2.0 기능과 전환 계약
        ├── decision-log.md            # 제품 결정 로그 — 결정은 여기 먼저, 도메인 policy.md 로 전파 (어긋나면 이 로그가 맞다)
        └── <기능-이름>/
            ├── prd.md                 # PRD — 문제 정의·목표·요구사항
            ├── policy.md              # 정책 정본 — 결정 로그·근거 (prd와 어긋나면 policy가 맞다)
            ├── information-architecture.md # IA — 화면 구조·네비게이션·정보 구조
            ├── high-level-design.md   # HLD — 시스템 구성·컴포넌트 간 흐름·API 개요
            ├── low-level-design.md    # LLD — 상세 설계 (스키마·엔드포인트 명세·시퀀스)
            ├── ux.html                # UX 시안 (있으면)
            └── diagrams/              # 다이어그램 (형식 자유)
```

시스템 전체를 가로지르는 **목표 아키텍처**(서비스·시스템·결정 장부)는 `docs/architecture/` 에 둔다 — 새 서비스·통신 경로·저장소를 추가하기 전에 먼저 본다. 기능 문서가 아닌 **팀 전체 규약**은 `docs/conventions/` 에 둔다 — 위 트리의 열한 개.
Git·PR 은 `git-pr-conventions.md`, 지라는 `jira-conventions.md`(분류) + `jira-ticket-template.md`(본문 양식·게이트)가 정본이다.

- 새 기능은 적용 제품에 따라 `prd/gromo/` 또는 `prd/fishcat/` 아래에 만든다. 분류 기준과 전체 목록은 [`prd/README.md`](prd/README.md)가 정본이다.
- 기능 폴더 이름은 **kebab-case 영문** (예: `island-quests`, `focus-rest-session`, `link-attribution`).
- 문서가 다 갖춰질 필요는 없다 — 있는 것부터 커밋하고 점진적으로 채운다.
- 문서는 한국어로 쓴다 (프로젝트 언어 컨벤션).

## 문서별 역할

| 문서 | 답하는 질문 |
| --- | --- |
| `prd.md` | 왜 만드는가? 무엇을 만드는가? (to-be 요구사항) |
| `policy.md` | 정책의 근거와 결정 로그 — 정책 충돌 시 **이 문서가 정본** |
| `fishcat/decision-log.md` | 제품 결정을 언제·누가·어떤 근거로 했나 — 결정은 여기 먼저 적고 도메인 `policy.md` 로 전파한다. 둘이 어긋나면 **이 로그가 맞다** |
| `information-architecture.md` | 사용자가 어디서 어떻게 진입·이동하는가? 화면·정보 구조는? |
| `high-level-design.md` | 어떤 컴포넌트(앱·서버·DB·외부)가 어떻게 협력하는가? |
| `low-level-design.md` | 정확히 어떤 테이블·API·로직으로 구현하는가? |

## 브랜치

문서를 추가·수정할 때는 `doc/` 프리픽스 브랜치를 쓴다 (전체 규칙은 `conventions/git-pr-conventions.md`):

- 신규 문서: `doc/prd-<기능이름>` (예: `doc/prd-island-quests`)
- 기존 문서 수정: `doc/fix-prd-<기능이름>` (예: `doc/fix-prd-island-quests`)
- PR 제목은 `[CHORE] GROMO-#### 요약`, 라벨 `documentation`

## 엔지니어링 개선 기록

- [2026-09-23 dev 배포 장애 및 복구 기록](engineering/dev-deployment-incident-2026-09-23.md) — 실행 이력, 장애 원인, 복구 절차와 최종 검증.
- [AWS 운영 부하 실측과 시험 데이터 정리](engineering/aws-loadtest/2026-10-29/README.md) — 채팅·홈·집중 지연, 중단 조건, 수용량 판단 한계와 잔존 검증.
- [CI 중복 빌드·캐시·실행 범위 개선](engineering/ci-build-reuse/README.md) — 원인 분석, 검증 로그, 전후 측정과 성과 서술 근거.
- [파이프라인 지도](engineering/pipeline-map.md) — 바꾼 경로별 PR 검사·머지 뒤·운영까지, 워크플로·환경·버전 축의 정본.
- [PR 대상에 따른 서버 CI 정책](engineering/pr-ci-policy.md) — 피처 간 수동 기능 검사, main 통합 검증, release 승격과 발행 경계.
- [dev V2 파이프라인](engineering/dev-v2-pipeline.md) — GCP VM 3대 구성, Auto CD 판정, 수동 작업, 실패 복구, 남은 일.
- [prod V2 파이프라인](engineering/prod-v2-pipeline.md) — EC2 4대 구성, 단위별 발행·배포, 복구, Kafka 사양 판단.
- [레거시 `/api/v1` 폐기 계획](engineering/legacy-v1-retirement/README.md) — 1.x 표면 폐기 실행 문서(결정 A24 후속).
- 백오피스: [독립 릴리스](engineering/backoffice-independent-release.md)(V1 태그 방식 기록) · [서버 기능의 선별 운영 승격](engineering/backoffice-selective-release.md) · [건설 비용·공사 시간 관리](engineering/backoffice-construction-policy.md) · [운영 배포 현황 2026-10-29](engineering/backoffice-prod-deployment-readiness-2026-10-29.md).
- dev 공개 경로: [dev 2.0 공개 라우팅 전환](engineering/dev-2.0-public-cutover.md) · [dev Business API 공개 경로 장애 기록](engineering/dev-business-ingress.md).
- 앱 성능: [최적화 전후(시뮬레이터)](engineering/app-performance/measurements.md) · [iPhone 15 실기기 측정 2026-11](engineering/app-performance/device-iphone15-2026-11.md) — 홈 움직임·집중·AI집중측정의 CPU·프레임, 집중 화면 테두리 그리기 개선 전후.
- [README 정보구조 개선 조사](engineering/readme-information-architecture/research.md) — 루트·영역·상세 문서 분리, 접힌 섹션, 문서 사이트 도입 기준.

## 신규 설계

- [고양이 일기](prd/fishcat/cat-diary/README.md) — LLM 주간 회고. 요구사항·정책·프롬프트·가드레일·평가·비용 문서와 서버·평가기가 함께 읽는 계약 파일(`spec/`). P0 명세 단계(GROMO-2860).
- [이미지 CDN·기기 캐시](prd/fishcat/image-cdn/README.md) — PRD·수명 정책·HLD·LLD·Jira 실행 계획. dev CDN 은 있고(`image-assets` 수동 발행), 운영 CDN 은 없다([파이프라인 지도](engineering/pipeline-map.md)).
