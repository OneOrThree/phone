# 레거시 `/api/v1/**` 잔존 매니페스트 (data-api)

GROMO-2069. data-api 의 `legacy` 그룹(`/v0/api-docs/legacy`)에 들어가는 **잔존
`/api/v1/**` 계약의 정본 목록**이다. 이 스펙은 생성만 되고 게시되지 않는다 —
무엇이 살아 있는지를 여기서 확정한다.

## §1 기준과 경고

- **기준 커밋: `232697f`(frozen base).** 아래 목록은 그 커밋의 컨트롤러 애노테이션
  스캔이다 — 현재 main 과 다를 수 있고, 「이미 삭제됐다」고 읽으면 안 된다.
- 삭제 판정·계획은 `../legacy-v1-retirement/README.md` 가 정본이다. 여기는
  「어떤 경로가 아직 코드에 존재하는가」만 적는다.
- **형제 PR 939 소유(제거 예정, 아직 살아 있음)** — 이 목록에서는 제거하지 않고
  표시만 한다:
  - `POST /api/v1/groups/{groupId}/code` (`GroupController`)
  - `PUT /api/v1/users/me/device-token` (`UserController`)
  - `DELETE /api/v1/users/me/device-token` (`UserController`)
- `/health`, `/l/*`, `/.well-known/*` 는 `/api/v1` 계약이 아니라 이 표에 없다.
  business-api 의 `/api/v1/**` 호환 라우트는 business-api 소유 — Apidog
  `business-api/legacy` 폴더에 들어가고 이 매니페스트 범위 밖이다.

## §2 잔존 경로 (110건)

