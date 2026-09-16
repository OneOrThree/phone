# 친구·편지 — HLD

[README](README.md) · [LLD](low-level-design.md)

## §0. 편지 vs 우체통 메시지 — 다른 도메인이다

`/screens/mailbox` 화면은 두 가지 서로 다른 것을 조합한다.

- **우체통 공개 메시지**(`island-mailbox`, 이미 설계됨) — 섬 주민 전체에게 보이는 실시간 채팅형
  메시지. 저장소는 Realtime 서비스의 `gromo_chat`(`ChatMessage`), 조회는 `GET /islands/{islandId}/messages`,
  전송은 STOMP가 아니라 REST POST. [island-mailbox LLD](../island-mailbox/low-level-design.md) §1·§2.
- **1:1 편지**(이 문서, 신규) — 친구 한 명에게만 보이는 사적인 글. 저장소는 Data(`gromo_phone`)의
  신규 `letters` 테이블. 화면에 두 목록이 같이 뜨더라도 API·데이터 모델·권한은 완전히 분리한다.

두 개념을 같은 이름("메시지"·"편지")으로 섞어 부르지 않는다 — 이 문서에서 **편지(letter)**는 항상
친구 간 1:1을, **메시지(message)**는 항상 섬 공개 채팅을 가리킨다.

## §1. 기존 구현 매핑표

