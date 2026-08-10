# 그룹 공통 분석 계약

| 항목 | 내용                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 상위 | [그룹 PRD](../prd.md) · [통합 HLD](../high-level-design.md)                                                               |
| 역할 | 01~04 기능이 함께 쓰는 이벤트 이름, 발행 주체, 공통 속성, 귀속·중복 규칙의 단일 정본                                      |
| 제외 | 기능별 UI 상태와 구현 위치는 각 기능 HLD·LLD에서 다룬다. 챌린지 계측은 [챌린지 문서](../../challenge/README.md)를 따른다. |
| 기준 | 2026-08-10 `origin/main`; 자동 수집·서버 전송은 실제 DebugView/내보내기 검증 전까지 KPI 정본으로 사용하지 않는다.         |

## 1. 측정 원칙

```mermaid
flowchart LR
    Reach["화면 도달"] --> Exposure["사용 가능한 정보 노출"]
    Exposure --> Intent["사용자가 수락한 의도"]
    Intent --> Result["서버 또는 목적 화면의 성공 결과"]

    Auto["자동 전환 · 다시 그리기 · 재시도"] -.->|사용자 행동으로 세지 않음| Intent
    Cancel["취소 · 실패 · 백그라운드"] -.->|성공 결과로 세지 않음| Result
```

- `C`는 앱의 typed helper → `analytics.track()` 경로, `S`는 서버 Measurement Protocol, `S-LOG`는 서버 구조화 로그, `A`는 GA4/Firebase 자동 수집이다.
- 퍼널 정본에는 DebugView에서 검증된 `C`·`S`·`A`만 사용한다. `S-LOG`는 분석 export와 사용자 귀속이 확인되기 전까지 운영 진단용이다.
- 같은 결과를 앱과 서버가 함께 발행하지 않는다. 서버가 정본인 가입·이탈 결과는 앱의 클릭 이벤트와 분리한다.
- 그룹 이름·소개·아이콘 glyph·버튼 문구·asset·로컬 순서·raw `userId`는 신규 이벤트 payload에 넣지 않는다.

## 2. 기능별 이벤트·cohort fact 사전

