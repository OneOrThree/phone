# 친구·편지 — LLD

[README](README.md) · [HLD](high-level-design.md)

에러 응답 봉투는 저장소 전체 정본(`docs/conventions/error-contract.md`)을 따른다 —
`{code, message}`, `code`는 에러코드 enum 상수 이름 그대로. 친구는 기존 `FriendErrorCode`
(`friend/exception/FriendErrorCode.java`)를 그대로 쓰고, 편지는 신규 `LetterErrorCode`를
같은 인터페이스(`common/exception/ErrorCode`)로 만든다. **상수 이름은 두 enum 사이에서도 겹치면 안 된다** — `code` 는 패키지 없이 `name()` 그대로 나가므로 같은 이름을 쓰면 앱이 원인을 구분하지 못한다(`docs/conventions/error-contract.md`:79 「상수 이름 재사용」 금지, 과거 `NOT_FOUND` 중복도 `TARGET_USER_NOT_FOUND` 등으로 개명해 해소했다). 따라서 편지에서 「친구가 아님」은 `FriendErrorCode.NOT_FRIEND`(404)와 이름이 겹치지 않도록 **`LETTER_RECIPIENT_NOT_FRIEND`** 로 둔다.

## §1. 계약별 상세

### 1.1~1.10 — 기존 친구·핀 계약 (동작 변경 없음, 경로만 무접두)

현재 구현의 실제 응답 필드를 그대로 옮긴다 — `FriendControllerDocs.java`·`PinControllerDocs.java`의
Swagger 설명과 `FriendService.java`의 실제 필드가 근거다(HLD §1 표의 `파일:줄` 참고).

| # | 계약 | 요청 | 응답(200/201/204 본문) | 상태코드 | 에러코드 | 권한 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `POST /friends/requests` | body `{targetUserId: UUID}` (`FriendRequestCreateRequest`, `@NotNull`) | 없음 | 201 | 400 `SELF_REQUEST` · 409 `ALREADY_FRIEND` · 409 `REQUEST_ALREADY_EXISTS` (대상 없음은 404, `UserErrorCode` 쪽) | 로그인 유저만. 자기 자신 대상이면 400 |
| 2 | `POST /friends/requests/{id}/accept` | 없음(`id`=요청 행 id) | 없음 | 200 | 403 `NOT_REQUEST_RECEIVER` · 404 `REQUEST_NOT_FOUND` | 요청의 **수신자**만 |
| 3 | `POST /friends/requests/{id}/reject` | 없음 | 없음 | 200 | 403 `NOT_REQUEST_RECEIVER` · 404 `REQUEST_NOT_FOUND` · 409 `INVALID_REQUEST_STATUS`(PENDING 아니면) | 요청의 **수신자**만 |
| 4 | `DELETE /friends/{friendUserId}` | 없음 | 없음 | 204 | 404 `NOT_FRIEND` | 관계의 양쪽 누구나 |
| 5 | `GET /friends?date=YYYY-MM-DD` | query `date`(KST 기준 오늘) | `FriendResponse[]` — `userId`·`nickname`·`tierLevel`·`occupation`·`isPinned`·`isFocusing`·`focusTimeMinutes`·`focusStartedAt`·`focusTagName` | 200 | 400(`date` 누락·형식) | 로그인 유저 본인 목록만 |
| 6 | `GET /friends/requests?type=received\|sent` | query `type` | `FriendRequestResponse[]` — `requestId`·`userId`·`nickname`·`tierLevel`·`createdAt`(=행의 `updatedAt`, HLD §2.2 상태 전이와 달리 친구 요청은 `updatedAt`이 요청 사이클 시작 시각) | 200 | 없음(`type` 미인식 값은 `sent`로 취급 — 대소문자 무시) | 로그인 유저 본인 목록만 |
| 7 | `GET /friends/search?type=&q=` | query `type`(`SearchType`)·`q` | `FriendSearchResultResponse[]` — `userId`·`nickname`·`tierLevel`·`occupation`·`relation`(`NONE`\|`PENDING`\|`FRIEND`) | 200 | 400 `INVALID_SEARCH_TYPE` | 로그인 유저. 결과에서 자기 자신 제외 |
| 8 | `POST /pins/{userId}` | 없음 | 없음 | 204 | 400 `SELF_PIN` (대상 없음은 404) | 로그인 유저. 친구 아닌 유저도 가능 |
| 9 | `DELETE /pins/{userId}` | 없음 | 없음 | 204(핀 없어도 204, 멱등) | 없음 | 로그인 유저 |
| 10 | `GET /pins?date=YYYY-MM-DD` | query `date` | `PinnedUserResponse[]` — `userId`·`nickname`·`character`(장착 슬롯 목록)·`focusTimeMinutes`·`isFocusing` | 200 | 400(`date` 누락·형식) | 로그인 유저 본인 목록만 |

