# 기획 API v1 대조표 — GROMO-1888

기획 [API v1 협의안](https://oneorthree.github.io/planning-document/docs/api/v1/index.html)(버전 `0.6-proposed · 2026-09-15`, 84행 화면 목록·98개 도메인 계약)과 이 레포의 화면 조회 14종·도메인 LLD를 한 행씩 대조한다. 기획팀에 그대로 전달하는 문서다. 정책 충돌 시 [policy.md](policy.md)가 정본이다.

## 1. 읽는 법

- **경로**: 우리 경로 정본은 레포 도메인 LLD다(policy.md B16). 기획 문서의 `/v1` 접두와 `/me/memberships`·`/islands/{islandId}/switch`·`.../members/{userId}/kick` 같은 새 이름은 채택하지 않았다 — 도메인 LLD가 경로를 이미 확정했기 때문이다.
- **이름이 바뀐 화면**(B25, 2026-09-16 결정): `boat`→`raft`, `sound`→`playback`, `post-office`→`mailbox`. `hall`은 v0.3에서 쓰던 이름인데 지금은 폐기했다 — 기록 화면은 `library`, 섬 관리 화면은 `town-hall`이다. `island-manage`(초안 이름)도 `town-hall`로 확정했다.
- **상태 값 5종**:
  - `그대로` — 기획 계약과 method·경로가 사실상 같다(도메인 명령으로 그대로 남는다).
  - `경로만 다름` — 같은 기능이지만 경로·이름·method가 다르다(예: `boat`→`raft`, `POST .../kick`→`DELETE .../members/{userId}`).
  - `화면 조회로 흡수` — 기획에서 화면 진입 시 별도 GET으로 불렀던 것을 이제 `/screens/*` 응답의 조각 하나로 받는다. B12에 따라 **쓰기 계약은 절대 이 상태가 아니다** — 화면 GET의 부수효과로 만들지 않는다.
  - `레포에 없음` — 기획에는 있는데 이 레포 도메인 LLD 어디에도 설계가 없다. §3에서 다시 모은다.
  - `폐기` — 검토 후 채택하지 않기로 확정한 것(B15 폐지 화면, B18 `progress` 등).
- **검증**: 「우리 경로」 열의 문자열은 전부 실제 도메인 LLD에 있는 문자열인지 `grep -n`으로 확인했다(정본 문서 열이 근거). 존재하지 않는 경로를 이 표에 적지 않았다.

## 2. 대조표

### 인증·계정 (14개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| guest | POST `/v1/auth/guest-sessions` | POST `/api/v1/auth/guest`(기존 legacy, 미변경) | [account LLD](../account/low-level-design.md) §1 "신규 guest 생성은 이 7개에 추가하지 않으며 기존 `/api/v1/auth/guest`…을 함께 검증한다" | 경로만 다름 |
| oauth | POST `/v1/auth/oauth/sessions` | POST `/auth/sessions` | [account LLD](../account/low-level-design.md) §2.1 | 경로만 다름 |
| refresh | POST `/v1/auth/token/refresh` | POST `/api/v1/auth/refresh`(기존 legacy, 미변경) | account LLD "refresh와 세션 마이그레이션"(§2.1 뒤) "기존 refresh 계약은 7개 신규 endpoint에 추가 계수하지 않는다" | 경로만 다름 |
| logout | DELETE `/v1/auth/session` | DELETE `/auth/sessions/current` | [account LLD](../account/low-level-design.md) §2.4 | 경로만 다름 |
| terms | GET `/v1/terms/current` | — | 레포 LLD 없음. 로그인 요청의 `termsVersion` 필드(§2.1)가 최초 동의만 흡수하고, 별도 「현재 약관 조회」 GET은 없다 | 레포에 없음 |
| consent | POST `/v1/me/terms-consents` | — | 레포 LLD 없음(위와 같은 이유 — 로그인 후 별도 재동의 계약이 없다) | 레포에 없음 |
| account | GET `/v1/me/account` | `me` 조각(GET `/me`) | [account LLD](../account/low-level-design.md) §2.2 — 로그인 수단 등 계정 필드는 `GET /me` 응답에 포함 | 화면 조회로 흡수 → `me`(account) |
| convert | POST `/v1/me/auth-identity` | — | 레포 LLD 없음. [decisions.md](../../architecture/decisions.md) A24가 "계정 전환 보상(내용은 기획 미정)"이라고만 기록 — 읽기 전용 파일이라 직접 확인만 함 | 레포에 없음 |
| conflict | POST `/v1/me/identity-conflicts/{conflictId}/resolve` | — | 레포 LLD 없음 | 레포에 없음 |
| me | GET `/v1/me` | `me` 조각(GET `/me`) | [account LLD](../account/low-level-design.md) §2.2 | 화면 조회로 흡수 → `me`(launch·raft·account) |
| profile | PATCH `/v1/me/profile` | PATCH `/me` | [account LLD](../account/low-level-design.md) §2.3 | 경로만 다름 |
| settings | GET `/v1/me/settings` | `settings` 조각(순수 GET, Notification) | [account LLD](../account/low-level-design.md) §2.6, [implementation-business-api.md](implementation-business-api.md) §4 각주(`NotificationApiClient.getSettings()`) | 화면 조회로 흡수 → `settings`(account) |
| settings-save | PATCH `/v1/me/settings` | PATCH `/me/settings` | [account LLD](../account/low-level-design.md) §2.7 | 경로만 다름 |
| delete-account | DELETE `/v1/me` | DELETE `/me` | [account LLD](../account/low-level-design.md) §2.5 | 그대로 |

### 섬·탐색 (20개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| island-create | POST `/v1/islands` | POST `/islands` | [island-membership LLD](../island-membership/low-level-design.md) §3.1 | 그대로 |
| island | GET `/v1/islands/{islandId}` | `island` 조각(GET `/islands/{islandId}`) | [island-membership LLD](../island-membership/low-level-design.md) §3.4 | 화면 조회로 흡수 → `island`(visit·home·focus·town-hall·library·board·mailbox·shop·playback, 섬 문맥) |
| island-save | PATCH `/v1/islands/{islandId}` | PATCH `/islands/{islandId}` | [island-management LLD](../island-management/low-level-design.md) §3.1 | 그대로 |
| memberships | GET `/v1/me/memberships` | `memberships` 조각(GET `/me/islands`) | [island-membership LLD](../island-membership/low-level-design.md) §3.5, policy.md B16(이 이름 명시 불채택) | 화면 조회로 흡수 → `memberships`(explore) |
| discover | GET `/v1/islands/discover` | `islands` 조각(GET `/islands/discover`) | [island-membership LLD](../island-membership/low-level-design.md) §3.3, policy.md B19 | 화면 조회로 흡수 → `islands`(explore, 미소속일 때) |
| search | GET `/v1/islands/search` | `islands` 조각(GET `/islands?q=`) | [island-membership LLD](../island-membership/low-level-design.md) §3.2, policy.md B19 | 화면 조회로 흡수 → `islands`(explore, 소속 있을 때) |
| invite-resolve | POST `/v1/invitations/resolve` | POST `/invitations/resolve` | [island-membership LLD](../island-membership/low-level-design.md) §3.10 | 그대로 |
| join | POST `/v1/islands/{islandId}/join-requests` | POST `/islands/{islandId}/memberships` | [island-membership LLD](../island-membership/low-level-design.md) §3.7 | 경로만 다름 |
| my-requests | GET `/v1/me/join-requests`(목록) | — | [island-membership LLD](../island-membership/low-level-design.md) §3.8은 단건(`GET /me/join-requests/{requestId}`)만 있다 — 목록 GET 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| join-cancel | DELETE `/v1/me/join-requests/{requestId}` | DELETE `/me/join-requests/{requestId}` | [island-membership LLD](../island-membership/low-level-design.md) §3.9 | 그대로 |
| join-incoming | GET `/v1/islands/{islandId}/join-requests` | `joinRequests` 조각(GET `/islands/{islandId}/join-requests`) | [island-management LLD](../island-management/low-level-design.md) §3.3 | 화면 조회로 흡수 → `joinRequests`(town-hall, 방장만) |
| join-answer | PATCH `/v1/islands/{islandId}/join-requests/{requestId}` | PATCH `/islands/{islandId}/join-requests/{requestId}` | [island-management LLD](../island-management/low-level-design.md) §3.4 | 그대로 |
| invite | POST `/v1/islands/{islandId}/invites` | POST `/islands/{islandId}/invitations` | [island-membership LLD](../island-membership/low-level-design.md) §3.11 | 경로만 다름 |
| members | GET `/v1/islands/{islandId}/members` | `members` 조각(GET `/islands/{islandId}/members`) | [island-management LLD](../island-management/low-level-design.md) §3.2 | 화면 조회로 흡수 → `members`(town-hall) |
| kick | POST `/v1/islands/{islandId}/members/{userId}/kick` | DELETE `/islands/{islandId}/members/{userId}` | [island-management LLD](../island-management/low-level-design.md) §3.6, policy.md B16 | 경로만 다름 |
| transfer | POST `/v1/islands/{islandId}/host-transfer` | POST `/islands/{islandId}/host-transfer` | [island-management LLD](../island-management/low-level-design.md) §3.5 | 그대로 |
| leave | POST `/v1/islands/{islandId}/leave` | DELETE `/islands/{islandId}/memberships/me` | [island-management LLD](../island-management/low-level-design.md) §3.7 | 경로만 다름 |
| switch | POST `/v1/islands/{islandId}/switch` | PUT `/me/current-island` | [island-membership LLD](../island-membership/low-level-design.md) §3.6, policy.md B16(이 이름 명시 불채택) | 경로만 다름 |
| visit | GET `/v1/islands/{islandId}/visit` | `island` 조각(GET `/islands/{islandId}`, 공개 요약) | [island-membership LLD](../island-membership/low-level-design.md) §3.4, [implementation-business-api.md](implementation-business-api.md) §4 `visit` 행 | 화면 조회로 흡수 → `island`(visit) |
| rankings | GET `/v1/rankings/islands` | GET `/rankings/islands`(도메인 GET 직접 호출) | [island-rankings LLD](../island-rankings/low-level-design.md) "GET `/rankings/islands`", policy.md B15(진입 조회 1개 화면은 집계 없음) | 그대로 |

섬 내 주민 랭킹(`GET /islands/{islandId}/rankings/members`, v0.3 "tower" 화면 전용)은 기획 v1 98계약에 없다 — B23 "전망대 주민 랭킹 폐지"와 맞물려 화면 자체가 B15로 폐지됐으므로 이 표에 별도 행을 만들지 않는다.

### 집중·휴식 세션 (11개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| home-summary | GET `/v1/me/focus-summary` | `focusSummary` 조각(GET `/me/focus-summary`) | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "home-summary" | 화면 조회로 흡수 → `focusSummary`(home) |
| current-session | GET `/v1/me/focus-session` | `session` 조각(GET `/focus-sessions/current`) | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "session" | 화면 조회로 흡수 → `session`(launch·home·focus) |
| focus-members | GET `/v1/islands/{islandId}/focus-members` | `focusMembers` 조각(GET `/islands/{islandId}/focus-members`) | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "focus-group / rest-members" | 화면 조회로 흡수 → `focusMembers`(focus) |
| focus-start | POST `/v1/islands/{islandId}/focus-sessions` | POST `/focus-sessions` | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "start" | 경로만 다름 |
| session | GET `/v1/focus-sessions/{sessionId}` | — | policy.md B18 "결과 조회 GET을 만들지 않는다" | 폐기 |
| progress | PUT `/v1/focus-sessions/{sessionId}/progress` | — | policy.md B18 "기획 v1의 `progress` PUT은 채택하지 않는다" | 폐기 |
| pause | POST `/v1/focus-sessions/{sessionId}/pause` | POST `/focus-sessions/{sessionId}/pause` | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "pause" | 그대로 |
| resume | POST `/v1/focus-sessions/{sessionId}/resume` | POST `/focus-sessions/{sessionId}/resume` | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "resume" | 그대로 |
| finish | POST `/v1/focus-sessions/{sessionId}/finish` | POST `/focus-sessions/{sessionId}/finish` | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "finish", policy.md B18(결과는 이 응답으로 그린다) | 그대로 |
| rest-members | GET `/v1/islands/{islandId}/rest-members` | `restMembers` 조각(GET `/islands/{islandId}/rest-members`) | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "focus-group / rest-members" | 화면 조회로 흡수 → `restMembers`(home) |
| emote | POST `/v1/islands/{islandId}/emotes` | STOMP SEND `/app/islands/{islandId}/focus/emotes` | [focus-rest-session LLD](../focus-rest-session/low-level-design.md) "emote", policy.md B22(realtime `emotes` 토픽) | 경로만 다름 |

### 공용 자원·가계부 (2개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| wallet | GET `/v1/islands/{islandId}/wallet` | `wallets` 조각(GET `/islands/{islandId}/shop/wallets`) | [island-shop LLD](../island-shop/low-level-design.md) §2.1 | 화면 조회로 흡수 → `wallets`(home·town-hall·board·shop·playback) |
| ledger | GET `/v1/islands/{islandId}/resources/ledger` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |

### 건설 (4개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| buildables | GET `/v1/islands/{islandId}/construction-options` | `constructionOptions` 조각(GET `/islands/{islandId}/construction-options`) | [island-construction LLD](../island-construction/low-level-design.md) "GET `/islands/{islandId}/construction-options`" | 화면 조회로 흡수 → `constructionOptions`(town-hall) |
| build-target | PUT `/v1/islands/{islandId}/construction-target` | PUT `/islands/{islandId}/construction-target` | [island-construction LLD](../island-construction/low-level-design.md) "PUT `/islands/{islandId}/construction-target`" | 그대로 |
| construction | GET `/v1/islands/{islandId}/constructions/current` | — | [island-construction LLD](../island-construction/low-level-design.md) §응답 예시(:25-62)·§계약 표(:131) — `construction-options` 응답은 `selectedBuildingId` 와 옵션별 `selectable`·`buildable`·`blockedReason` 뿐이고 **진행 상태(`status`)는 없다**. `status` 는 POST `/constructions` 의 완료 응답(:88)에만 있다 | 레포에 없음(§3 신규 항목 — BG10에 없음) — 「현재 진행 중인 건설의 상태」를 화면이 필요로 하면 도메인 계약에 필드를 더해야 한다 |
| build | POST `/v1/islands/{islandId}/constructions` | POST `/islands/{islandId}/constructions` | [island-construction LLD](../island-construction/low-level-design.md) "POST `/islands/{islandId}/constructions`" | 그대로 |

### 퀘스트·공지 (15개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| quests | GET `/v1/islands/{islandId}/quests`(목록) | `quests` 조각(GET `/islands/{islandId}/quests/current`) | [island-quests LLD](../island-quests/low-level-design.md) "quests" | 화면 조회로 흡수 → `quests`(board) — 목록이 아니라 진행 중인 것만 |
| quest | GET `/v1/quests/{questId}`(단건 상세) | GET `/islands/{islandId}/quests/{questId}/progress`(탭 시 직접 호출) | [island-quests LLD](../island-quests/low-level-design.md) "quest", policy.md B21 | 경로만 다름 — 화면 조회에 없음(B21, 상세는 탭할 때) |
| quest-create | POST `/v1/islands/{islandId}/quests` | POST `/islands/{islandId}/quests` | [island-quests LLD](../island-quests/low-level-design.md) "quest-create" | 그대로 |
| quest-edit | PATCH `/v1/quests/{questId}` | PATCH `/islands/{islandId}/quests/{questId}` | [island-quests LLD](../island-quests/low-level-design.md) "quest-edit" | 경로만 다름 |
| claim | POST `/v1/quest-occurrences/{occurrenceId}/rewards/me` | POST `/islands/{islandId}/quests/{questId}/claims` | [island-quests LLD](../island-quests/low-level-design.md) "claim" | 경로만 다름 |
| reward-notifications | GET `/v1/me/reward-notifications` | — | 레포 LLD 없음 | 레포에 없음(§3 신규 항목 — BG10에 없음) |
| reward-ack | POST `/v1/me/reward-notifications/{notificationId}/ack` | — | 레포 LLD 없음 | 레포에 없음(§3 신규 항목 — BG10에 없음) |
| notices | GET `/v1/islands/{islandId}/notices` | `notices` 조각(GET `/islands/{islandId}/notices`) | [island-board LLD](../island-board/low-level-design.md) "notices" | 화면 조회로 흡수 → `notices`(board) |
| notice | GET `/v1/notices/{noticeId}` | GET `/islands/{islandId}/notices/{noticeId}`(탭 시 직접 호출) | [island-board LLD](../island-board/low-level-design.md) "notice", policy.md B15(댓글 첫 페이지 포함) | 경로만 다름 — 화면 조회에 없음(B21) |
| notice-create | POST `/v1/islands/{islandId}/notices` | POST `/islands/{islandId}/notices` | [island-board LLD](../island-board/low-level-design.md) "notice-create" | 그대로 |
| notice-edit | PATCH `/v1/notices/{noticeId}` | PATCH `/islands/{islandId}/notices/{noticeId}` | [island-board LLD](../island-board/low-level-design.md) "notice-edit" | 경로만 다름 |
| notice-delete | DELETE `/v1/notices/{noticeId}` | DELETE `/islands/{islandId}/notices/{noticeId}` | [island-board LLD](../island-board/low-level-design.md) "notice-delete" | 경로만 다름 |
| comments | GET `/v1/notices/{noticeId}/comments`(목록) | 없음 — `notice` 상세 GET의 `commentsCursor`/`comments`에 병합 | [island-board LLD](../island-board/low-level-design.md) "notice"(§ 응답 예시의 `comments`·`commentsCursor`), policy.md B15 | 경로만 다름 — 별도 GET 없이 `notice` 상세에 병합 |
| comment-create | POST `/v1/notices/{noticeId}/comments` | POST `/islands/{islandId}/notices/{noticeId}/comments` | [island-board LLD](../island-board/low-level-design.md) "comment" | 그대로 |
| comment-delete | DELETE `/v1/comments/{commentId}` | — | 레포 LLD 없음(island-board LLD에 댓글 삭제 계약 없음) | 레포에 없음(§3 신규 항목 — BG10에 없음) |

### 도서관·통계 (5개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| library-status | GET `/v1/islands/{islandId}/library/summary` | `island` 조각(도서관 완공 여부는 섬 문맥의 시설 목록에 포함) | [island-membership LLD](../island-membership/low-level-design.md) §3.4, [implementation-business-api.md](implementation-business-api.md) §4 `library` 행("섬 문맥(도서관 완공)") | 화면 조회로 흡수 → `island`(library, 섬 문맥) — 별도 summary 엔드포인트 없음 |
| focus-stats | GET `/v1/islands/{islandId}/library/statistics/focus` | `focusStatistics` 조각(GET `/islands/{islandId}/statistics/focus`) | [island-records LLD](../island-records/low-level-design.md) "GET `/islands/{islandId}/statistics/focus`" | 화면 조회로 흡수 → `focusStatistics`(library) |
| screen-stats | GET `/v1/islands/{islandId}/library/statistics/screen-time` | `screenTimeStatistics` 조각(GET `/islands/{islandId}/statistics/screen-time`) | [island-records LLD](../island-records/low-level-design.md) "GET `/islands/{islandId}/statistics/screen-time`" | 화면 조회로 흡수 → `screenTimeStatistics`(library) |
| fish-earnings | GET `/v1/islands/{islandId}/library/fish-earnings` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| screen-upload | PUT `/v1/me/screen-time/{date}` | PUT `/me/screen-time/{date}` | [island-records LLD](../island-records/low-level-design.md) "PUT `/me/screen-time/{date}`" | 그대로 |

### 친구·편지 (14개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| friend-search | GET `/v1/users/search` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friends | GET `/v1/me/friends` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friend-requests | GET `/v1/me/friend-requests` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friend-send | POST `/v1/me/friend-requests` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friend-answer | PATCH `/v1/me/friend-requests/{requestId}` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friend-cancel | DELETE `/v1/me/friend-requests/{requestId}` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| friend-delete | DELETE `/v1/me/friends/{friendId}` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| island-messages | GET `/v1/islands/{islandId}/messages` | `messages` 조각(Realtime GET `/islands/{islandId}/messages`) | [island-mailbox LLD](../island-mailbox/low-level-design.md) §1 "messages" | 화면 조회로 흡수 → `messages`(mailbox) |
| island-message | POST `/v1/islands/{islandId}/messages` | POST `/islands/{islandId}/messages` | [island-mailbox LLD](../island-mailbox/low-level-design.md) §1 "message" | 그대로 |
| letters-received | GET `/v1/me/letters/received` | — | 레포 LLD 없음(island-mailbox는 섬 편지방만 다룬다) | 레포에 없음(§3 BG10과 동일 항목) |
| letters-sent | GET `/v1/me/letters/sent` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| letter | GET `/v1/me/letters/{letterId}` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| letter-send | POST `/v1/me/letters` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |
| letter-read | PATCH `/v1/me/letters/{letterId}/read` | — | 레포 LLD 없음 | 레포에 없음(§3 BG10과 동일 항목) |

### 상점·보유품 (9개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| catalog | GET `/v1/islands/{islandId}/shop/catalog` | `products` 조각(GET `/islands/{islandId}/shop/products?category=`) | [island-shop LLD](../island-shop/low-level-design.md) §2.2 | 화면 조회로 흡수 → `products`(shop·playback) |
| product | GET `/v1/islands/{islandId}/shop/products/{productId}` | GET `/islands/{islandId}/shop/products/{productId}`(탭 시 직접 호출) | [island-shop LLD](../island-shop/low-level-design.md) §2.3, policy.md B21 | 경로만 다름 — 화면 조회에 없음 |
| purchase | POST `/v1/islands/{islandId}/shop/purchases` | POST `/islands/{islandId}/shop/orders` | [island-shop LLD](../island-shop/low-level-design.md) §2.4 | 경로만 다름 |
| inventory | GET `/v1/me/inventory` | `inventory` 조각(GET `/me/inventory`) | [island-appearance LLD](../island-appearance/low-level-design.md) §1.1 | 화면 조회로 흡수 → `inventory`(raft) |
| appearance | PUT `/v1/me/appearance` | PATCH `/me/appearance` | [island-appearance LLD](../island-appearance/low-level-design.md) §1.2 | 경로만 다름 |
| themes | GET `/v1/islands/{islandId}/themes`(목록) | — | [island-shop LLD](../island-shop/low-level-design.md) §2.2(카탈로그 `category` enum은 `personal\|island\|sound`뿐이라 "테마" 카테고리가 명시돼 있지 않다) | 레포에 없음 — island-appearance §1.4는 테마 *적용*(PATCH)만 다루고 *목록 조회*는 없다 |
| theme-save | PUT `/v1/islands/{islandId}/themes` | PATCH `/islands/{islandId}/appearance` | [island-appearance LLD](../island-appearance/low-level-design.md) §1.4 | 경로만 다름 |
| my-orders | GET `/v1/me/purchase-history`(섬 무관 전체) | 부분 대응: GET `/islands/{islandId}/shop/orders?scope=personal`(한 섬 범위만) | [island-shop LLD](../island-shop/low-level-design.md) §2.5 — 섬 단위 경로로만 정의됨 | **레포에 없음**(§3 신규 항목) — 여러 섬에서 산 개인 구매를 합친 전체 이력 계약이 없다. 경로 차이가 아니라 기능 차이라 `경로만 다름` 으로 두면 기획팀이 이미 제공된다고 읽는다 |
| island-orders | GET `/v1/islands/{islandId}/purchase-history` | GET `/islands/{islandId}/shop/orders?scope=shared` | [island-shop LLD](../island-shop/low-level-design.md) §2.5 | 경로만 다름 |

### 축음기·음악 (4개 계약)

| 기획 계약 이름 | 기획 경로 | 우리 경로 | 정본 문서 | 상태 |
| --- | --- | --- | --- | --- |
| gramophone | GET `/v1/islands/{islandId}/gramophone` | `playback` 조각(GET `/islands/{islandId}/playback`) | [island-playback LLD](../island-playback/low-level-design.md) "GET `/islands/{islandId}/playback`" | 화면 조회로 흡수 → `playback`(home·focus·playback) |
| audio-catalog | GET `/v1/islands/{islandId}/gramophone/catalog` | `products` 조각(GET `/islands/{islandId}/shop/products?category=sound`) | [island-shop LLD](../island-shop/low-level-design.md) §2.2(카탈로그 `category` enum), policy.md B20 "축음기 전용 구매 계약을 만들지 않는다" | 화면 조회로 흡수 → `products`(playback, category=sound) |
| audio-purchase | POST `/v1/islands/{islandId}/gramophone/purchases` | POST `/islands/{islandId}/shop/orders` | [island-shop LLD](../island-shop/low-level-design.md) §2.4, policy.md B20 | 경로만 다름 |
| playback | PUT `/v1/islands/{islandId}/gramophone/playback` | PATCH `/islands/{islandId}/playback` | [island-playback LLD](../island-playback/low-level-design.md) "PATCH `/islands/{islandId}/playback`" | 경로만 다름 |

## 3. 「레포에 없음」 목록

아래는 §2에서 「레포에 없음」으로 표시한 항목을 원인별로 묶은 것이다. **BG10과 정확히 같은 집합인지 교차 검증**했다 — 결과는 다르다. BG10([policy.md](policy.md))과 [implementation-data-api.md](implementation-data-api.md) §4는 다음 6개만 기록한다: 친구 목록·받은/보낸 요청, 편지함·편지, 작성자 표시 정보 batch, 내 가입 대기 신청 목록, 공동 가계부, 주민별 누적 물고기.

이 표의 §2 전수 대조 결과 BG10에 **없는** 항목 6종을 추가로 찾았다:

| 항목 | 기획 계약 | BG10에 있는가 | 비고 |
| --- | --- | --- | --- |
| 계정 전환·충돌 해소 | convert, conflict | 아니오 | [decisions.md](../../architecture/decisions.md)(읽기 전용) A24 ①: "2.0(같이숲)은 빈 상태로 시작하고 기존 사용자에게는 계정 전환 보상으로 대신한다 — 보상 내용은 기획 결정이며 이 장부가 정하지 않는다"고만 언급 — API 계약 자체는 설계가 없다. `account` 화면(순서 1)의 프레임 80에 있어 BG04류 gate가 필요해 보인다 |
| 약관 재조회·재동의 | terms, consent | 아니오 | 로그인 시 `termsVersion` 필드로 최초 동의만 흡수. 약관 개정 후 기존 세션의 재동의 플로우가 없다 |
| 퀘스트 보상 알림 | reward-notifications, reward-ack | 아니오 | `board` 화면(프레임 48·49)이 참조하지만 island-quests LLD에도, 다른 도메인에도 이 계약이 없다 |
| 공지 댓글 삭제 | comment-delete | 아니오 | island-board LLD는 댓글 생성만 다루고 삭제 계약이 없다 |
| 건설 진행 상태 조회 | construction | 아니오 | `construction-options` 응답에 옵션별 `status` 가 없다 — 진행 중인 건설의 상태는 POST 완료 응답에만 있다. `town-hall` 화면이 진행 상태를 그리려면 도메인 계약에 필드가 필요하다 |
| 섬 무관 전체 구매 이력 | my-orders | 아니오 | island-shop 은 섬 단위 `orders` 만 정의한다. 여러 섬을 합친 개인 구매 이력 계약이 없다 |

이 6종은 이 문서 작성 중 새로 드러난 gap이라 policy.md의 BG 표에 반영돼 있지 않다 — **policy.md는 읽기·쓰기 소유가 이 워크스트림에 있으므로 반영 여부는 재영님 확인 후 별도로 추가한다(이 산출물 자체에는 추가하지 않았다).**

BG10과 일치하는 나머지(친구·편지·목록형 가입신청·가계부·물고기)는 §2 각 행에 "§3 BG10과 동일 항목"으로 표시했다.

## 4. 화면 14종 진입 조회 요약

기획 계약 중 **GET(읽기)** 만 집계한다 — B12에 따라 쓰기 계약은 화면 GET에 흡수되지 않고 그대로 남기 때문이다. "대체한 기획 계약 수"는 그 화면이 커버하는 기획 프레임들의 GET 계약을 중복 제거한 개수다.

| 화면 | 경로 | 대체한 기획 GET 계약 수 |
| --- | --- | --- |
| `launch` | `/screens/launch` | 1 (me) |
| `explore` | `/screens/explore` | 4 (memberships·discover·search·my-requests) |
| `visit` | `/screens/visit/{islandId}` | 2 (visit·my-requests) |
| `home` | `/screens/home` | 7 (island·home-summary·construction·wallet·current-session·rest-members·me) |
| `focus` | `/screens/focus` | 4 (current-session·focus-members·session·gramophone) |
| `town-hall` | `/screens/town-hall` | 7 (island·ledger·construction·members·join-incoming·wallet·buildables) |
| `library` | `/screens/library` | 4 (library-status·focus-stats·screen-stats·fish-earnings) |
| `board` | `/screens/board` | 7 (quests·quest·reward-notifications·construction·notices·notice·comments) |
| `mailbox` | `/screens/mailbox` | 4 (island-messages·letters-received·letters-sent·friends) |
| `shop` | `/screens/shop` | 4 (wallet·catalog·product·themes) |
| `playback` | `/screens/playback` | 3 (gramophone·audio-catalog·wallet) |
| `raft` | `/screens/raft` | 3 (me·inventory·friend-requests) |
| `friends` | `/screens/friends` | 3 (friend-search·friends·friend-requests) |
| `account` | `/screens/account` | 3 (me·account·settings) — `terms` 는 레포에 계약이 없고(§2 인증·계정) 약관 프레임 01 은 화면 조회가 없는 단일 GET 이라 집계에서 뺀다 |

합계 56 — 기획 GET 계약이 여러 화면에 걸쳐 재사용되는 경우(`me`·`wallet`·`island`·`construction` 등)가 있어 [§2](#2-대조표) 전체 GET 계약 수(약 45개, 폐기 2종·레포에 없음 다수 제외)보다 큰 값이다. 이 합계가 서로 다른 화면에서 같은 계약을 몇 번 대체했는지를 보여줄 뿐, 기획 98개 계약 수와 직접 비교되는 값은 아니다.

이 중 `focus`·`library`·`board`는 `quest`·`notice`·`comments`처럼 §2에서 "화면 조회에 없음"(B21, 탭 시 별도 호출)으로 표시한 GET도 프레임 커버리지 계산에는 포함했다 — 기획 원본 프레임이 그 계약을 "이 화면에서 쓴다"고 명시했기 때문이며, 우리 설계에서 실제로 화면 최초 응답에 포함되는지는 §2의 상태 열을 따른다.
