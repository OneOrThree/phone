# 우체통 — LLD

[정책](policy.md) · [HLD](high-level-design.md)

## 1. 공통 입력·인가·응답

신규 공개 ingress는 Business의 아래 exact method/path다. Bearer AT의 서명·access 타입·만료·주체를 검증하고 외부 X-User-Id를 모든 accessor에서 제거한다. Data/Realtime 내부 호출에는 해당 서비스 audience의 서비스 토큰, 검증한 주체, 현재 요청 ID·deadline만 새로 전달한다. 외부 헤더 전체 복사와 임의 내부 URL 입력은 금지한다. 실제 활성 사용자/세션 검증은 선행 인증 계약으로 수행하며 없는 sid/gen을 현재 DB 값으로 합성하지 않는다. 필요한 인증 기반 미통합이면 새 route 활성화가 선행 구현에 의존한다.

Data는 path islandId가 실제 groupId임을 해석하고 현재 사용자 활성·해당 소속·시설 해금·작업별 역할을 확인한다. 다른 섬의 자원 ID는 path로 다시 좁혀 찾는다. 요청 시작 때 확정한 path/context를 사용하며 도중에 current-island가 바뀌어도 다른 섬으로 재해석하지 않는다. 같은 사용자의 다른 섬 자원/방문자 projection을 주민 전용 응답에 섞지 않는다. 원 결과 재생도 현재 인가가 필요하며 이 문서에는 leave/host-transfer 같은 권한 상실 후 최소 성공 증거 예외가 없다.

- UUID는 하이픈 포함36자, v4/v7 생성 권고이며 다른 version 비트를 이유로 거절하지 않는다. 메시지 키 포함 공통 UUID 정규화가 정본이다. 날짜는 YYYY-MM-DD KST, 시각은 서버 UTC ISO-8601 instant. 샘플 문자열 ID는 실제 ID 검증을 대체하지 않는다.
- JSON object만 수락하고 unknown/duplicate field, 잘못된 타입·명시 null을 거절한다(아래 nullable 출력과 별개). 정수는 JsonNode 정수 토큰으로 검사하여 1.5·문자열을 Long으로 절삭/강제 변환하지 않는다. version은1~9007199254740991이다. legacy ObjectMapper를 전역 변경하지 않는다.
- 성공은 한 번만 `{data}`로 감싸며 새 작성201, 나머지200이다. 오류는 `{error:{code,message,field,retryable},requestId}`이고 X-Request-Id가 동일하다. 저장 원 결과를 재생해도 현재 requestId를 사용한다. 409의 current는 `{version,resource}`이고 현재 인가된 공개 DTO와 해당 version을 같은 snapshot으로 읽는다. 안전한 공개 상태가 없으면 current를 생략한다.
- 입력400 INVALID_REQUEST/INVALID_PARAMETER, 키400 INVALID_IDEMPOTENCY_KEY, AT401 UNAUTHORIZED, 비활성 본인404 USER_NOT_FOUND, 비주민/시설/역할403 FORBIDDEN, 해당 경로에 없는 자원404 NOT_FOUND, 승인 범위 위반422 OUT_OF_RANGE가 기본이다. 기존 legacy 상태/코드는 보존하며 신규 어댑터에서 실제 등록한 조합만 변환한다.
- 같은 키 다른의미409 IDEMPOTENCY_KEY_REUSED, 명시 version충돌409 VERSION_CONFLICT, 판정상충409 STATE_CONFLICT는 retryable=false다. 진행중409 REQUEST_IN_PROGRESS는 retryable=true/Retry-After:1. 불명확 상류계약502 UPSTREAM_CONTRACT_ERROR, 일시필수서비스실패503 SERVICE_UNAVAILABLE, 전체deadline504 UPSTREAM_TIMEOUT은 실패로 드러내며 빈 성공으로 대체하지 않는다.
- Servlet 인증·용량413·routing404/405/415도 공통 serializer를 사용한다. 지원불가 Accept는 공통 예외406 빈본문. 각 route의 인가/정책/내부 allowlist·DTO가 준비되기 전 공개하지 않는다. legacy의 auth 예외 경로를 새 기능 때문에 넓히지 않는다.

아래는 **변경하지 않은 원본 요청/응답 예시**다. 앞의 source_path에는 원본/v1을 별첨으로 보존하고 표기 경로만 사용자 결정에 맞춘다. 뒤 절의 추가 필드/검증은 원본 JSON을 덮어쓰지 않는다.

