# 섬 소속·탐색 — PRD

> GROMO-1758 · 2026-09-12 · **검토 초안 / 초대·승계 정책 결정 대기**
> [구성 설계](./high-level-design.md) · [상세 계약](./low-level-design.md) · [섬 관리](../island-management/prd.md)

## 목적과 범위

사용자가 섬을 만들거나 찾아 가입하고, 여러 소속 중 지금 머무를 섬을 선택한다. 방문자는 가입 판단에 필요한 공개 요약만 보고 주민 기록·편지·재화·관리 권한은 받지 않는다. 저장 계층의 `groups`를 외부에서 `islands`라고 부른다. 별도 island 테이블로 기존 그룹을 복제하는 사업이 아니다.

화면별 API 스펙 v0.3-proposed(참고 티켓 1739)와 원본 66계약 중 아래 11종이 범위다. 참고 티켓 1759가 6종, 1760이 5종을 구현한다. 기존 그룹 API는 보존하고 신규 Business 경로에는 `/v1`·`/api`를 붙이지 않는다.

| 계약 ID | 메서드 | 신규 경로 | 구현 참고 티켓 |
|---|---|---|---|
| create | POST | `/islands` | 1759 |
| islands | GET | `/islands` | 1759 |
| island-discover | GET | `/islands/discover` | 1759 |
| island | GET | `/islands/{islandId}` | 1759 |
| memberships | GET | `/me/islands` | 1759 |
| switch | PUT | `/me/current-island` | 1759 |
| join | POST | `/islands/{islandId}/memberships` | 1760 |
| join-status | GET | `/me/join-requests/{requestId}` | 1760 |
| join-cancel | DELETE | `/me/join-requests/{requestId}` | 1760 |
| invite-resolve | POST | `/invitations/resolve` | 1760 |
| invite | POST | `/islands/{islandId}/invitations` | 1760 |

가입 승인/거절, 방장 위임, 강퇴/탈퇴는 [관리 7계약](../island-management/low-level-design.md)의 책임이다. 가입 요청 상태와 membership 저장 규칙은 두 문서가 공유한다.

## 기존 정본과 차이

[기존 그룹 문서](../group/prd.md), [획득 설계](../group/features/01-acquisition/high-level-design.md), [운영 설계](../group/features/04-operation/high-level-design.md), [서비스 아키텍처](../../architecture/service-architecture.md)를 함께 따른다.

| 개념 | main의 사실 | 신규 계약 |
|---|---|---|
| 섬 | `groups`, `group_members` | 같은 ID를 islandId로 표현. role OWNER→host, MEMBER→member |
| 공개 | `is_private=false`이면 이름 검색 대상. 비밀번호는 독립 | visibility와 approvalRequired도 별개. 승인제를 password로 대체하지 않음 |
| 정원 | 1~10명, 생성 미입력 기본 10; 본인 소속 상한 10 | 기존 제한을 변경하지 않는 출발 기준. 새 UX의 제한 변경은 별도 결정 |
| 현재 섬 | 영속 현재 섬 필드 없음 | 본인 context 한 건을 저장하고 전체 BFF/집중 시작이 같은 값을 사용 |
| 승인 요청 | 정식 요청 상태 모델 없음 | pending/approved/rejected/cancelled, 현재 소속과 다른 자원 |
| 참가 코드 | 과거 8자·3시간 코드는 생성만 남은 폐기 기능 | 새 사람이 입력하는 코드와 기존 slug의 관계/수명을 먼저 결정 |
| 초대 링크 | 발급자별 slug와 클릭/귀속; 정본 문서는 이탈 시 폐기 요구 | 링크 서버 서명 자격과 Data membershipEpoch 검증 재사용. 코드가 승인을 우회하는지는 미정 |
| 성장/테마 | Group에 시설·테마 필드 없음 | 건설/외양 도메인이 소유한 정본 projection을 조합. 샘플 성장 수치 생성 금지 |

