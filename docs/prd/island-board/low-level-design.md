# 게시판 — LLD

[정책](policy.md) · [HLD](high-level-design.md)

## 1. 공통 입력·인가·응답

신규 공개 ingress는 Business의 아래 exact method/path다. Bearer AT의 서명·access 타입·만료·주체를 검증하고 외부 X-User-Id를 모든 accessor에서 제거한다. Data/Realtime 내부 호출에는 해당 서비스 audience의 서비스 토큰, 검증한 주체, 현재 요청 ID·deadline만 새로 전달한다. 외부 헤더 전체 복사와 임의 내부 URL 입력은 금지한다. 실제 활성 사용자/세션 검증은 선행 인증 계약으로 수행하며 없는 sid/gen을 현재 DB 값으로 합성하지 않는다. 필요한 인증 기반 미통합이면 새 route 활성화가 선행 구현에 의존한다.

Data는 path islandId가 실제 groupId임을 해석하고 현재 사용자 활성·해당 소속·시설 해금·작업별 역할을 확인한다. 다른 섬의 자원 ID는 path로 다시 좁혀 찾는다. 요청 시작 때 확정한 path/context를 사용하며 도중에 current-island가 바뀌어도 다른 섬으로 재해석하지 않는다. 같은 사용자의 다른 섬 자원/방문자 projection을 주민 전용 응답에 섞지 않는다. 원 결과 재생도 현재 인가가 필요하며 이 문서에는 leave/host-transfer 같은 권한 상실 후 최소 성공 증거 예외가 없다.

- UUID는 하이픈 포함36자, v4/v7 생성 권고이며 다른 version 비트를 이유로 거절하지 않는다. 메시지 키 포함 공통 UUID 정규화가 정본이다. 날짜는 YYYY-MM-DD KST, 시각은 서버 UTC ISO-8601 instant. 샘플 문자열 ID는 실제 ID 검증을 대체하지 않는다.
- JSON object만 수락하고 unknown/duplicate field, 잘못된 타입·명시 null을 거절한다(아래 nullable 출력과 별개). 정수는 JsonNode 정수 토큰으로 검사하여 1.5·문자열을 Long으로 절삭/강제 변환하지 않는다. version은1~9007199254740991이다. legacy ObjectMapper를 전역 변경하지 않는다.
- 성공은 한 번만 `{data}`로 감싸며 새 작성201, 나머지200이다. 오류는 `{error:{code,message,field,retryable},requestId}`이고 X-Request-Id가 동일하다. 저장 원 결과를 재생해도 현재 requestId를 사용한다. 409의 current는 `{version,resource}`이고 현재 인가된 공개 DTO와 해당 version을 같은 snapshot으로 읽는다. 안전한 공개 상태가 없으면 current를 생략한다.
- 입력400 INVALID_REQUEST/INVALID_PARAMETER, 키400 INVALID_IDEMPOTENCY_KEY, AT401 UNAUTHORIZED, 비활성 본인404 USER_NOT_FOUND, 비주민/시설/역할403 FORBIDDEN, 해당 경로에 없는 자원404 NOT_FOUND, 승인 범위 위반422 OUT_OF_RANGE가 기본이다. 기존 legacy 상태/코드는 보존하며 신규 어댑터에서 실제 등록한 조합만 변환한다.
- 같은키 다른의미409 IDEMPOTENCY_KEY_REUSED, 명시 version충돌409 VERSION_CONFLICT, 판정상충409 STATE_CONFLICT는 retryable=false다. 진행중409 REQUEST_IN_PROGRESS는 retryable=true/Retry-After:1. 불명확 상류계약502 UPSTREAM_CONTRACT_ERROR, 일시필수서비스실패503 SERVICE_UNAVAILABLE, 전체deadline504 UPSTREAM_TIMEOUT은 실패로 드러내며 빈 성공으로 대체하지 않는다.
- Servlet 인증·용량413·routing404/405/415도 공통 serializer를 사용한다. 지원불가 Accept는 공통 예외406 빈본문. 각 route의 인가/정책/내부 allowlist·DTO가 준비되기 전 공개하지 않는다. legacy의 auth 예외 경로를 새 기능 때문에 넓히지 않는다.

아래는 **변경하지 않은 원본 요청/응답 예시**다. 앞의 source_path에는 원본/v1을 별첨으로 보존하고 표기 경로만 사용자 결정에 맞춘다. 뒤 절의 추가 필드/검증은 원본 JSON을 덮어쓰지 않는다.

