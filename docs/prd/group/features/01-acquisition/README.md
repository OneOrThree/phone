# 01 그룹 획득 — 구현 착수 카드

## 목적

공개 그룹 찾기, 초대 링크, 생성으로 소속을 얻고, 서버가 확인한 전체 소속 목록으로 성공 목적지를 결정한다.

## 현재 구현 상태

[공통 구현 상태의 `GRP-01`](../../shared/implementation-status.md)을 따른다. 구현됨·남은 작업·착수/출시 gate는 그 행과 근거에서만 갱신하며 이 카드에서 재서술하지 않는다.

## 코드·테스트 시작점

| 구분             | 시작점                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 화면·전환     | `app/src/screens/group/GroupScreen.tsx`, `GroupCreateScreen.tsx`, `components/GroupFindSheet.tsx`, `components/GroupInviteSheet.tsx`, `app/src/navigation/RootNavigator.tsx`                                                                         |
| 앱 API·초대 복원 | `app/src/services/groupApi.ts`, `inviteLinkApi.ts`, `deferredInvite.ts`, `app/src/utils/inviteLink.ts`                                                                                                                                               |
| 서버             | `back/src/main/java/com/oneorthree/phone/group/api/GroupController.java`, `group/service/GroupService.java`, `invitelink/service/InviteLinkService.java`                                                                                             |
| 기존 테스트      | `GroupCreateScreen.test.tsx`, `GroupScreen.test.tsx`, `components/GroupFindSheet.test.tsx`, `components/GroupInviteSheet.test.tsx`, `services/deferredInvite.test.ts`, `back/src/test/java/com/oneorthree/phone/group/service/GroupServiceTest.java` |

## 담당 역할과 작업 패키지

- **앱:** 생성·찾기·초대 UI, 중복 요청 잠금, 성공 뒤 목록 재확인과 `groupId` 목적지 전환.
- **서버:** 비공개 가입 시 `inviteSlug` 유효성·그룹 공개 범위를 강제하고 오류 계약을 확정.
- **QA/분석:** 직접·복원 초대, 생성·가입 성공 뒤 목록 실패, 중복 탭·늦은 응답을 회귀 검증하고 이벤트 품질을 확인.

## 출시 게이트

- 생성·가입은 요청당 한 번만 전송되며, 성공 뒤 전체 목록이 확인되기 전 빈 상태나 중복 생성으로 수렴하지 않는다.
- 비공개 그룹 출시를 invite-only로 주장하려면 서버 enforcement와 해당 통합 테스트가 먼저 통과해야 한다.
- 새 초대·계정·화면 전환 뒤 늦은 응답이 현재 `groupId` 목적지를 바꾸지 않는다.

## 상위 정본

[그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) · [통합 HLD](../../high-level-design.md) · [통합 LLD](../../low-level-design.md) · [이 기능 HLD](./high-level-design.md) · [이 기능 LLD](./low-level-design.md)