| 기능    | 이벤트                              | 유형·주체         | 정확한 발행 시점                                              | 필수 속성·주의                                                                                 |
| ------- | ----------------------------------- | ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 공통    | `session_start`                     | lifecycle·A       | GA4 자동 세션 시작                                            | 앱 수동 발행 금지                                                                              |
| 공통    | `app_main_viewed`                   | screen·C          | main shell이 입력 가능한 foreground 진입당 1회                | `app_entry`, `auth_state`, `initial_tab`; rerender·탭 이동 제외                                |
| 공통    | `main_tab_selected`                 | action·C          | 비활성 글로벌 탭이 사용자 입력으로 실제 전환                  | `tab`, `from_tab`; 같은 탭 재탭·programmatic 이동 제외                                         |
| 공통    | `group_viewed`                      | screen·C          | 인증 사용자의 성공한 전체 소속 목록 확정 뒤 focus cycle당 1회 | `group_entry`, `group_count_bucket`; 목록 실패·부분 응답·rerender 제외                         |
| 01 획득 | `group_create_started`              | screen·C          | 생성 폼 표시 성공                                             | `entry_point`; 폼 진입당 1회                                                                   |
| 01 획득 | `group_create_submitted`            | action·C          | 유효한 생성 요청을 수락하고 API를 보내기 직전                 | `entry_point`, `is_private`; 요청당 1회                                                        |
| 01 획득 | `group_created`                     | result·C          | 생성 API 성공 응답 직후                                       | `entry_point`, `is_private`; 로컬 아이콘 저장과 분리                                           |
| 01 획득 | `group_find_opened`                 | screen·C          | 찾기 sheet가 실제 표시                                        | `entry_point`; open cycle당 1회                                                                |
| 01 획득 | `invite_link_opened`                | action·C          | 설치된 앱이 초대 링크를 처리                                  | 기존 `group_id`, `slug`, `via`                                                                 |
| 01 획득 | `group_invite_sheet_viewed`         | screen·C          | 초대 preview sheet가 실제 표시                                | 기존 `group_id`, `slug`, `entry=link\|deferred`                                                |
| 01 획득 | `group_join_attempted`              | action·C          | 식별자 조회를 끝내고 검색·초대 가입 API를 보내기 직전         | `join_method`, `result_track`; 요청당 1회                                                      |
| 01 획득 | `group_joined`                      | result·S+S-LOG    | 서버가 가입을 commit                                          | 선택적 `join_method`; `appInstanceId`가 있으면 GA4에도 발행, 없으면 S-LOG만; 앱 중복 발행 금지 |
| 01 획득 | `group_membership_reconciled`       | result·C          | 실제 가입 2xx 뒤 성공한 전체 목록에 요청 target이 포함        | `cause=join`, `result_track=s_log_only`; 요청당 1회, raw groupId 금지                          |
| 01 획득 | `group_first_membership_created_v1` | cohort fact·DWH   | commit된 snapshot의 계정 최초 멤버십 생성 시각을 산출         | `user_id`, `first_membership_created_at`, `cohort_version`; 앱·GA4 event로 발행 금지           |
| 02 탐색 | `group_card_deck_viewed`            | exposure·C        | 1개 이상 목록과 layout이 안정된 첫 렌더                       | `group_count_bucket`, `group_entry`, `guide_state`; focus당 1회                                |
| 02 탐색 | `group_card_flipped`                | action·C          | 사용자 입력으로 face가 실제 변경                              | `to_face`, `trigger`, `group_count_bucket`; guide·animation·복귀 제외                          |
| 02 탐색 | `group_carousel_paged`              | action·C          | 사용자 입력으로 active `groupId`가 변경                       | `trigger`, `from_index`, `to_index`, `group_count_bucket`; resize 제외                         |
| 02 탐색 | `group_card_action_clicked`         | action·C          | 뒷면의 focus·room·settings 흐름이 수락                        | `action`, `role`, `back_source`; disabled·연타·no-op 제외                                      |
| 02 탐색 | `group_card_reordered`              | action·C          | drag drop·popover 유효 이동·접근성 이동으로 순서 commit       | `trigger`, `from_index`, `to_index`, `group_count_bucket`; drag 중간 제외                      |
| 02 탐색 | `group_card_icon_editor_viewed`     | screen·C          | 아이콘 편집기가 실제 표시                                     | 설정 편집기만; 생성 inline picker와 구분                                                       |
| 02 탐색 | `group_card_icon_save_result`       | result·C          | 로컬 쓰기 성공·실패 확정                                      | `surface`, `result`; glyph 제외                                                                |
| 02 탐색 | `tab_guide_completed`               | result·C          | 마지막 `시작`으로 안내가 닫힌 직후                            | `guide=groupDeck:v1`; session당 1회, key write와 분리                                          |
| 03 활동 | `group_room_viewed`                 | result·C          | 그룹 방의 최초 성공 렌더                                      | 기존 속성 + `entry_source`                                                                     |
| 03 활동 | `focus_session_started`             | result·C          | `FocusSession` 최초 화면 진입·세션 시작 처리 시 1회           | 기존 속성 + 필수 `entry_source`; route context에서만 읽음                                      |
| 04 운영 | `group_settings_updated`            | result·C·진단     | 그룹 프로필 PATCH 성공                                        | 기존 `group_id`, `fields`; 성공 전용이며 시도·화면 수렴 분모 없음                              |
| 04 운영 | `group_owner_transferred`           | result·C·진단     | 방장 위임 API 성공                                            | 기존 `group_id`, `source`; 성공 전용이며 시도·화면 수렴 분모 없음                              |
| 04 운영 | `group_member_kicked`               | result·C·진단     | 멤버 강퇴 API 성공                                            | 기존 `group_id`; 성공 전용이며 시도·화면 수렴 분모 없음                                        |
| 04 운영 | `group_notice_grant_changed`        | result·C·진단     | 공지 권한 PATCH 성공                                          | 기존 `group_id`, `granted`; 성공 전용이며 시도·화면 수렴 분모 없음                             |
| 04 운영 | `group_left`                        | result·S-LOG·진단 | 서버가 나가기·강퇴를 commit                                   | `leave_reason`; 최상위 `user_id`는 이탈한 사용자, GA4 귀속 전 운영 로그 전용                   |

