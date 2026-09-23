# 문서 인덱스

팀원이 함께 보는 제품·기술 문서의 인덱스다. git으로 추적·공유되며, 개인 작업 메모는
여기 두지 않는다(개인 스크래치는 gitignored `doc/`).

## 무엇을 찾고 있나요?

| 질문 | 시작할 문서 |
| --- | --- |
| 제품과 저장소를 빠르게 훑고 싶다 | [루트 README](../README.md) |
| 서버 구성과 현재 데이터 흐름을 알고 싶다 | [서버 README](../server/README.md) |
| 특정 서버를 실행하거나 구현을 찾고 싶다 | [Business](../server/business-api/README.md) · [Data](../server/data-api/README.md) · [Notification](../server/notification/README.md) · [Realtime](../server/realtime/README.md) |
| 활성 2.0 앱을 실행하거나 구조를 알고 싶다 | [Fishcat 앱 README](../app/app-dev/README.md) |
| 동결된 1.x 앱을 확인하고 싶다 | [GROMO 앱 README](../app/legacy/app-dev/README.md) |
| 목표 아키텍처와 결정 근거를 알고 싶다 | [아키텍처 인덱스](architecture/README.md) · [결정 장부](architecture/decisions.md) |
| 기능별 요구사항·정책·API 설계를 찾고 싶다 | [`prd/`](prd/) |
| 팀 공통 규약을 확인하고 싶다 | [`conventions/`](conventions/) |
| 부하 테스트를 실행하거나 결과를 해석하고 싶다 | [부하 테스트 README](../loadtest/README.md) |

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
│   └── backend-layering.md            # 백엔드 레이어링 규약
├── engineering/                       # 저장소 운영·개발 생산성 조사와 검증 기록
├── qa/                                # 공유 QA 시나리오와 결과
├── app-imgs/                          # 앱 화면·카피·디자인 참고 자료
└── prd/
    ├── README.md                      # 제품 세대 구분과 분류 원칙
    ├── gromo/                         # 동결된 GROMO 1.x 기능과 호환 근거
    │   └── <기능-이름>/
    └── fishcat/                       # 활성 Fishcat 2.0 기능과 전환 계약
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

시스템 전체를 가로지르는 **목표 아키텍처**(서비스·시스템·결정 장부)는 `docs/architecture/` 에 둔다 — 새 서비스·통신 경로·저장소를 추가하기 전에 먼저 본다. 기능 문서가 아닌 **팀 전체 규약**은 `docs/conventions/` 에 둔다 — 위 트리의 여섯 개.
Git·PR 은 `git-pr-conventions.md`, 지라는 `jira-conventions.md`(분류) + `jira-ticket-template.md`(본문 양식·게이트)가 정본이다.

- 새 기능은 적용 제품에 따라 `prd/gromo/` 또는 `prd/fishcat/` 아래에 만든다. 분류 기준과 전체 목록은 [`prd/README.md`](prd/README.md)가 정본이다.
- 기능 폴더 이름은 **kebab-case 영문** (예: `challenge`, `focus-rest-session`, `invite-link`).
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

- 신규 문서: `doc/prd-<기능이름>` (예: `doc/prd-challenge`)
- 기존 문서 수정: `doc/fix-prd-<기능이름>` (예: `doc/fix-prd-challenge`)
- PR 제목은 `[CHORE] GROMO-#### 요약`, 라벨 `documentation`

## 엔지니어링 개선 기록

- [2026-09-23 dev 배포 장애 및 복구 기록](engineering/dev-deployment-incident-2026-09-23.md) — 실행 이력, 장애 원인, 복구 절차와 최종 검증.
- [CI 중복 빌드·캐시·실행 범위 개선](engineering/ci-build-reuse/README.md) — 원인 분석, 검증 로그, 전후 측정과 성과 서술 근거.
- [README 정보구조 개선 조사](engineering/readme-information-architecture/research.md) — 루트·영역·상세 문서 분리, 접힌 섹션, 문서 사이트 도입 기준.