### 1.11 — 친구 요청 취소 (신규)

`POST /friends/requests/{id}/cancel`

**신설 이유**: 현재 발신자가 자신이 보낸 PENDING 요청을 되돌릴 방법이 없다 — 수신자의 거절만
있고(§1.3), 발신자 쪽 취소가 빠져 있다. 받는 쪽이 방치하면 상대 검색 결과에 "요청중"
(`FriendRelation.PENDING`)이 계속 남는다.

| 항목 | 값 |
| --- | --- |
| 요청 | 없음(path `id`=요청 행 id) |
| 응답 | 없음 |
| 성공 코드 | 200 (수락·거절과 같은 모양) |
| 에러 | 403 `NOT_REQUEST_SENDER`(신규 코드, `NOT_REQUEST_RECEIVER`와 대칭) · 404 `REQUEST_NOT_FOUND` · 409 `INVALID_REQUEST_STATUS`(PENDING 아니면) |
| 권한 | 요청의 **발신자**만 — `accept`/`reject`가 수신자만 허용하는 것과 정반대 축 |

**엔티티 변경**: `FriendshipStatus`(`friend/repository/domain/FriendshipStatus.java`)에 `CANCELED`
1개 추가 — `REJECTED`("수신자가 거절함")와 의미가 다르므로 재사용하지 않는다(`REJECTED`를 재사용하면
"수신자가 거절함" enum 주석과 어긋나는 행이 생긴다). `Friendship`에 `cancel()` 도메인 메서드 추가
(`reject()`와 같은 모양 — `status = CANCELED`).

```java
// friend/repository/domain/Friendship.java 에 reject() 바로 아래 추가
public void cancel() {
    this.status = FriendshipStatus.CANCELED;
}
```

**수락 경로도 함께 막는다(필수).** `FriendService.acceptRequest`(`FriendService.java:212-227`)는 **상태를 검사하지 않는다** — 주석에도 「이 API 는 상태를 검사하지 않는다」고 적혀 있고, `ACCEPTED` 인지만 알림 중복 방지용으로 본 뒤 그대로 `accept()` 를 부른다. 그래서 `CANCELED` 를 추가하기만 하면 **발신자가 취소한 요청을 수신자가 옛 requestId 로 수락해 친구 관계가 되살아난다.** `acceptRequest` 에 **`status == CANCELED` 이면** `INVALID_REQUEST_STATUS`(409) 로 막는 검사 **하나만** 넣는다.

**`REJECTED` 와 `ACCEPTED` 는 지금 동작을 그대로 둔다.** `FriendService.java:200-206` 주석이 「수락은 전 상태 관용 — `REJECTED → ACCEPTED` 는 "거절했다 뒤늦게 수락" UX 로 의도된 전이라 허용하고 알린다(GROMO-719 오너 결정). `ACCEPTED → ACCEPTED` 는 멱등(무알림)」이라고 명시한다 — `status != PENDING` 을 통째로 막으면 **이 두 기존 계약이 함께 깨진다.** 이 문서의 전제(기존 친구 API 동작은 바꾸지 않는다)에도 어긋난다.