챌린지·내기의 생성, 참여, 결과 이벤트는 이 표에 추가하지 않는다. 해당 기능의 이벤트 정본은 챌린지 문서가 소유한다.

## 3. 공통 enum과 수명

| 속성                                     | 허용값                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `app_entry`                              | `cold_start \| foreground \| auth_complete \| unknown`                                    |
| `auth_state`                             | `guest \| member`                                                                         |
| `group_entry`                            | `tab \| invite \| push \| return \| unknown`                                              |
| `tab`                                    | `home \| league \| group \| menu`                                                         |
| `entry_point`                            | `empty \| list \| header \| end_card`                                                     |
| `group_count_bucket`                     | `0 \| 1 \| 2_5 \| 6_10`                                                                   |
| `guide_state`                            | `shown \| completed \| unknown`                                                           |
| `action`                                 | `focus \| room \| settings`                                                               |
| `role`                                   | `owner \| member`                                                                         |
| `to_face`                                | `front \| back`                                                                           |
| `back_source`                            | `user \| guide`                                                                           |
| `surface`                                | `create \| settings`                                                                      |
| `result`                                 | `success \| failed`                                                                       |
| `entry_source`                           | `group_card \| group_room \| group_find \| invite \| home_fab \| unknown`                 |
| `join_method` — C `group_join_attempted` | `search \| invite \| deferred_invite`                                                     |
| `join_method` — S/S-LOG `group_joined`   | `search \| invite \| deferred_invite \| code \| unknown \| 미전송(absent)`                |
| `result_track`                           | `ga4 \| s_log_only`                                                                       |
| `cause`                                  | `join`                                                                                    |
| `trigger`                                | `card_tap \| swipe \| indicator_press \| drag \| pointer_control \| accessibility_action` |
| `leave_reason`                           | `self \| kicked`                                                                          |

