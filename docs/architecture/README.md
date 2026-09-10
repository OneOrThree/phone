# 목표 아키텍처 (서비스 · 시스템)

서버 분리 라운드가 끝났을 때(Target-1)와 그 다음(Target-2)의 정본. 새 서비스·새 통신 경로·새 저장소를 추가하기 전에 이 폴더의 규칙과 어긋나지 않는지 먼저 본다.

| 문서 | 답하는 질문 |
|---|---|
| [`service-architecture.md`](service-architecture.md) | 어떤 프로세스가 무엇을 소유하고 누구를 부르나 — 단방향 규칙 · 통신 방식 · 인증 경계 · 배치의 자리 |
| [`system-architecture.md`](system-architecture.md) | 어디에 떠 있고 어떻게 배포·관측하나 — 환경 실측 · 노출면 · DB · CI/CD · Target-2 진입 조건 |
| [`decisions.md`](decisions.md) | 왜 그렇게 정했나 — 결정 장부 A1~A19 (**충돌 시 정본**). 본문의 숫자 티켓은 Jira `GROMO-####` |
| [`diagrams/`](diagrams/) | 직각 연결선 SVG 6장 — 서비스 구도 · 랭킹 3시점 · 배치 · 레포 |

## 한 문장

**앱은 Business API 하나만 본다. 데이터는 Data API 만 만진다. 알림과 링크는 자기 데이터만 갖고, 코어를 부르지 않는다.**

## 그림

![Target-1 서비스 구도](diagrams/01-service-target1.svg)

## 규칙 요약

- 위성(알림 · 링크)은 코어를 부르지 않는다. 코어가 위성에 밀어준다(이벤트 · 발급 시 스냅샷 동봉). 예외는 알림 → Data API 리컨실 1종.
- 이벤트 발행 주체 = 그 유스케이스를 완료한 프로세스 (요청형 Business API · 정산형 Data API).
- 배포 단위는 레포가 아니라 이미지. 서비스 하나가 바뀌면 그 이미지만 빌드·교체, 롤백은 직전 digest.
- Target-2 로 가는 신호는 감이 아니라 수치 — `system-architecture.md` §7.

## 새 서비스를 붙일 때 — 8단계 순서대로

1. **어느 무리인가** — JVM 이면 `oneorthree/server` 의 `services/<name>/`(A17), 스택이 다르면 별도 레포. 서브모듈은 쓰지 않는다(A15).
2. **누구를 부르고 누가 부르나** — `service-architecture.md` §3 허용/금지 표에 새 행·열을 추가한다. 위성이면 코어를 부르지 않는다. 필요한 사실은 이벤트·발급 시 동봉하고, 정합은 리컨실로.
3. **무엇을 소유하나** — §7 데이터 소유 표에 저장소를 등록한다. 코어 database 는 Data API 만. 자기 데이터가 있으면 같은 RDS 의 별도 database(A10). Redis 를 쓰면 키 네임스페이스와 쓰기 소유자를 정한다(A19).
4. **이벤트를 내나 받나** — 발행 주체 = 그 유스케이스를 완료한 프로세스. 봉투는 `eventId`·`type`·`occurredAt`·`userId`·`params`, 소비 측 멱등.
5. **어떻게 뜨나** — `system-architecture.md` §2.2 자원표(포트·힙)·§2.4 시크릿·§3 CI 경로 필터·§4 `DD_SERVICE` 에 한 줄씩 추가하고, 메모리 합계가 인스턴스를 넘지 않는지 A14 기준으로 계산한다.
6. **밖에서 닿아야 하나** — 외부(앱·Vercel 콘솔·웹훅)가 부르는 경로가 있으면 `system-architecture.md` §2.1 공인 노출면 표에 행을 추가하고 nginx 라우팅·인증 방식을 적는다. 없으면 "노출 0"을 명시한다(data-api 처럼).
7. **그림을 고친다** — mermaid 소스 둘(`service-architecture.md` §1, `system-architecture.md` §2 — 6단계의 nginx 라우팅이 여기 그려진다)과 그 정적 사본 `diagrams/01-service-target1.svg`·`05-deploy-target1.svg`(필요 시 랭킹 `02~04`)에 상자·화살표를 추가한다. 그림·허용 표·본문 셋이 같은 화살표 집합이어야 한다 — 리뷰 기준이다.
8. **결정을 남긴다** — 위에서 규칙을 바꾼 게 있으면 `decisions.md` 에 A 번호로.

## 바꾸는 법

결정을 바꾸려면 `decisions.md` 에 A 번호를 추가하고(뒤집힌 항목은 취소선 + 후속 번호), 두 문서를 그에 맞게 고친 뒤 `doc/fix-prd-architecture` 브랜치로 PR 을 연다.