| 컨트롤러 | 경로 | 비고 |
| --- | --- | --- |
| `analytics/AnalyticsController` | `POST /api/v1/analytics/events` | |
| `auth/AuthController` | `POST /api/v1/auth/guest` · `POST /api/v1/auth/refresh` | **삭제 금지** — 게스트·리프레시는 활성 의존(retirement §2) |
| `character/CharacterController` | `GET /api/v1/character/quota` · `POST /api/v1/character/generation` | |
| `character/CharacterModerationController` | `POST /api/v1/character/moderation` | |
| `focus/FocusController` | `GET·PATCH·DELETE /api/v1/tag` · `GET /api/v1/tag/defaults` · `DELETE /api/v1/tag/{tagId}` · `GET·POST·PATCH /api/v1/focus-session` · `POST /api/v1/focus-session/start` · `PATCH /api/v1/focus-session/cancel` | 태그 5종은 2.0 대응 없음 |
| `friend/FriendController` | `GET·POST /api/v1/friends/requests` · `POST .../requests/{id}/accept` · `POST .../requests/{id}/reject` · `GET /api/v1/friends` · `GET /api/v1/friends/search` · `DELETE /api/v1/friends/{friendUserId}` | 2.0 없음 |
| `friend/PinController` | `GET /api/v1/pins` · `POST /api/v1/pins/{userId}` · `DELETE /api/v1/pins/{userId}` | 2.0 없음 |
| `group/ChallengeResultAckController` | `POST /api/v1/me/challenge-results/{sessionId}/ack` · `.../claim` | 2.0 없음 |
| `group/GroupBetBatchController` | `POST /api/v1/groups/bets/settle` | 2.0 없음 |
| `group/GroupBetController` | `GET·POST /api/v1/groups/{g}/challenges/{c}/bets` · `POST .../challenges/{c}/join-next` · `POST .../challenges/{c}/join-week` · `POST /api/v1/groups/{g}/bets/{b}/join` · `DELETE /api/v1/groups/{g}/bets/{b}` · `DELETE .../bets/{b}/participation` · `POST /api/v1/groups/{g}/sessions/{s}/join` · `DELETE .../sessions/{s}/participation` | 2.0 없음 |
| `group/GroupBetQueryController` | `GET /api/v1/me/bet-sessions` · `GET /api/v1/me/challenge-results` · `GET /api/v1/groups/{g}/challenge-history` · `GET /api/v1/groups/{g}/challenges/{c}/deletion-preview` | 2.0 없음 |
| `group/GroupChallengeController` | `GET·POST /api/v1/groups/{g}/challenges` · `DELETE /api/v1/groups/{g}/challenges/{c}` · `POST .../challenges/{c}/end` · `PUT .../challenges/{c}/window-usage` | 2.0 없음 |
| `group/GroupController` | `GET·POST /api/v1/groups` · `GET /api/v1/groups/search` · `GET·PATCH·DELETE /api/v1/groups/{g}`(`DELETE`는 `members/me`) 등 17건 — `GET·PATCH /api/v1/groups/{g}` · `GET /api/v1/groups/{g}/overview` · `GET·PATCH /api/v1/groups/{g}/settings` · `GET·POST·PUT·DELETE /api/v1/groups/{g}/announcements[/{a}]` · `POST /api/v1/groups/{g}/join` · `DELETE /api/v1/groups/{g}/members/{u}` · `DELETE /api/v1/groups/{g}/members/me` · `PATCH /api/v1/groups/{g}/members/{u}/owner` · `POST /api/v1/groups/{g}/code`⚠️ | ⚠️ `POST .../code` 는 **PR 939 제거 예정**(형제 소유). `GET /api/v1/groups` 는 `server/realtime` 의 `GroupClient.fetchMyGroupIds` 가 활성 의존 |
| `group/GroupNotificationBatchController` | `POST /api/v1/groups/bets/notify-results` · `POST /api/v1/groups/challenges/notify-duration-end` · `POST .../notify-window-end` | 배치 진입점 |
| `currency/InGameCurrencyController` | `GET /api/v1/currency` · `GET /api/v1/currency/transactions` · `POST /api/v1/currency/earn` · `POST /api/v1/currency/spend` | |
| `item/EquipmentController` | `GET /api/v1/equipment` · `POST /api/v1/equipment/equip` · `DELETE /api/v1/equipment/{slotType}` | |
| `item/InventoryController` | `GET /api/v1/inventory` · `POST /api/v1/inventory/grant` | |
| `invitelink/InviteLinkController` | `POST /api/v1/groups/{g}/invite-link` · `POST /api/v1/invite-links/claim` | |
| `league/LeagueBatchController` | `POST /api/v1/league/batch/run` · `POST /api/v1/league/batch/resume` | 배치 진입점 |
| `league/LeagueController` | `GET /api/v1/league/ranking` · `GET·POST /api/v1/league/me/last-result[/ack]` · `GET /api/v1/league/me/rank` · `GET /api/v1/league/me/ranking` · `GET /api/v1/league/me/schedule` · `GET /api/v1/league/me/tier` | 2.0 없음 |
| `notification/NotificationBatchController` | `POST /api/v1/notifications/*/run` 7종 (inactive-return · league/crisis · league/deadline · league/final-deadline · league/relegation-warning · league/results · rank-overtake) | 배치 진입점 |
| `notification/NotificationTestController` | `POST /api/v1/notifications/test` | 테스트용 — prod 비활성 대상 검토 필요 |
| `occupation/OccupationController` | `GET /api/v1/occupations` | |
| `profile/ProfileController` | `GET /api/v1/users/{userId}/profile` · `GET /api/v1/users/{userId}/stats` | |
| `screentime/ScreenTimeController` | `POST /api/v1/screen-time` | |
| `stats/StatsController` | `GET /api/v1/stats/{by-category,focus,focus/average,heatmap,screen-time,streak,today}` 7건 | |
| `user/UserController` | `GET /api/v1/users/nickname/check` · `PATCH /api/v1/users/me/occupation` · `PUT /api/v1/users/me/device-token`⚠️ · `DELETE /api/v1/users/me/device-token`⚠️ | ⚠️ device-token 두 건은 **PR 939 제거 예정**(형제 소유) |

## §3 갱신 절차 (두 PR 통합 후)

이 목록은 스냅샷이다. PR 938(이 문서)과 PR 939(경로 삭제)가 **둘 다** 머지된 뒤
다음으로 목록을 재확정한다:

1. `server/data-api` 에서 `SPRING_PROFILES_ACTIVE=ci ./gradlew generateOpenApiDocs`.
2. 생성된 스펙의 `legacy` 그룹(`GET /v0/api-docs/legacy` 상당, 로컬 부팅 또는
   `build/docs/api/data-api.openapi.json` 생성 전에 플러그인의 `apiDocsUrl` 을
   바꿔 치지 않고, 앱 기동 상태에서 해당 엔드포인트를 curl)에서 `paths` 를 뽑는다.
3. 위 §2 표와 diff — PR 939 가 지운 3건이 빠졌는지 확인하고 표를 갱신한다.
4. 표에 없는 새 `/api/v1` 경로가 나타나면 retirement 표의 판정부터 채운다 —
   매니페스트는 결과지, 승인 장부가 아니다.