기존 문서의 목표 상태가 현재 코드에 모두 구현된 것은 아니다. 특히 private 가입 enforcement와 링크 이탈 폐기는 [LLD의 근거 표](./low-level-design.md#1-기존-코드-근거와-격차)를 따른다. 참고 티켓 1659의 미통합 기반도 main 완료로 계산하지 않는다.

## 요구사항

| ID | 요구사항 |
|---|---|
| M01 | 혼자 생성한 섬에서 바로 집중 가능. 첫 집중에 친구 초대나 2명 조건을 추가하지 않음 |
| M02 | 이름 검색은 비공개/종료/삭제 섬을 제외. 정확 코드 해석은 별도 자격 검증을 통과해야 함 |
| M03 | 첫 발견은 공개·즉시가입·비소속 후보를 무작위 순서로 제공하며 한 탐색 세션의 cursor 순서는 안정적 |
| M04 | 방문자 DTO는 허용 필드만 조립. 주민 상세 DTO를 만든 뒤 민감 필드를 몇 개 지우는 방식 금지 |
| M05 | pending 요청은 membership이 아니며 주민 채널·공동 데이터에 접근할 수 없음 |
| M06 | 즉시 가입/승인/생성의 정원·소속 상한을 DB 트랜잭션과 유일성으로 보장 |
| M07 | 현재 섬을 바꾸는 모든 명령은 진행 중 active/paused 세션과 직렬화. 첫 소속 이후 출발 섬 전망대 조건 적용 |
| M08 | 신청 승인 알림만으로 신청자의 현재 섬을 강제로 바꾸지 않음 |
| M09 | 멱등 키는 앱 소유. 같은 키+본문은 확정 결과를 복구하고 다른 본문은 충돌 |
| M10 | 가입/초대 검증, 상태 변화, 이벤트/outbox를 아키텍처의 원자 명령/증명 계약으로 처리 |

## 결정 대기

| ID | 미정 사항 | 근거와 추천안 | 상태 |
|---|---|---|---|
| IM-D01 | 새 코드와 기존 slug 관계 | 코드=발급자별 active 초대의 입력용 별칭 추천. 기존 8자 참가코드 기능을 자동 복원하지 않음 | 사용자 결정 대기 |
| IM-D02 | 코드 형식/기간/재발급·재사용 | 반복 발급은 같은 active 초대 재사용, 발급자 이탈·강퇴/그룹종료 폐기, 재가입은 새 버전이라는 기존 링크 정책 유지. 사람이 입력하는 코드의 형식·시간 TTL은 별도 확정 | 일부 기존 정본 / 새 값 대기 |
| IM-D03 | 초대의 승인 우회 여부 | 비공개 발견/초대자격만 제공하고 approvalRequired는 그대로 적용 추천. 정원·강퇴 이력은 어떤 경우에도 우회하지 않음 | 사용자 결정 대기 |
| IM-D04 | 기존 그룹·비밀번호·자산 승계 | 새 join에는 password 입력이 없다. 기존 잠금을 무시하거나 approvalRequired로 변환하지 않음 | 공통 승계 결정 대기 |
| IM-D05 | pending 요청의 자리 예약/재신청 | pending은 자리 미예약, 승인 때 정원 재검사; 처리된 요청 뒤 재신청은 새 requestId 추천. 반복/스팸 제한 별도 | 설계 제안, 제품 확인 필요 |
| IM-D06 | 현재 섬 이탈 후 선택 | 다른 섬 자동 이동보다 currentIslandId=null로 안전하게 비우고 앱에서 선택 추천. 강퇴 대상 진행세션은 관리 결정과 함께 확정 | 설계 제안, 제품 확인 필요 |

미답은 승인으로 간주하지 않는다. 해당 정책이 없으면 그 분기를 활성화하지 않는다. 문서 초안 제출이 Jira의 '11개 스키마·초대 정책 확정' 완료를 의미하지 않는다. 이 밖의 공용 소비 권한·강퇴 보상 결정은 관리 문서에 모은다.