### notices — GET `/islands/{islandId}/notices`

요청:

```json
{
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "items": [
      {
        "id": "welcome",
        "title": "환영해요",
        "commentCount": 1
      }
    ],
    "nextCursor": null
  }
}
```

### notice — GET `/islands/{islandId}/notices/{noticeId}`

요청:

```json
{
  "commentsCursor": null
}
```

응답:

```json
{
  "data": {
    "id": "welcome",
    "title": "환영해요",
    "body": "각자의 할 일에 집중해요",
    "version": 1,
    "comments": [
      {
        "id": "c1",
        "userId": "minji",
        "name": "민지",
        "catColor": "ginger",
        "text": "좋아요",
        "createdAt": "2026-09-11T09:10:00Z"
      }
    ],
    "nextCommentsCursor": null
  }
}
```

### notice-create — POST `/islands/{islandId}/notices`

요청:

```json
{
  "title": "공지 제목",
  "body": "내용"
}
```

응답:

```json
{
  "data": {
    "id": "notice-new",
    "title": "공지 제목",
    "body": "내용"
  }
}
```

### notice-edit — PATCH `/islands/{islandId}/notices/{noticeId}`

요청:

```json
{
  "title": "수정 제목",
  "body": "수정 내용"
}
```

응답:

```json
{
  "data": {
    "id": "notice-new",
    "title": "수정 제목",
    "body": "수정 내용"
  }
}
```

### notice-delete — DELETE `/islands/{islandId}/notices/{noticeId}`

요청:

```json
{}
```

응답:

```json
{
  "data": {
    "deleted": true
  }
}
```

### comment — POST `/islands/{islandId}/notices/{noticeId}/comments`

요청:

```json
{
  "text": "좋아요"
}
```

응답:

```json
{
  "data": {
    "id": "c2",
    "name": "수빈",
    "text": "좋아요"
  }
}
```

## 2. 실제 코드와 DTO 계약

Business→Data 내부 경로는 표의 공개 경로 앞에 `/internal`을 붙인 exact method/path로 설계한다. 이는 신규 내부 어댑터 제안이며 별도의 공개 계약이 아니다. 기존 Data 수신용 서비스 자격 검증과 business caller 허용목록에 해당6개만 추가하고 기존 Data 공개 controller를 비인증 우회로 사용하지 않는다.

기존 `server/data-api/src/main/java/com/oneorthree/phone/group/service/GroupAnnouncementService.java:48/105/129`는 생성·수정·삭제에서 `getCallerForShare`를 사용한다. `:77`은 전체 목록이고 상세/댓글/cursor가 없다. `GroupMember.java:162`의 `role == OWNER || announcementPermission == ALLOW`는 타인 수정·삭제도 허용한다. GroupController:117/128/190/202의 기존4경로는 유지한다. main에 공지 댓글 테이블/서비스가 있다는 전제는 틀리다.

| 계약 | 입력/출력의 실제 타입·규칙 |
| --- | --- |
| notices | cursor optional opaque string. 결과 items의 id UUID,title string,commentCount nonnegative integer,nextCursor string/null. 새 공지0개면 빈목록 |
| notice | noticeId UUID, commentsCursor optional. body/title string,version 양의정수,comments 배열,nextCommentsCursor string/null. comments의 id/userId UUID,name/catColor/text string,createdAt UTC |
| notice-create | title/body 두 string 필수. title 공백만/100 초과 거절,body 공백만 거절.201에 저장된 id/title/body |
| notice-edit | title/body 중 최소1개,생략 유지/null·빈값 거절. id/title/body는 수정 후 전체 두 값. 원본에는 expectedVersion 없음 |
| notice-delete | 본문 없음,200 deleted=true. legacy의204와 혼합하지 않음 |
| comment | text string 필수·공백만 거절,201 id/name/text. author는 검증주체,대리 userId 입력 금지 |

현재 main entity `GroupAnnouncement`는 title100/content TEXT/user nullable이고 `updateContent`가 null을 유지한다. 신규PATCH의 null거절은 어댑터에서 명시하며 legacyPUT의 @NotBlank 둘필수와 구분한다. 추가 본문/댓글 상한은 BQ03 정책·설정 gate이고 여기서 임의 상수를 지급하지 않는다. commentCount는 해당 공지의 보이는 댓글만 세며 삭제 처리 BQ02에 따라 필터가 결정된다.