- 초대 sheet의 기존 `entry=link|deferred`는 초대 내부 속성이다. 그룹 화면 유입의 `group_entry`와 섞지 않는다.
- 생성 이벤트의 `entry_point`는 현재 빈 상태 `empty`, 현행 목록 CTA `list`, 02 카드 덱의 헤더 `header`만 허용한다. `end_card`는 찾기 전용이다. 화면이 목록 수로 추론하지 않고 진입 route가 값을 전달한다.
- `code`는 신규 앱 C 이벤트가 만들지 않는 legacy 서버 결과다. nonblank 계약 밖 값은 서버가 `unknown`으로 정규화한다. null·blank·구버전 미전송은 payload에 `absent` 문자열을 넣지 않고 `join_method` 키 자체를 생략한다.
- `back_source=guide`는 안내가 만든 뒷면을 사용자가 다시 flip하기 전까지만 유지한다. front로 돌아간 뒤 다시 연 back은 `user`다.
- `focus_session_started.entry_source`는 집중 진입점에서 확정해 route context로 `FocusCategory → FocusSession`까지 그대로 보존한다. 카드 CTA는 `group_card`, 그룹방 FAB는 `group_room`, 글로벌 집중 FAB는 `home_fab`를 명시하고, source가 없는 구버전·외부 진입은 `FocusCategory` 진입에서 `unknown`으로 한 번만 정규화한다. `FocusCategory`는 필수 `entrySource`를 `FocusSession`에 넘기며 `initialGroupId`에서 source를 추론하거나 중간 화면에서 덮어쓰지 않는다. route를 재사용할 때 이전 source가 남지 않도록 source 없는 진입도 `unknown`을 명시한다. 현재 직접 집중 진입이 없는 `group_find|invite`는 실제 route가 생기기 전에는 발행하지 않는다.
- `focus_session_started`는 `FocusSession` 최초 화면 진입·세션 시작 처리의 결과다. live marker·heartbeat 등 후속 API 성공을 뜻하지 않으며, 같은 화면의 rerender·재시도에는 다시 발행하지 않는다.
- `trigger`는 이벤트별 허용값을 더 좁힌다. flip은 `card_tap|accessibility_action`, page는 `swipe|indicator_press|accessibility_action`, reorder는 `drag|pointer_control|accessibility_action`만 허용한다.
- `group_left`의 최상위 서버 로그 `user_id`는 행위자가 아니라 **소속에서 빠진 사용자**다. 자발 이탈은 요청자, 강퇴는 `targetUserId`를 명시 오버로드로 기록하고 `leave_reason=self|kicked`로 구분한다. 방장 행위자 정보가 필요하면 기존 요청·감사 맥락을 사용하며 이벤트 payload에 raw ID를 중복 전송하지 않는다.
- 현재 서버는 자발 이탈과 강퇴 모두 `group_id`만 남기고, 강퇴 로그의 최상위 `user_id`도 요청한 방장 MDC를 사용한다. 위 `group_left` 계약이 구현·export 검증되기 전에는 이 이벤트를 이탈률·강퇴율 KPI에 사용하지 않는다.
- 네 개의 기존 운영 앱 이벤트는 API 성공만 기록하고 수락된 시도·서버 commit 정본·최신 화면 수렴을 연결하지 않는다. `group_left`와 함께 운영 진단에는 사용할 수 있지만 v1 권한·나가기 성공률의 분자·분모에는 사용하지 않는다.
- 현재 앱의 `group_viewed`는 소속 목록 확정 전에 발행하고 위 두 필수 속성을 보내지 않는다. 성공한 전체 목록 뒤로 발행 위치를 옮기고 typed payload를 검증하기 전에는 F3의 0개 사용자 분모로 사용하지 않는다.
- `GRP-01` 목표 계약은 검색·초대 가입 모두 `getAppInstanceId()`를 먼저 best-effort로 끝낸 뒤 `group_join_attempted(result_track=ga4|s_log_only)`와 `joinGroup`을 await 간격 없이 바로 이어 실행하는 것이다. 현재 초대는 시도 이벤트 뒤 식별자를 조회하고 검색은 식별자·`result_track`을 보내지 않는다. 조회 실패·미지원은 가입을 막지 않고 S-LOG 결과만 남기며, 두 경로의 순서·typed payload·DebugView를 확인하기 전에는 cold fallback을 포함한 GA4 F3 전환을 출시 지표로 사용하지 않는다.
- 기존 `group_room_viewed` 외 새 카드 이벤트에는 raw `group_id`를 추가하지 않는다.

## 4. 공통 퍼널과 귀속

```text
F1 앱 → 그룹
  app_main_viewed(auth_state=member)
    ├─ main_tab_selected(tab=group) → group_viewed(group_entry=tab, group_count_bucket=0|1|2_5|6_10)
    └─ group_viewed(group_entry=invite|push|unknown, group_count_bucket=0|1|2_5|6_10)

F2 내 그룹 탐색 → 행동 결과
  group_card_deck_viewed
    → [tab_guide_completed OR group_card_flipped(to_face=back)]
    → group_card_action_clicked
      ├─ room  → group_room_viewed(entry_source=group_card)
      └─ focus → focus_session_started(entry_source=group_card)

F3 그룹 획득 → 소속 반영
  empty opener: group_viewed(group_count_bucket=0)
    ├─ group_find_opened → [검색 선택] → group_join_attempted(search) → group_joined
    ├─ invite_link_opened → group_invite_sheet_viewed → group_join_attempted(invite|deferred_invite) → group_joined
    └─ group_create_started → group_create_submitted → group_created
  cold invite fallback: 열린 episode 없이 group_join_attempted(invite|deferred_invite, result_track=ga4) → group_joined
  s_log_only terminal: 실제 join 2xx → target을 포함한 전체 목록 → group_membership_reconciled → unattributed 종료
  서버 성공 → 성공한 전체 소속 목록 확인 → 다음 목적 화면 노출
```

