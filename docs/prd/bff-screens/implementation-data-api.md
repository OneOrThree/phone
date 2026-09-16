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
| `GET /internal/islands/{islandId}/messages` | Realtime · island-mailbox §3 | mailbox |
| 알림 설정 조회 | Notification · Business `AccountSettingsUseCase` 경유 | account |

## 3. 허용목록 (business caller)

각 도메인 구현이 자기 줄을 추가한다. 14종이 모두 열리면 아래가 된다.

```yaml
internal:
  api:
    callers:
      business:
        allow:
          - 'GET /internal/users/*'
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

## 4. 설계가 없어 먼저 보강할 재료 (BG10)

| 재료 | 화면 | 지금 상태 |
| --- | --- | --- |
| 친구 목록·받은/보낸 요청 | friends · raft | 레포 LLD 없음. legacy `FriendController`(`/api/v1/friends…`)가 재사용 후보 |
| 편지함·편지 | mailbox | 레포 LLD 없음 (기획 v0.6 신규) |
| 작성자 표시 정보 batch | mailbox | island-mailbox LLD §5가 요구. 계약 미정 |
| 내 가입 대기 신청 목록 | explore | island-membership LLD는 단건 조회(§3.8)만 있다 |
| 공동 가계부 | town-hall | 원장 조회 계약 없음 |
| 주민별 누적 물고기 | library | island-records에 없음 |
