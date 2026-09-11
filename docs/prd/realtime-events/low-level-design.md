# 섬 실시간 이벤트 — 상세 계약

> GROMO-1754 · 2026-09-12 · [PRD](./prd.md) · [구성 설계](./high-level-design.md)
> 이 문서의 경로·타입은 구현할 계약이다. 참고 티켓 1755가 골격을 제공하며 각 도메인 생산자는 후속 작업이다.

## 1. 공통 봉투

신규 사건은 다음 **6개 필드**를 가진다. 기존 채팅 토픽의 `ChatMessageResponse`를 이 봉투로 강제 교체하지 않는다.

```json
{
  "eventId": "019f16a0-0000-7000-8000-000000000001",
  "type": "playback.updated",
  "islandId": "019f16a0-0000-7000-8000-000000000002",
  "aggregateVersion": 3,
  "occurredAt": "2026-09-12T00:00:00Z",
  "payload": {
    "trackId": "campfire",
    "playing": true,
    "positionSeconds": 0,
    "effectiveAt": "2026-09-12T00:00:00Z",
    "changedBy": "019f16a0-0000-7000-8000-000000000003",
    "version": 3,
    "serverNow": "2026-09-12T00:00:00Z"
  }
}
```

식별자·시각·음원 이름은 계약 설명용 예시이며 실제 사용자/음원 지급 정책이 아니다.

| 필드 | 타입/규칙 |
|---|---|
| `eventId` | UUID. 생산자가 한 사건에 한 번 부여. 전달·HTTP 재시도·relay 재전달에서 유지. 다른 사건에 재사용하지 않음 |
| `type` | §2의 dotted string 14종 중 하나. 모르는 타입은 전파하지 않고 관측 |
| `islandId` | UUID 또는 null. 섬 범위 사건은 필수. 개인 wallet/inventory만 null 사용. 개인 상품을 어느 섬에서 샀는지 이 필드로 공개하지 않음 |
| `aggregateVersion` | 양의 정수. `focus.emote`만 null. 값과 범위는 §2 정본. client 안전 정수 범위(1~9007199254740991) 밖은 직렬화 거절; 소비자가 부동소수로 반올림해 비교하지 않음 |
| `occurredAt` | 서버 UTC ISO-8601 instant. 상태 변경 때 고정; relay가 전달 시각으로 바꾸지 않음. 정렬/중복 판정에 사용하는 값이 아님 |
| `payload` | 타입별 object. 개인 토큰·HTTP header·임의 수신 destination 없음 |

`version`이 payload에 있는 유형은 `aggregateVersion == payload.version`을 검사한다. 집중/휴식의 `sessionVersion`은 **다른 축**이며 REST 세션 낙관락에 쓰는 값이다. 동일 세션 변경에서 만든 focus/rest 사건은 서로 다른 eventId를 갖고 세션 버전은 같을 수 있다.

용어: `Id`는 실제 도메인 식별자(UUID). `ProductId`/`TrackId`/`BuildingId`/`ThemeId`는 도메인 카탈로그의 불투명 문자열 키이며 클라이언트가 임의 생성하지 않는다. `Instant`는 UTC 문자열. `Version`은 위 양의 정수, `Seconds`는 0 이상의 정수다. 필수 nullable 필드는 키를 생략하지 않고 null을 보낸다. 아래 표의 필드가 해당 payload 정본이며 wire 변경은 이 문서와 타입 검증을 함께 갱신한다.

## 2. 이벤트 14종 정본

