# 01 그룹 획득 — 구현 착수 카드

## 목적

공개 그룹 찾기, 초대 링크, 생성으로 소속을 얻고, 서버가 확인한 전체 소속 목록으로 성공 목적지를 결정한다.

## 현재 구현 상태

[공통 구현 상태의 `GRP-01`](../../shared/implementation-status.md)을 따른다. 구현됨·남은 작업·착수/출시 gate는 그 행과 근거에서만 갱신하며 이 카드에서 재서술하지 않는다.

## 코드·테스트 시작점

| 구분                  | 시작점                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 화면·전환          | `app/src/screens/group/GroupScreen.tsx`, `GroupCreateScreen.tsx`, `components/GroupFindSheet.tsx`, `components/GroupInviteSheet.tsx`, `app/src/navigation/RootNavigator.tsx`                                                                         |
| 앱 API·분석·초대 복원 | `app/src/services/groupApi.ts`, `analytics.ts`, `inviteLinkApi.ts`, `deferredInvite.ts`, `app/src/utils/inviteLink.ts`                                                                                                                               |
| 서버                  | `back/src/main/java/com/oneorthree/phone/group/api/GroupController.java`, `group/service/GroupService.java`, `invitelink/service/InviteLinkService.java`                                                                                             |
| 기존 테스트           | `GroupCreateScreen.test.tsx`, `GroupScreen.test.tsx`, `components/GroupFindSheet.test.tsx`, `components/GroupInviteSheet.test.tsx`, `services/deferredInvite.test.ts`, `back/src/test/java/com/oneorthree/phone/group/service/GroupServiceTest.java` |

## 담당 역할과 작업 패키지

- **앱:** 생성·찾기·초대 UI, 현재 비공개 안내 완화, 구형 비공개 링크의 새 링크 재요청 안내, 식별자→시도 이벤트→API→목록 reconciliation 순서, 중복 요청 잠금과 `groupId` 목적지 전환.
- **서버:** 모든 가입의 `WAITING|ACTIVE` 그룹 검사, 비공개 slug·발급자 활성 멤버십·폐기 상태 강제, 마지막 이탈·가입 직렬화와 구형·직접 요청 오류 계약 확정.
- **QA/분석:** 직접·복원·검색 가입의 GA4/S-LOG 결과와 `result_track`, cold invite F3와 `s_log_only` terminal, 종료 그룹 우회·생성/가입 뒤 목록 실패·중복 탭·늦은 응답을 회귀 검증한다.

## 출시 게이트

- 생성·가입은 요청당 한 번만 전송되며, 성공 뒤 전체 목록이 확인되기 전 빈 상태나 중복 생성으로 수렴하지 않는다.
- 공개·비공개와 slug 유무에 관계없이 `ENDED`·삭제 그룹의 새 가입과 LEFT 재활성화가 서버에서 거절되고, 마지막 이탈과 join race가 하나의 상태로 수렴한다.
- 다음 앱 배포 전 `초대 링크를 받은 사람만`이라는 현재 문구를 `검색 비노출·링크 공유` 사실로 완화한다. invite-only를 다시 주장하려면 서버 enforcement와 우회 가입 통합 테스트가 먼저 통과해야 한다.
- slug 링크를 생성·해석하고 구형 비공개 링크의 재발급 안내를 표시하는 앱을 최소 지원 버전으로 올린 뒤 서버 강제를 배포한다. 그 시점부터 public legacy와 **활성 멤버가 발급한 미폐기 private slug**만 가입되고, 구형·폐기 private 링크는 새 링크를 받아야 한다.
- 검색·초대 가입은 `appInstanceId`를 먼저 best-effort로 조회하고 시도 이벤트와 API를 바로 이어 실행한다. 값이 없어도 가입과 S-LOG 결과를 막지 않으며 cold F3 분모는 열지 않는다.
- `s_log_only` 실제 가입은 성공한 전체 목록의 target 확인 뒤 reconciliation을 남겨 열린 empty F3를 `unattributed`로 닫고, 이후 결과를 잘못 귀속하지 않는다.
- 새 초대·계정·화면 전환 뒤 늦은 응답이 현재 `groupId` 목적지를 바꾸지 않는다.

## 상위 정본

[그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) · [통합 HLD](../../high-level-design.md) · [통합 LLD](../../low-level-design.md) · [이 기능 HLD](./high-level-design.md) · [이 기능 LLD](./low-level-design.md)
