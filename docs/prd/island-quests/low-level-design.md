# 섬 퀘스트 — LLD

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

### quests — GET `/islands/{islandId}/quests/current`

요청:

```json
{}
```

응답:

```json
{
  "data": {
    "items": [
      {
        "id": "q-focus",
        "occurrenceId": "q-focus-20260911",
        "title": "저녁 30분 집중",
        "type": "focus",
        "windowStart": "18:00",
        "windowEnd": "23:00",
        "timezone": "Asia/Seoul",
        "date": "2026-09-11",
        "targetMinutes": 30,
        "myRate": 60,
        "reward": {
          "currency": "village_points",
          "amount": 10
        },
        "settlementStatus": "in_progress",
        "claimable": false,
        "claimBlockedReason": "MEMBERS_INCOMPLETE",
        "claimed": false,
        "version": 1
      }
    ]
  }
}
```

### quest — GET `/islands/{islandId}/quests/{questId}/progress`

요청:

```json
{
  "occurrenceId": "q-focus-20260911",
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "id": "q-focus",
    "occurrenceId": "q-focus-20260911",
    "title": "저녁 30분 집중",
    "type": "focus",
    "windowStart": "18:00",
    "windowEnd": "23:00",
    "timezone": "Asia/Seoul",
    "date": "2026-09-11",
    "targetMinutes": 30,
    "myRate": 60,
    "reward": {
      "currency": "village_points",
      "amount": 10
    },
    "settlementStatus": "in_progress",
    "claimable": false,
    "claimBlockedReason": "MEMBERS_INCOMPLETE",
    "claimed": false,
    "version": 1,
    "members": [
      {
        "userId": "me",
        "name": "수빈",
        "catColor": "black",
        "rate": 60,
        "measurementStatus": "authorized"
      },
      {
        "userId": "minji",
        "name": "민지",
        "catColor": "ginger",
        "rate": 100,
        "measurementStatus": "authorized"
      }
    ],
    "nextCursor": null
  }
}
```

### quest-create — POST `/islands/{islandId}/quests`

요청:

```json
{
  "title": "저녁 30분 집중",
  "type": "focus",
  "targetMinutes": 30,
  "windowStart": "18:00",
  "windowEnd": "23:00",
  "timezone": "Asia/Seoul"
}
```

응답:

```json
{
  "data": {
    "id": "q-new",
    "title": "저녁 30분 집중"
  }
}
```

### quest-edit — PATCH `/islands/{islandId}/quests/{questId}`

요청:

```json
{
  "title": "저녁 40분 집중",
  "targetMinutes": 40
}
```

응답:

```json
{
  "data": {
    "id": "q-new",
    "title": "저녁 40분 집중",
    "targetMinutes": 40
  }
}
```

### claim — POST `/islands/{islandId}/quests/{questId}/claims`

요청:

```json
{
  "occurrenceId": "q-focus-20260911",
  "expectedVersion": 1
}
```

응답:

```json
{
  "data": {
    "claimId": "claim-1",
    "occurrenceId": "q-focus-20260911",
    "villagePointsAdded": 10,
    "claimed": true
  }
}
```

## 2. 요청·회차 DTO와 미결 경계

Business→Data 내부 어댑터는 공개5경로 앞에 `/internal`을 붙인 exact method/path 제안이다. 기존 Data 수신용 서비스 자격 검증과 business caller 허용목록에만 등록한다. 내부경로를 공개 계약에 추가 계수하지 않고, 외부 사용자의 userId/권한/claimable 입력을 받지 않는다.