| # | type / enum 상수 | payload 필수 필드와 타입 | 버전 비교 key / 의미 | 전달 경로 |
|---|---|---|---|---|
| 1 | `focus.member.updated` / `FOCUS_MEMBER_UPDATED` | `userId:Id`, `sessionId:Id`, `status:active\|paused\|completed`, `subject:string`, `activeSeconds:Seconds`, `serverNow:Instant`, `sessionVersion:Version` | `(focus.member,islandId,userId)`의 주민 집중 투영. 세션이 바뀌어도 단조 증가. REST sessionVersion과 별개 | `focus` |
| 2 | `rest.member.updated` / `REST_MEMBER_UPDATED` | `userId:Id`, `sessionId:Id`, `status:active\|paused\|completed`, `restStartedAt:Instant?`, `restSeat:integer?`, `serverNow:Instant`, `sessionVersion:Version` | `(rest.member,islandId,userId)`의 휴식 투영. 세션 교체로 초기화하지 않음 | `rest` |
| 3 | `focus.emote` / `FOCUS_EMOTE` | `userId:Id`, `sessionId:Id`, `type:hello\|cheer\|sleepy\|laugh\|hearts`, `expiresAt:Instant` | 버전 없음(null). eventId dedup + 만료만 사용 | `emotes` |
| 4 | `playback.updated` / `PLAYBACK_UPDATED` | `trackId:TrackId?`, `playing:boolean`, `positionSeconds:Seconds`, `effectiveAt:Instant`, `changedBy:Id`, `version:Version`, `serverNow:Instant` | `(playback,islandId)`의 전체 재생 상태 | `playback` |
| 5 | `message.created` / `MESSAGE_CREATED` | `id:Id`, `clientMessageId:Id`, `userId:Id`, `text:string`, `createdAt:Instant` | 불변 사건. `(message,id)`의 최초 버전 1. 다른 messageId와 버전 비교 금지 | `messages` |
| 6 | `quest.progress.updated` / `QUEST_PROGRESS_UPDATED` | `questId:Id`, `occurrenceId:Id`, `version:Version` | `(quest.progress,islandId,questId,occurrenceId)`의 무효화 신호 | `events` |
| 7 | `wallet.updated` / `WALLET_UPDATED` | `ownerType:user\|island`, `ownerId:Id`, `currency:fish\|village_points`, `version:Version` | `(wallet,ownerType,ownerId,currency)`의 지갑 무효화. 개인=user/fish, 공동=island/village_points만 허용 | 개인은 개인큐, 공동은 `events` |
| 8 | `inventory.updated` / `INVENTORY_UPDATED` | `ownerType:user\|island`, `ownerId:Id`, `productId:ProductId`, `version:Version` | `(inventory,ownerType,ownerId)` 보유 목록 무효화. productId는 변경 원인이지 전체목록 버전의 key 아님 | 개인은 개인큐, 공동은 `events` |
| 9 | `member.appearance.updated` / `MEMBER_APPEARANCE_UPDATED` | `userId:Id`, `appearance:Appearance`, `version:Version` | `(member.appearance,userId)`의 개인 외양 **전체 상태**. 다른 섬에서 온 동일 외양도 같은 버전 축 | `events` |
| 10 | `island.appearance.updated` / `ISLAND_APPEARANCE_UPDATED` | `islandThemeId:ThemeId`, `buildingThemes:object<BuildingId,ThemeId>`, `version:Version` | `(island.appearance,islandId)`의 공동 외양 전체 상태. 변경 PATCH와 달리 전체결과를 발행 | `events` |
| 11 | `island.updated` / `ISLAND_UPDATED` | `islandId:Id`, `version:Version` | `(island,islandId)` 섬 정보/시설/목표 무효화 | `events` |
| 12 | `island.members.updated` / `ISLAND_MEMBERS_UPDATED` | `islandId:Id`, `version:Version` | `(island.members,islandId)` 주민/역할 목록 무효화. 일반 island 버전과 비교하지 않음 | `events` |
| 13 | `join.request.updated` / `JOIN_REQUEST_UPDATED` | `requestId:Id`, `applicantId:Id`, `status:pending\|approved\|rejected\|cancelled`, `version:Version` | `(join.request,islandId,requestId)` 신청 무효화. 다른 신청은 별개 | 개인큐 |
| 14 | `notice.updated` / `NOTICE_UPDATED` | `noticeId:Id`, `version:Version` | `(notice,islandId,noticeId)` 공지/댓글 무효화. 삭제 뒤에도 삭제 사건 버전을 보존 | `events` |

`Appearance`는 `{clothes:ProductId?, decor:ProductId?, hull:ProductId, position:front|back}` 전체 상태다. 기본 `raft`, null 해제와 배치 규칙은 원본대로 외양 도메인에서 검증한다. 선체 업그레이드/하위 재착용 정책을 이 이벤트가 결정하지 않는다. 기존 캐릭터 HAIR/TOP/BOTTOM/SHOES 모델을 이 DTO와 같은 것으로 취급하지 않는다.

### 2.1 상태 및 범위 불변식

