# Data 구현 — 화면 조회가 기대는 내부 표면

[정책](policy.md) B15~B26 · [Business 구현](implementation-business-api.md)

> **B24 (2026-09-15 확정):** 화면 전용 Data 엔드포인트는 **0개**다. B24 예외로 등록된 화면이 생기면 그 화면 하나만 [LLD §3](low-level-design.md)의 `/internal/screen-read-models/*` 방식으로 만든다. 내부 경로 대응 규칙(§1)은 B26으로 확정했다.

## 1. 규칙

- 화면을 위해 새 엔드포인트·패키지·계층을 만들지 않는다. 화면 조각은 도메인 구현이 만드는 내부 GET을 그대로 쓴다. 그래서 `DomainLayerRulesTest`의 `LAYERS`도 바뀌지 않는다.
- 내부 경로 대응(B26 확정): 사용자 축 공개 경로(`/me/**`, 본인 세션 `/focus-sessions/current`)는 `/internal/users/{userId}/…`, 그 밖은 `/internal` + 공개 경로다. 선례는 `POST /internal/islands/{islandId}/host-transfer`와 [island-mailbox LLD](../island-mailbox/low-level-design.md) §3의 `/internal/islands/{islandId}/messages`다. 사용자 축을 경로에 두는 이유는 `InternalAuthFilter`가 `/internal/users/{userId}/…`의 경로 사용자와 `X-User-Id`를 대조하기 때문이다.
- 인증은 사용자 위임 호출(서비스 토큰 + `X-User-Id`, A9 (가))이다. 허용목록은 `application-satellites.yml`의 `internal.api.callers.business.allow`에 method + path를 정확히 적는다.
- 인가와 한 요청 안의 스냅샷 읽기는 각 도메인 GET의 책임이다(각 도메인 LLD). 화면 조합 때문에 인가를 느슨하게 하거나 N+1 조회를 허용하지 않는다.
- 아래 GET은 모두 main `df38072b4`에 없다. 각 도메인 구현이 만들고 허용목록 줄도 그 구현이 추가한다. 화면 구현은 목록에 있는지만 확인한다.

## 2. 화면이 쓰는 내부 GET

| 내부 GET (B26 규칙) | 공개 경로 · 소유 LLD | 쓰는 화면 |
| --- | --- | --- |
| `GET /internal/users/{userId}` | `GET /me` · [account](../account/low-level-design.md) §2.2 | launch · raft · account |
| `GET /internal/users/{userId}/islands` | `GET /me/islands` · [island-membership](../island-membership/low-level-design.md) §3.5 | 섬 문맥이 필요한 화면 전부 · launch · explore |
| `GET /internal/users/{userId}/focus-summary` | `GET /me/focus-summary` · [focus-rest-session](../focus-rest-session/low-level-design.md) | home |
| `GET /internal/users/{userId}/focus-sessions/current` | `GET /focus-sessions/current` · focus-rest-session | launch · home · focus |
| `GET /internal/users/{userId}/join-requests/{requestId}` | `GET /me/join-requests/{requestId}` · island-membership §3.8 | visit |
| `GET /internal/users/{userId}/inventory` | `GET /me/inventory` · [island-appearance](../island-appearance/low-level-design.md) §1.1 | raft |
| `GET /internal/islands` | `GET /islands?q=` · island-membership §3.2 | explore |
| `GET /internal/islands/discover` | `GET /islands/discover` · island-membership §3.3 | explore |
| `GET /internal/islands/{islandId}` | `GET /islands/{islandId}` · island-membership §3.4 | visit · home · focus · town-hall · library · board · mailbox · shop · playback |
| `GET /internal/islands/{islandId}/focus-members` | focus-rest-session | focus |
| `GET /internal/islands/{islandId}/rest-members` | focus-rest-session | home |
| `GET /internal/islands/{islandId}/playback` | [island-playback](../island-playback/low-level-design.md) | home · focus · playback |
| `GET /internal/islands/{islandId}/members` | [island-management](../island-management/low-level-design.md) §3.2 | town-hall |
| `GET /internal/islands/{islandId}/join-requests` | island-management §3.3 | town-hall (방장만) |
| `GET /internal/islands/{islandId}/construction-options` | [island-construction](../island-construction/low-level-design.md) | town-hall |
| `GET /internal/islands/{islandId}/shop/wallets` | [island-shop](../island-shop/low-level-design.md) §2.1 | home · town-hall · board · shop · playback |
| `GET /internal/islands/{islandId}/shop/products` | island-shop §2.2 | shop · playback |
| `GET /internal/islands/{islandId}/inventory` | island-appearance §1.3 | shop · playback |
| `GET /internal/islands/{islandId}/statistics/focus` · `…/statistics/screen-time` | [island-records](../island-records/low-level-design.md) | library |
| `GET /internal/islands/{islandId}/quests/current` | [island-quests](../island-quests/low-level-design.md) | board |
| `GET /internal/islands/{islandId}/notices` | [island-board](../island-board/low-level-design.md) | board |