| 계약 | 구체 타입과 의미 |
| --- | --- |
| quests | query 없음, 서버 KST 현재 회차 items. 각 항목 id/occurrenceId UUID,title string,type focus/screen,date YYYY-MM-DD,timezone Asia/Seoul,targetMinutes 정수,myRate number/null,reward(currency=village_points,amount정수),settlementStatus string,claimable boolean,claimBlockedReason string/null,claimed boolean,version 양의정수 |
| quest | path questId UUID, query occurrenceId UUID필수/cursor optional. 해당 occurrence의 같은 헤더와 members(userId UUID,name/catColor string,rate number/null,measurementStatus authorized/denied/unavailable/pending),nextCursor string/null. path섬/quest/회차의소속 일치 검증 |
| quest-create | title/type/targetMinutes 필수,focus는windowStart/windowEnd HH:mm 필수,screen에는창필드 금지. timezone 누락=Asia/Seoul/다른값400 INVALID_PARAMETER.201 id/title |
| quest-edit | 원본의 title/targetMinutes 중 하나 이상. 생략 유지,null거절,새 type/창/반복키 unknown400.200 id/title/targetMinutes는 정의의수정결과. 실제적용회차 QQ02 결정 전 비활성 |
| claim | occurrenceId UUID,expectedVersion 엄격 양의정수필수.200 claimId UUID,occurrenceId UUID,villagePointsAdded 비음수정수,claimed=true. 실제승인된양수/무보상정책은 QQ05에의존 |

focus 창/target 수학적 범위와 screen0분 허용·title길이는 승인한 도메인 설정으로 검증하고 목업30/40/10을 상수로 채택하지 않는다. 시간 HH:mm 파싱,실재하는날짜,안전정수 등의 기술 검증은 독립 구현한다. 자정 넘는 창을 지원하거나 거절하는 제품 범위는 QQ02 확정 뒤 설정/테스트로 고정한다. 명시필수 필드 누락/null은400,해석가능한 범위위반422 OUT_OF_RANGE(field=해당공개필드)다.

원본focus항목의 windowStart/windowEnd는 focus에서필수,screen응답에서는null이라는 **타입별 nullable명시 확장**을 채택한다. claimBlockedReason은 claimable=true 또는 claimed=true일때null이고 미달성MEMBERS_INCOMPLETE는원본값이다. 측정대기 등 추가 reason값과 settlementStatus 확장은 QQ01~03 결정 후정본enum으로등록한다. 현재 원본에서 확인한 in_progress/claimed 외 상태를 완성된운영 enum이라고제시하지않는다. ready여부는claimable이며 상태문자열을추측하지않는다.

**PII 출력 확장:** 회차cohort에 탈퇴자가 남는 정책이승인되면 members의 userId/name/catColor는파기후null가능하고 rate/measurementStatus표현도승인한최소판정결과만사용한다. fake UUID나원래프로필보존으로필수필드를채우지않는다. QQ01과계정 파기계약확정전그경로를활성화하지않는다. 최종공개nullable개정은원본 JSON에덮어쓰지않는다.

## 3. 기존 구현과 새 저장 경계

기존 GroupChallengeService:437은 OWNER만생성,활성 4개·repeatDays·창간격제약과CTI4조합을사용한다. `:532`의createBetOnChallengeCreation은기존 내기배선이다. 기존 정책 `docs/prd/challenge/policy.md`는수정없음/개인참가비·payout을갖고새5계약과동일하지않다. GroupBetJudge:48의focus창 5분관용·screen미계측정산미달성도새정책으로자동 채택하지않는다. ChallengeResultAckService:25의claimDisplay는결과모달표시 선점이며지급수단이아니다.

논리저장단위(물리테이블/마이그레이션번호는구현조정자소유):

| 단위 | 최소자료·제약 |
| --- | --- |
| QuestDefinition | UUID,islandId,type,title,목표/창,정의revision,승인된스케줄·적용시점 |
| Occurrence | UUID,questId,islandId,KST귀속일/고정창UTC경계,정의snapshot/rewardrevision,판정 정책revision,version,정산상태. 같은정의회차중복개설방지 유일키 |
| Cohort/evidence | 승인된시점의대상집합,참여/이탈처리근거,sourceID/version,진행값·측정상태·확정결과. 파기정책과최소증거분리 |
| Claim | claimId,islandId,occurrenceId,지급량·통화/정책revision,원장참조. 도메인 UNIQUE(islandId,occurrenceId,settlement-kind) |
| 공용지갑/원장 | ownerType=island,ownerId=islandId,currency=village_points. 기존경제정본재사용;임의별도balance컬럼금지 |
| receipt/outbox | actor+operation/key/fingerprint,contractVersion,원 결과·사건ID. 선언적UIclaim과별개 |