친구 10종은 전부 `server/data-api/src/main/java/com/oneorthree/phone/friend/`에 있고, 기준 코드는
`b2cd11c90`(2026-09-16)이다. "새 경로"는 B16(무접두) 규칙을 그대로 적용한다 — `/api/v1` 접두만
떼고 나머지 path는 바꾸지 않는다. island-management의 선례(G08 "신규 API는 접두어 없는 경로, 기존
`/api/v1` 동작 보존")를 따라 **레거시 `/api/v1/friends`·`/api/v1/pins`는 그대로 남기고 무접두 경로를
추가**한다 — 구버전 앱이 레거시를 계속 호출해도 깨지지 않는다.

| # | 현재 경로 | 새 경로(무접두) | 동작 변경 | 구현 클래스 `파일:줄` |
| --- | --- | --- | --- | --- |
| 1 | `POST /api/v1/friends/requests` | `POST /friends/requests` | 없음 | `FriendController.java:39-45` → `FriendService.createRequest` `FriendService.java:132-186` |
| 2 | `POST /api/v1/friends/requests/{id}/accept` | `POST /friends/requests/{id}/accept` | 없음 | `FriendController.java:47-54` → `FriendService.java:211-227` |
| 3 | `POST /api/v1/friends/requests/{id}/reject` | `POST /friends/requests/{id}/reject` | 없음 | `FriendController.java:56-63` → `FriendService.java:238-245` |
| 4 | `DELETE /api/v1/friends/{friendUserId}` | `DELETE /friends/{friendUserId}` | 없음 | `FriendController.java:65-72` → `FriendService.java:253-260` |
| 5 | `GET /api/v1/friends?date=` | `GET /friends?date=` | 없음 | `FriendController.java:74-80` → `FriendService.java:269-299` |
| 6 | `GET /api/v1/friends/requests?type=` | `GET /friends/requests?type=` | 없음 | `FriendController.java:82-88` → `FriendService.java:381-415` |
| 7 | `GET /api/v1/friends/search?type=&q=` | `GET /friends/search?type=&q=` | 없음 | `FriendController.java:90-97` → `FriendService.java:426-445` |
| 8 | `POST /api/v1/pins/{userId}` | `POST /pins/{userId}` | 없음 | `PinController.java:33-39` → `FriendService.java:307-317` |
| 9 | `DELETE /api/v1/pins/{userId}` | `DELETE /pins/{userId}` | 없음 | `PinController.java:42-48` → `FriendService.java:325-332` |
| 10 | `GET /api/v1/pins?date=` | `GET /pins?date=` | 없음 | `PinController.java:51-56` → `FriendService.java:341-371` |
| 11 | 없음 | `POST /friends/requests/{id}/cancel` | **신규** — 보낸 요청 취소. `FriendService`에 `cancelRequest` 메서드·`FriendshipStatus.CANCELED`·`Friendship.cancel()` 신설 | LLD §1.11 |

행 5·6은 화면 조합용 내부 경로도 겸한다 — §3에서 B26 규칙으로 확정한다. 행 7(검색)·8~10(핀)은
현재 어떤 `/screens/*` 조각 표에도 없어(BG10 재료 표 포함) 내부 경로를 만들지 않는다 — 쓰는 화면이
생기면 그때 추가한다(ponytail: 안 쓰는 내부 경로를 미리 만들지 않는다).

## §2. 편지 도메인

### 2.1 데이터 모델

`letters` 테이블 1개, 상태 전이 없는 단순 모델이다(친구 요청처럼 여러 상태를 오가지 않는다 — 보내면
끝이고, 그 뒤로는 읽음 여부만 바뀐다).

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid PK | `@GeneratedUuidV7`(`common/id/GeneratedUuidV7.java`) — 목록 커서가 생성 시간순 정렬에 기댄다 |
| `sender_id` | uuid NOT NULL, FK→users.id | 보낸 유저 |
| `receiver_id` | uuid NOT NULL, FK→users.id | 받는 유저 |
| `content` | varchar(1000) NOT NULL | 편지 본문. 길이 상한 1000은 이 설계의 기본값 제안이지 확정 제품 수치가 아니다 — island-mailbox 메시지(2000 UTF-16, LLD §2)와 다른 상한을 굳이 맞출 이유가 없어 별도로 잡았다. 실제 값은 구현 착수 전 기획 확인 |
| `read_at` | timestamptz NULL | 수신자가 처음 상세 조회한 시각. NULL = 안 읽음. 별도 status enum을 두지 않는다 — "읽음"은 편지의 유일한 상태 전이라 컬럼 하나로 충분하다(ponytail) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | 발송 시각. 커서 정렬 축은 이 컬럼이 아니라 `id`다(FocusSession 선례와 동일 이유 — UUID v7이 이미 시간순이라 별도 인덱스 컬럼이 필요 없다) |
| `deleted_at` | timestamptz NULL | 소프트 삭제. **이 설계는 사용자가 부르는 편지 삭제 API를 만들지 않는다**(티켓 범위 밖) — 이 컬럼은 §결정-3(친구 삭제 후 편지 보존 정책)이 "삭제"로 결론 나면 그 실행에 쓸 시스템 필드다. 탈퇴 처리에는 쓰지 않는다(§4·LLD §3 탈퇴 절 참고 — 탈퇴는 익명화로 충분해 편지 행을 건드리지 않는다) |

`Friendship`(`friend/repository/domain/Friendship.java:71-73,105-107`)처럼 **행 하나에 삭제 시각 하나**만
둔다 — 발신자·수신자별로 따로 지우는 2컬럼(`deleted_by_sender_at`/`deleted_by_receiver_at`) 모델은
쓰지 않는다. 편지함처럼 "내 쪽에서만 숨기기" UX가 필요해지면 그때 확장한다(YAGNI) — 이 티켓은 삭제
기능 자체를 요구하지 않는다.

인덱스는 목록 조회 두 방향(받은 편지함·보낸 편지함)을 각각 지원한다:

```sql
CREATE INDEX idx_letters_receiver_cursor ON letters (receiver_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_letters_sender_cursor   ON letters (sender_id,   id DESC) WHERE deleted_at IS NULL;
```

`friendships`의 `to_user_id` 단독 인덱스 부재가 남긴 순차 스캔 경고(`FriendshipRepository.java:179-180`
주석, `findActiveByUserId` 바로 위)를 편지에서 반복하지 않으려고 처음부터 커버링 인덱스를 둔다 — 편지함은 친구 목록과 달리 매
화면 진입마다 조회되는 목록이라 순차 스캔을 감당하기 어렵다.

### 2.2 상태 전이

```
[생성됨] --(수신자가 상세 조회)--> [읽음]
```

이것뿐이다. `REJECTED`·`ACCEPTED` 같은 분기가 없다 — 편지는 받는 즉시 확정이고, 유일한 변화는
"읽었는가"다. 상세 조회(`GET /letters/{letterId}`)가 호출자를 수신자로 판별하고 `read_at`이
`NULL`일 때만 `now()`로 채운다(발신자 본인 조회로는 읽음 처리하지 않는다 — 자기가 쓴 편지를 다시
봐도 "상대가 읽었다"는 신호가 아니다).

### 2.3 목록 조회의 커서 규칙 — 그룹 축 keyset 선례를 그대로 따른다

**선례**: `FocusSessionRepository.findSessionsByCursor`
(`server/data-api/src/main/java/com/oneorthree/phone/focus/repository/FocusSessionRepository.java:59-70`)
+ `FocusService.getFocusSessions`(`focus/service/FocusService.java:330-360`). UUID v7 `id`가 이미
생성 시간순이므로 별도 정렬 컬럼 없이 `id DESC` + `cursor IS NULL OR id < :cursor`(strict keyset)로
페이지를 자른다. 응답 봉투는 `FocusSessionSliceResponse`(`focus/dto/FocusSessionSliceResponse.java`)와
`GroupBetHistorySliceResponse`(`group/dto/GroupBetHistorySliceResponse.java`) 두 선례가 공유하는
`{content, size, hasNext, nextCursor}` 모양을 그대로 쓴다.

편지 목록에 그대로 적용:

```sql
SELECT * FROM letters
WHERE receiver_id = :me   -- (또는 sender_id = :me, type=sent일 때)
  AND deleted_at IS NULL
  AND (:cursor IS NULL OR id < :cursor)
ORDER BY id DESC
```

`Slice`로 `size+1`을 읽어 `hasNext`를 판정한다(count 쿼리 없음 — FocusSession 선례와 동일 이유,
편지함은 전체 개수 표시가 필요 없다). `nextCursor`는 반환한 마지막 항목의 `id`.

island-mailbox처럼 HMAC 서명 opaque cursor(LLD §5)를 쓰지 않는다 — 그건 여러 서비스(Realtime)가
같은 cursor를 검증해야 하는 교차 서비스 계약이라 위조 방지가 필요했다. 편지는 Data 안에서만
`id < cursor`를 걷는 단일 서비스 쿼리라 FocusSession과 같은 평문 UUID cursor로 충분하다 — 남의
`id`를 넣어도 `WHERE receiver_id = :me`가 이미 막아 정보 노출이 없다.

### 2.4 소프트딜리트 패턴

`Friendship.deletedAt`과 같은 필드 레벨 패턴을 쓴다(§2.1) — 삭제 메서드는 엔티티에 `Instant`를
받는 도메인 메서드 하나로 두고(`Friendship.softDelete(Instant now)` 형태), 필드를 밖에서 직접
바꾸는 통로는 만들지 않는다. 목록·상세 조회는 전부 `deletedAt IS NULL`을 필수로 건다 —
`FriendshipRepository`(`friend/repository/FriendshipRepository.java:16-23`)의 "목록성 조회는
`deletedAt IS NULL` 필수, 재요청류 판정만 예외" 규칙과 동일선상이다. 편지는 REJECTED 재전환 같은
행 재사용이 없으므로(같은 두 유저 사이에 여러 통의 편지가 동시에 존재할 수 있다 — `friendships`처럼
`(sender_id, receiver_id)` unique 제약을 걸지 않는다) 삭제 행을 되살리는 로직 자체가 필요 없다.

### 2.5 권한 확인 패턴

**선례**: `FriendshipRepository.findAcceptedBetween`(`friend/repository/FriendshipRepository.java:117-129`) +
`FriendService.deleteFriend`의 사용 방식(`friend/service/FriendService.java:253-260`).

- **편지 발송**: 발신자·수신자가 `ACCEPTED`·미삭제 친구 관계여야 한다 — `findAcceptedBetween(sender, receiver)`를
  그대로 재사용해 없으면 `NOT_FRIEND`로 거절한다(LLD §1.12). 친구가 아닌 임의 유저에게 편지를 쓸 수
  없다 — 이 점이 "임의 유저 핀 가능"(`PinController.java:22` 주석)과 다른 제약이다.
- **편지 상세 조회**: 발신자 또는 수신자 본인만 — `FriendService.getReceivedRequest`가 요청 수신자를
  검증하는 방식(`friend/service/FriendService.java:495-502`)과 같은 모양으로, 편지는 두 역할(발신·수신)
  중 하나와 일치해야 한다.
- 유저 활성 조회는 `UserQueryService`의 기존 구분을 그대로 쓴다: 발송 시 양쪽 다
  `getCallerForShare`/`getTargetForShare`(활성 검증 + 공유 락, `UserQueryService.java:157,169`)로
  탈퇴 트랜잭션과 직렬화하고, 상세 조회 같은 순수 읽기는 `getCaller`(`:117`)만 쓴다.

## §3. 화면과의 연결

내부 경로는 B26 규칙(`docs/prd/bff-screens/policy.md` B26) — 본인 것만 읽는 조회는
`/internal/users/{userId}/…`. 새 컨트롤러는 기존 `InternalUserController`
(`server/data-api/src/main/java/com/oneorthree/phone/internal/InternalUserController.java`)와 같은
모양(`@RequestMapping("/internal")` + 메서드별 `/users/{userId}/…`)으로 `friend`·`letter` 패키지
안에 각각 신설한다(`internal` 패키지에 몰아넣지 않는다 — 기존 `InternalUserController`도 유저 축
공통 관심사만 담고, 도메인 전용 내부 표면은 해당 도메인 패키지가 갖는다는 전제가 이미 있다. 이
전제가 깨지면 이 절도 다시 봐야 한다).

| 화면 | 조각 | 내부 GET | 비고 |
| --- | --- | --- | --- |
| `/screens/friends` (프레임 78·79) | `friends` | `GET /internal/users/{userId}/friends?date=` | `FriendService.getFriends` 그대로(§1 행 5) |
| `/screens/friends` | `friendRequests` | `GET /internal/users/{userId}/friend-requests?type=received` | `FriendService.getRequests`(§1 행 6). 보낸 요청도 화면에 필요하면 `type=sent` 병렬 호출을 추가한다 — 이 설계는 두 방향 모두 같은 내부 GET으로 낼 수 있음을 전제로만 남긴다(화면 IA 확정은 이 문서 범위 밖) |
| `/screens/mailbox` (프레임 63-66) | `letters` | `GET /internal/users/{userId}/letters?type=received&cursor=&size=` | 편지함 목록(신규, §2.3). Realtime `…/messages`(island-mailbox)와 나란히 병렬 조각으로 들어간다 |
| `raft` (프레임 76·77) | "받은 친구 요청 수" | 위 `friendRequests`(`type=received`) 응답의 `content.length` | 별도 count 엔드포인트를 만들지 않는다 — 이미 있는 목록의 길이로 충분하다(ponytail) |

**작성자 표시 정보**: island-mailbox는 공개 메시지 작성자용으로 별도 batch 프로필 조회를 새로
설계했다(LLD §5, "임의 userId 프로필 조회가 아니라 요청자/섬/실제 작성자 맥락에 결박된 내부 계약").
편지는 발신자가 **항상 이미 친구**이므로(§2.5) 그런 별도 batch가 필요 없다 — `LetterItemResponse`가
발신자 `nickname`을 직접 실어 보낸다(LLD §1.13 DTO). 화면이 어차피 `friends` 조각도 같이 부르지만,
두 조각이 같은 순간 조합된다는 보장이 없어(B24 — 화면 조각은 독립적으로 병렬 호출된다) `friends`
응답에서 닉네임을 찾아 붙이는 방식은 쓰지 않는다. 탈퇴한 발신자는 `nickname`이 `null`로 내려간다
(`UserService.erasePersonalData`가 닉네임을 지우지만 행은 남긴다 — LLD §3 탈퇴 절).

**편지 상세(프레임 67)**는 화면 조합 표에 없다 — B21 규칙("상세·다음 페이지는 탭할 때 도메인 GET을
부른다")대로 앱이 `GET /letters/{letterId}`를 직접 부른다. 화면 전용 read-model을 만들지 않는다(B24).

## §4. 알림·실시간

**푸시 — 기존 경로를 그대로 재사용한다.** 친구 요청/수락의 이벤트 발행 → `AFTER_COMMIT` 리스너 →
FCM 패턴(`friend/event/FriendRequestSentEvent.java`,
`notification/listener/FriendNotificationEventListener.java:49-63`,
`notification/service/FriendNotificationService.java`)을 편지에도 그대로 적용한다:

1. `letter` 패키지에 `LetterReceivedEvent(letterId, receiverId, senderId)` 신설 — `FriendRequestSentEvent`와
   같은 모양(`friend/event/FriendRequestSentEvent.java`).
2. 편지 저장 서비스가 트랜잭션 안에서 `eventPublisher.publishEvent(...)`만 하고 발송은 하지 않는다
   (`FriendService.createRequest`가 `onRequestCreated`에서 하는 것과 동일 이유 — 저장이 롤백되면
   알림도 안 나가야 한다).
3. `NotificationKind`(`notification/producer/NotificationKind.java`)에 `LETTER_RECEIVED` 1건을
   추가한다 — `FRIEND_REQUEST`와 같은 모양(`MINUTE` 슬롯, `DROP` 정책, `SubjectKind.COUNTERPART_USER`,
   `NotificationKind.java` "친구" 섹션 마지막 두 항목 참고). 새 슬롯 축·정책을 발명하지 않는다.
4. 새 리스너 `LetterNotificationEventListener`(`FriendNotificationEventListener`와 같은 모양,
   `@Async` + `@TransactionalEventListener(AFTER_COMMIT)`)가 발송을 맡는다.

5. **OUTBOX 모드도 함께 배선한다(필수).** 알림 발송에는 두 경로가 있다. 직접 발송 모드에서는 위 `AFTER_COMMIT` 리스너가 보내지만, **OUTBOX 모드에서는 `FriendNotificationEventListener` 가 직접 발송을 건너뛰고 `NotificationRequestOutboxListener` 가 `BEFORE_COMMIT` 에서 이벤트를 outbox 로 수집한다**(`notification/listener/NotificationRequestOutboxListener.java:99-108` 이 `FriendRequestSentEvent`·`FriendRequestAcceptedEvent` 를 그렇게 다룬다). `AFTER_COMMIT` 리스너만 추가하면 OUTBOX 환경에서 편지 알림이 **아무 데도 적재되지 않아 푸시가 전혀 나가지 않는다.** 그래서 같은 클래스에 `collectLetterReceived(LetterReceivedEvent)` 를 `BEFORE_COMMIT` 으로 더한다.
6. **알림 서버 catalog 마이그레이션이 선행돼야 한다.** 적재가 돼도 `server/notification` 의 catalog(`db/migration/V2__notification_catalog.sql` 계열)에 `LETTER_RECEIVED` 의 kind·템플릿·딥링크가 없으면 `DispatchService` 가 억제한다. 알림 서버 쪽 마이그레이션을 이 기능의 선행 작업으로 잡는다 — data-api 만 고치면 조용히 발송되지 않는다.

**실시간 토픽 — 새로 만들지 않는다.** B22(`docs/prd/bff-screens/policy.md` B22)는 토픽을 정확히
7개로 못 박았다: `events`·`focus`·`rest`·`emotes`·`playback`·`messages`·`/user/queue/events`. 편지를
위한 8번째 토픽을 추가하지 않는다 — 근거:

- 편지는 우편함 UX라 즉시성 요구가 낮다. 앱을 보고 있지 않을 때 알림이 필요하다는 요구는 이미
  FCM 푸시(위)가 충족한다 — 실시간 소켓 프레임이 추가로 필요한 이유가 없다.
- 편지함 뱃지(안 읽은 수)를 실시간으로 갱신하고 싶어지면, 새 토픽이 아니라 이미 유저 단위로
  존재하는 개인 큐 `/user/queue/events`(B22, 7개 중 유저 축 전용)에 편지 이벤트 payload를 실어
  보내는 방식을 먼저 검토한다 — 이 설계의 범위 밖이지만, 그 방식이라면 B22의 토픽 개수를 바꾸지
  않는다는 점만 여기 남긴다.
- `island-mailbox`의 `messages` 토픽(LLD §5 "새 topic은 `/topic/islands/{islandId}/messages`")은
  섬 공개 채팅 전용이다. 편지를 그 토픽에 얹으면 섬 주민 전체가 남의 1:1 편지 이벤트를 구독하게
  되어 §0의 도메인 분리를 깨므로 절대 재사용하지 않는다.

**탈퇴와의 관계**: 편지는 탈퇴 정리 대상이 아니다 — `sender_id`/`receiver_id`는 `users.id`를 그대로
가리키고(FK 안 끊김), `UserService.erasePersonalData`(`user/service/UserService.java:286-296`)가
`nickname`만 지우고 유저 행 자체는 `deleted=true`로 남긴다(하드 삭제 아님). 그래서 `friendships`처럼
탈퇴 시점에 편지 행을 순회하며 `softDelete`할 필요가 없다 — 표시 계층이 `nickname == null`을 "탈퇴한
유저"로 이미 처리하는 기존 관례(island-mailbox LLD §2 "탈퇴/비노출 작성자에 대해 name을 null로
허용")를 그대로 따른다. 자세한 근거는 LLD §3.