- focus/rest의 완료 표기 `completed`는 이벤트 wire 값이다. 기존 Data enum을 이름만 변환하지 않고 새 세션 수명주기 계약(참고 티켓 1763/1764)이 생성한다. 기존 취소/자동정리도 종료 투영을 만들 때 종료 이유를 새 enum으로 임의 늘리지 않고 최신 스냅샷의 terminal 상태로 매핑한다. 세션 의미 변경은 해당 도메인에서 검토한다.
- focus `activeSeconds`는 `serverNow` 시점 순수 집중초. active일 때만 이후 시간을 가산하며 paused/completed에는 가산하지 않는다. 재전달 시 activeSeconds와 serverNow를 새로 계산하지 않는다.
- rest `paused`일 때 restStartedAt과 restSeat가 필수이고 restSeat는 도메인이 정한 유효 자리 번호다. 그 외에는 둘 다 null이며 해당 휴식 행을 제거한다. 자리 정원/배정 정책은 참고 티켓 1763/1765 소유다.
- 세션별 버전만 쓰면 예전 세션의 큰 버전이 새 세션의 작은 버전을 덮거나, 지연된 예전 입장으로 종료자가 살아난다. 그래서 focus/rest는 **사용자×섬 투영의 지속 버전**을 별도로 저장/조회한다. 이 요구는 현재 Data 모델에 없는 선행 변경이다.
- `playback`의 null trackId는 음원 미선택 상태의 wire 표현이며 playing=false/positionSeconds=0이어야 한다. 초기 무료곡을 자동 지급한다는 뜻이 아니다. 재생 중 위치는 effectiveAt anchor와 서버 시간 차이로 계산한다. anchor 위치만 현재로 바꾸고 effectiveAt을 그대로 두는 이중 가산을 금지한다.
- `message.created`는 순서를 가진 상태 덮어쓰기가 아니다. 모든 다른 messageId를 처리하고 정렬은 히스토리 계약의 서버 키를 사용한다. `clientMessageId`는 발신자 userId와 함께 낙관적 UI를 병합한다. 서로 다른 사용자의 같은 clientMessageId를 하나로 접지 않는다.
- ownerType=island이면 ownerId=envelope.islandId. ownerType=user이면 islandId=null이고 UserAudience는 해당 ownerId 하나다. wallet/inventory에 balance/잔액 전체나 타인의 보유 목록을 포함하지 않는다.
- island.updated/island.members.updated의 payload islandId는 envelope와 같아야 한다. join.request의 개인 수신자는 요청자 본인과 현재 방장의 합집합이며 같은 사용자면 한 번으로 접는다. 생산 시점의 방장 목록은 영구 권한이 아니다. 라우팅 시 신뢰된 membership resolver가 현재 방장으로 audience를 다시 확정하고, 이전 방장은 전달 직전 검사에서도 차단한다.
- inventory/quest/notice 등 무효화 이벤트는 해당 목록/자원을 다시 읽는 신호다. 높은 버전의 product B가 먼저 왔다고 product A의 개별 소유를 수동으로 삭제하지 않는다. 목록 스냅샷은 A/B를 모두 포함해야 한다.
- 여러 섬에 보이는 개인외양은 대상별 envelope를 별도 eventId로 내구화하되 같은 외양 version을 사용한다. 적용 중 실제 표시 권한이 사라진 섬에는 보내지 않는다.

### 2.2 생산자와 내구화 소유

| 사건 | 상태가 커밋되는 곳 / 생산 지점 | 후속 구현 소유 |
|---|---|---|
| focus.member.updated, rest.member.updated | Data의 시작/휴식/재개/종료 TX, 세션 및 주민 투영 버전+outbox. 동일 명령 재시도는 같은 사건들 | 참고 티켓 1764/1765 |
| focus.emote | Realtime의 인증된 SEND 검증 후 즉시 생성. DB/outbox/replay 없음 | 참고 티켓 1765 |
| playback.updated | Data 재생 상태 변경 TX+outbox. GET에는 생산 없음 | 참고 티켓 1779 |
| message.created | 기존 `gromo_chat` 메시지 커밋 후 fanout의 신규 wire adapter. 히스토리가 복구 정본 | 참고 티켓 1775 |
| quest.progress.updated | Data 집중/측정/퀘스트 판정·정산 TX+outbox | 참고 티켓 1769/1773 및 집중 종료 생산자 |
| wallet.updated | Data 집중보상/퀘스트/건설/구매 TX+해당 지갑버전+outbox | 참고 티켓 1764/1767/1773/1781 |
| inventory.updated | Data 주문/소유권 부여 TX+목록버전+outbox | 참고 티켓 1781/1783 |
| member.appearance.updated, island.appearance.updated | Data 외양 적용 TX+외양버전+outbox | 참고 티켓 1783 |
| island.updated | Data 섬정보/목표선택/건설 TX+outbox | 참고 티켓 1759/1762/1767 |
| island.members.updated, join.request.updated | Data 소속/요청/승인/거절/취소/역할변경 TX+outbox. 권한철회 제어자료 함께 생성 | 참고 티켓 1760/1762 |
| notice.updated | Data 공지/댓글 저장·수정·삭제 TX+outbox | 참고 티켓 1771 |

