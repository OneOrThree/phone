# 목표 아키텍처 (서비스 · 시스템)

서버 분리 라운드가 끝났을 때(Target-1)와 그 다음(Target-2)의 정본. 새 서비스·새 통신 경로·새 저장소를 추가하기 전에 이 폴더의 규칙과 어긋나지 않는지 먼저 본다.

| 문서 | 답하는 질문 |
|---|---|
| [`service-architecture.md`](service-architecture.md) | 어떤 프로세스가 무엇을 소유하고 누구를 부르나 — 단방향 규칙 · 통신 방식 · 인증 경계 · 배치의 자리 |
| [`system-architecture.md`](system-architecture.md) | 어디에 떠 있고 어떻게 배포·관측하나 — 환경 실측 · 노출면 · DB · CI/CD · Target-2 진입 조건 |
| [`decisions.md`](decisions.md) | 왜 그렇게 정했나 — 결정 장부 A1~A18 (**충돌 시 정본**) |
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

## 바꾸는 법

결정을 바꾸려면 `decisions.md` 에 A 번호를 추가하고(뒤집힌 항목은 취소선 + 후속 번호), 두 문서를 그에 맞게 고친 뒤 `doc/fix-prd-architecture` 브랜치로 PR 을 연다.
