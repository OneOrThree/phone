# 집중·휴식 상세 계약

> GROMO-1763 · [정책](policy.md) · [구성](high-level-design.md) · [원본9계약](source-contracts.json)
> 아래 테이블/필드는 후속 구현 설계다. 현재 DB·API에 이미 있다는 뜻이 아니다.

## 1. 공통 타입과 공개 범위

`Id`는 UUID 문자열이다. 원본 `soda`, `focus-1`, `minji`는 설명용 ID라 요청 validator 예제로 쓰지 않는다.
`Instant`는 UTC ISO-8601, `Version`은 0~9007199254740991 정수(발행 세션은1부터), `Seconds`는
0 이상의 안전 정수다. `targetMinutes`, expectedVersion은 JSON 정수 타입을 변환 전에 검사한다.
소수/문자열을 Long으로 강제 변환해 통과시키지 않는다. 버전 누락/타입 오류400, 음수/초과422다.

| DTO | 공개 필드 |
| --- | --- |
| `FocusSessionView` | id:Id, islandId:Id, subject:string, targetMinutes:integer, status:active\|paused, activeSeconds:Seconds, serverNow:Instant, startedAt:Instant, restStartedAt:Instant?, version:Version |
| `FocusFinishView` | recordId:Id, islandId:Id, subject:string, targetMinutes:integer, activeSeconds:Seconds, goalAchieved:boolean, earnedFish:integer, allocation:{personalFishAdded:integer,constructionFishAdded:integer}(2026-09-18 D5-귀속으로 «되살아난» 필드 — **2026-09-21 재화-단일로 `personalFishAdded` 는 영구 0, `constructionFishAdded` 가 `earnedFish` 전부다**. 개인 물고기 지갑이 없어 비율이라는 축 자체가 없다. 두 필드는 호환으로 유지하고 제거는 앱 전량 전환 뒤 별도 티켓(재화-단일-호환 ③). `constructionFishAdded` 는 섬 통장 몫인데 이름이 건설로 좁다(섬 통장은 공동 구매에도 쓰인다) — 이름 재검토는 LLD 개정 몫), completedAt:Instant, questProgress:[{id:Id,myRate:number}] |
| `FocusMember` | userId:Id, name:string, catColor:catalogKey, appearance:{clothes:catalogKey?,decor:catalogKey?,hull:catalogKey,position:front\|back}, sessionId:Id, subject:string, activeSeconds:Seconds, status:active\|paused |
| `RestMember` | userId:Id, name:string, catColor:catalogKey, restSeat:integer, restStartedAt:Instant |
| `FocusSummary` | date:KST date, completedSeconds:Seconds, currentSessionSecondsToday:Seconds, totalSeconds:Seconds, serverNow:Instant |

카탈로그 값은 외양 설계의 정본을 참조하고 여기서 새 항목을 지급하거나 임의 enum을 확정하지 않는다.

**구현 유예(GROMO-1765):** `FocusMember`·`RestMember` 의 `catColor`·`appearance`(와 BFF B14 의 `appearanceVersion`)는 출처(계정 Q03 · 개인 외양 정본 티켓 1783)가 main 에 들어오기 전까지 싣지 않는다. `null` 로 채우지 않고 제공자가 생기면 필드를 추가한다([BFF policy B14](../bff-screens/policy.md)).

nullable 필드는 키를 유지한다. 현재 세션이 없으면 data=null, 목록은 items=[]다.
FocusFinishView의 myRate 범위·퀘스트 포함 기준은 1772/1773의 승인 계약을 사용한다. 원본83을 고정값으로
반환하거나 계산 불가를 무조건0으로 바꾸지 않는다. subject 원문/이름/외양 이외의 계정정보·토큰·타인 지갑은
공개 DTO에 없다. 완료 기록의 통계 태그와 subject는 다른 개념이며 subject 문자열로 기존 태그를 자동 생성하지 않는다.

## 2. 9계약의 동작

원본 9계약 뒤에 **GROMO-1998 이 셋을 더한다** — 서버 크론 `rest-auto-close` 와 그 결과를 한 번만 건네는
`pending-result`·`acknowledge`. 원본 계약의 동작은 바뀌지 않는다.

### start — POST /focus-sessions, 201

입력은 `{islandId, subject, targetMinutes}`. Idempotency-Key 필수, expectedVersion 없음.
Data 사용자 잠금 아래 계정 활성, 현재 섬 일치, 활성 membership, 미종료 세션 부재를 검증한다.
같은 키의 성공 재생은 원201/같은 id·startedAt·serverNow·version을 유지한다. 새로운 키로 이미 진행 중이면
409 STATE_CONFLICT다. 사전 GET가 null이었다고 새 세션을 무조건 만들지 않는다.
상세/ACTIVE 구간·세션 version1·주민 투영·outbox를 한 TX에 만든다. 보상/기여는 아직 지급하지 않는다.
subject/목표 허용 범위는 FR-D06, reward policy revision은 FR-D01 확정 설정을 시작 시 고정한다.
정책 없는 세션을 시작시켰다가 finish에서 영구 막는 배포를 하지 않는다.

### session — GET /focus-sessions/current, 200

입력 없음, 본인만 조회한다. 단일 DB snapshot의 현재 세션과 상세·구간을 읽고 serverNow 시점 순수 초를 반환한다.
paused이면 restStartedAt 유지/activeSeconds 고정, active이면 restStartedAt=null.
completed를 current로 반환하지 않고 data=null이다. 다기기에서 같은 세션으로 복구한다.
FR-D03이 미결인 소속 상실 중간 상태를 정상으로 만들지 않는다. 정책 확정 후 소속 상실 복구 DTO는 별도 개정한다.

### pause — POST /focus-sessions/{sessionId}/pause, 200

입력 `{expectedVersion}`와 키 필수. 본인·소속·active·version을 검사한다. ACTIVE 열린 구간을 서버 시각 t에서
닫고 REST 구간을 열며, paused/restStartedAt=t와 sessionVersion+1을 저장한다.
restSeat는 섬의 허용 주민 수에 맞는 서버 자리1..capacity 중 빈 최소 번호를 같은 섬 잠금 아래 배정하는
기술 선택이다. paused 동안 유지하며 같은 섬의 두 paused 사용자에게 같은 자리를 주지 않는다.
자리 배치는 로컬 연출이고 자리 선택/예약 API를 추가하지 않는다. 같은 키는 원 결과, 다른 키의 paused 재요청은409다.

### resume — POST /focus-sessions/{sessionId}/resume, 200

입력 `{expectedVersion}`와 키 필수. 본인·소속·paused·version을 검사한다. REST 구간을 t에서 닫고 같은
sessionId의 ACTIVE 구간을 열며 restStartedAt/restSeat를 null로 지운다. sessionVersion+1.
REST 시간은 activeSeconds에 더하지 않는다. completed/active에 대한 신규 resume는409다.

### finish — POST /focus-sessions/{sessionId}/finish, 200

입력 `{expectedVersion}`와 키 필수. active/paused에서 가능하다. 새 종료만 version을 검사하고 열린 구간을
닫은 뒤 **정산 «기록»을 확정한다 — 지급은 하지 않는다**(2026-09-20 결정 D5-적립: 물고기는 진행 중에 매분 적립 틱이 이미 섬 통장에 넣었고,
마지막 틱 이후의 자투리는 버린다). endedAt/completedAt, 순수초·날짜분포·goalAchieved·정산 정책 revision·allocation(2026-09-19 D5-귀속-개정 — 섬 통장 100%·개인 0%, 비율은 운영값. ~~D5-귀속 50/50~~ 대체)·
원래 questProgress와 내부 events를 세션별 정산에 고정한다. `earnedFish` 는 그 세션이 적립 원장에 쌓은 합이고 `allocation` 은 `{0, earnedFish}` 다.
`targetMinutes` 는 선택이라 없을 수 있고, 없으면 `goalAchieved` 는 false 다.

같은 키/같은 본문은 공통 receipt를 재생한다. **이미 완료된 같은 세션을 새 키로 finish해도**, 계정 활성·본인·
현재 결과 열람 권한을 검사한 후 세션별 정산의 같은 결과를 반환하는 도메인 복구 계약을 채택한다.
이때 과거 expectedVersion을 현재와 비교해 원 성공을 실패로 바꾸지 않고 새 원장·통계·이벤트를 만들지 않는다.
공통 receipt에 같은 키의 다른 본문이 있으면 이 도메인 복구보다 먼저409다. 정산이 없는데 completed인 새 행은
자동 재지급하지 않고 정합성 오류로 운영 복구한다. legacy 완료행은 새 finish 대상이 아니며 결과를 추정하지 않는다.