- F1은 로그인 `user_id + ga_session_id` 고유 세션으로 본다. 탭 전환 뒤 10초 안의 `group_viewed(group_entry=tab)`만 navigation 성공으로 귀속한다.
- F2의 뒷면 사용 가능은 같은 session에서 guide 완료와 사용자 flip의 합집합으로 dedupe한다. room 결과는 action 뒤 30초, focus 결과는 10분을 초기 귀속 window로 둔다. focus 결과는 `entry_source=group_card`가 route 전체에서 보존된 경우에만 카드 action에 귀속한다.
- F3에서 검색은 선택 단계다. 기본 목록에서 바로 가입해도 정상이다. 가입 결과 정본은 서버 `group_joined`, 생성 결과는 현재 앱 `group_created`이며 같은 결과의 앱·서버 중복 발행을 금지한다.
- F3 집계 단위는 **획득 episode**이며 opener를 분리한다. 같은 Firebase `user_pseudo_id`의 첫 `group_viewed(group_count_bucket=0)`는 `empty`, 열린 episode가 없을 때 실제 API 전송 직전의 `group_join_attempted(invite|deferred_invite,result_track=ga4)`는 `invite_intent` fallback episode를 연다. 성공 결과 또는 30분 경과 중 먼저 오는 시점에 닫는다.
- `invite_link_opened`는 설치된 앱이 direct URL을 처리한 진단 이벤트이고, `group_invite_sheet_viewed`는 direct·deferred preview 노출 이벤트다. 둘 자체는 F3 opener가 아니며, deferred 복원에서 과거 `invite_link_opened`를 재발행하지 않는다. 시트 노출·게스트 로그인 대기·오류만으로 분모를 만들지 않는다.
- cold direct·deferred 가입은 최초 목록의 0개 확정을 기다리거나 UX를 막지 않는다. 먼저 발생한 `invite_intent`가 episode를 열며, 뒤늦은 0개 목록·rerender·foreground·같은 pending invite 재표시는 분모를 추가하지 않는다. 다른 링크의 실제 가입 요청도 기존 30분 episode가 열려 있으면 진단 시도만 남긴다.
- 서버 `group_joined`의 `app_instance_id`는 클라이언트 `user_pseudo_id`와 같아야 한다. 현재 서버 MP에는 `ga_session_id`가 없으므로 F3 연결 키나 같은-session 조건으로 쓰지 않고, 첫 분모부터 **30분 이하**의 결과만 귀속한다.
- 수락되어 실제 API가 전송된 `group_join_attempted`·`group_create_submitted`는 반복 시도 진단으로 모두 남기되 분모를 늘리지 않는다. 단, 열린 episode가 없는 direct·deferred 초대의 첫 `result_track=ga4` join attempt만 `invite_intent` 분모 1건이다. `s_log_only`·검색 attempt는 fallback opener가 아니다. validation 실패·잠금 거절·disabled tap은 시도 이벤트 0건이다.
- 같은 episode의 최초 `group_created` 또는 **선행 `group_join_attempted`와 `join_method`가 일치하는** `group_joined(search|invite|deferred_invite)`만 전환 1건으로 센다. `user_pseudo_id`가 같고 30분 이하인 결과만 인정한다. 두 번째 실제 2xx의 결과 이벤트도 해당 요청에 1회 남기되 F3 전환 집계에서는 무시하고, 같은 요청 결과의 재전송은 dedupe한다. 이후 성공한 전체 0개 목록을 다시 본 시점에만 새 episode를 연다.
- 열린 episode에 `group_joined(code|unknown|미전송)` 또는 C/S `join_method` 불일치가 먼저 오면 `unattributed_legacy_or_invalid_method`로 닫고 `conversion=unattributed`로 분자·분모에서 제외한다. 뒤의 결과를 그 episode에 귀속하지 않는다. 열린 episode가 없으면 이 결과는 S/S-LOG 데이터 품질·legacy migration 진단만 남기고 새 episode를 열지 않는다.
- `empty`와 `invite_intent`는 분모의 의미가 다르므로 source별 전환율을 따로 보고하고 하나의 F3 비율로 합치지 않는다.
- `group_membership_reconciled`는 가입 성공 전환을 대체하지 않는다. 실제 join 2xx의 `{targetGroupId, mutation=joined, resultTrack=s_log_only}`를 보존하고, 이어진 성공한 전체 목록이 1개 이상이며 target을 포함할 때만 발행한다. `ALREADY_MEMBER`·목록 실패/부분 응답·target 미포함·늦은 세대에는 발행하지 않는다.
- 열린 `empty` episode에서 최초 reconciliation이 30분 안에 오면 그 시각에 `membership_observed_s_log_only`로 닫는다. 이는 `conversion=unattributed`이며 GA4 전환율 분자·분모에서 제외한다. 닫힌 뒤 도착한 `group_joined|group_created`는 이전 episode에 귀속하지 않는다. `result_track=ga4` reconciliation은 서버 after-commit 결과보다 먼저 올 수 있으므로 발행하지 않는다.
- `appInstanceId`가 없어 `result_track=s_log_only`인 cold invite는 GA4 F3 episode·분모를 열지 않고 S-LOG 운영 지표에만 남긴다. episode 중 로그인 `user_id`가 바뀐 경우도 GA4 F3에서 제외하고, S-LOG 운영 집계와 GA4 전환율을 시간만으로 조인하거나 합산하지 않는다. reconciliation이 없으면 기존 30분 timeout으로 닫되 성공·실패로 단정하지 않는다.
- F3 획득 episode와 `G-P3` 신규 활성화 cohort는 다른 분석 단위다. 기존 멤버의 추가 그룹 생성·가입은 이벤트 진단에는 남지만 `empty` episode나 생애 최초 멤버십 cohort를 새로 만들지 않는다. `group_created`·`group_joined`·reconciliation을 cohort opener로 재사용하지 않는다.