`CANCELED` 만 예외인 이유: 거절은 「수신자가 한 번 거부했지만 마음을 바꿀 수 있는」 상태라 수락이 의미를 갖지만, 취소는 **발신자가 요청 자체를 거둬들인** 상태라 수신자가 되살릴 근거가 없다.

**서비스 로직**: `FriendService.rejectRequest`(`FriendService.java:238-245`)와 대칭이지만 검증 대상이
반대다 — `getReceivedRequest`(수신자 검증, `:495-502`)와 짝을 이루는 `getSentRequest`(발신자 검증)를
새로 만든다. `Friendship.getFromUser().getId().equals(me)`가 아니면 `NOT_REQUEST_SENDER`.

**재요청 재사용 확장**: `createRequest`의 REJECTED 재전환 분기(`FriendService.java:165-176`)는
현재 `status == REJECTED`만 본다. `CANCELED`도 같은 방식으로 재사용해야 한다 — 취소한 요청을 다시
보낼 때 `unique(from_user_id, to_user_id)`에 걸려 새 행을 못 만드는 사정은 REJECTED와 같다. 구현
시 이 조건을 `status == REJECTED || status == CANCELED`로 넓히거나, "ACCEPTED가 아닌 내 방향
행"으로 일반화한다.

**마이그레이션 영향**: `friendships_status_check` CHECK 제약에 `CANCELED`를 추가해야 한다 — §2.

### 1.12 — 편지 보내기 (신규)

`POST /letters`

| 항목 | 값 |
| --- | --- |
| 요청 body | `{receiverId: UUID, content: String}` — 둘 다 필수. `content`는 strip 후 empty면 400(아래 에러 칸과 같다) |
| 응답 body | `LetterResponse` — `id`·`senderId`·`receiverId`·`content`·`createdAt`·`readAt`(항상 `null`, 방금 만든 편지) |
| 성공 코드 | 201 |
| 에러 | 400 `SELF_LETTER`(자기 자신에게) · 400 `INVALID_REQUEST`(필수 누락·strip 후 빈 본문) · 422 `LETTER_CONTENT_OUT_OF_RANGE`(길이 상한 초과, §2.1) — **한 상수는 한 상태만 갖는다**(`common/exception/ErrorCode.getStatus()` 가 하나뿐이라 「400 또는 422」는 표현할 수 없다) · 404 `TARGET_USER_NOT_FOUND`(수신자 없음·탈퇴 — `UserQueryService.getTargetForShare`(`user/repository/UserQueryService.java:157`)가 던지는 코드다. 요청자 쪽 `getCallerForShare` 의 `USER_NOT_FOUND` 와 다르다) · 404 `LETTER_RECIPIENT_NOT_FRIEND`(친구 관계 아님, HLD §2.5) |
| 권한 | 로그인 유저 = `senderId`(토큰에서 주입, 본문으로 받지 않는다 — `FriendRequestCreateRequest`와 같은 관례) |

`FriendService.createRequest`의 활성 검증 순서(`FriendService.java:137-138`, `getCallerParticipant`→
`getRelationParticipant`)를 그대로 따른다 — 발신자·수신자 둘 다 활성 유저인지 먼저 확인한 뒤
`findAcceptedBetween`으로 친구 관계를 확인한다.

### 1.13 — 편지함 목록 (신규)

`GET /letters?type=received|sent&cursor=&size=`

