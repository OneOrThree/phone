# README 정보구조 개선 조사

조사일: 2026-09-15

대상 브랜치: `doc/GROMO-1740-readme-overhaul`
범위: 루트 README, 서버 문서 계층, 접힌 섹션, 문서 사이트 도입 기준

## 결론

현재는 문서 사이트를 먼저 도입하기보다 **루트 README를 짧은 랜딩·인덱스로 줄이고,
상세 내용을 기존 `docs/`와 영역별 README로 이동**하는 것이 적절하다. GitHub도 README를
프로젝트의 용도, 가치, 시작 방법, 도움받는 곳처럼 방문자가 처음 알아야 할 내용에
사용하고, 긴 문서는 분리하라고 안내한다. 저장소 안의 상세 문서는 상대 링크로 연결할
것을 권장한다. [GitHub — About the repository README file](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)

추천하는 읽기 경로는 세 단계다.

```text
README.md                         프로젝트 소개 · 5분 시작 · 전체 문서 지도
├── server/README.md              서버 구성 · 서비스 선택 인덱스
│   └── server/<service>/README.md  서비스 역할 · 실행 · 코드 탐색
└── docs/                         아키텍처 · 규약 · 운영 · 상세 설명의 정본
```

`<details>`는 파일을 나누는 대신 쓰지 않는다. 모든 독자에게 필요하지 않은 옵션,
긴 예시, 보조 다이어그램처럼 **같은 문맥의 선택적 보충 설명**에만 쓴다. 문서 링크,
필수 실행 순서, 핵심 아키텍처는 펼쳐진 상태로 둔다.

## 현재 문서의 문제

로컬 파일을 기준으로 확인한 규모는 다음과 같다.

| 문서 | 줄 수 | 판단 |
| --- | ---: | --- |
| `README.md` | 685 | 제품 소개부터 배포·Git 규칙까지 한 파일에 섞여 있다. |
| `server/README.md` | 105 | 영역 인덱스로 쓰기에 적당한 규모다. |
| `server/business-api/README.md` | 963 | 서비스 README 자체가 다시 상세 문서로 분리되어야 한다. |
| 나머지 서비스 README 5개 | 104~122 | 서비스별 진입 문서로 유지할 수 있다. |