**명시 출력 확장:** 탈퇴 댓글 처리 BQ02에서 보존이 승인되면 원본 comments의 userId/name/catColor는 식별정보가 파기된 행에서 null을 허용하도록 확장한다. 임의의 fake UUID/다른 사용자 프로필을 넣지 않는다. 파기 판단 없는 조회 실패를 탈퇴자라고 숨기지 않는다. 결정 전 해당 댓글 기능은 비활성이다. 원본 예시에는 이 변경을 반영하지 않았다.

## 3. 저장·트랜잭션·멱등

Data의 논리 모델은 기존 notice 행+단조 noticeVersion, 신규 comment(id,noticeId,authorId,text,createdAt), 공통 receipt와 outbox다. 실제 migration 번호는 조정자가 정한다. comment FK 삭제/보존은 BQ02 결정 후 확정한다. 기존 공지에는 시작 version을 백필하고 legacy 생성·PUT·DELETE도 동일 notice version/outbox 변경 경계를 사용해야 한다. 기존 응답 형식은 유지한다. 새 경로에서만 version을 올리면 legacy 수정이 새 구독자에게 보이지 않으므로 이것도 활성화 조건이다. 불변 createdAt/id를 cursor정렬에 사용하고 update시 createdAt을 바꾸지 않는다.

쓰기 caller가 Data TX를 열고 활성 users 공유 잠금 → group 잠금(소속/역할 변경과 같은 경계)을 확보한 뒤 공통 PublicCommandService.run을 호출한다. 공통 명령/receipt 잠금 뒤 신규 command callback 안에서 notice를 잠그고 댓글/본문을 변경한다. 즉 users → group → 공통 명령 → notice 순서다. 새 noticeId는 최초 성공 명령에서 한 번 발급한다. 모든 신규 writer와 그 legacy 공용 변경 경로가 이 순서와 권한경계를 지키도록 통합한다.

읽은 선행 구현의 PublicCommandService.run은 Propagation.MANDATORY이며 activeAuthorization/replayAuthorization/command callback을 받는다. activeAuthorization은 이미 잠근 활성 주체·현재 섬/권한을 검증하고, replayAuthorization은 현재 공개 결과를 볼 자격을 검증한다. **대상 notice 존재 검사는 activeAuthorization에서 하지 않는다.** DELETE 완료 재생은 대상이 이미 사라졌기 때문이다. 신규 command callback에서만 대상 부재를 검사한다. 공통층 자체가 주민/시설 검사를 대신한다고 가정하지 않는다.

scope는 검증actor+method+route+실제islandId/noticeId+키이며 다른 섬/공지는 다른 scope다. fingerprint는 정규화한 의미JSON, 요청중/완료 다른본문은409(본문/원결과 공개 없음). PATCH의 생략과 null을 구분하고 미지필드를 버려 같은명령으로 취급하지 않는다. contractVersion은 resourceVersion과 별개다.

1. 현재 actor/주민/시설/작업 권한을 확인한다. 기존 동일 명령이 있으면 그 contractVersion과 fingerprint를 확인한다.
2. 현재 인가가 있고 동일 완료 receipt면 원 HTTP상태와 원 결과를 반환한다. 공지 DELETE 자체가 성공해 notice가 사라진 경우에도 현재 섬/작성 권한은 확인하고, **삭제된 대상 부재 검사는 완료 재생 뒤**다. 새키로 없는 공지를 삭제하면404다.
3. 새 실행은 notice/댓글의 현재 상태를 확인하고 변경한다. 생성version1, 제목/본문/댓글 변경마다 증가, 삭제는 마지막version+1을 내구화한다. 기존값과 같은 PATCH도 명령1회당 일관된 처리 규칙으로 버전1회 증가한다.
4. 댓글 행과 목록 count의 투영, notice version, 원 결과 receipt, notice.updated outbox를 한 TX로 확정한다. 외부 HTTP/팬아웃을 TX 안에서 기다리지 않는다. outbox 기록 실패도 전체rollback이다.
5. relay는 고정 eventId/occurredAt/version을 재전달한다. 전달 실패가 이미 커밋한 공지 성공을 되돌리지 않는다.

