# 그룹 구현 상태 정본

| 항목    | 내용                                                                                     |
| ------- | ---------------------------------------------------------------------------------------- |
| 기준    | 2026-08-10 `origin/main`(`e0a24b7b`)의 앱·서버 코드와 그룹 문서                          |
| 역할    | 01~04 기능의 현재 구현 상태, 다음 작업과 착수·출시 gate를 한 곳에서 관리한다.            |
| 범위 밖 | 제품 정책·화면 상세·API DTO·테스트 절차의 정본. 각각 루트 PRD/IA, 기능 HLD/LLD를 따른다. |

작업 패키지 ID는 문서와 코드 변경을 연결하는 안정 식별자다. 사람 assignee와 Jira 번호는 스프린트에서 이 ID에 연결하되, 배정 변경 때문에 제품·설계 문서를 수정하지 않는다.

| 기능·패키지                 | 상태                     | 구현됨                                                                                                          | 남은 작업                                                                                                                             | 책임 역할                | 구현 착수 gate                                                                                                                 | 출시 gate                                                                                                                               |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 01 획득<br>`GRP-01`         | 🟡 일부 구현             | 공개 찾기, 직접·복원 초대, 생성·가입, 성공 뒤 전체 목록 재확인과 초대 대상 방 이동                              | 비공개 그룹의 invite-only 서버 강제, 생성 submit의 같은 순간 이중 실행 잠금                                                           | 백엔드·앱·QA             | `joinGroup`이 비공개 그룹과 유효한 `inviteSlug`를 가입 허가 조건으로 판정하는 API·오류 계약 합의                               | 비공개 그룹을 링크 수신자 전용이라고 안내·출시하기 전 서버 강제와 우회 가입 회귀 테스트 통과                                            |
| 02 내 그룹 탐색<br>`GRP-02` | ⬜ 설계 완료·구현 미착수 | 카드 덱·플립·재정렬·로컬 아이콘·guide·계측의 문서 계약                                                          | 앱 덱/플립/재정렬/아이콘/guide, ranking wrapper·coverage gate, `group_viewed` 목록 확정 뒤 typed 발행, 이벤트 helper·자동화 검증 전체 | 앱·백엔드·분석·디자인·QA | `F02-P0` 완료. [착수 카드의 `F02-T1`](../features/02-my-groups/README.md#지금-시작할-첫-변경-단위)부터 의존성 순서로 바로 시작 | 기능 LLD 수용 기준, 접근성·중복 계측·coverage-unknown E2E, DebugView와 아래 규모 gate 증거 통과                                         |
| 03 활동<br>`GRP-03`         | 🟡 일부 구현             | 그룹방 detail 선행 조회, detail 성공 뒤 공지·하위 영역의 독립 오류 표시, 공지 권한과 `initialGroupId` 집중 진입 | 집중 버튼 동시 이중 전환 잠금, 영역별 재시도(현행은 공용 reload), 열린 화면의 자정 경계 갱신, 권한 경합 E2E                           | 앱·QA                    | 집중 진입 lock과 날짜 경계의 UX·복귀 계약 확정                                                                                 | 최초 detail 실패는 전체 shell 오류·재시도라는 현행 수용 계약을 유지하고, detail 성공 뒤 하위 영역 실패 격리·집중 진입 회귀 통과         |
| 04 운영<br>`GRP-04`         | 🟡 일부 구현             | 설정 허브, 프로필·위임·강퇴·공지 권한·나가기, 요청 잠금·rollback·서버 멤버십 전이                               | 일부 하위 화면의 최신 역할 guard, `group_left` 사유·이탈 대상 귀속, 통합·접근성 E2E, 02 `F02-P1` 아이콘 편집 route/store 연결         | 앱·백엔드·QA             | 02의 아이콘 route/store 범위와 운영 허브 연결 계약 확정                                                                        | 역할별 권한·위임 후 이탈·강퇴·공지 권한 E2E와 `group_left` 사유·대상 로그 검증 통과. 아이콘은 02 `F02-P1` 구현 전 운영 출시 조건이 아님 |

## 근거

- 01: 공개 검색은 비공개 그룹을 제외하지만([`GroupService.searchGroups`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupService.java#L197-L207)), 가입 처리에는 `isPrivate`·`inviteSlug` 허가 검증이 없다([`GroupService.joinGroup`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupService.java#L255-L307)).
- 02: 현재 `GroupScreen`은 1개 이상 소속에서 기존 `GroupListScreen`을 표시하며([`GroupScreen`](../../../../app/src/screens/group/GroupScreen.tsx#L303-L319)), 카드 덱 관련 앱 구현은 없다. 상세 계약은 [02 HLD](../features/02-my-groups/high-level-design.md)·[02 LLD](../features/02-my-groups/low-level-design.md)를 따른다.
- 03: 최초 detail 실패는 전체 오류·재시도로 렌더한다([`GroupRoomScreen`](../../../../app/src/screens/group/GroupRoomScreen.tsx#L670-L696), [`화면 테스트`](../../../../app/src/screens/group/GroupRoomScreen.test.tsx#L273)). detail 성공 뒤 하위 영역 오류는 표시상 격리되지만, 현재 각 `다시 시도` 버튼은 공용 `reload()`를 호출한다([`GroupRoomScreen`](../../../../app/src/screens/group/GroupRoomScreen.tsx#L735-L853)).
- 04: 설정 화면은 focus마다 detail을 재조회하고 현재 역할을 다시 계산한다([`GroupSettingsScreen`](../../../../app/src/screens/group/GroupSettingsScreen.tsx#L60-L84)). 현재 `group_left`는 자발 이탈·강퇴 모두 `group_id`만 기록하고 강퇴 시 요청한 방장 MDC를 사용자로 사용한다([`GroupMemberService`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupMemberService.java#L65-L125)). 아이콘 편집은 [02 LLD §2](../features/02-my-groups/low-level-design.md#2-카드-순서아이콘-저장과-계정-경계)의 `F02-P1` 계획 의존성이다.

## 02 규모 출시 gate 실행

`F02-P1` 앱 구현은 지금 시작할 수 있다. 아래 절차는 구현 착수 조건이 아니라 staging·production 출시 때 top100 완전성 전제를 확인하는 운영 gate다. 90명 미만에서는 v1 서버 코드를 바꾸지 않는다.

1. **백엔드·운영**이 배포 후보마다 production read replica 또는 승인된 read-only 콘솔에서 아래 집계를 실행한다.

   ```sql
   SELECT COUNT(*) AS eligible_user_count
   FROM users
   WHERE is_deleted = false
     AND is_guest = false;
   ```

2. 실행 환경·KST 시각·결과 수·실행자를 release checklist에 첨부한다. 쿼리 실패나 증거 없음은 `unknown`이다.
3. **QA**는 staging에서 category 없는 ranking 원본 99행·100행·요청 실패 fixture를 검증한다. 99행만 count를 산출하고 100행·실패는 `coverage-unknown`이며 `0명`으로 표시하지 않아야 한다.
4. **제품 release approver**는 아래 표의 조치와 LLD gate 증거가 모두 있을 때만 출시를 승인한다.

| 관측값                | 출시 판단                 | 필수 조치                                                                           |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| 0~89                  | v1 gate 통과              | 다음 배포에도 같은 집계 증거를 남긴다.                                              |
| 90~99                 | 이번 배포 가능, 전환 경고 | 백엔드가 대체 계약 ADR/티켓·담당 역할·100명 전 목표 배포일을 확정한다.              |
| unknown 또는 100 이상 | 출시 차단                 | 그룹 live 필드, 멤버 batch, `isFocusing` pagination 중 승인된 계약을 먼저 배포한다. |

대체 계약 선택은 90명 경고 때 내리는 후속 아키텍처 결정이다. 선택 전에도 앱은 `100행·loading·error → 미산출` 계약으로 안전하게 구현·테스트할 수 있다.