루트 README의 제목 구조에는 서버 구현 상세, 앱 실행, 로그인, 명령어, 기술 스택,
CI/CD, Git 규칙, 문서 지도가 모두 같은 깊이에 있다. 독자는 첫 방문, 로컬 실행,
아키텍처 이해, 작업 규칙 확인이라는 서로 다른 목적을 한 파일에서 해결해야 한다.
GitHub가 Markdown 제목으로 자동 목차와 섹션 링크를 제공하더라도 이는 한 파일 안의
이동만 개선한다. [GitHub — README의 자동 목차와 섹션 링크](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#auto-generated-table-of-contents-for-markdown-files)

GitHub 공식 문서는 README가 개발자가 프로젝트 사용과 기여를 시작하는 데 필요한
정보만 담아야 한다고 명시한다. 저장소 안의 다른 파일에는 상대 링크를 쓰면 현재 보고
있는 브랜치에 맞게 GitHub가 링크를 변환하므로, 문서를 나눠도 PR 프리뷰와 브랜치별
탐색이 유지된다. [GitHub — Relative links and image paths](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#relative-links-and-image-paths-in-markdown-files)

공식 프로젝트도 README를 상세 문서의 복사본보다 입구로 사용한다.

- `github/docs`의 README는 38줄이며 기여자 유형별 빠른 링크와 저장소의 역할을 설명한
  뒤 상세 기여 문서로 연결한다. [github/docs 원본 README](https://github.com/github/docs/blob/main/README.md)
- MkDocs의 README는 79줄이며 제품 설명, 기능 요약, 지원 경로를 보여주고 전체 사용법은
  공식 문서로 보낸다. [mkdocs/mkdocs 원본 README](https://github.com/mkdocs/mkdocs/blob/master/README.md)
- Docusaurus의 README는 123줄이며 소개와 가장 짧은 설치법을 제공하고 튜토리얼,
  설정, 기여 안내는 각각 별도 문서로 연결한다. [facebook/docusaurus 원본 README](https://github.com/facebook/docusaurus/blob/main/README.md)

줄 수 자체가 목표는 아니다. 세 사례가 공통으로 보여주는 원칙은 README에서 독자의
목적지를 고르게 하고, 선택한 목적의 전체 설명은 별도 문서가 맡게 하는 것이다.

## 권장 정보구조

### 1. 루트 README: 저장소의 랜딩 페이지

루트에는 다음만 남기는 것을 권장한다.

1. 제품이 무엇인지 설명하는 한 문단과 대표 이미지
2. 앱, 서버, 데이터 저장소의 관계를 보여주는 전체 구성도 한 개
3. 앱 또는 서버를 처음 실행하는 가장 짧은 경로
4. 독자 목적별 문서 인덱스
5. 기여·문의 진입 링크

문서 인덱스는 디렉터리 목록이 아니라 독자가 답을 찾는 질문으로 구성한다.

| 찾는 내용 | 바로 갈 문서 |
| --- | --- |
| 서버 전체 구조와 서비스 선택 | `server/README.md` |
| Business API | `server/business-api/README.md` |
| Data API | `server/data-api/README.md` |
| Notification | `server/notification/README.md` |
| Realtime | `server/realtime/README.md` |
| 관측 환경 | `server/observability/README.md` |
| 실행·배포 도구 | `server/scripts/README.md` |
| 목표 아키텍처와 결정 근거 | `docs/architecture/README.md` |
| 개발 규약 | `docs/conventions/` |
| 기능별 기획·설계 | `docs/prd/` |

루트에서 서비스별 README에 직접 연결하되, 서버 전체를 처음 보는 사람의 기본 경로는
`server/README.md`로 둔다. 이렇게 하면 특정 서비스로 바로 갈 수도 있고, 구조를 모르는
독자는 서버 인덱스에서 설명을 읽고 선택할 수도 있다.

### 2. `server/README.md`: 서버 문서 인덱스

현재 105줄짜리 서버 README는 다음 역할을 유지하면 된다.

- 현재 서비스 구성과 목표 구조의 구분
- 서비스마다 한 문장으로 설명한 링크 표
- 서버 공통 로컬 실행의 최소 절차
- 공통 아키텍처·배포·관측 문서 링크

서비스 내부 구현, 엔드포인트 목록, 장애 복구 절차는 각 서비스 README 또는 그 아래
`docs/`가 맡는다. 같은 설명을 루트, 서버, 서비스 README에 복사하지 않고, 각 사실의
정본 한 곳으로 링크한다.

### 3. 서비스 README: 서비스의 랜딩 페이지

서비스 README는 다음 질문에 빠르게 답한다.

1. 이 서비스가 무엇을 소유하는가?
2. 누가 이 서비스를 호출하고, 이 서비스는 누구를 호출하는가?
3. 로컬에서 어떻게 실행·검증하는가?
4. 코드는 어디서부터 읽는가?
5. 상세 설계와 운영 문서는 어디에 있는가?

`server/business-api/README.md`는 현재 963줄이므로 아래처럼 나누는 것이 자연스럽다.
파일명은 실제 편집 시 해당 문서가 소유할 정본 범위를 확인한 뒤 확정한다.

```text
server/business-api/
├── README.md                         역할 · 빠른 실행 · 상세 문서 인덱스
└── docs/
    ├── request-envelope.md           JSON 봉투 · 키 · 버전 · 멱등
    ├── aggregation-and-failures.md   제한 시간 조합 · 실패 분류 · 재시도
    ├── file-preview.md               파일 미리보기 계약 · 캐시 · 복구
    ├── notification-settings.md      알림 설정 이관 · 동시성
    └── session-commands.md           로그아웃 · 방장 위임 명령
```

### 4. `docs/`: 저장소를 가로지르는 정본

이 저장소는 이미 `docs/README.md`에서 공유 기능 문서, 아키텍처, 팀 규약을 `docs/`에
둔다고 정의한다. 따라서 새 최상위 문서 체계를 또 만들기보다 기존 분류를 유지한다.

- 여러 서비스에 공통인 현재·목표 구조: `docs/architecture/`
- 개발자 전체가 따라야 하는 규칙: `docs/conventions/`
- 특정 기능의 요구사항과 설계: `docs/prd/<feature>/`
- 저장소 운영이나 개발 생산성 조사: `docs/engineering/<topic>/`
- 한 서비스에만 해당하는 구현·운영 상세: `server/<service>/docs/`

## `<details>/<summary>` 사용 기준

GitHub는 `<details>`와 `<summary>`를 공식 지원한다. 내부에는 제목, 텍스트, 이미지,
코드 블록을 넣을 수 있고, 기본 상태는 닫힘이며 `<details open>`으로 처음부터 열 수
있다. GitHub가 제시하는 용도는 모든 독자에게 관련되지는 않는 기술 세부 정보다.
[GitHub — Organizing information with collapsed sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)

````md
<details>
<summary>선택 환경변수와 추가 실행 옵션</summary>

### Kafka까지 함께 실행할 때

```sh
docker compose up kafka
```

</details>
````

### 적합한 내용

- 선택 환경변수와 드문 실행 옵션
- 긴 로그·응답·설정 예시
- 주 흐름을 이해하는 데 필요 없는 보조 다이어그램
- 드문 장애의 문제 해결 절차

### 접지 않을 내용

- 문서 인덱스와 서비스 직접 링크
- 필수 설치·실행·검증 순서
- 현재 구조와 목표 구조의 차이
- 보안·데이터 소유권·호출 경계처럼 잘못 이해하면 구현이 달라지는 계약

이 구분은 GitHub의 동작에서 직접 나온다. 접힌 내용은 독자가 클릭하기 전까지
숨겨지므로, 핵심 탐색 경로를 접으면 파일 길이는 줄어도 발견성이 낮아진다.
[GitHub — 접힌 섹션의 기본 동작](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections#creating-a-collapsed-section)

`<details>`는 HTML의 disclosure widget이며 `summary`가 그 설명 레이블이다. 탭이나
메뉴 같은 다른 탐색 UI를 대신하는 용도로 쓰는 것은 HTML 표준에 맞지 않는다.
[WHATWG HTML — The details element](https://html.spec.whatwg.org/dev/interactive-elements.html#the-details-element)
표준의 콘텐츠 모델은 `summary` 하나가 먼저 오고 그 뒤에 상세 내용이 오는 형태이며,
두 태그의 닫는 태그도 생략할 수 없다. 여러 항목을 배타적으로 여닫는 아코디언은 많은
항목을 확인하거나 둘 이상을 비교하는 독자를 답답하게 할 수 있다고 표준이 직접
주의시킨다. 따라서 긴 README 전체를 접힘 목록으로 바꾸는 방식은 피한다.

GitHub Flavored Markdown은 raw HTML을 처리하지만 GitHub.com은 변환 후 별도 정제를
수행한다. GitHub의 렌더링 파이프라인은 `script`, 인라인 스타일, `class`, `id` 같은
요소를 제거한다고 설명한다. 따라서 접힘의 모양을 저장소 README에서 직접 디자인하는
방식에는 의존하지 않는다. [GFM 공식 명세](https://github.github.com/gfm/#raw-html),
[github/markup 렌더링 설명](https://github.com/github/markup#github-markup)

## 문서 사이트는 언제 도입할까

GitHub Pages와 MkDocs·Docusaurus는 같은 층의 대안이 아니다. GitHub Pages는 정적 파일을
게시하는 **호스팅 서비스**이고, MkDocs와 Docusaurus는 Markdown을 정적 사이트로 만드는
**생성기**다. GitHub Pages는 저장소의 HTML·CSS·JavaScript를 직접 게시하거나 빌드
과정을 거쳐 게시한다. [GitHub — What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| 선택 | 쓰기 좋은 시점 | 얻는 것 | 추가 비용 |
| --- | --- | --- | --- |
| GitHub Markdown만 유지 | 독자가 주로 개발자이고 PR 안에서 문서를 함께 검토할 때 | 빌드·배포 없이 브랜치별 문서 확인 | 사이트 전체 검색과 고정 내비게이션 없음 |
| MkDocs + GitHub Pages | 문서가 여러 계층으로 늘어 전역 메뉴·검색·이전/다음 이동이 필요할 때 | YAML `nav`, 기본 검색, 로컬 자동 새로고침 프리뷰, 정적 배포 | Python 도구와 사이트 빌드 CI 관리 |
| Docusaurus + GitHub Pages | 외부 제품 문서에 버전·다국어·검색·SEO·커스텀 인터랙션이 필요할 때 | React/MDX, 버전 관리, i18n, 검색, 테마 확장 | Node 빌드와 프런트엔드 설정·업그레이드 관리 |

MkDocs는 문서 원본 디렉터리의 기본값이 `docs/`이고, `nav`로 페이지 순서와 중첩을
정한다. 개발 서버는 변경 시 자동으로 다시 빌드하며, 기본 UI에 전역 검색과 이전·다음
이동이 포함된다. [MkDocs — Getting Started](https://www.mkdocs.org/getting-started/)
정적 결과물은 GitHub Pages에 배포할 수 있지만, 공식 문서도 배포 전에 `build` 또는
`serve`로 결과를 확인하라고 권한다. [MkDocs — Deploying Your Docs](https://www.mkdocs.org/user-guide/deploying-your-docs/)

Docusaurus는 React와 MDX 기반의 정적 문서 사이트 생성기이며 검색, 문서 버전 관리,
다국어, 테마 커스터마이징을 주요 기능으로 제공한다. 공식 비교에서도 React나 SPA가
필요하지 않다면 MkDocs가 좋은 선택이라고 설명한다.
[Docusaurus — Introduction and features](https://docusaurus.io/docs#features),
[Docusaurus — Comparison with other tools](https://docusaurus.io/docs#mkdocs)
Docusaurus가 만든 정적 파일도 GitHub Pages, Vercel, Netlify 등에 게시할 수 있다.
[Docusaurus — Deployment](https://docusaurus.io/docs/deployment)

GitHub Pages를 도입할 때는 게시 범위를 별도로 검토해야 한다. GitHub 공식 문서는 요금제와
조직 설정에 따라 private 저장소에서 만든 Pages 사이트도 인터넷에 공개될 수 있다고
경고한다. 또한 Pages는 PHP·Ruby·Python 같은 서버 측 언어를 실행하지 않는다.
[GitHub — Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 이 저장소에 대한 단계별 제안

### 지금: Markdown 정보구조부터 정리

1. 루트 README를 소개, 전체 구성도, 최소 실행, 문서 인덱스로 줄인다.
2. 루트의 서버 섹션에 `server/README.md`와 서비스별 README 직접 링크를 함께 둔다.
3. 아키텍처·Git 규칙·배포 등 상세 설명은 기존 정본으로 이동하고 루트에는 요약과 링크만
   남긴다.
4. `server/business-api/README.md`를 랜딩 페이지와 주제별 상세 문서로 분리한다.
5. `<details>`는 선택 예시와 긴 출력에만 적용한다.

이 단계만으로 현재의 읽기 문제를 해결할 수 있고, Markdown 원본을 이후 MkDocs나
Docusaurus의 입력으로도 재사용할 수 있다.

### 다음: 필요가 관찰되면 MkDocs를 시험

다음 조건이 반복될 때 `docs/`를 입력으로 하는 MkDocs 프리뷰를 작은 범위에서 시험한다.
아래 조건은 도구의 공식 제한이 아니라 이 저장소의 도입 판단 기준이다.

- 독자가 어느 파일에 답이 있는지 몰라 저장소 전체 검색을 자주 사용한다.
- `docs/README.md`의 수동 인덱스와 실제 파일 구성이 반복해서 어긋난다.
- 비개발자에게 GitHub 파일 화면보다 읽기 쉬운 고정 URL을 제공해야 한다.
- 문서 변경 PR에서 완성된 사이트의 내비게이션과 레이아웃을 검토해야 한다.

GitHub Pages는 이때 MkDocs 결과물을 게시하는 배포 대상으로 붙인다. Pages 자체를 먼저
도입해도 정보구조나 검색이 자동으로 생기지는 않는다.

### 이후: 제품 문서 요구가 생기면 Docusaurus 검토

서로 다른 출시 버전의 문서를 동시에 유지하거나, 다국어 문서·React 컴포넌트·제품
랜딩과 블로그가 실제 요구사항이 될 때 Docusaurus를 검토한다. Docusaurus 공식 문서도
버전 관리가 많은 트래픽을 받고 버전 사이 문서가 빠르게 변하는 사이트에 가장 알맞다고
설명하며, 대부분의 경우 최신 문서만 유지하는 것이 더 낫다고 안내한다.
[Docusaurus — Versioning](https://docusaurus.io/docs/versioning)

## 최종 선택

이 저장소에는 다음 순서가 비용과 효과의 균형이 가장 좋다.

```text
README 분리와 인덱스 정비
    → 선택 내용만 <details>로 접기
    → 전역 검색·고정 내비게이션 수요가 확인되면 MkDocs 프리뷰
    → 외부 제품 문서의 버전·다국어·MDX 수요가 생기면 Docusaurus
```

당장의 목표는 “한 파일을 접어서 짧아 보이게 만들기”가 아니라, 독자가 첫 화면에서
자신의 목적에 맞는 다음 문서를 고를 수 있게 만드는 것이다.