receipt는 단순 noticeId 재조회 포인터만으로 원응답을 재현하면 안 된다. 이후 수정으로 값이 바뀌므로 원 결과를 최소 구조로 보관해야 한다. 원문 요청/자격 전체는 보관하지 않고 계정파기 때 actor/관련 PII 결과를 지운다. 삭제된 공지에 대한 예전 생성/수정 결과는 현재 인가와 원결과 보존 정책을 확인하며 서비스는 현재 상태 GET과 과거 명령 결과를 구별한다. 보존 정책 미승인 상태에서 receipt TTL삭제 후 같은키 재실행을 허용하지 않는다.

## 4. 조회·커서·실시간

목록기본30/최대100은 서버 내부 페이지 설정이며 원본query에는limit를 추가하지 않는다. 댓글도기본30/최대100, commentsCursor로 다음쪽을 읽는다. 목록key=(createdAt DESC,id DESC), 댓글key=(createdAt ASC,id ASC), cursor에 actor/islandId/noticeId/정렬/필터/pageSize/anchor/기한/keyId를 HMAC으로 결박한다. 임의 UUID를 opaque cursor로 받지 않고 위조/잘못된축400 INVALID_CURSOR, 만료409 CURSOR_EXPIRED. 공지 목록 오류 field는cursor, 댓글 추가페이지 오류 field는실제제출필드commentsCursor다. 추가/삭제 중 count나본문이 달라질 수 있지만 불변 정렬키로 이미 본 행의 순서가 바뀌지 않는다. anchor 행이 삭제돼도 값 기반 seek를 허용한다.

상세본문/댓글page/count/notice.version은 Data REPEATABLE_READ 읽기 TX 등 검증된 동일 snapshot으로 구성한다. 현재 actor·membership·시설 검사도 해당 읽기 경계에서 수행하고 권한확인 실패를 댓글없음으로 바꾸지 않는다. profile을 per댓글HTTP로 읽지 않고 같은 Data snapshot에서 인가된 batch projection으로 조합한다. API 반환 시점 이후 발생하는 변경을 동시 snapshot이 포함한다고 약속하지 않는다.

notice.updated 봉투는 schemaVersion1,eventId,type,islandId,aggregateVersion,occurredAt,payload의7필드다. payload={noticeId,version}, aggregateVersion=version, key=(notice,islandId,noticeId), `/topic/islands/{islandId}/events`에 현재 수신자격 검증 뒤 전달한다. 작성/수정/삭제/댓글 producer만 발행하고 GET은 사건을 만들지 않는다.

구독 RECEIPT 확인→buffer→GET→version 설치→dirty 재조회. 더 높은 사건이 조회 중 도착하면 응답version이 따라올 때까지dirty 유지한다. 다른 noticeId의 version을 비교하지 않는다. 삭제 사건의 재조회404는 그 notice 제거/목록갱신으로 처리한다. 유실/foreground/재연결 때 정본을 다시 읽고 실패한GET을 eventId dedup 때문에 영구 생략하지 않는다. membership상실은 실제구독해제/전달직전차단, 단순TTL캐시 최종허용 금지.

## 5. 개인정보와 검증

기존 공지는 탈퇴 후 보존 의도이나 작성자nullable만으로 파기가 완료되지 않는다. 계정삭제의 users배타잠금과 생성/댓글 writer 공유잠금을 맞추고 authorId/name/catColor 사본·receipt·outbox·조회 캐시 파기를 전수 확인한다. 타인수정이 늦은 전체UPDATE로 nullify된 authorId를 되살리지 않게 동적컬럼 갱신/공지행직렬화 등 실제경쟁으로 검증한다. 댓글보존 여부 BQ02 없이 기본 영구보존을 만들지 않는다.

로그: requestId,route,commandId,단계,안전한code,처리시간,outboxlag/재시도; title/body/text·프로필·토큰·키원문·상류본문은 금지. PII가 지워져도 사용자비활성과 명령tombstone으로 재실행을 차단한다.

필수 검증: OWNER/ALLOW/일반주민/방문자·시설잠김·남의공지ID; PATCH생략/null/unknown과legacyPUT; 같은키재전송/다른본문409·삭제후동일키성공; 동일timestamp 커서·삭제anchor; 댓글추가/삭제/공지삭제/탈퇴·권한회수 경합; count/version/outbox/receipt rollback; 수신 직전 membership상실·조회중새event·fanout누락/재연결; 실제SQL·Servlet chain을 사용하며 production권한seam을 mockoverride한 성공만으로 검증하지 않는다.
