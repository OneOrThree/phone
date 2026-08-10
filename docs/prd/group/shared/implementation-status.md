# 그룹 구현 상태 정본

| 항목    | 내용                                                                                     |
| ------- | ---------------------------------------------------------------------------------------- |
| 기준    | 2026-08-10 `origin/main`(`e0a24b7b`)의 앱·서버 코드와 그룹 문서                          |
| 역할    | 01~04 기능의 현재 구현 상태, 다음 작업과 착수·출시 gate를 한 곳에서 관리한다.            |
| 범위 밖 | 제품 정책·화면 상세·API DTO·테스트 절차의 정본. 각각 루트 PRD/IA, 기능 HLD/LLD를 따른다. |

작업 패키지 ID는 문서와 코드 변경을 연결하는 안정 식별자다. 사람 assignee와 Jira 번호는 스프린트에서 이 ID에 연결하되, 배정 변경 때문에 제품·설계 문서를 수정하지 않는다.

| 기능·패키지                 | 상태                     | 구현됨                                                                                                          | 남은 작업                                                                                                                                                                                              | 책임 역할                | 구현 착수 gate                                                                                                                 | 출시 gate                                                                                                                                                                                               |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 획득<br>`GRP-01`         | 🟡 일부 구현             | 공개 찾기, 직접·복원 초대, 생성·가입, 성공 뒤 전체 목록 재확인과 초대 대상 방 이동                              | 공통 active-group guard·close/join race, private link 폐기/claim/가입, 검색 식별자·`result_track`, reconciliation, 서버 allowlist 주석·legacy join taxonomy·`code`/MP absent test, 생성 lock, F3 query | 백엔드·앱·분석·QA        | slug 전환 시각, 폐기 claim no-op, 모든 join의 group 상태·private authorization·잠금 순서, pending reconcile context를 합의     | inactive 신규·LEFT 우회 0건, 기존 활성 `ALREADY_MEMBER` 무변경, public/active private 성공, link race, `code` 보존·MP absent·legacy/unknown/mismatch F3 terminal, reconciliation·GA4/S-LOG fixture 통과 |
| 02 내 그룹 탐색<br>`GRP-02` | ⬜ 설계 완료·구현 미착수 | 카드 덱·플립·재정렬·로컬 아이콘·guide·계측의 문서 계약                                                          | 앱 덱/플립/재정렬/아이콘/guide, dependency ensure, ranking wrapper·60초 foreground 갱신·coverage gate, 카드 `entrySource=group_card`, `group_viewed` typed 발행, 자동화 검증                           | 앱·백엔드·분석·디자인·QA | `F02-P0` 완료. [착수 카드의 `F02-T1`](../features/02-my-groups/README.md#지금-시작할-첫-변경-단위)부터 의존성 순서로 바로 시작 | 기능 LLD 수용 기준, cold/warm 요청 수·집중 freshness·접근성·coverage-unknown E2E, `group_card` source·DebugView와 아래 규모 gate 증거 통과                                                              |
| 03 활동<br>`GRP-03`         | 🟡 일부 구현             | 그룹방 detail 선행 조회, detail 성공 뒤 공지·하위 영역의 독립 오류 표시, 공지 권한과 `initialGroupId` 집중 진입 | 집중 버튼 동시 이중 전환 잠금, 공통 Focus route/helper의 `group_room`, `home_fab`, `unknown` 보존·정규화와 최초 진입 이벤트, 영역별 재시도, 자정 경계 갱신, 권한 경합 E2E                              | 앱·분석·QA               | 집중 진입 lock·route source와 날짜 경계의 UX·복귀 계약 확정                                                                    | 기존 방 흐름, `group_card`, `group_room`, `home_fab`, `unknown` source 보존·비누출, 최초 detail 실패, 하위 영역 실패 격리·집중 진입·DebugView 회귀 통과                                                 |
| 04 운영<br>`GRP-04`         | 🟡 일부 구현             | 설정 허브, 프로필·위임·강퇴·공지 권한·나가기, 요청 잠금·rollback·서버 멤버십 전이                               | 나가기 `NOT_FOUND`의 인증·그룹 scope 재확인, 강퇴 `NOT_FOUND` 또는 `MEMBER_ONLY`의 operation별 postcondition 재확인, 일부 화면의 최신 역할 guard, `group_left` 귀속, 통합·접근성 E2E, 02 아이콘 연결   | 앱·백엔드·분석·QA        | 02의 아이콘 route/store 범위와 운영 허브 연결 계약 확정                                                                        | leave·kick 사후조건 분기, 비활성 요청자 세션 복구, 역할별 권한·위임 후 이탈·강퇴·공지 권한 E2E와 `group_left` 로그 검증. 성공 전용 이벤트는 success-rate KPI에서 제외                                   |

## 근거

- 01: 공개 검색은 비공개 그룹을 제외하지만([`GroupService.searchGroups`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupService.java#L197-L207)), 가입 처리는 `isPrivate`·`inviteSlug`뿐 아니라 `deletedAt`·`ENDED`도 검증하지 않는다([`GroupService.joinGroup`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupService.java#L255-L307)). 종료 그룹은 현재 앱의 초대·검색 UI에서만 차단한다([`GroupInviteSheet`](../../../../app/src/screens/group/components/GroupInviteSheet.tsx#L198-L204), [`GroupFindSheet`](../../../../app/src/screens/group/components/GroupFindSheet.tsx#L47-L55)). 앱은 slug 없는 구형 링크를 의도적으로 파싱하며([`inviteLink`](../../../../app/src/utils/inviteLink.ts#L55-L84)), 생성·프로필 화면은 현재 invite-only를 보장하는 문구를 노출한다([`GroupCreateScreen`](../../../../app/src/screens/group/GroupCreateScreen.tsx#L56-L60), [`GroupProfileEditScreen`](../../../../app/src/screens/group/GroupProfileEditScreen.tsx#L303-L306)). 초대 가입은 `appInstanceId`를 전달하지만 검색 가입은 `joinMethod`만 전달해 GA4 `group_joined`가 생략된다([`GroupInviteSheet`](../../../../app/src/screens/group/components/GroupInviteSheet.tsx#L244-L254), [`GroupFindSheet`](../../../../app/src/screens/group/components/GroupFindSheet.tsx#L209-L215)).
- 02: 현재 `GroupScreen`은 1개 이상 소속에서 기존 `GroupListScreen`을 표시하며([`GroupScreen`](../../../../app/src/screens/group/GroupScreen.tsx#L303-L319)), 카드 덱 관련 앱 구현은 없다. 상세 계약은 [02 HLD](../features/02-my-groups/high-level-design.md)·[02 LLD](../features/02-my-groups/low-level-design.md)를 따른다.
- 03: 최초 detail 실패는 전체 오류·재시도로 렌더한다([`GroupRoomScreen`](../../../../app/src/screens/group/GroupRoomScreen.tsx#L670-L696), [`화면 테스트`](../../../../app/src/screens/group/GroupRoomScreen.test.tsx#L273)). detail 성공 뒤 하위 영역 오류는 표시상 격리되지만, 현재 각 `다시 시도` 버튼은 공용 `reload()`를 호출한다([`GroupRoomScreen`](../../../../app/src/screens/group/GroupRoomScreen.tsx#L735-L853)).
- 04: 설정 화면은 focus마다 detail을 재조회하고 현재 역할을 다시 계산한다([`GroupSettingsScreen`](../../../../app/src/screens/group/GroupSettingsScreen.tsx#L60-L84)). 현재 나가기는 `NOT_FOUND`와 `MEMBER_ONLY`를 모두 즉시 화면 복귀로 처리해 비활성 요청자·그룹 부재 scope를 구분하지 않으며([`GroupSettingsScreen`](../../../../app/src/screens/group/GroupSettingsScreen.tsx#L98-L102)), 강퇴도 같은 오류 뒤 target 사후조건을 재확인하지 않는다. `group_left`는 자발 이탈·강퇴 모두 `group_id`만 기록하고 강퇴 시 요청한 방장 MDC를 사용자로 사용한다([`GroupMemberService`](../../../../back/src/main/java/com/oneorthree/phone/group/service/GroupMemberService.java#L65-L125)). 아이콘 편집은 [02 LLD §2](../features/02-my-groups/low-level-design.md#2-카드-순서아이콘-저장과-계정-경계)의 `F02-P1` 계획 의존성이다.

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