현재main에는위공동퀘스트회차/claim지갑연결이없다. 기존 챌린지ID를새questID로사용하거나두기능을동시에생성하는자동이관은범위 밖이다. 원래내기장부를수정/삭제하지않는다.

## 4. 계산과 version

focus의기술입력은고정island귀속의서버ACTIVE구간이다. 각구간을회차의KST→UTC경계에clip하고중복없이초합산한다. REST구간은 0초기여하며원본now-start나앱진행률을신뢰하지않는다. 분내림은각구간마다하지않고최종정확초와목표분*60을비교한다. 화면rate의반올림/관용치 QQ03은판정식과분리한다.

screen은승인된하루정본의device/측정시각/권한상태를사용한다. `group_challenge_members`창형값을하루값으로읽지않는다. 기존일통계의미보고null을0으로채우지않고,현재사용상한이하를최종성공으로간주하지않는다. 마감/grace/새측정의정정허용과현재/이전권한의처리는 QQ03결정후고정한다.

입력집중/측정producer는이미반영한(source-kind,sourceId,sourceVersion,occurrenceId)를원자대조한다. source중복이quest.version을증가시키거나정산을다시실행하지않게한다. 같은원본이업데이트되는경우누적전체를매번더하지말고동일 source의최신 기여를교체하거나검증된차분으로변경한다. FocusService.recordCompletion은통계·스트릭·FOCUS_GOAL/SESSION_COMPLETE개인 coin을변경하므로여기서재호출하지않는다.

quest.progress.version의축은(islandId,questId,occurrenceId)다. 주민변경/측정반영/정의변경의해당회차영향과claim완료가그축을증가시킨다. 정의revision/지갑version/이벤트schemaVersion은다르다. 시간경과만으로판정이바뀌는마감은정책기반finalizer가해당회차를잠그고상태/version/outbox를확정하며GET이숨은정산을실행하지않는다. finalizer중복도같은전이로 1회처리한다.

## 5. claim 원자 명령과 경쟁

caller는Data TX를열고활성users공유잠금→group잠금→공통PublicCommandService.run→occurrence잠금→공용섬wallet잠금순서로처리한다. 관리·집중종료·경제writer와같은group/지갑순서를통합한다. 회차/cohort변경writer도같은잠금축을사용한다. 네트워크호출을TX안에서대기하지않는다.

scope=(검증actor,method,route,islandId,questId,key),fingerprint는occurrenceId/expectedVersion포함정규화JSON이다. 같은 키의다른body409는기존본문/결과를노출하지않는다. activeAuthorization은현재사용자/세션·주민/게시판·행위권한, replayAuthorization은현재공개결과열람권한을검증한다. 동일완료receipt는expectedVersion재검사보다먼저원200/지급량을재생하며지원불가contractVersion은409 STATE_CONFLICT로거절하고재실행하지않는다.

새실행은다음순서다.

1. path quest와occurrence가같은섬·회차인지확인,해당회차/전체 cohort의안정된정본잠금.
2. 현재정산상태·제출version검사. 다른 키로이미정산한회차는409 STATE_CONFLICT,지급없음. 첫요청응답 유실은반드시원키로재시도한다.
3. 승인된 대상전체의성공/측정확정/마감/claim권한검증. 미달성/정산대기는409 STATE_CONFLICT이며원본예상409를보존한다. current는권한이있을때공개회차DTO와version만허용한다.
4. 승인된rewardrevision의금액을그회차섬wallet에QUEST_SETTLEMENT등분리된원장원인으로 1회credit. 실제원장원인명은경제정본과함께등록하며개인BET_PAYOUT/coin명령을대용하지않는다.
5. Claim유일성·회차claimed/version증가·지갑version·원200receipt·quest.progress.updated/wallet.updated outbox를같은 TX로확정. 어느단계실패도전체 rollback.