| 항목 | 값 |
| --- | --- |
| 요청 query | `type`(`received`\|`sent`, 기본 `received`) · `cursor`(직전 페이지 마지막 편지 `id`, 생략 시 첫 페이지) · `size`(**기본 20 · 허용 1~100**). `FocusService` 는 상한 100(`MAX_PAGE_SIZE`)만 정의하고 `size` 를 `@RequestParam int size` 로 **필수**로 받으므로(`FocusController.java:129`) 기본값 선례가 없다 — 편지함은 화면 조합이 파라미터 없이 부르는 조각이라 기본값이 반드시 필요해 여기서 숫자로 확정한다 |
| 응답 body | `LetterSliceResponse{content, size, hasNext, nextCursor}` — `FocusSessionSliceResponse`(`focus/dto/FocusSessionSliceResponse.java`)와 같은 모양 |
| `LetterItemResponse` | `id`·`counterpartUserId`(상대 — `type=received`면 발신자, `type=sent`면 수신자)·`counterpartNickname`(HLD §3 "작성자 표시 정보" — 탈퇴자는 `null`)·`content`·`isRead`(`type=sent`일 때는 항상 `false` 고정 — 내가 보낸 편지의 상대측 열람 여부는 이 계약에서 노출하지 않는다)·`createdAt` |
| 성공 코드 | 200 |
| 에러 | 400 `INVALID_PAGE_REQUEST`(size 범위 초과) |
| 권한 | 로그인 유저 본인 편지함만(`receiver_id`/`sender_id` = 본인로 고정, 쿼리 파라미터로 다른 유저 지정 불가) |

쿼리는 HLD §2.3 그대로:

```sql
SELECT * FROM letters
WHERE ((:type = 'received' AND receiver_id = :me)
    OR (:type = 'sent'     AND sender_id   = :me))
  AND deleted_at IS NULL
  AND (:cursor IS NULL OR id < :cursor)
ORDER BY id DESC
```

**수신·발신 선택 조건 전체를 괄호로 묶는 것이 필수다.** SQL 은 `AND` 가 `OR` 보다 먼저 결합하므로 괄호가 없으면 `type='received'` 일 때 첫 절만 참이면 `deleted_at`·커서 조건을 통째로 건너뛴다 — 다음 페이지가 첫 페이지를 다시 돌려줘 페이징이 멈추고, 소프트 삭제된 편지까지 노출된다.

(실제 JPA 리포지토리는 `FocusSessionRepository.findSessionsByCursor` 처럼 `type`별로 메서드를
나누는 편이 `Slice`+`@Query` 조합에서 더 단순하다 — 구현 시 선택.)

### 1.14 — 편지 상세 (신규)

`GET /letters/{letterId}`

| 항목 | 값 |
| --- | --- |
| 응답 body | `LetterResponse` — `id`·`senderId`·`senderNickname`·`receiverId`·`content`·`createdAt`·`readAt` |
| 성공 코드 | 200 |
| 에러 | 404 `LETTER_NOT_FOUND` · 403 `NOT_LETTER_PARTICIPANT`(발신자도 수신자도 아님) |
| 권한 | 발신자 또는 수신자 본인만(HLD §2.5) |
| 부수효과 | 호출자가 **수신자**이고 `readAt IS NULL`이면 `now()`로 갱신한다. 발신자 본인 조회는 `readAt`을 건드리지 않는다. **갱신은 원자적이어야 한다** — `UPDATE letters SET read_at = :now WHERE id = :id AND read_at IS NULL` 같은 조건부 UPDATE(또는 행 배타 락)로 쓴다. 읽고 나서 쓰면 두 기기·재시도가 동시에 `read_at IS NULL` 을 읽어 각자의 `now()` 를 덮어써 **실제 최초 열람 시각이 보존되지 않는다** |

### 1.15 — 내부 GET (B26, Business 전용)

HLD §3 표와 동일. 공개 계약(§1.5·1.6·1.13)과 인가만 다르다 — 서비스 위임 토큰 + `X-User-Id`,
`InternalAuthFilter`가 경로의 `{userId}`와 대조(선례 `InternalUserController.java:44-58`).