GET의 API 설명에 '후속 이벤트'가 표시돼 있어도 조회가 변경 이벤트를 생산한다는 뜻으로 구현하지 않는다. 참고 티켓 1755가 이 표의 producer를 임시 이벤트/샘플 상태로 대체하지 않는다. Kafka 토픽·consumer group·내부 auth allowlist는 기존 내부 이벤트 작업 정본과 합류하며 이 문서에서 별도 공인 ingress를 신설하지 않는다.

## 3. 전송 경로와 router

### 3.1 정확한 목적지

`{islandId}`/`{groupId}`는 UUID를 파싱한 뒤 `UUID.toString()`과 원문이 같은 소문자 canonical 형태만 허용한다. query·후행 slash·matrix parameter·추가 경로·wildcard·인코딩 우회는 허용하지 않는다. 접두 문자열 비교만으로 열지 않는다.

| 동작 | 경로 | 인가 |
|---|---|---|
| WebSocket handshake | `/ws/realtime` | Origin 정책 유지, 실제 인증은 STOMP CONNECT |
| 호환 handshake | `/ws/chat` | 같은 인증 모델. 기능에 따른 목적지 인가 |
| SUBSCRIBE | `/topic/islands/{islandId}/events` | 현재 소속 주민. 메시지/음악/응원·개인 경제/가입요청은 이 채널에 실리지 않음 |
| SUBSCRIBE | `/topic/islands/{islandId}/focus` | 같은 섬 주민. 집중 중 여부로 주민 관람 전체를 차단하지 않음 |
| SUBSCRIBE | `/topic/islands/{islandId}/rest` | 같은 섬 주민. 로컬 모닥불 관람 때문에 새 세션을 만들지 않음 |
| SUBSCRIBE | `/topic/islands/{islandId}/emotes` | 현재 같은 섬에서 active 집중 세션을 가진 사용자 |
| SUBSCRIBE | `/topic/islands/{islandId}/playback` | 같은 섬 주민 + 방송기 접근 가능 |
| SUBSCRIBE | `/topic/islands/{islandId}/messages` | 같은 섬 주민 + 우체통 접근 가능 + 기존 채팅 집중 제한 |
| SUBSCRIBE | `/user/queue/events` | 인증된 본인 큐. event별 owner/신청관계/방장권한은 전달 직전 추가 검사 |
| 신규 SEND | `/app/islands/{islandId}/focus/emotes` | 본인 active sessionId + 현재 같은 섬 + 5종 + 만료/속도 제한. 참고 티켓 1765 전 비활성 |
| 호환 SUBSCRIBE/SEND | `/topic/groups/{groupId}`, `/app/groups/{groupId}/send` | 기존 ChatAccessGuard 및 와이어 유지 |
| 호환 개인큐 | `/user/queue/errors`, `/user/queue/duplicates` | 발신한 세션에만 실패/중복 결과 회신 |

`/topic/**`, `/queue/**`, `/user/**`로 클라이언트 직접 SEND는 전부 거절한다. 개인큐에 userId를 경로로 받지 않으며 `convertAndSendToUser`의 주체는 서버가 검증한 principal이다. 새 개인 이벤트는 본인 여러 기기에 전달하지만 기존 errors/duplicates는 특정 발신 세션에만 전달한다.

HTTP 집중 쓰기는 `POST /focus-sessions`, `POST /focus-sessions/{sessionId}/pause|resume|finish`. 상태 조회는 `GET /focus-sessions/current`, `GET /islands/{islandId}/focus-members|rest-members`. 이 경로는 담당 도메인에서 제공한다. `/app/.../start|pause|resume|finish` 또는 emote REST 우회 경로를 추가하지 않는다.

### 3.2 구현용 내부 인터페이스

다음은 **서버 내부** 인터페이스이며 외부 사용자가 audience/destination을 제출하는 API가 아니다. Java17 record/enum, 기존 Jackson3 타입을 사용한다.

```java
record RealtimeEventEnvelope(
    UUID eventId,
    RealtimeEventType type,
    UUID islandId,
    Long aggregateVersion,
    Instant occurredAt,
    JsonNode payload
) {}

sealed interface RealtimeAudience permits IslandAudience, UserAudience {}
record IslandAudience(UUID islandId) implements RealtimeAudience {}
record UserAudience(Set<UUID> userIds) implements RealtimeAudience {}

// EventRouter 구체 클래스가 제공하는 메서드의 개념 시그니처:
// void route(RealtimeEventEnvelope event, RealtimeAudience audience)
```