### messages — GET `/islands/{islandId}/messages`

요청:

```json
{
  "cursor": null,
  "limit": 30
}
```

응답:

```json
{
  "data": {
    "items": [
      {
        "id": "m1",
        "userId": "minji",
        "name": "민지",
        "catColor": "ginger",
        "text": "오늘도 힘내!",
        "createdAt": "2026-09-11T09:10:00Z"
      }
    ],
    "nextCursor": null
  }
}
```

### message — POST `/islands/{islandId}/messages`

요청:

```json
{
  "clientMessageId": "local-1",
  "text": "오늘도 같이 집중하자"
}
```

응답:

```json
{
  "data": {
    "id": "m2",
    "clientMessageId": "local-1",
    "userId": "me",
    "name": "수빈",
    "catColor": "black",
    "text": "오늘도 같이 집중하자",
    "createdAt": "2026-09-11T09:10:00Z"
  }
}
```

## 2. 공개 DTO와 기존 코드

기존 ChatController:37은 /api/v1/chat아래방목록/과거메시지/읽음만있고REST메시지POST는없다. ChatMessageService:93이STOMP발신저장, :152가최신부터과거id커서history다. 저장은gromo_chat의ChatMessage, senderId는검증 주체,UUID유일키는(group_id,sender_id,client_message_id)다. GroupMember/프로필DB를Realtime에공유하지않는다.

| 공개 계약 | 타입·규칙 |
| --- | --- |
| messages | cursor optional opaque string,limit optional integer default30/max100.0이하/상한초과는신규400 INVALID_PARAMETER(field=limit),legacy clamp는그대로. items배열과nextCursor string/null |
| message | clientMessageId UUID필수,text string필수. strip후empty/NUL/2000 UTF-16초과는422 OUT_OF_RANGE(field=text);잘못된타입/null400 INVALID_REQUEST. senderId/receiverId/미지 필드거절 |
| Message | id UUID,userId UUID,name string,catColor string,text string,createdAt UTC,clientMessageId UUID. 기존messageId/senderId/content/sentAt을명시매핑 |

**원본 대비 명시 확장:** GETitems에도clientMessageId를필수로반환한다. 원본 GET예시에는없지만응답 유실뒤history와낙관적말풍선을합치려면원클라이언트키가필요하다. POST와message.created에는원본부터존재한다. source JSON은변경하지않는다. UUID36자에임의version비트제한을추가하지않고원본local-1은실제유효 값으로받지않는다.

탈퇴/비노출작성자에대해name/catColor를null로허용하는**공개 DTO확장**을명시한다. 기존message senderId는보존되는기술 ID이며새personalprofile연결을허가하는증명이아니다. 탈퇴자표시는기존“알 수 없음”의도를따르되새별칭/고양이색을서버가임의합성하지않는다. 활성작성자프로필상류장애는탈퇴자로바꾸지않고502/503으로드러낸다. 현재 주민목록에없는작성자라서삭제된계정이라고추정하지않는다.

## 3. ingress와 인가 경계

Business의공개2경로는인증된내부Realtime어댑터로전달한다. 필요한서버 간추가면은 POST `/internal/islands/{islandId}/messages`와 GET 같은경로다(이번설계의**내부기술제안**,원본 13개추가 계수아님). Realtime 수신용 서비스 자격과 caller=business의exact method/path허용목록과검증 주체위임을사용한다. legacy REST/STOMP 클라이언트는내부 어댑터를직접호출할수없다. 이경로추가시gateway/헬스/기존/api/v1의auth예외를넓히지않는다.

Realtime은Data의신뢰된 권한 조회어댑터에서현재활성 사용자/세션,해당island주민,우체통완공,승인된집중제한상태와revision을확인한다. Data의기존멤버십TTL캐시만으로허용하지않는다. 이권한어댑터는미통합기반과중복신설하지말고기존service auth/session검증을확장한다. legacyBearer를임의내부위임JWT로신뢰하거나없는sid/gen을DB현재값으로보충하지않는다.