| 내부 GET | 대응 공개 계약 | 신설 위치 |
| --- | --- | --- |
| `GET /internal/users/{userId}/friends?date=` | §1.5 | `friend/InternalFriendController`(신설) |
| `GET /internal/users/{userId}/friend-requests?type=` | §1.6 | 위와 동일 클래스 |
| `GET /internal/users/{userId}/letters?type=&cursor=&size=` | §1.13 | `letter/InternalLetterController`(신설) |

**컨트롤러 신설만으로는 호출되지 않는다.** `InternalAuthFilter` 는 등록된 (메서드, 경로) 패턴과 정확히 맞지 않으면 403 을 준다. 현재 `application-satellites.yml` 의 business caller 허용목록(`internal.api.callers.business.allow`)에 이 세 경로가 없으므로, 구현 PR 이 다음 세 줄을 함께 추가해야 `friends`·`mailbox` 조각이 거절되지 않는다.

```yaml
          - 'GET /internal/users/*/friends'
          - 'GET /internal/users/*/friend-requests'
          - 'GET /internal/users/*/letters'
```

세그먼트 하나짜리 `*` 로 적는다 — `GET /internal/users/*` 처럼 넓히면 같은 접두의 다른 계약까지 함께 열린다([bff-screens 구현 문서](../bff-screens/implementation-data-api.md) §3 의 같은 경고).

## §2. Flyway 마이그레이션 계획

**버전 번호는 예약하지 않는다.** 이 문서 작성 시점 최신은
`server/data-api/src/main/resources/db/migration/V56__realtime_outbox_target.sql`이므로 다음
사용 가능한 번호는 **V57**이지만, 실제 번호는 다른 PR과 경합하므로 **머지 직전에 확정**한다
(`server/data-api/CLAUDE.md` 관례). 파일명 예시는 `V57__friend_cancel_and_letters.sql`(가제) —
같은 티켓의 두 스키마 변경(친구 상태 확장 + 편지 테이블 신설)이라 한 파일로 묶는다.

```sql
-- ── 1. 친구 요청 취소 상태 추가 (§1.11) ──────────────────────────────
ALTER TABLE friendships DROP CONSTRAINT friendships_status_check;
ALTER TABLE friendships ADD CONSTRAINT friendships_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED'));
-- 근거: 현재 제약은 V1__baseline.sql:148. 다른 컬럼은 손대지 않는다.

-- ── 2. 편지 테이블 신설 (§2.1) ────────────────────────────────────
CREATE TABLE letters (
    id          uuid PRIMARY KEY,
    sender_id   uuid NOT NULL REFERENCES users(id),
    receiver_id uuid NOT NULL REFERENCES users(id),
    content     varchar(1000) NOT NULL,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
-- FK는 V1__baseline.sql의 friendships FK 스타일(ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY,
-- V1__baseline.sql:1033-1040)과 달리 CREATE TABLE 안에 인라인으로 뒀다 — 신규 테이블이라
-- 베이스라인의 "덤프 순서상 나중에 ALTER로 붙인" 제약이 아니라 처음부터 함께 만든다.

CREATE INDEX idx_letters_receiver_cursor ON letters (receiver_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_letters_sender_cursor   ON letters (sender_id,   id DESC) WHERE deleted_at IS NULL;
```

**`schema.dbml` 동반 반영 필수** — `server/data-api/docs/db/schema.dbml`은 tracked 파일이라
(`server/data-api/.gitignore`의 `docs/db/` 화이트리스트, GROMO-735) 이 마이그레이션과 **같은 PR**에서
`friendships` 테이블 정의(`schema.dbml:340-357`)의 `status` 주석에 `CANCELED`를 추가하고, `letters`
테이블 블록을 새로 추가해야 한다. dbml이 실제 마이그레이션과 갈라지면 다음 스키마 변경 작업자가
틀린 정본을 보고 작업한다.

## §3. 탈퇴 시 처리

