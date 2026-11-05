# 앱 API·서버 경로·시나리오 커버리지

입력 소스 SHA-256: `c3c1afa983ad81714524716daebfdbb421a449dea70e0832f382ad0014b7259a`

API 122개 / 서버 경로 미일치 0개 / 미해석 0개 / 시나리오 등록 11개

**정적 분석 결과다. 서버 경로 일치·시나리오 등록은 테스트 실행 성공을 의미하지 않는다.**

| 메서드 | 경로 | 서버 선언 | 등록 시나리오 | 실제 실행 | 앱 호출 위치 |
| --- | --- | --- | --- | --- | --- |
| DELETE | `/api/v1/users/me/device-token` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/deviceToken.ts:73 |
| PUT | `/api/v1/users/me/device-token` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/deviceToken.ts:51 |
| GET | `/auth/sessions/app-requirements` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/developerNotices.ts:38 |
| POST | `/auth/sessions/current/refresh` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/client.ts:172 |
| DELETE | `/auth/sessions/current` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/auth.ts:370 |
| POST | `/auth/sessions/guest` | 일치 | guest-account | NOT_RUN | app/app-dev/src/services/api/auth.ts:255 |
| POST | `/auth/sessions` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/auth.ts:314 |
| DELETE | `/blocks/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/safety.ts:32 |
| GET | `/blocks` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/safety.ts:21 |
| POST | `/blocks` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/safety.ts:25 |
| GET | `/customization/catalog` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/customizationCatalog.ts:241 |
| POST | `/focus-sessions/{}/acknowledge` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:226 |
| POST | `/focus-sessions/{}/finish` | 일치 | focus-reward-construction | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:215 |
| PUT | `/focus-sessions/{}/live-activity` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/liveActivityPush.ts:36 |
| POST | `/focus-sessions/{}/pause` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:193 |
| POST | `/focus-sessions/{}/resume` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:204 |
| POST | `/focus-sessions/{}/tutorial-reward` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:41 |
| GET | `/focus-sessions/current` | 일치 | focus-reward-construction | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:128 |
| GET | `/focus-sessions/pending-result` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:133 |
| POST | `/focus-sessions/sea` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:164 |
| POST | `/focus-sessions` | 일치 | focus-reward-construction | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:147 |
| DELETE | `/friends/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:117 |
| POST | `/friends/requests/{}/accept` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:98 |
| POST | `/friends/requests/{}/cancel` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:110 |
| POST | `/friends/requests/{}/reject` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:104 |
| GET | `/friends/requests` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:81 |
| POST | `/friends/requests` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:91 |
| GET | `/friends/search` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:86 |
| GET | `/friends` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:77 |
| POST | `/invitations/resolve` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:250 |
| PATCH | `/islands/{}/appearance` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:240 |
| POST | `/islands/{}/arrivals` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/telescope.ts:144 |
| GET | `/islands/{}/construction-options` | 일치 | focus-reward-construction | NOT_RUN | app/app-dev/src/services/api/home.ts:373 |
| PUT | `/islands/{}/construction-target` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/home.ts:390 |
| POST | `/islands/{}/constructions` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/home.ts:413 |
| GET | `/islands/{}/focus-members` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:377 |
| DELETE | `/islands/{}/guestbook/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:327 |
| GET | `/islands/{}/guestbook` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:296 |
| POST | `/islands/{}/guestbook` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:316 |
| POST | `/islands/{}/host-transfer` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:207 |
| POST | `/islands/{}/intro-arrivals` | 일치 | first-voyage | NOT_RUN | app/app-dev/src/services/firstVoyage.ts:49 |
| GET | `/islands/{}/inventory` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:197 |
| POST | `/islands/{}/invitations` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:261 |
| PATCH | `/islands/{}/join-requests/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:169 |
| GET | `/islands/{}/join-requests` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:157 |
| DELETE | `/islands/{}/members/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:180 |
| GET | `/islands/{}/members` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/home.ts:426, app/app-dev/src/services/api/islandManagement.ts:148 |
| DELETE | `/islands/{}/memberships/me` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/home.ts:450, app/app-dev/src/services/api/islandManagement.ts:195 |
| POST | `/islands/{}/memberships` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:209 |
| GET | `/islands/{}/messages` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:139 |
| POST | `/islands/{}/messages` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:146 |
| GET | `/islands/{}/news` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:185 |
| DELETE | `/islands/{}/notices/{}/comments/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:168 |
| POST | `/islands/{}/notices/{}/comments` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:154 |
| DELETE | `/islands/{}/notices/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:141 |
| GET | `/islands/{}/notices/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:105 |
| PATCH | `/islands/{}/notices/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:129 |
| GET | `/islands/{}/notices` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:97 |
| POST | `/islands/{}/notices` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:115 |
| GET | `/islands/{}/playback` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/playback.ts:24 |
| PATCH | `/islands/{}/playback` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/playback.ts:32 |
| POST | `/islands/{}/promotions/{}/reports` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:441 |
| PUT | `/islands/{}/promotions/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:174 |
| GET | `/islands/{}/promotions/editor` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:148 |
| POST | `/islands/{}/promotions` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:161 |
| POST | `/islands/{}/quests/{}/claims` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/quests.ts:157 |
| GET | `/islands/{}/quests/{}/progress` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/quests.ts:110 |
| PATCH | `/islands/{}/quests/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/quests.ts:143 |
| GET | `/islands/{}/quests/current` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/quests.ts:96 |
| POST | `/islands/{}/quests` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/quests.ts:130 |
| GET | `/islands/{}/resources/ledger` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/townHall.ts:145 |
| GET | `/islands/{}/rest-members` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:381 |
| GET | `/islands/{}/shop/orders` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:189 |
| POST | `/islands/{}/shop/orders` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:175 |
| GET | `/islands/{}/shop/products/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:155 |
| GET | `/islands/{}/shop/products` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:151 |
| GET | `/islands/{}/shop/wallets` | 일치 | focus-reward-construction | NOT_RUN | app/app-dev/src/services/api/shop.ts:159 |
| GET | `/islands/{}/statistics/focus` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/records.ts:270 |
| GET | `/islands/{}/statistics/screen-time` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/records.ts:289 |
| POST | `/islands/{}/tutorial-reward` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:28 |
| GET | `/islands/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:129 |
| PATCH | `/islands/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islandManagement.ts:137 |
| GET | `/islands/discover` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:166 |
| GET | `/islands` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:174 |
| POST | `/islands` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:146 |
| DELETE | `/letters/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:136 |
| GET | `/letters/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:130 |
| GET | `/letters` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:123, app/app-dev/src/services/api/letters.ts:128 |
| POST | `/letters` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:133 |
| PATCH | `/me/appearance` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:218 |
| PUT | `/me/current-island` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/home.ts:440 |
| GET | `/me/developer-notices/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/developerNotices.ts:25 |
| GET | `/me/developer-notices` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/developerNotices.ts:19 |
| GET | `/me/inventory` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:193 |
| GET | `/me/islands` | 일치 | first-voyage | NOT_RUN | app/app-dev/src/services/api/islands.ts:269 |
| DELETE | `/me/join-requests/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:239 |
| GET | `/me/join-requests/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:232 |
| GET | `/me/join-requests` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:227 |
| GET | `/me/magazine/assets` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:135 |
| PUT | `/me/magazine/issues/{}/receipt` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:423 |
| GET | `/me/magazine/issues/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:400 |
| GET | `/me/magazine/issues` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:370 |
| GET | `/me/magazine/today` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/magazine.ts:360 |
| GET | `/me/member-appearances` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/memberLooks.ts:10 |
| PUT | `/me/screen-time/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/screenTime.ts:11 |
| PUT | `/me/sea-remark` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/focusSessions.ts:179 |
| DELETE | `/me/telescope/pins/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/telescope.ts:177 |
| POST | `/me/telescope/pins` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/telescope.ts:161 |
| GET | `/me/telescope` | 일치 | first-voyage | NOT_RUN | app/app-dev/src/services/api/telescope.ts:136 |
| DELETE | `/me` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/account.ts:46 |
| GET | `/me` | 일치 | guest-account | NOT_RUN | app/app-dev/src/services/api/auth.ts:437 |
| PATCH | `/me` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/account.ts:33 |
| GET | `/rankings/islands` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/rankings.ts:75 |
| GET | `/screens/board` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/notices.ts:91 |
| GET | `/screens/explore` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:158 |
| GET | `/screens/friends` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/friends.ts:73 |
| GET | `/screens/home` | 일치 | first-voyage | NOT_RUN | app/app-dev/src/services/api/home.ts:369 |
| GET | `/screens/library` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/records.ts:249 |
| GET | `/screens/mailbox` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/letters.ts:120 |
| GET | `/screens/shop` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/shop.ts:141 |
| GET | `/screens/town-hall` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/townHall.ts:130 |
| GET | `/screens/visit/{}` | 일치 | 미등록 | NOT_RUN | app/app-dev/src/services/api/islands.ts:178 |

## 해석·범위 한계

- 경로 변수 이름은 `{}`로 통일하고 쿼리 값은 경로 대조에서 제외한다. 쿼리·본문·헤더·응답 계약은 이 검사로 증명하지 않는다.
- TypeScript AST의 공용 request 호출과 직접 인증 refresh 호출을 수집한다. HTTP 외 WebSocket·네이티브 SDK 호출은 제외한다.
- 해석하지 못하는 앱 호출과 서버 매핑은 숨기지 않고 별도 목록에 남기며 CI를 실패시킨다.
- 공용 request 외 fetch는 별도 검토 대상이다. 자산 요청을 서버 API로 집계하지 않는다.

```json
{
  "unresolved": [],
  "unsupportedServer": [],
  "otherFetches": [
    {
      "file": "app/app-dev/src/components/CatOutfitLayers.tsx",
      "line": 169,
      "expression": "fetch(url)",
      "reason": "공용 request 밖의 호출 — 별도 검토"
    }
  ],
  "unreviewedFetches": []
}
```