- history/POST각각의현재 인가조회가해당행위의선형화경계다. 그검사이후Data에서권한이바뀌어이미허용된chat INSERT가완료될수있는분산경계를명시한다. Data와chat저장을같은 TX라고주장하지않는다. 이보다강한“이탈commit후저장0”제품요구가있으면별도입장리스/해지barrier프로토콜이선행돼야하며현재설계가보장하지않는다.
- read결과전달직전에도권한을재검증하고실패하면성공본문을반환하지않는다. POST후재검증실패는이미저장된메시지를롤백하지못한다. 성공원 결과를보여줄현재권한이없으면403이며,나중에허가받은원키재시도만중복결과를읽는다.
- event는소켓프레임전달직전현재 세션/주민/시설/집중정책을검사한다. finalcheck뒤이미네트워크로나간프레임회수를보장하지않는다. 만료/철회후SimpleBroker실제구독을해지하고미지원이면소켓을닫는다.
- Data membership변경의내구제어/리컨실과모든노드캐시무효화로회수한다. Pub/Sub만믿거나 120초TTL을최종허용근거로사용하지않는다.

신규messages접근범위의집중/REST/수신동작은 MQ02해결전닫는다. 공통CONNECT는JWT인증만하고message가드를focus/rest/emote/playback/events에적용하지않는다. legacy `/topic/groups/{groupId}`와 `/app/groups/{groupId}/send`의동작/와이어는보존한다. 신규messages STOMP SEND경로는만들지않으며신규발신은REST POST다.

## 4. 중복 저장과 부분 실패

새POST는clientMessageId가기준이며일반Idempotency-Key receipt를추가하지않는다. 두헤더/필드가있어도메시지 유일성정본은actor+island+clientMessageId다. 신규fingerprint는정규화text와contractVersion으로결정한다. text는기존strip정규화규칙을고정하고원문공백차이를새의도로간주하지않는다. 알고리즘/정규화변경은contractVersion 호환검증이필요하며지원불가재생은409 STATE_CONFLICT다.

1. 현재 인가확인뒤text정규화/키검증,동일scope조회또는INSERT를시도한다. 조회만으로유일성을보장하지않고DB UNIQUE가최종 판정한다.
2. 새 행은메시지ID/client키/정규화본문/서버sentAt를한번저장한다. fingerprint/version은같은행의최소메타데이터또는같은chat TX의sidecar에저장한다. 별도Data receipt로이중권위를만들지않는다.
3. UNIQUE경쟁이면실패한 INSERT TX를종료한뒤새TX로기존행을조회한다. 기존ChatMessageService가외부@Transactional을사용하지않는이유다. 실패 TX안재조회로PostgreSQL aborted TX를만들지않는다.
4. 신규 어댑터는기존정규화text와동일하면같은id/createdAt/client키/text원 결과를반환한다. 다른 본문이면409 IDEMPOTENCY_KEY_REUSED(field=clientMessageId,false)이며기존원문/다른 본문을오류에싣지않는다. legacySTOMP는같은 키다른 본문에도원문 반환을보존한다. 저장직접함수를두벌만들지말고중복 처리 정책을어댑터입력으로분리한다.
5. legacy로먼저저장된행도신규재시도시실제저장text를비교하고일치할때만재생한다. 서버가계산한검증가능한backfill과동일원문비교로전환하고메타데이터없음을무조건새 메시지로취급하지않는다.
6. legacy/new 어느 입구든 처음 저장한 행의 커밋 후에는 기존 fanout과 신규 event adapter를 연결한다. legacy wire는 유지하고 새 구독자의 현재 인가를 별도로 확인한다. 새 adapter 미활성 상태를 성공 전달로 과장하지 않는다. 새 행 커밋 후만 fanout한다. 중복재시도는방전체재방송없음,HTTP는원 결과201,legacy는발신세션duplicates큐.프로필은현재 인가된표시projection이라이름변경은재조회에반영될수있으며불변메시지결과(id/text/시간/키)와구분한다. 이표시정책을범용 receipt의원비즈니스결과재생보장과혼동하지않는다.

DB저장 성공뒤프로필조합/응답전송/최종 인가실패가있어도저장된행을숨겨다시INSERT하지않는다. 원키재시도가이를복구한다. 실패한fanout은로그/지표에남고history정본으로복구한다. message.created의내구outbox발행은1754범위에없으며존재하는것처럼표시하지않는다. Data의account/membership파기제어는별도내구경로다.

## 5. 히스토리·프로필·실시간 병합