### 4.1 `G-P3` 활성화 cohort

- `group_first_membership_created_v1`은 이벤트 발행값이 아니라 commit된 서버 snapshot의 derived fact다. 인증된 비게스트 `user_id`별 모든 `group_members` 행에서 `MIN(created_at)`을 `first_membership_created_at=t0`로 산출한다. `created_at`은 행 영속화 때 부여된 시각이지 transaction commit timestamp가 아니며, rollback된 행은 snapshot에 없다. 생성자의 OWNER 행과 모든 join method를 포함하고 `is_left` 현재값으로 과거 이력을 제거하지 않는다.
- 신규 활성화 분모는 `t0 >= cohort_contract_start_utc`인 계정이다. 재가입·추가 그룹 획득은 같은 계정의 두 번째 opener가 아니며, 기준 이전 기존 멤버는 별도 관찰군으로 분리한다. nullable·유실된 `created_at`은 임의로 `updated_at`·첫 화면 시각으로 보정하지 않고 backfill 검증 전에는 기준선을 차단한다.
- 서버 fact의 `user_id`는 앱이 Firebase SDK에 설정한 JWT UUID의 GA4 `user_id`와 결합한다. raw ID를 event parameter로 복제하거나 `user_pseudo_id`·시각 근접 조인을 사용하지 않는다. 모든 서버 멤버십 행은 GA4·S-LOG 결과 도착 여부와 무관하게 포함한다.
- 분자는 `[t0, t0+7×24시간)`의 `focus_session_started(entry_source=group_card|group_room)` 존재 여부다. 계정당 cohort·분자를 각각 1건으로 dedupe하고 `t0+7×24시간 <= as_of_utc`인 성숙 cohort만 보고한다. 쿼리 산출물에는 contract version·cutoff·as-of·서버/GA4 snapshot을 함께 남긴다.
- CTA 의도 뒤 결과가 없으면 취소·background·navigation 실패일 수 있다. 클릭을 성공으로 해석하지 않는다.

## 5. 구현·검증 게이트