receipt·정산의 원 결과 전체는 현재 섬 데이터 열람 권한이 있을 때만 공개한다. 소속 상실 뒤 같은 키라는
이유로 questProgress/섬 정보가 든 결과를 그대로 재생하지 않는다. 본인 완료 증거가 필요한 FR-D03은 관리 정책과
공개 축소 DTO를 먼저 확정한다. 비활성 계정은404, 타인 세션은403, 없는 세션은404다.

### rest-auto-close — 서버 크론(공개 엔드포인트 없음), GROMO-1998

휴식(`PAUSED`)에 들어간 지 **1시간**이 지나면 서버가 이번 집중을 **정상 완료**로 끝낸다
([현재 정책](https://github.com/OneOrThree/planning-document/blob/main/policy-2026-09-14.md) 「집중·휴식·도서관」:
"휴식하기를 누른 순간부터 1시간이 지나면 서버가 이번 집중을 자동 종료한다. 정상 종료와 같게 집중 기록·퀘스트 진행에
반영하고, 다음에 앱을 켤 때 결과창을 한 번 보여준다. 물고기는 이미 섬 잔액에 들어가 있어 따로 정산하지 않는다").

- 유예의 기산점은 `last_transition_at` 이다 — PAUSED 행에 그 값을 쓰는 전이는 `pause` 하나뿐이라 곧 `restStartedAt` 이다.
- `finish` 와 **같은 정산 경로**를 탄다: 열린 REST 구간을 닫고, 일 집계·기본 마커(`COMPLETED`)·정산 행·focus/rest
  사건·프레즌스 해제를 한 TX 에 남긴다. 포기(`ABANDONED`)·소속 상실(`MEMBERSHIP_LOST`)과 달리 **정산 행이 생긴다** —
  그 둘은 「미정산」이고 이쪽은 「정상 완료」다.
- 추가 지급은 없다. 적립 틱이 이미 넣었고(D5-적립), 종료 직전 적립 한 번이 마지막에 «찬» 분만 확정한다.
- 잠금 순서는 전이와 같다(사용자 공유 → 섬 배타 → 멤버십 공유 → 상세 배타). 스캔이 고른 뒤 잠그기까지
  `resume`·`finish` 가 이길 수 있으므로 **잠근 뒤 다시 판정**한다 — 여전히 `PAUSED` 이고 여전히 1시간을 넘겼을 때만
  끝낸다. 반대로 크론이 이기면 뒤늦은 `resume` 은 409 `SESSION_STATE_CONFLICT`, 뒤늦은 `finish` 는 완료 세션의
  도메인 복구 경로로 **원 결과를 그대로** 돌려받는다(새 정산 행 없음).
- 「본인이 접속하지 않아도」 남의 모닥불 화면에서 사라져야 하므로 지연 판정이 아니라 **크론**이다
  (`FocusRestAutoCloseScheduler`, 매분 30초, ShedLock). 크론 게이트는 두지 않는다 — 지급 주체가 둘이 되는 문제가
  없고 세션당 정산 1행(PK)이 최후 방어선이다.

### pending-result — GET /focus-sessions/pending-result, 200

입력 없음, 본인만 조회한다. **자동 종료로 끝났고 아직 안 보여 준** 정산 중 가장 오래된 한 건을 `finish` 와
**같은 모양**(`FocusFinishView`)으로 돌려준다 — 앱이 결과창을 두 벌 그리지 않게 한다. 보여 줄 것이 없으면
`data:null` 이고 404 가 아니다(`session` 과 같은 규칙: 빈 본문은 계약 위반이다).
`finish` 로 끝난 정산은 결과를 그 자리에서 이미 돌려줬으므로 여기에 오지 않는다.
확인(`acknowledge`) 전에는 몇 번을 물어도 같은 결과가 온다 — 네트워크가 끊기거나 앱이 죽어 결과창을 못 본
사용자에게 「영영 못 받음」을 만들지 않는다.

### acknowledge — POST /focus-sessions/{sessionId}/acknowledge, 204

본문 없음, 키 없음. `focus_settlements.acknowledged_at IS NULL` **조건부 원자 UPDATE** 라 재접속·동시 접속·재시도에
몇 번이 와도 최초 1회만 세팅되고 나머지는 0행 no-op 다 — 「한 번만 제공」의 근거는 이 컬럼 하나이고 인메모리
플래그가 아니다(`league_weekly_results.acknowledged_at` 과 같은 관례). 확인할 것이 없어도(이미 확인했거나 자동 종료가
아닌 세션) 성공이다. **남의 세션은 403** 이다 — 확인 시각은 그 사람의 결과가 사라지는 부작용이다.
Business 는 204 를 공통 advice 가 200 `data:null` 로 바꾼다.

### home-summary — GET /me/focus-summary, 200

query `{date?,timezone?}`. [KST 규약](policy.md)을 적용한다. completedSeconds는 해당 KST 날짜의 완료 net,
currentSessionSecondsToday는 진행 세션 ACTIVE 구간과 요청 날짜의 교집합이다. totalSeconds는 둘의 합이다.
종료 TX와 겹친 GET가 '완료 집계 갱신 후 + 아직 진행 중'을 동시에 읽어 이중 계산하지 않도록
완료 집계·진행 상태·구간을 같은 읽기 snapshot(단일 SELECT 또는 read-only REPEATABLE READ)에서 읽는다.
캐시된 완료 값과 실시간 진행 값을 따로 더하지 않는다. 소속에 관계없는 본인 개인 요약이며 과거 기록은
기존 KST net 집계와 연결하되 새 종료의 가산은 정확히 한 번만 수행한다.

### focus-group / rest-members — GET /islands/{islandId}/focus-members, /rest-members, 200

**비소속 방문자도 조회한다(2026-09-19 확정, 1765 구현).** 방문자에게 내리는 항목은 주민과 같다 —
이 목록은 섬 광장에 앉아 있는 사람들의 모습 그 자체이고, 둘로 가르면 앱이 두 모양을 다뤄야 하며,
가입이 열린 섬에서는 가려 봐야 「가입하면 보인다」로 끝난다. **없는 섬·종료된 섬·탈퇴 계정은 여전히
403 MEMBER_ONLY** 로 합쳐 임의 islandId로 섬 존재가 새지 않게 한다. 섬에 비공개 속성이 생기면 그
판정은 이 한 곳(`requireVisitableIsland`)에 들어간다. 목록에 실리는 사람은 언제나 **그 섬의 활성
주민**이라 강퇴·탈퇴자는 방문자 화면에서도 사라진다. focus 목록은 진행 세션
active/paused를 포함하고 completed는 제거한다. rest 목록은 paused만 포함한다. 과목·이름·외양을 batch로
읽어 N+1을 피한다. activeSeconds는 snapshot의 같은 serverNow anchor로 계산한다.

원본 `{items,serverNow}`에 PR737의 **watermarks**를 추가한다. 각 focus row에는 표시 외양/과목에 필요한
현재 공개 DTO가 있지만 이벤트는 이 전체 프로필을 모두 포함하지 않으므로 미지의 사용자를 이벤트만으로 생성하지 않는다.
watermark `{projection:"focus.member"|"rest.member",islandId,aggregateId:userId,version}`는 해당 상태와
같은 DB snapshot에서 읽는다. 종료/비휴식 tombstone도 version을 보존하되 무한 과거 사용자 목록을 공개하지 않는다.
미지 key는 정본 재조회 규칙으로 복구한다. 원본 RestMember의 sessionId 필드를 몰래 추가하지 않으며
휴식 시간 표시는 restStartedAt와 serverNow를 사용한다.

### emote — STOMP SEND /app/islands/{islandId}/focus/emotes

SEND body는 원본 `{sessionId,type}`다. type은 hello/cheer/sleepy/laugh/hearts만 허용한다.
서버가 principal의 활성·소속·해당 섬 **본인 진행 세션(active 또는 paused)의 sessionId**를 검증한다.
**휴식 중에도 보낼 수 있다(2026-09-20 결정)** — 휴식은 같이 낚시에서 빠진 상태가 아니라 모닥불에 앉은
상태이고, 쉬는 사람이 집중하는 사람을 응원하지 못하면 이 기능의 절반이 사라진다. 판정 정본은
`GET /internal/islands/{islandId}/focus-members`다 — 그 목록의 필터가 `[ACTIVE, PAUSED]`라 휴식자도
`status:"paused"`로 실려 온다. 거기에 내가 같은 sessionId로 있으면 활성 계정·살아 있는 섬·현재 활성
주민·본인 진행 세션이 한 번의 조회로 전부 증명된다(그래서 이 결정에 새 표면이 필요 없었다).
서버는 목록에 있다는 것만으로 통과시키지 않고 status가 그 둘 중 하나인지 확인한다 — Data가 나중에
다른 상태를 같은 목록에 실어도 조용히 허용되지 않게 한다.
TTL 캐시를 최종 권한 증거로 쓰지 않는다(§4.2). userId·expiresAt·destination은
클라이언트가 지정할 수 없다. **완료·포기/다른 사용자 세션/다른 섬이면 전송하지 않는다.**

Realtime가 서버 eventId·occurredAt·expiresAt을 만들고 `/topic/islands/{islandId}/emotes`로 방송한다.
HTTP 응답이 아니므로 원본의 `{data:{eventId,...}}`200을 별도 REST 성공으로 구현하지 않는다.
아래 부록에 원본 JSON을 보존하고, 채택 wire는 §6의 7필드 focus.emote 봉투로 명시 변경한다.
STOMP RECEIPT는 프로토콜 수신 확인이며 모든 사용자에게 표시됐다는 보증이 아니다.
실패는 기존 발신 세션용 `/user/queue/errors` adapter로 보고한다. 잘못된 type422 의미·집중 아님409·
과다429를 구분하되 HTTP response가 아니라 typed 오류 의미다. 신규 타입 검증·오류 adapter는1765 구현 범위다.

emote는 영속 Idempotency-Key/receipt 대상이 아니고 DB/outbox에 저장하지 않는다. eventId는 내부 fanout 중복에
대해서만 dedup한다. 앱이 SEND를 두 번 보내면 별도 사건일 수 있으므로 자동 재전송하지 않는다.
**표시 TTL은 3초다(1765 확정).** 서버가 `expiresAt = occurredAt + 3s`를 만든다. 3초를 고른 근거는
그것이 존재하는 유일한 실측(앱 목업 `setTimeout(…, 3000)`)이고, 앱이 이미 그 길이로 사라지게 그리고
있어 서버가 다른 수를 주면 짧은 쪽이 이겨 서버 TTL이 무의미해지기 때문이다. FR-D05가 다른 값을 정하면
`realtime.focus.emote-ttl` 한 곳만 바꾼다.

**빈도 제한은 둘이고 축이 다르다.**

| 창 | 키 | 축 | 길이 | 언제 잡나 |
| --- | --- | --- | --- | --- |
| 시도 | `lock:chat:emote:try:{userId}` | **사용자** | 600ms | **STOMP 관문에서, 본문 변환보다 앞** — 거절될 요청도 소모한다 |
| 성공 | `lock:chat:emote:{islandId}:{userId}` | 사용자×섬 | 3초(TTL과 같음) | 인가를 통과한 뒤에만 |

검사 순서는 **시도 창 → 형식 → 인가 → 성공 창**이고, 시도 창은 **컨트롤러가 아니라 STOMP 관문**에서
잡는다. 컨트롤러 안에서 재면 `sessionId`가 빠지거나 UUID가 아닌 프레임은 `@Payload` 변환·`@Valid`가
메서드 진입 전에 실패시켜 **창을 아예 안 거치므로**, 가장 싼 거절만 공짜가 되어 그 프레임을 무제한
반복해 변환·오류 응답 경로를 고갈시킬 수 있다. 창을 관문으로 올린 대신 컨트롤러·서비스에서는 재지
않는다 — 한 프레임이 창을 두 번 먹으면 두 번째 정상 응원이 자기 자신 때문에 막힌다.

시도 창 초과의 응답은 **ERROR 프레임 + 연결 종료**다(다른 관문 위반과 같다). 정상 클라이언트는 자기
성공 창(3초) 때문에 이 속도를 만들 수 없기 때문이고, 사용자에게 보여 줄 「너무 자주 보냈어요」는
성공 창이 개인 큐로 따로 보낸다. 하나로 합치면 둘 중 하나가 깨진다. 성공 창 하나만
두고 인가를 먼저 하면 **임의의 다른 섬 UUID로 보내는 거절 요청이 제한 키를 만들지도 않은 채 매번 Data
정본 조회를 부른다** — 인증된 사용자 하나가 여러 연결에서 SEND를 반복하면 동기 HTTP로 STOMP 채널
스레드와 Data API를 고갈시킬 수 있다(섬이 키에 있으면 UUID만 바꿔 제한을 비켜 가므로 시도 창은 사용자
축이다). 반대로 시도 창 하나만 두고 성공까지 거기서 재면 잘못된 type 한 번이 정상 응원의 창을 먹는다.
그래서 **상류 호출의 상한을 정의하는 것은 시도 창**이다 — 사용자당 600ms에 인가 조회 1회. 600ms는
성공 창의 1/5이라 성공 1건당 최대 5회 시도할 수 있고, 거절당한 사용자가 3초를 기다리지 않아도 된다.

두 창 모두 세지 않고 `SET key value NX PX` **한 명령**으로 「있으면 거절」한다. INCR로 세면 수명을 거는
EXPIRE가 별도 명령이라 그 사이에 끊기면 수명 없는 카운터가 남아 그 사람이 영영 응원을 못 보낸다.

## 3. 저장·잠금·정산

| 논리 저장 | 데이터/제약 | 역할 |
| --- | --- | --- |
| 기존 focus_sessions | PK·user·startedAt·endedAt·COMPLETED·focus_seconds_by_date | legacy와 통계 식별자 공유. 상세가 있는 행은 v0.3 프로토콜 |
| 신규 focus_session_details | PK/FK session_id, user_id, island_id, membership_epoch_at_start, subject, target_minutes(**nullable — 목표는 선택, D5-적립**), lifecycle, version, last_transition_at, policy_revision, **rewarded_seconds(적립 워터마크)** | 소속 귀속 불변. user당 active/paused 부분 UNIQUE, 휴식 자리의 활성 범위 UNIQUE. 워터마크는 전이가 아니라 적립 틱이 민다 — version 을 올리지 않는다 |
| 신규 focus_session_intervals | session_id, ordinal, kind ACTIVE/REST, started_at, ended_at nullable | ordinal 유일, 열린 구간 최대1, 역전/겹침 금지. 명령 idempotency와 같은 TX |
| 신규 focus_settlements | session_id UNIQUE, contract_version, policy_revision, HTTP 결과·원 events·총시간, **auto_closed·acknowledged_at(V88)** | 다른 key의 완료 복구 방어. **D5-적립 이후 이 행은 «지급의 근거»가 아니라 «확정 기록»이다** — 지급은 적립 원장이 한다. `auto_closed`(서버가 끝냈다) + `acknowledged_at IS NULL`(아직 안 보여 줬다) 이 「다음 접속에 한 번 보여줄 결과」다(GROMO-1998). 개인정보 파기 정책 적용 |
| 신규 focus_reward_accruals | (session_id, accrued_on) UNIQUE, earned_fish | **적립의 정본**(D5-적립). 매분 틱이 (세션, UTC 날짜)로 누적한다. 하루 상한 합산과 회관 기록의 주민 누적 획득이 둘 다 여기를 읽는다 — 정산 행만 세면 진행 중·강퇴 세션의 적립분이 빠진다 |
| 신규 주민 projection | (projection,island_id,user_id) UNIQUE, version, 현재 session_id/상태 | 세션 교체·재가입에도 version 초기화 금지, focus/rest 별도 축 |
| 기존 command_idempotency | PublicCommandService의 사용자/operation/key scope, fingerprint, contractVersion 있는 결과 | TTL 자동 삭제 없음. 미지원 버전409 STATE_CONFLICT, 재실행 금지 |
| 기존 일별 net + 경제/시설/퀘스트 정본 | 세션별 반영 유일성, 지갑 owner/currency 잠금, 건설 cap 조건부 갱신 | 정산과 함께 커밋. 수동 구매 권한과 자동 집중 기여 정책 분리 |

물리 컬럼명·Flyway 번호·DBML은 구현 조정자가 최종 할당한다. 제약은 행이 없는 경합의 마지막 방어이며
그 제약 오류를 catch한 같은 JPA TX에서 재조회를 계속하지 않는다. 기존 V47은 부분 UNIQUE가 아니다.

잠금 순서는 참여 writer 전체에서 합의한 한 순서로 고정한다: 영향 사용자 UUID 정렬 배타 잠금 → 공통 receipt
선점 → 섬/현재 membership·context → focus 상세/구간 → 관련 회차·시설 정산 자원 → 지갑(owner/type/id/currency
정렬) → 일 집계 → projection/outbox 버전. 기존 내기 정산의 **회차→지갑** 순서를 뒤집지 않는다.
계정 탈퇴·가입/현재 섬 변경·host 강퇴가 여러 사용자를 다루면 처음부터 정렬한 사용자를 잠그고
group를 잡은 뒤 상대 user를 역순으로 잡지 않는다. 늦게 영향 사용자가 발견되면 TX를 다시 시작한다.

적립 틱(D5-적립)은 이 순서의 **꼬리 부분만** 잡는다 — 상세 배타 → 섬 건설 상태 → 섬 통장. 전이 순서의 접두사가 아니라 접미사라
교착 쌍이 생기지 않으므로 섬 행·멤버십을 따로 잡지 않는다. 전이·강퇴와는 상세 행에서 줄을 서고, 강퇴가 이기면 세션이
`MEMBERSHIP_LOST` 가 되어 그 뒤의 틱은 아무것도 하지 않는다.

이 순서는 새로운 외부 서비스 락이 아니다. 하나의 Data TX에서 유지하며 Business는 DB 락을 잡지 않는다.
강퇴의 승인 정책은 미결이어도 강퇴↔finish, start↔switch, pause↔finish가 같은 사용자·세션 경계에 참여해야 한다.
강퇴가 먼저 승리한 경우와 finish가 먼저 승리한 경우의 지급/기여는 FR-D03 결정표로 검증한다.
단순히 membership을 삭제한 뒤 진행 세션과 outbox를 따로 처리하지 않는다.

정산 정책은 시작 시 revision을 고정해 운영 설정 변경이 진행 세션의 지급률을 바꾸지 않게 하는 기술 선택이다.
~~시설 완료 instant/상태는 FR-D02 선택에 따라 해석하지만~~ FR-D02 는 **2026-09-18 재영님 결정 D6(「쌓이면 건설한다」)로 폐기**됐다 — 정산은 물고기를 지갑에 적립할 뿐이고 시설 완공 시점과 교차하지 않는다. 같은 TX에서 잠금·정책 revision을 확인하는 규율은 유지한다.
산식 결과 earnedFish=E, 개인 몫=P, 섬 통장 반영=C라면 **E=P+C**가 기본 보존식이고 **P≡0 · C=E** 다 — 2026-09-21 재화-단일로 개인 물고기 지갑이 없어 P 는 영구 0 이다(~~2026-09-18 D5-귀속의 50:50~~ · ~~D5-귀속-개정의 「비율은 운영값」~~ 대체 — `personal_share_percent` 를 올리는 경로를 두지 않는다, 결정 개인적립-차단). 보존식과 두 필드는 호환으로 남긴다. C 는 「초기 건설 기여」가 아니라 **섬 통장 몫**이다(D1: 섬 통장은 건설·공동 구매에 함께 쓰인다) — D6 가 폐기한 것은 «세션 도중 완공 시 시간 분할·초과 환류»이지 개인/섬 배분 축이 아니었다. 산식은 1830 확정값(60초당 1마리·휴식 제외·주민·섬별 하루 480 상한, [정책](policy.md) FR-D01)이며 아래 응답 예시의 `allocation{personalFishAdded,constructionFishAdded}` 가 그 배분을 싣는다.
**지급 시점은 2026-09-20 결정 D5-적립으로 종료가 아니라 «진행 중 매분»이다.** 매분 크론이 진행(ACTIVE) 세션마다 상세 행을 배타 잠그고 「지금까지의 순수 집중 초로 나올 수 있는 총 마리 수 − 이미 판정한 몫(`rewarded_seconds`)」만 새로 준다. 상한에 걸려 못 받은 몫도 **판정 완료로 워터마크를 민다** — 그러지 않으면 자정에 상한이 풀리는 순간 어제 깎인 몫이 한꺼번에 터진다(반려한 대안: 이월). **새로 주는 분은 한 건으로 접지 않고 하나씩 판정한다**: 분마다 「그 분이 찬 시각」(`FocusIntervalMath.instantAtActiveSeconds` — `activeSecondsAsOf` 의 역함수)을 구해 **그 시각의 UTC 날짜**로 상한을 보고, 섬 원장에도 **분마다 금액 1짜리 한 줄**을 남긴다. 접으면 둘이 깨진다 — ① 적립일이 「틱이 돈 날」이 되어 자정 직전에 찬 분이 다음 날 상한을 먹고, 밀린 분이 여러 날에 걸치면 전부 하루 상한 하나로 판정돼 나머지가 워터마크에 밀려 소실된다 ② 분 단위 감사 추적이 사라져 「원장은 건별, 접는 것은 가계부 조회뿐」(결정 가계부-묶음)이라는 전제가 무너진다. 하루 상한의 창은 **UTC 날짜**이고 일 집계(`daily_focus_stats`)의 KST 축과 일부러 다르다 — 그쪽은 1930 전환 대기 중인 레거시 축이고 이 축은 신규라 처음부터 UTC 다(Q-6·RC-축과 같다). 자정에 걸친 60초는 초 단위 워터마크라 끊기지 않으며, 그 분은 「찬 시각」의 날짜에 적립된다(반려한 대안: 날짜별 분할 배분 — 상한 두 개에 반 마리씩 걸린다). 섬 원장의 멱등 키는 `focus:<sessionId>:<누적 마리 수>` 라 같은 틱을 다시 돌려도 같은 키가 나온다. 휴식은 `activeSeconds` 에 없으므로 휴식 중에는 워터마크가 자연히 멈춘다 — 별도 분기를 두지 않는다.
**종료 직전에도 같은 적립을 한 번 돌린다**(구간을 닫은 뒤, 정산 행을 쓰기 전). 마지막 틱 이후에 «찬» 분이 그러지 않으면 영영 사라지기 때문이다 — 12:00:01 에 시작해 12:01:02 에 끝낸 세션은 12:01:00 틱에 59초뿐이라 못 받고, 그 뒤 ACTIVE 스캔에서도 빠진다. 「종료 시 추가 지급 없음」은 **1분이 안 찬 자투리**를 주지 않는다는 뜻이지 이미 찬 분을 버린다는 뜻이 아니다. 휴식 중 finish 도 같은 경로라 휴식 직전에 찬 분이 새지 않는다(크론은 PAUSED 를 훑지 않는다 — 휴식 중에는 새로 줄 것이 없다).
**혼합 버전 창의 구멍은 트리거가 막는다.** 크론 게이트는 «크론» 만 막고 옛 인스턴스의 `finish` 는 일부러 열어 두므로(막으면 그 창에서 끝낸 사용자가 한 마리도 못 받는다), V82 뒤에 옛 이미지가 쓴 정산은 적립 원장에 안 남아 상한·누적에서 사라진다. 그래서 `focus_settlements` 의 AFTER INSERT 트리거가 **「earned_fish > 0 이면서 그 세션의 적립 행이 하나도 없을 때만」** 완료 시각의 UTC 날짜로 한 행을 옮긴다 — 새 코드의 finish 는 정산 행을 쓰기 전에 이미 적립했으므로 트리거가 비켜난다. 앱 코드로는 «다른 버전의 앱» 을 잡을 수 없어 DB 가 유일한 자리다. 배포가 수렴하면 조건에 걸리는 행이 더는 생기지 않는다.
**V82 는 기존 정산분을 이 원장으로 이관한다** — 하루 상한과 주민 누적 획득이 이제 적립 원장만 읽으므로, 옮기지 않으면 과거 누적 획득이 0 으로 보이고 배포 당일의 기존 지급분이 상한에서 빠진다. 기준선은 **정산 행의 `completed_at` 의 UTC 날짜**다 — 종전 상한도 같은 축으로 합산했으므로 이관 전후로 판정이 같다.
숨어 있는 버림값을 두거나 `min(cap,E)` 뒤 초과분을 기록 없이 없애지 않는다(상한에 닿아도 집중 기록은 쌓인다 — 1830). 상한으로 깎인 몫은 **다음 날로 이월하지 않는다**(D5-적립).
~~초기 기여는 건설 진행량이며 `ownerType=island,currency=fish`라는 지갑을 만들지 않는다.~~ → D1: 섬 통장(섬 물고기)이 존재한다. 통화 식별자는 [상점 정책](../island-shop/policy.md)을 따른다.
동시 종료가 같은 마지막 건설량을 사용하면 cap과 완성 사건은 시설 행 잠금/유일성으로 한 번만 반영한다.

## 4. 서버 시간과 자정 계산

새 REST 입력에 startedAt/endedAt/activeSeconds/보상량을 받지 않는다. 상태 전이에 필요한 잠금을 잡은 뒤
서버 clock에서 한 번 읽은 t를 저장/응답/사건의 anchor로 사용한다. TX 시작 전에 읽은 시각으로 잠금 대기 시간을
잘라 버리지 않는다. 서버 시계 역행은 `max(now,lastTransitionAt)`로 역전 구간을 막고 별도 경고/계측한다.
지속 구간을 단말 시간이나 Redis 리스 시작 시각으로 정산하지 않는다.

구간은 `[start,end)`이며 paused는 REST 구간이다. 저장 정밀도에 맞춘 정수 마이크로초로 ACTIVE 길이를 합한 뒤
마지막에 초로 내린다. pause마다 초 단위로 잘라 반복 pause로 시간이 유실되지 않게 한다.
active 조회는 열린 ACTIVE의 end를 조회 anchor로 임시 닫아 계산하고 DB에 매초 UPDATE하지 않는다.

일별 분포는 ACTIVE 구간들을 KST 자정과 교차시킨 뒤 날짜 순서의 누적 순수 시간으로 분배한다.
기존 splitByLocalDay의 '경계 올림·전체 합 상한·마지막 잔여' 원칙을 따라, 총 초 T=floor(totalMicros/1e6),
날짜 d까지의 누적 micros C(d)에 대해 누적 배정 `min(ceil(C(d)/1e6),T)`의 전일 대비 차를 사용한다.
따라서 날짜 합은 항상 T이고 날짜별 휴식 시간을 다시 빼지 않는다. 소수초 경계는 최대1초의 결정적 배분이며
legacy의 날짜 배분 함수를 새 구간마다 따로 호출해 총합을 줄이지 않는다.

| KST 실제 구간 | 순수 집중 배분 |
| --- | --- |
| ACTIVE 09-11 23:50~23:55, REST 23:55~09-12 00:05, ACTIVE 00:05~00:10 | 09-11 300초, 09-12 300초, 총600초 |
| ACTIVE 09-11 23:59~09-12 00:00에 정확 종료 | 09-11 60초, 09-12 가산0 |
| 23:59:59.800~00:00:00.800 ACTIVE | 총1초를 경계 규약대로 전일1/당일0, 총합 보존 |
| ACTIVE 누적0.6초 → REST → ACTIVE0.6초 | 총1초. 각각0으로 버리지 않음 |

23:55 KST는 같은 날14:55Z, 다음날00:05 KST는 전날15:05Z다. UTC 날짜로 groupBy하면 첫 예시의 다음날
집중이 전날에 붙으므로 `ZonePolicy.KST`/[날짜 축 규약](../../../conventions/date-axis.md)을 사용한다.
`focus_seconds_by_date`에 net을 저장한 새 행은 읽을 때 totalDistractionSeconds로 다시 차감하지 않는다.
일반 시간창 퀘스트도 신규 interval을 정확히 자르는 조회 포트를 쓰며 legacy 구간 비율 근사와 구분한다.
기존 recordCompletion/creditSessionReward를 그대로 호출해 코인 보너스를 중복 지급하지 않도록 순수 집계와
보상 부수효과를 분리한 도메인 포트를 연결한다. 기존 일일 목표 코인·내기 연계의 새 세션 적용은 자산/정책 결정과
회귀 검증이 필요한 출시 의존이다.

## 5. legacy 공존과 전환 gate

새 상세 FK로 protocol을 판별한다. 기존 `/api/v1/focus-session` save/end/cancel, start의 마커 회전,
계정 파기, orphan 스윕, presence 복구 모두 상세 존재를 확인한다. 새 상세 행은 legacy 변경으로 마감하지 않는다.
legacy body.sessionId로 새 세션 PK를 제출한 경우409로 거절하고 POST fallback이 우회하지 못하게 한다.

신규 start가 기존 열린 마커를 발견하면409로 종료/동기화를 안내한다. 구 start가 새 진행 세션을 발견해도409다.
새 사용자 잠금과 부분 UNIQUE는 서로 다른 프로토콜의 진행 충돌도 보호해야 한다.
legacy 완료 업로드가 새 서버 구간과 중복되는지 user 잠금 아래 검사하고 겹침이 있으면 새 도메인 시간으로
덮어쓰기/재지급하지 않는다. 기존 비중복 오프라인 업로드는 유지한다. 겹침 거절의 legacy 오류/클라이언트
fallback 처리를 구현하고 다기기 혼용 회귀 검증을 통과하기 전 새 경로를 활성화하지 않는다.

v0.3 상세는 기존 orphan 스윕의12h AUTO_CLOSED 대상에서 제외한다. FR-D06의 새 종료/복구 정책과 동작하는
정리 주체가 준비되지 않으면 새 세션을 운영에서 시작시키지 않는다. 새 정책 없이 미종료가 영구 남는 것도
출시 성공이 아니다. 계정 탈퇴는 상세 subject·구간·정산 개인정보 파기를 기존 세션 익명화와 같은 TX에 포함하고
receipt 재생으로 제거한 개인정보를 되살리지 않는다.

### 5.1 기존 live reader도 출시 전환 대상이다

main의 `LeagueRankingQueryRepository.LIVE_SESSIONS`(`:91~99`)는 상세 lifecycle을 읽지 않고
`ended_at IS NULL`인 마커를 고른다. `LIVE_SECONDS`(`:124~128`)는 세션 최초 시작부터 현재까지를 더한다.
v0.3 paused 상세도 기본 마커는 ACTIVE/endedAt=null이므로, 현재 쿼리를 유지하면 휴식 시간이 랭킹에
포함된다. `FocusLiveInfoLookup`과 이를 사용하는 legacy live DTO/화면 표시도 같은 전환 조사 대상이다.

신규 상세가 **없는** legacy 세션은 기존 읽기 계약을 유지한다. 상세가 **있는** 세션은 요청의 같은 `now`와
KST 주간 범위에 걸친 ACTIVE interval의 합을 읽는다. 이미 닫힌 ACTIVE 구간의 합에, lifecycle이 active인
경우에만 현재 열린 ACTIVE 구간의 현재까지 몫을 더한다. paused에서는 값이 고정되고 REST 구간은 항상 0이다.
paused 행을 통째로 빼서 이전 집중분을 0으로 만들거나, resume 시 최초 startedAt부터 다시 세지 않는다.
완료된 상세는 같은 snapshot에서 진행분 대상에서 빠지고 확정 일 집계에 한 번만 들어간다.

랭킹 정렬과 응답/앱의 live 표시도 함께 맞춘다. 기존 응답의 `totalFocusSeconds`는 확정값이고 앱은
`focusStartedAt` 이후 경과를 더한다는 전제(`LeagueRankingQueryRepository.java:67~79`)가 있으므로,
서버 정렬만 고치거나 최초 시작 앵커를 그대로 반환하면 화면은 여전히 휴식을 더한다. 상세 lifecycle·
누적 ACTIVE 초·현재 ACTIVE 앵커를 이해하는 reader/응답 어댑터와 배포된 클라이언트의 호환 동작을
확정·검증하기 전 신규 세션을 열지 않는다. 기존 필드의 의미를 설명 없이 바꾸거나 진행분을 양쪽에 더하지 않는다.
주간 정산과 알림용 keyset 페이지는 기존 확정값 정렬 계약을 유지하며 live 보정을 무조건 확대하지 않는다.

출시 회귀는 `start → ACTIVE 누적 → pause → 시간 경과 → resume → finish` 전체에서 순위 비교와 화면
표시를 같은 관측 시각으로 대조한다. pause 동안 불변, resume 뒤 추가 ACTIVE만 증가, finish 전후 동일한
순수 누적량, 자정/주 경계 clipping, legacy 혼합 사용자, 전이 동시 조회의 완료+진행 이중 계상 0을 단정한다.
이 검증은 finish 정산 테스트만으로 대신할 수 없다.

### 5.1.1 완료 목록과 앱의 재계산도 같은 gate에 포함한다

완료 후에는 문제가 사라진다고 가정하지 않는다. 기존 `FocusService.getFocusSessions`
(`server/data-api/src/main/java/com/oneorthree/phone/focus/service/FocusService.java:330~351`)는
GET `/api/v1/focus-session`에 기본 행의 `startedAt`, `endedAt`, `totalDistractionSeconds`,
`focusSecondsByDate`를 그대로 내려준다. 신규 상세의 시작부터 종료까지에는 REST가 들어 있으므로,
날짜별 net만 정확히 저장해도 다음 기존 소비자는 여전히 다른 값을 계산한다.

| 실제 앱 소비처 (`app/legacy/app-dev/src/` 기준) | 현재 계산 | 신규 상세에 필요한 완료 reader |
| --- | --- | --- |
| `screens/focus/focusRestore.ts:29~43`, `screens/stats/LongestSessionStat.tsx:54` | `sessionFocusSeconds`가 전체 벽시계 구간에서 방해 초를 차감, 최장 세션에도 사용 | 논리 세션 하나의 확정 ACTIVE 합. REST를 방해 초로 위장하지 않음 |
| `screens/league/useLeagueRanking.ts:75~85` | 완료 목록을 받아 `sessionFocusSeconds`로 내 주간 시간을 재합산 | 상세의 정확한 ACTIVE 구간/확정 날짜 기여를 해당 주에 합산. 서버 랭킹과 일치 |
| `screens/stats/format.ts:70~102`, `screens/stats/WeeklyTimetableCard.tsx:140` | `weekdayFocusBlocks`가 startedAt부터 endedAt까지 연속 칠함 | ACTIVE interval만 실제 시각에 표시하고 REST 구간은 비움 |
| `screens/focus/focusRestore.ts:63~67` | 서버 날짜 분포를 쓰는 조건이 아니면 전체 구간 겹침 추정으로 fallback | 신규 상세는 정확한 구간으로 날짜를 자름. 비KST 기기에서도 REST를 포함한 gross fallback 금지 |

**기본 출시 경로는 완료 조회 계약과 호환 앱을 함께 전환하는 것이다.** 상세가 있는 완료 세션은
논리 sessionId, 확정 ACTIVE 합, 실제 ACTIVE 구간과 날짜 기여를 구분해 읽을 수 있는 조회 계약을
준비하고, 위 소비처가 그 계약을 사용하도록 한다. 구체 DTO 확장은 후속 구현에서 버전/협상 계약으로
고정한다. 기존 DTO에 필드만 추가하고 구 앱도 자동으로 사용한다고 간주하지 않는다. 상세 없는 legacy
기록의 방해 초·목록·업로드 의미는 그대로 유지한다.

신규 세션 생성 gate는 **서버 완료 reader 준비 + 검증된 앱 최소 호환 버전/기능 지원 + 그 버전이 실제로
적용되는 접근 경계**를 모두 확인해야 열린다. 같은 계정의 다른 기기나 다운그레이드한 구 앱도 신규 완료
기록을 읽을 수 있으므로, 신규 시작 요청의 앱 버전만 확인하는 것으로 충분하지 않다. 호환되지 않는
완료 reader가 그 기록을 소비하지 못하도록 하는 실제 버전 제한/업데이트 경계와 앱 배포·복구 증거를
릴리스에 남긴다. 제한 방식이 구현·검증되지 않았으면 신규 생성을 계속 닫는다. 구 앱에 오류를 숨기고
빈 목록을 내려 기록이 사라진 것처럼 만드는 방식은 호환이 아니다.

서버의 **읽기 전용 호환 projection**을 선택하는 대안도 가능하지만, 원 기본 행의 전체 벽시계 구간을
그대로 반환하거나 총 net만 추가하는 것으로 끝낼 수 없다. 시간표용으로 ACTIVE 구간을 투영하되,
논리 세션의 식별·최장 세션 합·주간/날짜 기여·기간 필터·cursor 페이지 경계를 함께 정의해야 한다.
예를 들어 ACTIVE 조각 두 개를 별개 완료 세션으로만 반환하면 시간표는 맞아도 최장 세션이 반으로
줄어든다. 따라서 구 앱의 모든 위 소비처에 같은 의미를 제공할 수 있다는 계약/회귀 증거가 없는
projection은 최소 호환 앱 요구를 대체하지 못한다. 이 문서는 어떤 미구현 projection도 이미 안전한
대안으로 승인하지 않는다. 조회 projection은 추가 완료 행/정산/보상 이벤트를 생성하지 않는다.

회귀 예시는 `10:00~10:10 ACTIVE → 10:10~10:20 REST → 10:20~10:30 ACTIVE → finish`다.
완료 순수 시간과 논리 최장 세션은 1,200초이고 시간표는 10분 ACTIVE 두 칸 사이의 10분을 비워야 한다.
완료 목록의 페이지 크기를 작게 해도 중복/누락이 없어야 하며, 휴식이 KST 자정·주 경계를 넘는 경우와
비KST 기기의 복원, 구/신 기록 혼합, 같은 계정의 구/신 앱·다운그레이드 접근도 검증한다. 기존
`totalDistractionSeconds`에 REST를 넣거나 net 분포에서 REST를 다시 빼는 보정은 금지한다. 보상 산식이나
새 최장 세션 제품 규칙을 정하는 것이 아니라, 같은 논리 세션의 순수 ACTIVE 시간과 실제 구간을
소비처마다 다르게 해석하지 않도록 하는 기술적 활성화 조건이다.

### 5.2 호환 baseline을 먼저 배포하고 신규 API를 나중에 연다

현재 `.github/workflows/prod-rollback.yml`의 `image_sha` 입력은 commit/tag를 받고, `:50~60`의 검사는
ECR 이미지 존재 여부뿐이다. `:62~69`는 해당 이미지를 SSM 배포에 넘긴다. focus 상세 호환 여부를 검사하는
현재 guard는 없다. DB를 되돌리지 않아도 옛 `FocusService.startFocusSession`의
`autoCloseOpenMarkersOf` 호출(`:918`)과 `FocusSessionRepository.java:387~394`의 bulk update,
`FocusService.sweepOrphanSessions`(`:1105~1113`)가 새 상세를 모른 채 기본 마커를 마감할 수 있다.
따라서 “스키마 expand라 구 이미지로 언제든 롤백 가능”은 이 설계에서 성립하지 않는다.

| 단계 | 반드시 완료할 작업 | 활성화/롤백 조건 |
| --- | --- | --- |
| 1. 호환본 선행 배포 | 새 API·새 상세 생성은 비활성. 스키마 expand 후 모든 legacy start/save/end/cancel·orphan·presence writer와 §5.1의 live·완료 reader가 상세를 인식하는 호환 이미지를 전량 배포. §5.1.1의 호환 앱 배포/접근 경계 또는 검증된 조회 projection을 준비 | 구/신 인스턴스 혼재가 끝날 때까지 새 세션 생성 금지. 기존 legacy 요청 회귀 유지 |
| 1. 롤백 baseline 이동 | 호환 이미지의 정확한 digest/프로토콜 지원을 릴리스 증거에 기록하고 rollback workflow·실제 SSM 배포 등 이미지 교체 진입점에서 그보다 비호환인 이미지의 실행을 거절하도록 구현 | 이미지 존재 확인만으로 통과 금지. 임의 구 SHA/tag를 지정해도 배포 호출 전에 거절되는 실제 검증 필요 |
| 2. 새 API 활성화 | live·완료 reader/writer 및 앱 회귀, §5.1.1의 최소 호환 앱/조회 projection 접근 증거, 정책 FR-D01~06의 해당 결정, 최소 호환 baseline의 전량 적용 및 구 이미지 차단 검증을 모두 확인 | 그 다음에만 신규 start/pause/resume/finish와 해당 구독 기능을 단계적으로 개방 |
| 2.5 목표 없는 세션 (GROMO-1990) | `target_minutes` 가 nullable 이 된다 — **null 을 못 읽는 옛 독자가 둘**(옛 data-api 엔티티의 primitive `int`, 옛 business DTO 의 필수 `int`). **data-api·business-api 양쪽에 새 버전을 전량 배포한 뒤** `focus.session.start-enabled` 를 켠다 | 이미 켜져 있다면 롤링 배포 동안 **먼저 끈다** — 꺼져 있으면 v0.3 세션 행 자체가 안 생겨 null 을 쓸 경로가 없다. 레포가 정하는 기본값은 네 곳 모두 `false` 이고(dev·prod yml · `docker-compose.dev.yml` · `server/scripts/README.md`), 실제 값은 배포 시크릿에 있다 |
| 3. 분당 적립 크론 활성화 (GROMO-1990) | 위 2단계가 끝나고 **배포가 한 버전으로 수렴한 뒤** `focus.reward.accrual-enabled`(기본 **false**, `FocusRewardAccrualGate`)를 켠다. 혼합 버전 창에서는 새 이미지의 크론이 `focus:<세션>:<분>` 으로, **옛 이미지의 finish 가 세션 전체를 `focus:<세션>` 으로** 지급해 같은 시간이 두 번 나간다 — 두 키는 접두사가 달라 `uq_island_wallet_tx_idem` 에도 안 걸린다 | 끄고 있는 동안에도 사용자는 손해 보지 않는다(finish 가 그 자리에서 적립을 확정한다). **켠 뒤 롤백하려면 flag 를 «먼저» 끄고 그때 진행 중이던 세션이 전부 끝난 뒤에 이미지를 내린다** — 켜진 채로 옛 이미지로 되돌리면 이미 분 단위로 지급된 세션을 옛 finish 가 통째로 재지급한다 |
| 활성화 후 장애 | 새 세션 생성의 활성화 flag를 닫고 상세를 이해하는 호환 이미지로만 rollback/roll-forward | 이미 존재하는 active/paused 상세·구간·정산을 보존하고 승인된 재개/종료 경로 유지. 비호환 구 이미지로 복귀 금지 |

최소 호환 baseline은 단순 tag 문자열의 사전순 비교가 아니라 검증된 이미지/프로토콜 호환 증거로 판단한다.
DB에 신규 상세 행이 남아 있는 동안 flag를 껐다는 이유로 baseline 제한을 해제하지 않는다. 배포·롤백
guard 구현과 실제 거절/복구 검증은 후속 구현의 release gate이며, 이 문서 PR이 workflow를 수정하거나
운영 배포를 실행한 것은 아니다. 안전한 baseline이 없으면 신규 API를 계속 비활성으로 둔다.

검증 환경에서 active와 paused 상세를 각각 만든 뒤 비호환 구 이미지 롤백을 요청해 **실행 전에 차단**되는지,
호환 baseline으로 롤백한 뒤 legacy start/orphan/presence 작업이 해당 기본 마커·상세·구간을 훼손하지 않는지
확인한다. 신규 생성 gate와 기존 상세 복구 경로를 구분해, 생성을 닫아도 기존 상세의 재개/종료·완료 receipt 재생이
보존되는지 함께 확인한다.

## 6. 이벤트·스냅샷·presence

공통 봉투는 `{schemaVersion,eventId,type,islandId,aggregateVersion,occurredAt,payload}` **7필드**,
schemaVersion=1이다. 버전 없는 emote만 aggregateVersion=null. 나머지는 양의 안전 정수다.

| 사건 | payload 필수 필드 | 비교 축 / 수신 |
| --- | --- | --- |
| focus.member.updated | userId,sessionId,status(active/paused/completed),subject,activeSeconds,serverNow,sessionVersion | (focus.member,islandId,userId) / 해당 섬 주민 focus 토픽 |
| rest.member.updated | userId,sessionId,status,restStartedAt,restSeat,serverNow,sessionVersion | (rest.member,islandId,userId) / 해당 섬 주민 rest 토픽 |
| focus.emote | userId,sessionId,type,expiresAt | version 없음, eventId+만료 / 같은 섬 진행 세션(active·paused) 주민 emotes 토픽 |
| wallet.updated | ownerType,ownerId,currency,version | **(island,islandId,village_points) 만** / 해당 섬 events 토픽, 섬 통장이 실제 바뀐 경우만. ~~개인(user,id,fish)은 islandId=null · 본인 user queue~~ 는 재화-단일로 폐기 — 개인 지갑이 없어 발행자가 없다 |
| quest.progress.updated | questId,occurrenceId,version | (quest.progress,islandId,questId,occurrenceId) / 섬 events 토픽, 관련 진행이 실제 바뀔 때 |
| island.updated | islandId,version | (island,islandId) / 초기 건설 진행·완성이 실제 바뀔 때 |

새14종에 위 사건을 추가로 세지 않는다. 나머지8종은1754의 다른 producer 소유다.
wallet/quest/island의 payload.version은 aggregateVersion과 같고, focus/rest의 sessionVersion은 별개다.
start는 focus 사건과 현재 active를 나타내는 rest 투영을, pause/resume/finish는 focus/rest 각각을 내구화한다.
rest가 paused일 때 restSeat/restStartedAt 필수, active/completed는 null로 행 제거를 나타낸다.
focus 완료는 목록에서 제거하고 watermark를 유지한다. 여러 세션을 거쳐도 주민 투영 버전은 초기화하지 않는다.
신규 wallet 사건에 잔액이나 개인 보상량을 섬으로 방송하지 않는다.

스냅샷 확장 예시는 아래와 같다. 원본 응답 예시와 구분한다.

```json
{"data":{"items":[],"serverNow":"2026-09-12T00:00:00Z","watermarks":[{"projection":"focus.member","islandId":"019f16a0-0000-7000-8000-000000000002","aggregateId":"019f16a0-0000-7000-8000-000000000003","version":5}]}}
```

```mermaid
sequenceDiagram
  participant A as 앱 새 연결 generation
  participant R as Realtime
  participant D as REST snapshot
  A->>R: SUBSCRIBE focus/rest (receipt 요청)
  R-->>A: 실제 등록 RECEIPT
  Note over A: 이후 사건을 유한 버퍼에 보관
  A->>D: focus/rest snapshot
  D-->>A: items + serverNow + 같은 snapshot의 watermarks
  A->>A: snapshot 설치·같은 key의 더 높은 version만 병합
  R-->>A: 상태 사건
  alt unknown key 또는 버퍼 초과/프로토콜 불일치
    A->>D: 정본 재조회
  else 이미 아는 key
    A->>A: eventId 중복 제거·version 비교
  end
```

새 generation 이전 응답/이벤트는 버린다. unknown key는 오래된 완료자일 수 있어 바로 행을 만들지 않는다.
프로필/외양이 부족한 focus 입장 사건도 스냅샷을 다시 읽는다. schemaVersion 누락/미지원은 payload 적용과
watermark 갱신을 모두 중지하고 지원하는 정본을 조회한다. emote는 초기화 버퍼/재접속에서 재생하지 않고
초기화 완료 후 받은 expiresAt 미래 사건만 표시한다.

Redis Pub/Sub 단일 유실은 지속 version 숫자 차이만으로 모두 알 수 없다. foreground·화면 재진입·재연결에
스냅샷을 갱신하고 활성 화면에 유한 주기 정합성 조회 또는 서버 gap 제어를 구현한다. 이 간격/버퍼 상한은
1765의 설정/부하 검증 항목이며 주민별 고빈도 폴링을 다시 만드는 방식은 피한다.

membership 상실 시 구독을 실제 해지하며 broker 해지가 검증되지 않으면 해당 소켓을 닫는다.
SUBSCRIBE와 최종 outbound에서 현재 계정/소속을 재검사하고 emote는 수신자가 **아직 진행 중인지**까지
검사한다. **최종 outbound의 판정 근거는 `presence:focus:{userId}`가 아니다** — 그 사본은 Data의
best-effort 쓰기라 양쪽으로 어긋난다(쓰기 실패 → 정상 참가자의 응원이 전부 버려짐, 삭제 유실 → 종료한
사용자가 TTL 내내 수신). §6이 「이 사본을 신규 emote의 최종 인가 증거로 단독 사용하지 않는다」고 정한
그대로다. 대신 **사건마다 정본에서 나온 수신 집합**을 봉투에 동반해 대조한다: 발신이 이미 치른
`GET /internal/islands/{id}/focus-members` 한 번이 「그 섬에서 지금 진행 중인 주민 전원」을 주므로
**추가 조회 없이** 판정이 정본에 붙는다(realtime-events LLD §4.2의 「배치 권한조회」). 그 집합은 서버
프로세스 안에 `eventId`로 보관하고 다른 인스턴스에는 내부 팬아웃 봉투로 넘긴다 — 클라이언트에는 가지
않는다. 기록이 없거나 만료됐으면 fail-closed다.
남는 창은 발신과 전달 사이(밀리초)에 종료한 사람이 그 한 건을 받는 것뿐이며, 이미 브로커로 넘어간
프레임을 회수하지 않는다는 §4.2의 경계와 같은 자리다.
권한 원천 장애는 fail-closed다. paused 채팅 정책은 FR-D04 미결이며(응원과 별개 축이다 — 응원은
2026-09-20에 paused 허용으로 확정됐다), active 채팅 차단을 focus/rest/emote의
CONNECT 자체에 적용하지 않는다. JWT 만료는 기존 PR739의 명시 세션 종료/재인증 흐름을 따른다.

`presence:focus:*`는 A19대로 **Data만 쓴다**. Realtime/Business에 별도 writer나 쓰기 ACL을 추가하지 않는다.
기존 RedisFocusPresence와 새 도메인 producer가 각각 직접 쓰는 이중 배선을 두지 않고 하나의 Data projection
포트로 통합한다. 상태 TX의 내구 제어자료를 소비해 commit 뒤 갱신하고 실패는 리컨실한다.
기존 세션 토큰 기반 삭제만으로 같은 세션 active→paused→active의 역순을 구분할 수 없으므로,
새 v0.3 투영은 사용자별 지속 controlVersion과 절대 상태를 CAS하는 설계를 필수로 한다.
기존 Redis 값/키를 무단 변경하지 않고, reader 호환·tombstone/TTL·허용 namespace/ACL 개정과 전환 검증을
공통 기반 담당과 합류한다. FR-D04 결정에 따라 active/paused를 채팅 차단 투영으로 매핑한다.
이 사본을 신규 emote의 최종 인가 증거로 단독 사용하지 않는다. 현재 Data 상태/인가 revision을 확인한다.

## 7. 검증과 관측

| 검증 | 실패 시 막는 문제 |
| --- | --- |
| 새/구 혼합2기기 동시 start·switch·join의 사용자 락 | 진행세션2개·집중 중 섬 이동 |
| pause/resume/finish 두 요청의 같은/다른 version·키 | 시간 구간 중복/역전·이중 정산 |
| finish 성공 응답 유실·동일키·다른키 복구·receipt 미래 버전 | 중복 보상·원 결과 변경·미지원 결과 재실행 |
| 정산·원장·일 집계·receipt/outbox 각 단계 장애 후 rollback | 부분 지급·기록만 완료·나중 재시도 이중 지급 |
| KST 자정 정확 종료·휴식 자정·소수초 반복 pause·비KST 기기 | 날짜/초 총합 불일치·휴식 이중 차감 |
| finish와 focus-summary의 동시 읽기 | completed+current 이중 합산 |
| 초기 건설 마지막 잔량에 동시 finish2개 | cap 초과·완성2회·초과 물고기 유실 |
| 계정 탈퇴·강퇴·재가입과 finish/outbox/재생 | 제거된 권한/개인정보 재노출·귀속 변경 |
| 등록 RECEIPT 전후 snapshot race·역순·unknown key·재연결 | 종료자 부활·최신 상태 덮어쓰기 |
| active→pause→active의 지연 presence 갱신·Redis 재시작 | 같은 sessionId의 오래된 상태가 채팅 가드 덮음 |
| emote paused/타인session/다른섬/만료/속도제한·소속철회 | 부적격 송수신·무한 재생 |
| 기존 오프라인 업로드·orphan·일 목표/내기/코인 회귀 | 기존 계약 파손·신규 fish와 이중 지급 |
| pause/resume/finish 전후 legacy live 랭킹 정렬·앱 표시·KST 주 경계·동시 조회 | 휴식 시간 가산·pause 시 누적 소실·완료와 진행분 이중 계상 |
| 완료 목록의 합계·논리 최장 세션·시간표/복원, REST 포함 finish·자정/주 경계·페이지 경계 | 휴식 가산·REST 구간 색칠·ACTIVE 조각 분할에 따른 최장값 손실·목록 중복/누락 |
| 구/신 앱 혼용·다운그레이드와 신규 완료 기록 접근 | 시작 기기의 버전만 확인해 다른 구 앱의 잘못된 계산 허용 |
| 신규 비활성 호환본 전량 배포 → rollback baseline 제한 → 신규 활성화 | 혼재/구 이미지의 마커 자동 종료·orphan 처리로 신규 상세 파손 |
| active/paused 상세를 가진 상태의 구 이미지 롤백 거절·호환 이미지 롤백 | flag 해제로 호환 제한 우회·재개/종료 및 receipt 복구 불가 |

운영 로그는 서버 requestId, commandId, sessionId, eventId, policyRevision, 이전/다음 상태·version,
active 구간 수, 계산 초, 충돌/재생/정산 결과 코드, TX 시간·lock 대기·outbox 지연을 기록한다.
subject·이름·JWT·멱등키 원문·원장 개인 응답 전체는 남기지 않는다. 세션 ID는 로그 상관키로만 쓰고
고카디널리티 메트릭 label로 만들지 않는다. emote 로그는 허용/거절 이유와 집계량 중심이며 히스토리가 아니다.

## 8. 원본 요청·응답 예시 보존

아래9개 예시는 GROMO-1739 HTML의 api-{id}에서 추출한 JSON과 동일하다. 설명용 숫자/ID/시각의
일관성을 고쳐 운영값처럼 만들지 않았다. 경로 접두어·emote 전송 변경, watermarks 추가, timezone 오류 개정은
위 채택 계약을 따른다. emote 원본200 응답은 STOMP HTTP응답 계약으로 사용하지 않는다.

### 원본 start

원본 `POST /v1/focus-sessions`, 채택 `POST /focus-sessions`.

요청 예시

```json
{
  "islandId": "soda",
  "subject": "수학 문제 풀기",
  "targetMinutes": 25
}
```

응답 예시

```json
{
  "data": {
    "id": "focus-1",
    "islandId": "soda",
    "subject": "수학 문제 풀기",
    "targetMinutes": 25,
    "status": "active",
    "activeSeconds": 0,
    "serverNow": "2026-09-11T09:10:00Z",
    "startedAt": "2026-09-11T09:10:00Z",
    "restStartedAt": null,
    "version": 1
  }
}
```


### 원본 session

원본 `GET /v1/focus-sessions/current`, 채택 `GET /focus-sessions/current`.

요청 예시

```json
{}
```

응답 예시

```json
{
  "data": {
    "id": "focus-1",
    "islandId": "soda",
    "subject": "수학 문제 풀기",
    "targetMinutes": 25,
    "status": "active",
    "activeSeconds": 600,
    "serverNow": "2026-09-11T09:10:00Z",
    "startedAt": "2026-09-11T09:00:00Z",
    "restStartedAt": null,
    "version": 1
  }
}
```


### 원본 pause

원본 `POST /v1/focus-sessions/{sessionId}/pause`, 채택 `POST /focus-sessions/{sessionId}/pause`.

요청 예시

```json
{
  "expectedVersion": 1
}
```

응답 예시

```json
{
  "data": {
    "id": "focus-1",
    "islandId": "soda",
    "subject": "수학 문제 풀기",
    "targetMinutes": 25,
    "status": "paused",
    "activeSeconds": 600,
    "serverNow": "2026-09-11T09:10:00Z",
    "startedAt": "2026-09-11T09:00:00Z",
    "restStartedAt": "2026-09-11T09:10:00Z",
    "version": 2
  }
}
```


### 원본 resume

원본 `POST /v1/focus-sessions/{sessionId}/resume`, 채택 `POST /focus-sessions/{sessionId}/resume`.

요청 예시

```json
{
  "expectedVersion": 2
}
```

응답 예시

```json
{
  "data": {
    "id": "focus-1",
    "islandId": "soda",
    "subject": "수학 문제 풀기",
    "targetMinutes": 25,
    "status": "active",
    "activeSeconds": 600,
    "serverNow": "2026-09-11T09:10:00Z",
    "startedAt": "2026-09-11T09:00:00Z",
    "restStartedAt": null,
    "version": 3
  }
}
```


### 원본 finish

원본 `POST /v1/focus-sessions/{sessionId}/finish`, 채택 `POST /focus-sessions/{sessionId}/finish`.

요청 예시

```json
{
  "expectedVersion": 3
}
```

응답 예시

```json
{
  "data": {
    "recordId": "focus-1",
    "islandId": "soda",
    "subject": "수학 문제 풀기",
    "targetMinutes": 25,
    "activeSeconds": 1500,
    "goalAchieved": true,
    "earnedFish": 25,
    "allocation": {
      "personalFishAdded": 0,
      "constructionFishAdded": 25
    },
    "completedAt": "2026-09-11T09:10:00Z",
    "questProgress": [
      {
        "id": "q-focus",
        "myRate": 83
      }
    ]
  }
}
```


### 원본 focus-group

원본 `GET /v1/islands/{islandId}/focus-members`, 채택 `GET /islands/{islandId}/focus-members`.

요청 예시

```json
{}
```

응답 예시

```json
{
  "data": {
    "items": [
      {
        "userId": "minji",
        "name": "민지",
        "catColor": "ginger",
        "appearance": {
          "clothes": "scarf",
          "decor": "flag",
          "hull": "sailboat",
          "position": "front"
        },
        "sessionId": "focus-minji",
        "subject": "영어 단어",
        "activeSeconds": 1320,
        "status": "active"
      }
    ],
    "serverNow": "2026-09-11T09:10:00Z"
  }
}
```


### 원본 emote

원본 `POST /v1/islands/{islandId}/emotes`, 채택 `STOMP SEND /app/islands/{islandId}/focus/emotes`.

요청 예시

```json
{
  "sessionId": "focus-1",
  "type": "hello"
}
```

응답 예시

```json
{
  "data": {
    "eventId": "emote-1",
    "userId": "me",
    "type": "hello",
    "expiresAt": "2026-09-11T09:10:03Z"
  }
}
```


### 원본 rest-members

원본 `GET /v1/islands/{islandId}/rest-members`, 채택 `GET /islands/{islandId}/rest-members`.

요청 예시

```json
{}
```

응답 예시

```json
{
  "data": {
    "items": [
      {
        "userId": "sua",
        "name": "수아",
        "catColor": "gray",
        "restSeat": 1,
        "restStartedAt": "2026-09-11T09:07:00Z"
      }
    ],
    "serverNow": "2026-09-11T09:10:00Z"
  }
}
```


### 원본 home-summary

원본 `GET /v1/me/focus-summary`, 채택 `GET /me/focus-summary`.

요청 예시

```json
{
  "date": "2026-09-11",
  "timezone": "Asia/Seoul"
}
```

응답 예시

```json
{
  "data": {
    "date": "2026-09-11",
    "completedSeconds": 3600,
    "currentSessionSecondsToday": 600,
    "totalSeconds": 4200,
    "serverNow": "2026-09-11T09:10:00Z"
  }
}
```