`JsonNode`는 `tools.jackson.databind.JsonNode`다. payload 수신 후 type에 맞는 validator를 거쳐야 하며 임의 JsonNode를 그대로 방송하지 않는다. UserAudience는 비어 있지 않은 불변 Set을 복사해 보유한다. 섬 이벤트는 IslandAudience와 같은 islandId여야 하고 개인/신청 이벤트는 UserAudience만 허용한다. enum은 §2의 대문자 상수와 dotted wire 값을 명시적으로 매핑한다.

라우터 흐름: 봉투/payload 검증 → type+ownerType으로 허용 audience 검증 → 현재 수신 정책 확인 → 고정 목적지 계산 → 유효 로컬 세션 전달/내부 fanout. `event.payload.destination`이나 호출자가 넘긴 임의 경로를 사용하지 않는다. domain producer/내부 authenticated consumer만 호출하며 payload에 적힌 신청 방장 ID를 검증 없이 신뢰하지 않는다. 후속 가입 요청 전달 기능을 활성화할 때는 `EventRouter`가 신뢰된 membership resolver를 호출해 요청자와 현재 방장으로 `UserAudience`를 새로 구성한다. producer/relay가 전달한 과거 audience는 이 결과로 대체하며, resolver가 현재 권한을 확인하지 못하면 전달하지 않는다. 이 재구성은 전달 직전 세션별 인가 검사와 별개이며, 1755의 비활성 골격에 이미 구현됐다는 뜻은 아니다.

1755 구현은 EventRouter **구체 클래스**의 위 route 메서드와 구조/매핑/공통 유효성 검사를 제공한다. 별도 router interface 추상화를 필수로 요구하지 않는다. 1755의 검증 범위는 공통 봉투 필수값, 타입, version 안전 정수/nullable 규칙, payload.version이 있을 때 aggregateVersion과 일치, wallet/inventory ownerType·ownerId·currency 및 audience 일치다. **14종 전체 세부 payload의 필드/상태/시설/소유 검증은 각 producer와 후속 adapter 활성화 작업의 책임**이다. 공통 검증만 통과한 payload가 완전한 도메인 검증을 통과했다고 주장하지 않는다.

신규 권한 제공자가 없는 channel의 allowlist 등록은 곧 허용을 뜻하지 않는다. 1755의 신규 전달 adapter는 비활성 상태를 명시적으로 거절하고, 신규 SUBSCRIBE/SEND 및 outbound를 닫는다. handler·시설·멤버십·snapshot·세부 payload validator가 준비된 기능만 후속 단계에서 활성화한다.

추가 다중노드 fanout의 후속 계약은 `chat:events:v1`에 `{originInstanceId,event,audience}` 내부 봉투를 사용하는 것이다. 기존 `chat:fanout`과 payload를 보존한다. 이 추가 채널이 현재 배포돼 있다는 뜻은 아니며, 실제 구현 작업에서 ACL·serializer·배포 호환 검증을 붙인다. 클라이언트는 이 내부 봉투를 받지 않고 6필드 event만 받는다.

## 4. 인가·철회·집중 제한

### 4.1 CONNECT와 채팅 목적지 분리

1. CONNECT에서 현재 JWT 만료/서명/주체를 검증한다. 쿼리스트링 토큰은 사용하지 않는다.
2. **CONNECT에서 집중 상태를 검사하지 않는다.** 그렇지 않으면 집중 사용자에게 필요한 focus/emote까지 막힌다.
3. SUBSCRIBE/SEND는 exact allowlist와 현재 세션 인증을 검사한다. 채팅 목적지에서만 기존 ChatAccessGuard를 적용한다.
4. 휴식 상태가 '채팅 가능'인지 여부는 새 세션 도메인의 집중 제한 정의와 맞춘다. 이 문서가 PAUSED를 임의 허용하지 않는다. 기존 presence 키 존재 검사로 새 휴식 상태를 판정할 수 있다고 가정하지 않는다.
5. 음악·집중·경제 이벤트는 채팅 집중 가드로 차단하지 않는다. 1755의 기계적 이름 변경만으로 채팅 guard를 공통 guard로 승격하지 않는다.

### 4.2 이미 연결된 사용자

서버 레지스트리는 세션 id, 검증 주체, 토큰 만료, 구독 id/경로, 섬 및 수신 정책 범주를 관리한다. 서버가 역할/소속 상실을 감지하면 해당 구독을 해지하고, 브로커의 부분 해지 지원이 검증되지 않았으면 소켓을 닫는다. 단지 레지스트리에서만 지우고 실제 SimpleBroker 구독을 남겨두면 안 된다.