1. 신규 클라이언트 이벤트는 `analyticsEvents.ts`의 typed helper 한 경로에서만 보낸다. 화면의 Firebase 직접 호출을 금지한다.
2. cold/warm start, 로그인 전환, 탭 재선택, background/foreground별 once 기준을 단위 테스트한다.
3. DebugView에서 F1의 tab/direct 분기, F2의 guide/user 분기, F3의 find/invite/create 분기를 각각 검증한다.
4. rerender·resize·route 복귀·guide programmatic 전환·no-op·취소는 사용자 이벤트 0건이어야 한다.
5. CTA 연타는 action 최대 1건이며 실제 목적 결과가 없으면 result 0건이어야 한다.
6. raw payload에 그룹 이름·소개·glyph·asset·로컬 순서·raw `userId`가 없는지 확인한다.
7. 서버 로그에서 자발 이탈은 `leave_reason=self`와 요청자 `user_id`, 강퇴는 `leave_reason=kicked`와 대상자 `user_id`로 기록되는지 검증한다.
8. 검색·초대 가입 각각에서 식별자 조회가 끝난 직후 `group_join_attempted(join_method,result_track)`와 가입 API가 연속 호출되고, `appInstanceId` 있음은 GA4+S-LOG, 없음은 비차단 S-LOG 결과가 되는지 검증한다.
9. F3 export fixture에서 같은/다른 `user_pseudo_id`, 29분 59초/30분 초과, 반복 0개 화면·시도·결과, 계정 전환을 검증해 episode당 분모·전환이 각각 최대 1건인지 확인한다.
10. cold direct·deferred에서 `group_viewed(0)` 없이 `result_track=ga4` attempt→joined가 `invite_intent` episode 1·전환 1인지, `s_log_only`는 episode 0인지, 열린 `empty` episode 뒤 초대 시도는 분모 0건 추가인지, preview·로그인 대기만으로는 episode 0건인지 검증한다.
11. `empty` episode의 s_log_only join 2xx→target 포함 전체 목록은 reconciliation 1건과 `unattributed` 종료를 만들고, ALREADY_MEMBER·목록 실패·target 미포함은 0건인지 검증한다. 종료 뒤 두 번째 join/create 결과가 이전 episode에 귀속되지 않아야 한다.
12. 서버 결과의 `code` 보존, 계약 밖 nonblank→`unknown`, null·blank→키 미전송을 실제 S-LOG·MP body에서 검증한다. F3 fixture는 정상 C/S method 일치만 전환으로 세고 legacy·unknown·absent·method mismatch를 `unattributed`로 닫아 후속 결과를 오귀속하지 않아야 한다.
13. 네 개의 운영 앱 결과 이벤트는 해당 API 2xx 뒤에만 1회이고 실패·rollback에는 0건인지 확인한다. attempt·commit·화면 reconciliation 상관 계약을 별도 승인하기 전에는 이 이벤트와 `group_left`로 운영 성공률 대시보드를 만들지 않는다.
14. 카드 CTA·그룹방 FAB·글로벌 집중 FAB·source 없는 외부 진입 각각에서 `group_card|group_room|home_fab|unknown`이 `FocusCategory → FocusSession`을 거쳐 최초 진입 이벤트에 1회 남고, route 재사용 때 이전 source가 누출되지 않는지 검증한다.
15. 생성 fixture는 route의 `entry_point`별 폼 표시 1회, validation·disabled·same-tick lock 거절 0회, 실제 API 요청마다 submitted 1회, API 2xx마다 created 1회를 검증한다. API 실패 뒤 새 유효 재시도, 비공개 링크 실패, 성공 뒤 목록 재조회 실패에도 같은 요청 결과를 재발행하지 않는다. 같은 F3 episode의 두 번째 실제 2xx는 `group_created`를 요청당 1회 남기되 conversion은 최초 결과 1건만 인정하고 이전 episode에 귀속하지 않는다.
16. `group_first_membership_created_v1` query fixture에서 create OWNER와 모든 서버 가입 이력은 GA4·S-LOG 결과 도착 여부와 무관하게 최초 `created_at` 1건으로 산출되는지 검증한다. 재가입·추가 그룹·`ALREADY_MEMBER`는 새 cohort 0건이고 기준 이전 기존 멤버는 신규 분모에서 제외해 별도 관찰군으로 남긴다.
17. cohort export는 nullable `created_at` backfill, 서버 UUID↔GA4 `user_id` 연결, 7×24시간 경계·미성숙 window·탈퇴 뒤 이력 보존·계정당 dedupe와 snapshot 재현성을 검증한다. 하나라도 증명하지 못하면 `G-P3` 기준선을 미산출한다.
18. 이벤트·대시보드 책임 역할과 DebugView 증거가 [구현 상태 정본](./implementation-status.md)에 배정되기 전에는 해당 분석 게이트를 완료로 표시하지 않는다.
