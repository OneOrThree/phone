# 04 그룹 운영 — 구현 착수 카드

## 목적

서버가 확인한 역할과 멤버십을 기준으로 그룹 프로필·위임·강퇴·공지 권한·나가기를 안전하게 관리한다.

## 현재 구현 상태

[공통 구현 상태의 `GRP-04`](../../shared/implementation-status.md)을 따른다. 구현됨·남은 작업·02 `F02-P1` 의존성은 그 행에서만 갱신하며 이 카드에서 재서술하지 않는다.

## 코드·테스트 시작점

| 구분           | 시작점                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 화면·라우트 | `app/src/screens/group/GroupSettingsScreen.tsx`, `GroupProfileEditScreen.tsx`, `GroupOwnerTransferScreen.tsx`, `GroupMemberManageScreen.tsx`, `GroupNoticePermissionScreen.tsx`, `app/src/navigation/RootNavigator.tsx` |
| 앱 API         | `app/src/services/groupApi.ts`                                                                                                                                                                                          |
| 서버           | `back/src/main/java/com/oneorthree/phone/group/api/GroupController.java`, `group/service/GroupService.java`, `group/service/GroupMemberService.java`                                                                    |
| 기존 테스트    | `GroupSettingsScreen.test.tsx`, `GroupProfileEditScreen.test.tsx`, `GroupOwnerTransferScreen.test.tsx`, `GroupMemberManageScreen.test.tsx`, `GroupNoticePermissionScreen.test.tsx`                                      |

## 담당 역할과 작업 패키지

- **작업 패키지:** `GRP-04` (문서 추적용 식별자이며 Jira 티켓·사람 이름이 아님).
- **앱:** 설정 허브의 최신 detail/role 반영, 중복 요청·늦은 응답 처리, 역할별 접근성 노출을 보강한다.
- **서버:** 프로필·역할·멤버십·공지 권한 요청마다 최신 권한과 대상 상태를 계속 검증한다.
- **QA/분석:** OWNER/MEMBER matrix, 위임 뒤 나가기, 강퇴·권한 변경 경합과 실패 복구를 검증한다.

## 착수·출시 gate

- **착수:** 역할 변경과 나가기의 최신 상세 재조회·오류 복귀 계약, 02 `F02-P1` 아이콘 route/store 경계를 확정한다.
- **출시:** OWNER/MEMBER 권한, 위임 후 이탈, 강퇴, 공지 권한 rollback, 늦은 응답의 E2E·접근성 회귀를 통과한다.
- 아이콘 편집은 02 `F02-P1`이 구현되기 전에는 04 출시 gate가 아니며, 구현 뒤에도 서버 API·DTO·역할 판단을 바꾸지 않는다.

## 상위 정본

[그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) · [통합 HLD](../../high-level-design.md) · [통합 LLD](../../low-level-design.md) · [이 기능 HLD](./high-level-design.md) · [이 기능 LLD](./low-level-design.md)