두주민이서로다른 키로동시claim해도도메인 유일성과회차 잠금이 1회지급을보장한다. 중복원장/claim발생시이를추가보상으로접지않는다. 금융정책의수치없음은0P성공이아니라출시미준비다. 후속측정정정이이미지급된회차를자동추가지급/환수하는정책도없으며 QQ03에서필요한정정을먼저확정한다.

## 6. 조회·커서·이벤트

current는서버KST현재회차를동일Data snapshot으로읽고샘플값을합성하지않는다. 회차없음은빈items지만정책/측정기반미구현을빈목록정상으로숨기지않는다. progress의헤더/version/해당page/cohort집계는동일snapshot이다. cursor는actor,island,quest,occurrence,cohortRevision,projectionVersion,정렬(userId고정순),pageSize30/상한100,기한/keyId를HMAC결박한다. projection/cohort변경으로페이지가다른판정과섞이면409 CURSOR_EXPIRED로처음부터조회한다. 위조/다른scope는400 INVALID_CURSOR다. APIquery에는새limit를추가하지않는다.

claimable계산은전체 cohort에대한서버집계이며화면 pagination과무관하다. creator/updater와탈퇴자가정의/회차를깨지않도록참조/최소증거를분리한다. 현재회차만요청가능하며과거history기능은추가하지않는다(어느날까지current인지 QQ02필요).

이벤트 7필드(schemaVersion1,eventId,type,islandId,aggregateVersion,occurredAt,payload)를사용한다. quest.progress.updated payload={questId,occurrenceId,version},key=(quest.progress,islandId,questId,occurrenceId);wallet.updated payload={ownerType:island,ownerId:islandId,currency:village_points,version},key=(wallet,island,islandId,village_points). 각aggregateVersion은자기payload.version과같다. 같은claim이두event를만들어도eventId는각각다르고relay재전달에서는유지한다. `/topic/islands/{islandId}/events`에현재 주민만받는다.

SUBSCRIBE RECEIPT뒤버퍼→GET→각회차version설치→새사건dirty재조회. 다른회차/지갑version을서로비교하지않는다. unknown회차사건은목록재조회,GET중더높은version이면dirty유지,실패재조회를dedup으로없애지않는다. 계정/소속상실은실제구독해제와전달직전현재 인가로차단한다.

## 7. 개인정보·관측·검증

cohort/evidence는개인활동자료다. 계정 탈퇴users배타잠금과source/claim writer를직렬화하고미정산에필요한최소결과를먼저동결할지여부를 QQ01로확정한다. 측정 원본을무기한보존하지않으며기존account의group_challenge_members파기를새cohort보존근거로우회하지않는다. 탈퇴 전용최소증거와공개members프로필은다르다. 필요한판정증거를확정할수없을때조용히 0분으로정산하지않는다. actor/프로필 사본·원receipt·outbox에퍼진PII도파기/비노출계약에포함한다. 단순사용자UUID삭제로지급 유일성까지없애재지급되지않게비개인회차정산tombstone을보존한다.

로그에는requestId,commandId,단계,정책revision,결과code,처리시간,집계지연/outboxlag만남긴다. 개인별분/이름/프로필/본문·키원문/토큰·원 상류 오류는기록하지않는다.

검증: ACTIVE/REST·KST자정·창경계와최종초단위;미측정/철회/늦은·같은시각다른측정/멀티기기;페이지밖미달성주민;정의수정/이탈/탈퇴와claim경합;같은source중복/새sourceversion차분;두주민다른 키동시claim·응답 유실원키재생·version충돌;지급중rollback과outbox중복;기존coin/내기/통계추가지급0;권한회수와실제HTTP/DB경로. 제품정책확정전이를가짜전원성공fixture로완료표시하지않는다.
