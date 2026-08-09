# docs/ — 팀 공유 기능 문서

팀원이 함께 보는 **기능별 문서 공간**이다. git으로 추적·공유되며, 개인 작업 메모는
여기 두지 않는다 (개인 스크래치는 gitignored `.docs/`).

## 구조

`docs/prd/` 아래에 기능(피처) 단위 폴더를 만들고, 그 안에 기획·설계 문서를 둔다:

```
docs/
├── README.md                          # 이 파일
└── prd/
    └── <기능-이름>/                    # 예: challenge, focus-session
        ├── prd.md                     # PRD — 문제 정의·목표·요구사항
        ├── policy.md                  # 정책 정본 — 결정 로그·근거 (prd와 어긋나면 policy가 맞다)
        ├── information-architecture.md # IA — 화면 구조·네비게이션·정보 구조
        ├── high-level-design.md       # HLD — 시스템 구성·컴포넌트 간 흐름·API 개요
        ├── low-level-design.md        # LLD — 상세 설계 (스키마·엔드포인트 명세·시퀀스)
        ├── ux.html                    # UX 시안 (있으면)
        └── diagrams/                  # 다이어그램 (형식 자유)
```

- 폴더 이름은 **kebab-case 영문** (예: `challenge`, `focus-session`, `invite-link`).
- 문서가 다 갖춰질 필요는 없다 — 있는 것부터 커밋하고 점진적으로 채운다.
- 문서는 한국어로 쓴다 (프로젝트 언어 컨벤션).

## 문서별 역할

| 문서 | 답하는 질문 |
| --- | --- |
| `prd.md` | 왜 만드는가? 무엇을 만드는가? (to-be 요구사항) |
| `policy.md` | 정책의 근거와 결정 로그 — 정책 충돌 시 **이 문서가 정본** |
| `information-architecture.md` | 사용자가 어디서 어떻게 진입·이동하는가? 화면·정보 구조는? |
| `high-level-design.md` | 어떤 컴포넌트(앱·서버·DB·외부)가 어떻게 협력하는가? |
| `low-level-design.md` | 정확히 어떤 테이블·API·로직으로 구현하는가? |

## 브랜치

문서를 추가·수정할 때는 `doc/` 프리픽스 브랜치를 쓴다:

- 신규 문서: `doc/prd-<기능이름>` (예: `doc/prd-challenge`)
- 기존 문서 수정: `doc/fix-prd-<기능이름>` (예: `doc/fix-prd-challenge`)