인가 캐시 무효화는 모든 인스턴스에 전파한다. Redis Pub/Sub만으로 내구 철회를 보장하지 않는다. membership 원본 변경 TX의 내구 제어자료/리컨실과 전달 직전 현재 인가 검사로 누락을 닫는다. 이 제어자료는 도메인 사건 14종의 공개 payload와 분리한다. `island.members.updated`에는 주민 개인 퇴장 사유/신청 상세를 넣지 않는다.

실시간 데이터 프레임을 실제 소켓으로 내보내기 직전에 세션 인증과 해당 type의 현재 수신 자격을 확인한다. 특히 개인 join.request 수신 중 이전 방장 권한, emote 수신 중 pause/finish, messages 수신 중 집중 시작을 재검증한다. 보호 채널에서 stale TTL 캐시를 최종 권한 증거로 쓰지 않는다. 권한 원천 확인 실패는 fail-closed; subscriber 수에 비례한 조회 비용은 배치 권한조회/동일 revision 검사로 최적화하되 허용 가능한 지연창을 몰래 늘리지 않는다.

'권한 상실 후 차단'의 실행 경계는 각 프레임의 최종 인가 검사다. 그 검사 뒤 이미 네트워크로 나간 프레임을 회수하거나 DB 커밋과 TCP 송신을 분산 원자화한다고 약속하지 않는다. 지연된 과거 가입/방장 이벤트가 철회된 세션을 다시 허용하지 않도록 membership 제어 version도 aggregate별로 적용한다.

## 5. 스냅샷과 버전 병합

### 5.1 조회 계약 확장

새 focus/rest GET 및 이를 품은 BFF에는 원본 `items`, `serverNow`와 함께 `watermarks`를 제공한다. 이는 v0.3 예상 계약의 **경쟁 방지용 추가 설계**이며 현재 API에 존재하는 필드가 아니다.

```json
{
  "data": {
    "items": [],
    "serverNow": "2026-09-12T00:00:00Z",
    "watermarks": [
      {
        "projection": "focus.member",
        "islandId": "019f16a0-0000-7000-8000-000000000002",
        "aggregateId": "019f16a0-0000-7000-8000-000000000003",
        "version": 5
      }
    ]
  }
}
```

watermarks의 projection/key는 §2와 같으며 단일 id로 표현할 수 없는 wallet/quest 등은 해당 도메인의 구조화 key 필드를 추가한 공통 DTO를 사용한다. 화면 하나에 여러 domain의 버전이 들어와도 하나의 `screenVersion`으로 대체하지 않는다. 표의 예시는 focus용이고 모든 도메인 스냅샷에 같은 불완전 aggregateId를 강제하는 형태가 아니다.

물리 저장 방식은 Data 담당이 소유한다. 적어도 스냅샷에 포함된 상태/종료 tombstone의 버전은 해당 상태와 같은 DB snapshot으로 읽어야 한다. Data가 준 값의 version을 Business가 새로 발급하지 않는다. Focus user×island 투영 버전은 새 세션이 생겨도 초기화하지 않으며 `sessionVersion`을 대신 사용하지 않는다.

### 5.2 연결과 병합 알고리즘

1. 새 연결/섬 이동마다 클라이언트 connection generation을 바꾼다. 이전 generation의 비동기 REST 결과/이벤트는 적용하지 않는다.
2. 필요한 SUBSCRIBE마다 브로커 등록이 완료된 RECEIPT를 확인하고 이벤트를 버퍼링한다. 등록 전에 만든 로컬 플래그나 네트워크 송신 성공을 완료로 간주하지 않는다.
3. REST 또는 BFF 스냅샷을 읽는다. 실패·권한거절이면 화면 상태를 성공으로 확정하지 않고 구독/재시도를 정리한다.
4. 스냅샷 값과 watermarks를 설치한다. buffer의 동일 eventId는 한 번만 처리한다.
5. 전체상태형 이벤트는 **같은 projection/key**에서 `version > watermark`일 때만 적용한다. focus와 rest는 서로 다른 투영이며 지갑/재고/다른주민/다른회차의 버전을 비교하지 않는다. completed/비휴식 행 삭제 후에도 해당 key의 마지막 version은 연결 세대 동안 보존한다.
6. 스냅샷에 key가 없는 이벤트는 누락된 새 주민인지 오래전에 종료된 주민인지 알 수 없다. **이를 새 행으로 바로 추가하지 않고 정본을 재조회한다.** 조회 결과에도 없으면 행을 만들지 않는다. 새로운 정상 입장도 이 경우 조회 후 표시한다. 없는 행의 무한 과거 tombstone을 모두 내려보낸다고 가정하지 않는다.
7. 무효화형 이벤트는 resource를 dirty로 표시하고 debounce된 재조회로 복구한다. 조회 중 더 높은 version을 받으면 응답 version이 이를 덮을 때까지 dirty를 유지한다. 구독 버전만 먼저 올리고 오래된 GET 응답을 확정하지 않는다. 실패한 재조회를 eventId dedup 때문에 영구 생략하지 않는다.
8. `message.created`는 버전 최대값으로 버리지 않는다. messageId와 `(userId,clientMessageId)`로 병합하고, 연결복구 때 서버 히스토리 cursor 조회로 빠진 메시지를 읽는다.
9. `focus.emote`는 스냅샷/replay 버퍼에서 재생하지 않는다. 초기화 완료 후 실시간으로 받은 것 중 `expiresAt > serverNow 추정값`인 사건만 표시한다. 연결전의 남은 말풍선을 복구하지 않는다.
10. buffer/프레임 크기/연결대기 시간은 유한 상한을 둔다. overflow·서버 Redis 재연결·권한변경·프로토콜 오류가 생기면 해당 세대를 버리고 재조회한다. 구현 상한은 1765의 설정/부하 검증 항목이며 무한 저장을 허용하지 않는다.

