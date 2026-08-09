# docs/ — 팀 공유 기능 문서

팀원이 함께 보는 **기능별 문서 공간**이다. git으로 추적·공유되며, 개인 작업 메모는
여기 두지 않는다 (개인 스크래치는 gitignored `.docs/`).

## 구조

기능(피처) 단위로 폴더를 만들고, 그 안에 문서 4종을 둔다:

```
docs/
├── README.md                      # 이 파일
└── <기능-이름>/                    # 예: focus-session, league, group
    ├── prd.md                     # PRD — 문제 정의·목표·요구사항·정책
    ├── ia.md                      # IA — 화면 구조·네비게이션·정보 구조
    ├── high-level-design.md       # HLD — 시스템 구성·컴포넌트 간 흐름·API 개요
    └── low-level-design.md        # LLD — 상세 설계 (스키마·엔드포인트 명세·시퀀스)
```

- 폴더 이름은 **kebab-case 영문** (예: `focus-session`, `invite-link`).
- 4종이 다 갖춰질 필요는 없다 — 있는 것부터 커밋하고 점진적으로 채운다.
- 문서는 한국어로 쓴다 (프로젝트 언어 컨벤션).

## 문서별 역할

| 문서 | 답하는 질문 |
| --- | --- |
| `prd.md` | 왜 만드는가? 무엇을 만드는가? 정책·엣지케이스는? |
| `ia.md` | 사용자가 어디서 어떻게 진입·이동하는가? 화면·정보 구조는? |
| `high-level-design.md` | 어떤 컴포넌트(앱·서버·DB·외부)가 어떻게 협력하는가? |
| `low-level-design.md` | 정확히 어떤 테이블·API·로직으로 구현하는가? |

## 컨벤션

- 다이어그램은 **Mermaid** (구조는 flowchart, 흐름은 sequenceDiagram).
- DB 스키마의 정본은 `back/docs/db/schema.dbml` — LLD에는 해당 기능의 델타만 적고
  정본 링크로 대신한다.
- 문서 갱신은 코드 PR과 같은 브랜치에 담아도 되고, `doc/` 브랜치로 분리해도 된다.