DB조회는id DESC,과거쪽id<cursor로limit+1을받는다. nextCursor anchor는그선택집합의가장작은id이며응답items를id ASC로뒤집어반환한다(앱한묶음오름차순). 클라이언트도서버id순서를우선하고표시createdAt만으로동시노드순서를재정렬하지않는다. 프로필배치정렬이나items반전후잘못된끝값을nextCursor로쓰지않는다.

공통HMAC cursor의actor/island/order/limit/anchor/발급·만료/keyId결박을사용한다. 문자열UUID를직접opaque커서로받지않는다. 잘못된형식/위조/다른 사용자·섬400 INVALID_CURSOR,만료409 CURSOR_EXPIRED. 현재 인가를매페이지검증한다. legacyUUID커서/size clamp는원경로에서유지한다.

Realtime저장DTO에는name/catColor가없다. Business는허가된메시지sender집합으로Data의최소표시projection을한번batch조회한다. 임의userId프로필조회가아니라요청자/섬/실제메시지작성자맥락에결박된내부계약이어야한다. 탈퇴상태와현재접근가능한display만반환하고email/provider/자산/개인 설정은금지한다. 현재 주민이아닌과거작성자의조회범위는 MQ03의보존규칙을따르며목록에서누락됐다고가짜프로필을만들지않는다. 여러서비스응답을동일DB snapshot이라고표현하지않는다.

message.created의7필드(schemaVersion1,eventId,type,islandId,aggregateVersion,occurredAt,payload)를사용한다. payload={id,clientMessageId,userId,text,createdAt},aggregateVersion=1,key=(message,id),고정eventId와occurredAt는메시지생성과연결한다. 새topic은`/topic/islands/{islandId}/messages`;legacyChatMessageResponse를이봉투로강제교체하지않는다. event에는name/catColor를몰래추가하지않고필요한profile은허가된GET/BFF정본으로얻는다.

SUBSCRIBE RECEIPT확인→event버퍼→history설치→id 및(userId,clientMessageId)로병합한다. 서로다른메시지를aggregateVersion1로덮어쓰거나다른 사용자의같은client키를접지않는다. POST/이벤트/history가어떤순서여도낙관적말풍선은 1개다. 연결세대가바뀌면이전요청응답을버리고재연결/foreground에최신history부터마지막known id까지페이지조회해누락을채운다. 한페이지에새 메시지 30개를넘었다고첫페이지조회로복구완료하지않는다. 복구중지한계/버퍼overflow는화면을재초기화하며무한버퍼를만들지않는다.

## 6. 읽음·개인정보·검증

ChatRoomService:58의unreadCount는본인배지, :113의markRead는해당방메시지확인후단조UPSERT다. peer에게읽음event를보내는서비스가아니다. MQ01결정전기존read/API/table유지,신규GET/POST에는read부수효과없음.새GET이자동markRead를호출하면원본“읽음전송없음”을깨므로추가하지않는다.

기존ChatMessage문서는탈퇴후원문/senderId보존의도를갖지만개인정보 파기완료를증명하지않는다. 새이름/외양사본을영구저장하지않고계정 탈퇴제어가Realtime세션/권한/캐시/프로필projection및본인readcursor를정리할범위를명시한다. 원문보존기간/원문내개인정보의삭제요청은 MQ03결정과기존계정 파기정본으로정하며이설계가전체익명화를주장하지않는다. 파기제어는generation/epoch tombstone으로늦은재등록을차단하고중복삭제도멱등이어야한다. 사용자ID를유일키에서바꿔기존client키가새 메시지로재실행되지않게한다.

로그에는requestId,messageId,단계,결과code,인가실패범주,fanout실패/지연·복구건수만남긴다. text/name/catColor/토큰·원키·원 상류 본문금지. broker내부Redis namespace/chatDB를개명때교체하지않는다.

검증: 실제Servlet신규GET/POST와legacySTOMP같은저장소;키UUID/unknown/strictlimit;같은 키같은 본문·다른 본문·legacy먼저저장·두인스턴스경쟁;DB성공뒤응답/프로필/fanout실패;30개초과재연결gap과정렬/cursor;historyprofile권한누출·탈퇴자null;Data권한장애failclosed·구독후이탈/강퇴·집중/휴식정책;공통CONNECT가focus/emote를막지않음;기존read/unreadAPI회귀. production권한seam을가짜override한테스트만으로인가완료를주장하지않는다.
