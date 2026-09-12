# 링크·어트리뷰션 — 초대 링크 · 캠페인 링크 · 광고 설치 신호

GROMO-1799 설계. [PRD](prd.md) → [정책](policy.md) → [아키텍처](high-level-design.md) → [상세 설계](low-level-design.md) 순서로 읽는다. 정책 충돌 시 policy.md 가 정본이다. 그림은 [diagrams/architecture.html](diagrams/architecture.html) 을 브라우저로 연다.

초대 링크를 일반화해 그룹과 무관한 **캠페인 링크**를 만들고, 광고로 들어온 설치 신호(**iOS SKAN 포스트백 복사본**, **Android Install Referrer**)를 받는다. 공개 표면·콘솔은 business-api, 원장·트랜잭션·집계는 data-api 에 둔다. **별도 링크 서버는 만들지 않는다.**

## 상태

설계 문서다. 구현은 없다. 기준 main `875a9fd89` 에서 초대 링크는 data-api `invitelink` 패키지가 공개로 서빙하고 있다(`LinkPublicController`·`WellKnownController`, V21 두 테이블). 문서 병합은 기능 활성화가 아니다.

## 기존 문서·작업과의 관계

| 대상 | 관계 |
| --- | --- |
| [아키텍처 A23](../../architecture/decisions.md) | 이 설계를 아키텍처 결정으로 등록한다. A8·A11·A12·A17·A22 의 링크 서버 전제 문장에 우선한다 |
| [그룹 획득 HLD §2](../group/features/01-acquisition/high-level-design.md) · [LLD §2.1](../group/features/01-acquisition/low-level-design.md) | 초대 링크 수명(발급·반복 발급·폐기·재발급)과 비공개 가입 검증의 정본. 이 설계는 저장 위치와 컬럼만 제공한다 |
| [그룹 분석 §4](../group/shared/analytics.md) | 앱 이벤트는 바꾸지 않는다. 서버 GA4 이벤트에 파라미터만 더한다([LLD §8](low-level-design.md#8-ga4-서버-이벤트)) |
| 티켓 1660 · `mmp-custom` 저장소 | 분리 범위는 폐기한다. 그 저장소는 초대 링크·알림 콘솔·Neon 이관 코드였고 캠페인·SKAN·Referrer 코드는 없었다 |
| PR #745 | 링크 분리 전제 코드를 포함한 채 머지한다([정책 L15](policy.md)). 머지 뒤 켜지 말아야 할 것과 걷어낼 목록은 [LLD §9](low-level-design.md#9-pr-745-와의-관계) |

## 후속

구현은 data-api(원장·내부 API) · business-api(공개 표면·SKAN·Referrer) · 콘솔 · Infra(nginx·Cloudflare) · 앱 3건으로 나눈다. 순서는 [HLD §7](high-level-design.md#7-배포-순서). 착수 전 [LLD §11 확인 목록](low-level-design.md#11-확인-목록-구현-착수-전)을 먼저 닫는다.