전송 끊김뿐 아니라 앱 foreground 복귀/화면 재진입에서도 snapshot을 갱신한다. Redis Pub/Sub의 한 건 유실은 일반 event version의 숫자 차이만으로 항상 검출할 수 없다(다른 사건과 버전 공간을 공유할 수 있음). 정확한 실시간 목록을 계속 보장하는 출시에는 활성 화면의 유한 주기 리컨실 또는 서버 gap 제어를 함께 구현한다. 그 주기/실패 UI는 1765/화면 집계 설계에서 확정하며, 현재 유실 없는 스트림을 제공한다고 쓰지 않는다.

### 5.3 검증할 경쟁 예시

- SUBSCRIBE 전 변경 → 나중 snapshot에 포함.
- 등록 후 snapshot 읽기 전 변경 → snapshot과 buffer에 중복. watermark로 한 번 적용.
- snapshot 읽은 뒤 응답 전 변경 → buffer의 더 높은 버전 적용.
- 새 세션 시작 후 예전 세션의 active 이벤트 지연 → 사용자×섬 지속 버전이 낮아 폐기.
- snapshot에 없는 종료자에 대한 오래된 입장 → unknown key 재조회, 부활 금지.
- 회차 B의 version 11 뒤 회차 A의 version 10 → 서로 다른 key라 둘 다 재조회.
- REST 응답 중 다른 섬으로 이동 → 이전 generation 결과 무시.

## 6. 장애 처리와 관측

| 구간 | 처리 | 복구 정본 |
|---|---|---|
| Data TX rollback | 상태/이벤트 모두 없음. 미커밋 이벤트 발행 금지 | 명령 재시도 |
| Data commit 뒤 HTTP 유실 | 앱은 같은 Idempotency-Key. 저장 결과와 같은 eventId 재생 | Data 명령 결과/outbox |
| relay 선점 후 장애 | lease 만료 후 같은 eventId 재선점; version 재발급 금지 | 기존 내부 relay 계약 |
| Realtime 재시작/Redis fanout 유실 | 상태 이벤트 중복 허용, 보호 채널 재인가·snapshot | Data REST 또는 편지 히스토리 |
| 한 노드 개인 이벤트 전달 | 같은 사용자 다른 노드의 세션에도 내부 fanout; 노드별 권한 재검증 | 본인 REST |
| 권한 원천 장애 | 보호 프레임 전달 차단, false 멤버/권한없는정보 포함200을 만들지 않음 | 권한 복구 후 재구독 |
| malformed envelope/미지원 type | 해당 사건 전파 거절, 원문본문 로깅 금지, producer 알람 | adapter 수정 후 내구 사건 재전달 |
| emote 전송 실패/만료 | 재저장·outbox·오프라인 replay 없음 | 복구하지 않음 |

로그는 `requestId`(현재 HTTP 시도), `eventId`, `type`, `projection`, `aggregateVersion`, `phase`, `outcome`, `durationMs`, relay retry/lease를 연결한다. 공개 이벤트 봉투에 requestId를 추가해 7필드로 바꾸지 않고 내부 전송 메타데이터/로그에서 연결한다. 메시지 text, subject, payload JSON, 토큰, 원시 헤더는 기록하지 않는다. 메트릭 label은 이벤트 종류/결과/목적지 유형처럼 유한 집합만 사용한다.