Data 밖:

| 호출 | 소유 | 쓰는 화면 |
| --- | --- | --- |
| `GET /internal/islands/{islandId}/messages` | Realtime · island-mailbox §1 | mailbox |
| 알림 설정 조회 | Notification · Business `NotificationApiClient.getSettings()`(순수 GET) | account |

위 행이 한때 `AccountSettingsUseCase` 경유로 적혀 있었다. 그 유스케이스의 `read()` 는 POST 를 먼저 보내므로 화면 조합기의 읽기 전용 context 에서 실행하면 `/screens/account` 가 예외로 실패한다 — [Business 구현](implementation-business-api.md) §4 각주와 같은 이유다. 두 문서 중 하나만 고치면 README 안내대로 Business → Data 순으로 읽은 구현자가 이 표를 따라 다시 깨뜨린다.


## 3. 허용목록 (business caller)

각 도메인 구현이 자기 줄을 추가한다. 14종이 모두 열리면 아래가 된다.

```yaml
internal:
  api:
    callers:
      business:
        allow:
          - 'GET /internal/users/*'  # notification-snapshot 은 InternalAuthFilter 가 별도로 막는다(GROMO-1906) — 아래 해소 서술 참조
          - 'GET /internal/users/*/islands'
          - 'GET /internal/users/*/focus-summary'
          - 'GET /internal/users/*/focus-sessions/current'
          - 'GET /internal/users/*/join-requests/*'
          - 'GET /internal/users/*/inventory'
          - 'GET /internal/islands'
          - 'GET /internal/islands/*'
          - 'GET /internal/islands/*/focus-members'
          - 'GET /internal/islands/*/rest-members'
          - 'GET /internal/islands/*/playback'
          - 'GET /internal/islands/*/members'
          - 'GET /internal/islands/*/join-requests'
          - 'GET /internal/islands/*/construction-options'
          - 'GET /internal/islands/*/shop/wallets'
          - 'GET /internal/islands/*/shop/products'
          - 'GET /internal/islands/*/inventory'
          - 'GET /internal/islands/*/statistics/focus'
          - 'GET /internal/islands/*/statistics/screen-time'
          - 'GET /internal/islands/*/quests/current'
          - 'GET /internal/islands/*/notices'
```

`'GET /internal/islands/*'`는 `AntPathMatcher`에서 `/internal/islands/discover`도 받는다. 같은 caller의 같은 GET이라 줄을 따로 두지 않는다.

**해소 (GROMO-1906):** `'GET /internal/users/*'`는 `/internal/islands/*`의 경우와 달리 같은 caller에 허용해도 되는 이웃 경로가 아니라 `notification` 전용 컬렉션 조회(`GET /internal/users/notification-snapshot`)까지 세그먼트 매칭으로 같이 열던 자리였다 — `AntPathMatcher`가 `*`를 세그먼트 하나로 매칭하기 때문이다. `InternalAuthFilter`(`server/data-api/.../InternalAuthFilter.java`)가 이제 그 리터럴 경로를 `notification` caller 가 아니면 허용목록 통과 여부와 무관하게 명시적으로 403 거부한다 — allowlist 설계를 바꾸지 않고 필터 안에서 이름으로 다시 막은 것이라(해결 방식 B), notification 클라이언트(`server/notification/.../DataClient.java`)나 배포 순서를 건드리지 않는다. 검증은 `InternalAuthFilterTest`의 GROMO-1906 케이스 3종.
**그래서 이제 `'GET /internal/users/*'`를 business 허용목록에 그대로 추가해도 된다** — launch·raft·account가 여는 `GET /me` 대응(§2 `GET /internal/users/{userId}`)을 위해 넣을 때 더 이상 사전 조건이 없다.

## 4. 설계가 없어 먼저 보강할 재료 (BG10)

| 재료 | 화면 | 지금 상태 |
| --- | --- | --- |
| ~~친구 목록·받은/보낸 요청~~ **해소** | friends · raft | [friend-letter LLD](../friend-letter/low-level-design.md) §1.15 — `GET /internal/users/{userId}/friends`·`…/friend-requests`. 기존 `FriendController` 구현을 무접두로 재노출하는 것이라 신규 도메인 로직은 없다. **허용목록 3줄 추가가 선행**(같은 §1.15) |
| ~~편지함·편지~~ **해소** | mailbox | [friend-letter LLD](../friend-letter/low-level-design.md) §1.12~1.15 — `letters` 테이블 신설, `GET /internal/users/{userId}/letters`. 섬 우체통 공개 메시지(island-mailbox)와 다른 도메인이다(HLD §0) |
| 작성자 표시 정보 batch | mailbox | island-mailbox LLD §5가 요구. 계약 미정 |
| 내 가입 대기 신청 목록 | explore | island-membership LLD는 단건 조회(§3.8)만 있다 |
| 공동 가계부 | town-hall | 원장 조회 계약 없음 |
| 주민별 누적 물고기 | library | island-records에 없음 |
