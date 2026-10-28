# 03 그룹 활동 — 구현 착수 카드

## 목적

서버가 확인한 그룹 상세를 바탕으로 방 shell·멤버 현황을 보이고, 공지와 그룹 맥락의 집중 진입을 제공한다.

## 현재 구현 상태

[공통 구현 상태의 `GRP-03`](../../shared/implementation-status.md)을 따른다. 최초 detail과 하위 영역의 현재 실패 경계는 [이 기능 HLD §3](./high-level-design.md#3-독립-조회와-실패-격리), 실행 예외는 [LLD](./low-level-design.md)가 정본이다. 현재 `GroupRoomScreen`은 detail의 `MEMBER_ONLY`와 `NOT_FOUND`를 모두 즉시 `onLeft`로 처리한다. 그러나 서버 detail의 `NOT_FOUND`는 비활성·탈퇴 계정, 그룹 부재를 함께 뜻하므로 이 즉시 복귀는 목표 계약에 아직 맞지 않는다.

## 코드·테스트 시작점

| 구분           | 시작점                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 화면·라우트 | `app/src/screens/group/GroupRoomScreen.tsx`, `GroupRoomRouteScreen.tsx`, `components/GroupRoomBottomBar.tsx`, `NoticeScreen.tsx`                                                |
| 앱 API·공지 UI | `app/src/services/groupApi.ts`, `app/src/screens/group/components/NoticeComposeSheet.tsx`, `app/src/screens/group/noticeDate.ts`                                                |
| 서버           | `back/src/main/java/com/oneorthree/phone/group/api/GroupController.java`, `group/service/GroupService.java`, `group/service/GroupAnnouncementService.java`                      |
| 기존 테스트    | `GroupRoomScreen.test.tsx`, `GroupRoomRouteScreen.test.tsx`, `NoticeScreen.test.tsx`, `back/src/test/java/com/oneorthree/phone/group/service/GroupAnnouncementServiceTest.java` |

## 담당 역할과 작업 패키지

- **앱:** detail 선행 표시, 하위 영역 오류 표시·응답 격리, `NOT_FOUND`의 인증·그룹 scope 재확인 뒤 안전 복귀, 현행 공용 재조회와 후속 영역별 retry, 집중 중복 전환 방지, 카드 CTA의 비식별 `interaction_id`를 Room·Focus 결과까지 route별로 보존, 공통 Focus route/helper의 `group_room|home_fab|unknown` 보존·정규화, 방 복귀 시 같은 `groupId` 유지.
- **서버:** detail·공지·권한 변경의 최신 멤버십/역할 검증과 오류 응답을 유지한다.
- **QA/분석:** 최초 detail 실패, `MEMBER_ONLY` 직접 수렴, `NOT_FOUND`의 비활성 계정·그룹 부재·의미 불명/재확인 실패 분기, detail 성공 뒤 공지 실패, 권한 변경 충돌, 카드 CTA의 A 취소→B 성공·route 재사용·첫 결과 전 background에서 exact `interaction_id` pair가 한 결과에만 남고 만료 키는 제거되는지, 집중 진입·복귀와 `focus_session_started(entry_source=group_room|home_fab|unknown)`의 최초 화면 진입 1회·route source 비누출을 E2E·DebugView로 검증한다.

## 출시 게이트

- detail 없이 멤버·권한·집중 가능 여부를 추정하거나 거짓 빈 상태를 표시하지 않는다.
- 공지 실패가 detail 성공 화면이나 집중 진입을 막지 않는다. `MEMBER_ONLY`는 활성 인증 뒤의 미소속 사후조건일 때만 직접 수렴하고, `NOT_FOUND`는 즉시 `onLeft`하지 않는다.
- `NOT_FOUND` 뒤에는 인증 상태를 재확인한다. 비활성·탈퇴 계정이면 성공 처리 없이 세션을 안전 복구하고, 인증이 유효하면 최신 detail 또는 성공한 전체 그룹 목록으로 group 부재·미소속을 재확인했을 때만 탐색/목록으로 복귀한다. 의미가 불명하거나 재확인이 실패하면 현재 안전 상태를 유지하고 오류·재시도를 보인다.
- 현행 공용 재조회가 다른 성공 영역을 지우지 않는지 검증하고, 영역별 retry 구현 여부는 [공통 상태 정본](../../shared/implementation-status.md)에서 추적한다.
- 동일 `groupId`의 빠른 집중 탭은 요청·전환이 한 번만 일어나도록 보강하고 회귀 테스트한다.
- 그룹방 FAB가 `initialGroupId`와 `entrySource=group_room`을 함께 전달하고, `FocusCategory → FocusSession`에서 이를 보존해 최초 화면 진입 이벤트를 1회 발행해야 한다. marker API 성공과 결합하거나 `initialGroupId`로 source를 추론하지 않는다.
- 카드 CTA로 연 Room은 전달된 비식별 `interaction_id`를 최초 성공 렌더까지 한 번만 보존한다. 카드 source가 아닌 그룹방 FAB·외부 진입에는 이 값을 만들거나 물려주지 않으며, route 재사용·취소 뒤 이전 값도 재사용하지 않는다. 정확한 이벤트 정의는 [공통 분석 계약](../../shared/analytics.md)을 따른다.

## 상위 정본

[그룹 PRD](../../prd.md) · [그룹 IA](../../information-architecture.md) · [통합 HLD](../../high-level-design.md) · [통합 LLD](../../low-level-design.md) · [이 기능 HLD](./high-level-design.md) · [이 기능 LLD](./low-level-design.md) · [챌린지 문서 세트](../../../challenge/README.md)