필수 지표: accepted/rejected events, authorization rejection, expired token/emote, invalid audience, snapshot retry/overflow, private delivery 실패, fanout publish/parse 실패, outbox oldest age/retry. '연결 수'만 정상이라고 전체 전달이 정상이라고 보고하지 않는다.

## 7. 기존 구현과 변경 소유 경계

기준 코드는 `server/chat` 경로의 `config/WebSocketConfig`, `config/StompAuthChannelInterceptor`, `message/service/ChatAccessGuard`, `fanout/ChatFanout`, `fanout/ChatFanoutSubscriber`, `common/redis/RedisKeys`다. 개명 후 같은 구조가 `server/realtime`으로 이동한다.

- 기존 CONNECT의 `requireNotFocusing`은 목적지와 분리한다. 기존 subscribe/send의 채팅 guard는 보존한다.
- 기존 `DUPLICATE_QUEUE`는 `/queue/duplicates`이고 구독 문자열은 `/user/queue/duplicates`다. 새 개인 이벤트 큐와 바꾸지 않는다.
- 기존 `ChatFanoutEvent(originInstanceId,message)` 및 `chat:fanout` payload는 호환 대상. 신규 도메인 사건을 같은 wire로 섞지 않는다.
- `presence:focus:{userId}`의 존재만 읽는 현재 reader는 새 active/paused/섬/세션 정보를 제공하지 않는다. 1765가 권위 있는 session projection을 연결하기 전 emote를 허용하지 않는다.
- 기존 subscription은 멤버십 상실 뒤에도 남는다고 코드가 명시한다. 1755에서 이름만 바꾼 상태와 §4의 최종 전달 차단 완료를 구분해 보고한다.
- `setPreserveReceiveOrder(true)`는 기존 거절 ERROR 프레임이 정체된다는 코드 경고가 있다. 개명과 함께 이 옵션을 임의로 켜지 않는다. 변경하려면 실제 ERROR/연결 종료 테스트로 별도 검증한다.
- 아직 없는 Data 투영 버전/시설 정책/outbox producer를 Realtime DB/Redis의 임시 가짜 상태로 대신하지 않는다. Flyway/공통 오류/내부 allowlist는 해당 소유자에게 합류한다.

## 8. 구현 검증표

이 문서 작업은 빌드/실행 결과가 아니다. 아래는 기능 구현 후 통과해야 하는 테스트 목록이다.

| 묶음 | 필수 검증 | 소유 |
|---|---|---|
| 이름/호환 | 새/구 handshake, 기존 REST/STOMP 경로·message wire·errors/duplicates 유지, DB/Redis 이름 유지 | 1755 |
| 타입 골격 | enum 14종, 공통 봉투 필수값/null/version 상한, 존재하는 payload.version 일치, wallet/inventory owner·audience 일치, 임의 destination 거절 | 1755 |
| 도메인 payload | §2 각 유형의 필수 필드·status·ID·시설·소유·version key 검증, validator 없는 타입의 활성화 금지 | 각 producer 및 후속 adapter |
| 인증 | CONNECT 무토큰/만료 거절, active 사용자 CONNECT 성공, 채팅 subscribe/send는 기존 제한, idle 만료 후 egress0 | 1755/1765 |
| 인가 | 비주민/탈퇴/강퇴/시설잠김, wildcard/인코딩/직접브로커SEND, 개인타인·이전방장 수신0 | 1762/1765/각 기능 |
| 스냅샷 | 등록 전후/응답 전후 경합, out-of-order/duplicate, unknown key 부활금지, 세션교체·회차분리, overflow 재조회 | 1765/BFF |
| 내구성 | TXrollback 사건0, 커밋후응답유실 같은사건 재생, relay lease 장애·재전달, 버전과 상태 동일snapshot | 내부명령 및 각 producer |
| 멀티노드 | 두 Realtime 노드의 섬/본인여러기기 전달, origin 반향제거, Redis reconnect 후 리컨실, 모든노드 철회 | fanout/1765 |
| 응원 | 5종, 본인active 세션검증, 다른섬/휴식/종료거절, 속도제한, TTL, 재연결replay0 | 1765 |
| 경제 | 개인·공동 owner/currency 불일치거절, wallet/inventory 별개 version, 공유토픽에 개인payload0 | 1781/1783 |
| 관측 | payload/본문/토큰 비노출, command→event→relay→router 추적, 실패메트릭 | 각 단계 |

문서 자체 검증은 상대 링크 존재, 14개 행/enum 중복 없음, 원본 14종과 정확 집합 일치, 세 문서의 신규/호환 경로·단계 구분 및 미정 정책 보존으로 제한한다.