**친구**: 기존 로직 그대로 — 변경 없음. `AccountWithdrawalService.withdraw`
(`server/data-api/src/main/java/com/oneorthree/phone/withdrawal/service/AccountWithdrawalService.java:127`)가
`friendService.detachWithdrawnUser(userId, Instant.now())`
(`friend/service/FriendService.java:533-539`)를 호출해 그 유저가 낀 모든 살아있는 관계(`ACCEPTED`뿐
아니라 `PENDING`도, status 무관)를 소프트 삭제한다. `CANCELED`도 이미 "무관"에 포함되므로 이
호출부는 손댈 필요가 없다 — `findActiveByUserId`(`FriendshipRepository.java:176-198`, "status
무관")가 그대로 잡는다.

**핀**: 기존 로직 그대로 — `pinnedUserRepository.deleteAllInvolving(userId)`
(`friend/service/FriendService.java:538`, `PinnedUserRepository.java:68-82` "회원 탈퇴" 벌크 DELETE)가
내가 건 핀·남이 나를 건 핀 양쪽을 하드 삭제한다.

**편지 — 새 정리 로직을 추가하지 않는다.** 근거(HLD §4 탈퇴 절):

1. `sender_id`/`receiver_id`는 `users.id` FK다. `UserService.erasePersonalData`
   (`user/service/UserService.java:286-296`)는 `user.setDeleted(true)`로 소프트 삭제하고
   `nickname`을 `null`로 지우지만 **행을 지우지 않는다** — FK가 끊기지 않으므로 편지를 미리
   정리하지 않아도 500(FK 위반)이 나지 않는다.
2. 표시 계층은 이미 "탈퇴자 표시 정보 null 허용" 관례가 있다 — island-mailbox LLD §2가 같은
   문제(탈퇴한 메시지 작성자)를 "name/catColor를 null로 허용하는 공개 DTO 확장"으로 풀었다.
   `LetterItemResponse.counterpartNickname`(§1.13)도 같은 방식을 쓴다 — 탈퇴자는 조회 시점에
   `nickname == null`이 자연히 나온다.
3. `focus`·`stats`·`screentime` 도메인의 탈퇴 처리(`AccountWithdrawalService.java:119-121`
   `anonymizeWithdrawnUser`)가 이미 "행은 남기고 표시만 끊는" 같은 패턴이다 — 편지도 그 계열에
   합류할 뿐 새 패턴이 아니다.

**주의**: 이건 **탈퇴**(withdraw) 처리다. **친구 삭제**(unfriend, `DELETE /friends/{friendUserId}`)는
전혀 다른 트리거이고, 그 뒤 주고받은 편지를 어떻게 할지는 §결정-3(아래)이 아직 정하지 않았다 —
탈퇴 처리와 혼동하지 않는다.

## §4. 결정 대기 — 값을 지어내지 않는다

아래 3건은 제품 결정이 필요하다. **각 선택지의 결과만 적었고 실제 값은 비워 뒀다** — 코드나
마이그레이션에 반영하기 전에 재영님 확인이 선행돼야 한다.

### 결정 1 — 게스트 계정이 편지를 읽을 수 있는 범위

`User.isGuest`(`user/repository/domain/User.java:58`)가 이미 존재하는 필드다. 게스트도 친구를
맺고 편지를 주고받을 수 있는지, 받을 수만 있고 보낼 수는 없는지 등 조합이 여럿이다.

| 선택지 | 결과 |
| --- | --- |
| A. 게스트도 완전히 동일 | 편지 도메인에 게스트 분기가 전혀 없다. 게스트 계정이 대량 생성돼 스팸처럼 편지를 뿌리는 악용 경로를 별도로 막아야 한다 |
| B. 게스트는 받기만(보내기 금지) | `POST /letters`가 `getCallerParticipant`에서 `isGuest`를 추가로 확인해야 한다(§1.12 검증 순서에 분기 추가). 게스트 온보딩 중 "편지 써보기" 같은 유도 UX는 불가 |
| C. 게스트는 친구 자체가 불가(전제가 되는 친구 요청 단계에서 이미 막힘) | 이 문서가 다루는 편지 계약 자체가 게스트에게 도달하지 않는다 — 다만 이 경우 막는 지점은 `friend` 도메인(`FriendService.createRequest`)이지 `letter` 도메인이 아니므로, 이 결정은 friend-letter 티켓보다 상위(BG10 밖) 결정일 수 있다 |

**재영님 확인 필요**: (값 비움)

### 결정 2 — 받는 쪽 섬의 우체통 시설이 완공돼야 편지를 받을 수 있는가

우체통은 `island-construction`의 건설 대상 하나다(`docs/prd/fishcat/island-construction/prd.md:11`,
"전망대·우체통·방송기" 선택 시설). `/screens/mailbox` 자체는 이미 "섬 문맥(우체통 완공)"을
전제로 게이팅된다(`implementation-business-api.md` §4 `mailbox` 행) — 하지만 그건 **화면 접근**
게이트이고, 이 결정은 **편지 발송/수신 자체**를 우체통 완공에 묶을지를 묻는다.

| 선택지 | 결과 |
| --- | --- |
| A. 우체통 완공과 무관 — 언제나 발송·수신 가능 | `POST /letters`(§1.12)가 수신자의 섬·시설 상태를 조회하지 않는다. 우체통이 없는 섬 주민도 편지는 쌓이고, 나중에 `/screens/mailbox`를 열면(우체통 완공 후) 한꺼번에 보인다 |
| B. 수신자 섬에 우체통이 없으면 발송 자체를 막는다 | `POST /letters`가 island-construction 조회를 새로 의존해야 한다(§1.12 검증에 시설 확인 단계 추가) — 편지 도메인이 섬 도메인에 결합된다. 에러코드 신설 필요(예: `RECEIVER_MAILBOX_LOCKED`) |
| C. 발송은 항상 가능하지만 우체통 완공 전까지는 "쌓이기만 하고 안 보임"(화면 게이트만, A와 결과는 같지만 의도적으로 "수신 보류"라고 명시) | A와 API 동작은 동일 — 문서화 차이뿐이라 사실상 A의 하위집합 |

**재영님 확인 필요**: (값 비움)

### 결정 3 — 친구를 삭제한 뒤 주고받은 편지를 보존하는가

`DELETE /friends/{friendUserId}`(§1.4)는 `friendships` 행만 소프트 삭제한다(§3의 탈퇴 처리와
별개 — 이건 살아있는 유저가 명시적으로 친구를 끊는 경우다).

| 선택지 | 결과 |
| --- | --- |
| A. 보존 — 편지는 친구 관계와 독립적으로 계속 보인다 | `deleteFriend`(§1.4)가 `letters` 테이블을 전혀 건드리지 않는다 — 구현 변경 없음. 편지함에는 이제 친구가 아닌 상대의 편지도 남는다(`counterpartNickname`은 여전히 조회 가능 — 상대가 탈퇴하지 않는 한) |
| B. 삭제 — 친구를 끊으면 그 사이 주고받은 편지도 양쪽에서 사라진다 | `deleteFriend`가 두 유저 사이의 `letters` 행을 전부 `deletedAt`으로 소프트 삭제해야 한다(§2.1의 `deleted_at` 컬럼이 이 용도로 처음 쓰인다) — `FriendService.deleteFriend`(`FriendService.java:253-260`)에 편지 정리 호출 추가, `Friendship.softDelete` 패턴과 동일한 도메인 메서드(`Letter.softDelete(Instant)`) 신설 |
| C. 받은 사람만 유지, 보낸 사람 쪽에서만 정리(또는 반대) | §2.1에서 명시적으로 배제한 "발신자/수신자별 개별 삭제" 2컬럼 모델이 필요해진다 — 이 선택지를 고르면 §2.1 데이터 모델부터 다시 설계해야 한다 |

**재영님 확인 필요**: (값 비움)
