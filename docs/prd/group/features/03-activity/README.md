# 03 그룹 활동 — 구현 착수 카드

## 목적

서버가 확인한 그룹 상세를 바탕으로 방 shell·멤버 현황을 보이고, 공지와 그룹 맥락의 집중 진입을 제공한다.

## 현재 구현 상태

[공통 구현 상태의 `GRP-03`](../../shared/implementation-status.md)을 따른다. 최초 detail과 하위 영역의 현재 실패 경계는 [이 기능 HLD §3](./high-level-design.md#3-독립-조회와-실패-격리), 실행 예외는 [LLD](./low-level-design.md)가 정본이다.

## 코드·테스트 시작점

| 구분           | 시작점                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 화면·라우트 | `app/src/screens/group/GroupRoomScreen.tsx`, `GroupRoomRouteScreen.tsx`, `components/GroupRoomBottomBar.tsx`, `NoticeScreen.tsx`                                                |
| 앱 API·공지 UI | `app/src/services/groupApi.ts`, `app/src/screens/group/components/NoticeComposeSheet.tsx`, `app/src/screens/group/noticeDate.ts`                                                |
| 서버           | `back/src/main/java/com/oneorthree/phone/group/api/GroupController.java`, `group/service/GroupService.java`, `group/service/GroupAnnouncementService.java`                      |
| 기존 테스트    | `GroupRoomScreen.test.tsx`, `GroupRoomRouteScreen.test.tsx`, `NoticeScreen.test.tsx`, `back/src/test/java/com/oneorthree/phone/group/service/GroupAnnouncementServiceTest.java` |

## 담당 역할과 작업 패키지

- **앱:** detail 선행 표시, 하위 영역 오류 표시·응답 격리, 현행 공용 재조회와 후속 영역별 retry, 집중 중복 전환 방지, 방 복귀 시 같은 `groupId` 유지.
- **서버:** detail·공지·권한 변경의 최신 멤버십/역할 검증과 오류 응답을 유지한다.
- **QA/분석:** 최초 detail 실패, detail 성공 뒤 공지 실패, 권한 변경 충돌, 집중 진입·복귀를 E2E로 검증한다.

## 출시 게이트

- detail 없이 멤버·권한·집중 가능 여부를 추정하거나 거짓 빈 상태를 표시하지 않는다.
- 공지 실패가 detail 성공 화면이나 집중 진입을 막지 않으며, 소속 없음은 서버 확인 뒤에만 안전 복귀한다.
- 현행 공용 재조회가 다른 성공 영역을 지우지 않는지 검증하고, 영역별 retry 구현 여부는 [공통 상태 정본](../../shared/implementation-status.md)에서 추적한다.
- 동일 `groupId`의 빠른 집중 탭은 요청·전환이 한 번만 일어나도록 보강하고 회귀 테스트한다.

## 상위 정본

[그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) · [통합 HLD](../../high-level-design.md) · [통합 LLD](../../low-level-design.md) · [이 기능 HLD](./high-level-design.md) · [이 기능 LLD](./low-level-design.md) · [챌린지 문서 세트](../../../challenge/README.md)
