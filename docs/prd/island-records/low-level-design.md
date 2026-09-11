# 회관 기록 상세 설계

이 문서는 strict 입력·내구 측정·원자 집계 기술을 정한다. [정책](policy.md)의 미결 범위와 병합/마감 결정은 기본값으로 대체하지 않는다.

## 1. 원본 요청·응답 보존

원본 v0.3-proposed 예시다. 실제 GET은 query이며 아래 JSON을 GET body로 보내지 않는다. cursor:null은 최초 요청에서 query를 생략한다는 예시이고 문자열 null을 보내는 규칙이 아니다. 모든 성공은 원본대로200이다.

### GET `/islands/{islandId}/statistics/focus`

원본 `/v1/islands/{islandId}/statistics/focus`.

요청:

```json
{
  "from": "2026-09-07",
  "to": "2026-09-13",
  "timezone": "Asia/Seoul",
  "scope": "me",
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "scope": "me",
    "totalSeconds": 1500,
    "series": [
      {
        "date": "2026-09-11",
        "seconds": 1500
      }
    ],
    "records": [
      {
        "id": "focus-1",
        "subject": "수학",
        "activeSeconds": 1500,
        "completedAt": "2026-09-11T09:10:00Z"
      }
    ],
    "nextCursor": null
  }
}
```

### GET `/islands/{islandId}/statistics/screen-time`

원본 `/v1/islands/{islandId}/statistics/screen-time`.

요청:

```json
{
  "from": "2026-09-07",
  "to": "2026-09-13",
  "timezone": "Asia/Seoul",
  "scope": "me"
}
```

응답:

```json
{
  "data": {
    "scope": "me",
    "measurementStatus": "unavailable",
    "totalMinutes": null,
    "series": [],
    "updatedAt": null
  }
}
```

### PUT `/me/screen-time/{date}`

원본 `/v1/me/screen-time/{date}`.

요청:

```json
{
  "minutes": 90,
  "measurementStatus": "authorized",
  "timezone": "Asia/Seoul",
  "measuredAt": "2026-09-11T09:10:00Z",
  "deviceId": "device-1"
}
```

응답:

```json
{
  "data": {
    "date": "2026-09-11",
    "minutes": 90,
    "measurementStatus": "authorized"
  }
}
```

## 2. 공개 DTO와 입력 검증

from/to는 필수 YYYY-MM-DD이며 양끝 날짜를 포함한다. 요청 기간은 `[from 00:00 KST, to+1일 00:00 KST)`다. 조회 기술 상한은31일로 두어 주/월 화면을 모두 지원하며, 더 긴 조회는 계약 개정 없이 무제한 열지 않는다. from>to, 존재하지 않는 날짜,31일 초과는422 OUT_OF_RANGE(field=from 또는 to)다. 누락/중복 query/파싱 불가 형태는400 INVALID_PARAMETER. timezone 생략은 Asia/Seoul이며 명시 빈값/null 문자열/다른 존/별칭/중복은400 INVALID_PARAMETER(field=timezone)다. PUT의 JSON timezone 명시 null도 같은 오류다.

scope는 필수 me|island, 다른 값은422 OUT_OF_RANGE(field=scope). islandId와 응답 사용자/세션 식별자는 UUID36, v4/v7 생성 권고다. 원본 focus-1/minji 등은 식별자 예시일 뿐 실제 허용 식별자가 아니다. name/catColor는 계정의 공개 projection을 재사용하며 catColor의 미답6종을 이 설계가 임의 seed하지 않는다.

### 집중 scope별 data

| scope | 필드 | 의미 |
| --- | --- | --- |
| me | scope,totalSeconds,series[{date,seconds}],records[{id,subject,activeSeconds,completedAt}],nextCursor,**asOf** | 본인 전체 요청 기간 합과 완료 세션 상세 페이지 |
| island | scope,members[{userId,name,catColor,totalSeconds,series[{date,seconds}]}],nextCursor,**asOf** | 공개 주민 기간 집계 페이지. 개인 records/subject 없음 |

asOf는 이번 승인된 UTC instant 확장이다. 원본 JSON은 그대로 유지하고 실제 data에 `"asOf":"2026-09-11T09:10:00Z"`를 추가한다. timestamp만으로 snapshot을 재현하지 않으며 실제 immutable snapshotId는 cursor에 결합한다. scope별 조회 대상의 의미는 RC-D01 승인 정책을 사용한다. scope=island의 nextCursor는 members 페이징에 사용하고 scope=me의 nextCursor는 records 페이징이다. 어떤 목록을 넘기는지 cursor scope에 고정한다.

totalSeconds와 series는 페이지와 무관한 전체 기간 합이다. records는 **완료 세션**당1행이며 activeSeconds는 조회 날짜 범위에 배분된 그 세션의 몫이다. completedAt은 원 세션의 실제 종료 UTC 시각이므로 범위 밖에 있어도 날짜 기여가 있으면 포함한다. 같은 세션의 ACTIVE 구간마다 records를 복제하지 않는다. 진행 세션 기여는 승인된 개인/섬 범위에서 total/series에 더하지만 completedAt이 없는 가짜 완료 record는 만들지 않는다. 따라서 records 페이지 합이 total과 같아야 한다는 가정을 하지 않는다. 전체 세션 시간을 보려면 기존 세션 상세 계약을 사용한다.

series는 원본처럼 오름차순의 희소 날짜 배열이다. 집중 데이터가 완전히 알려진 범위에서 누락 날짜는0초이며 빈 결과는 totalSeconds=0,series=[],records 또는 members=[]다. 귀속을 모르는 legacy 자료를 '알려진0'으로 바꾸지 않는다. 해당 정책/백필이 해결되지 않은 범위는 RC-D05 gate다. 날짜 몫이0초인 완료 기록을 표시할지는 기록 DTO 검증에서 일관되게 처리하며 이 설계는 양의 기간 기여가 있는 세션만 목록에 싣는 기술 선택을 채택한다.

### 스크린타임 scope별 data

| scope | 필드 |
| --- | --- |
| me | scope,measurementStatus,totalMinutes nullable,series[{date,minutes nullable,measurementStatus,updatedAt nullable}],updatedAt nullable |
| island | scope,members[{userId,name,catColor,minutes nullable,measurementStatus,series[{date,minutes nullable,measurementStatus,updatedAt nullable}],updatedAt nullable}] |

섬 주민의 minutes는 해당 요청 기간에 대해 승인된 병합/완전성 정책의 결과다. 원본 서술의 주민별 minutes/status를 위와 같이 구체화하며 개인 기기 목록·deviceId·앱 선택 토큰·subject를 공개하지 않는다. screen GET 원본에 cursor가 없으므로 새 무한 목록 API로 확장하지 않는다. 섬 최대 주민 수는 기존 섬 정책 상한을 검증하고 한 Data 집계 요청으로 반환한다.

단일 관측값이 authorized이고 minutes=0이면 실제0이다. pending은 권한 획득 후 수집 대기, denied는 권한 거절, unavailable은 지원/수집 불가이고 이 세 상태의 값은 null이다. 측정이 전혀 없으면 원본처럼 unavailable/null/series[]/updatedAt=null을 반환한다. 이 기본 부재 응답은 '현재 기기에서 권한이 거절됐다'는 추론이 아니다. 알려진 미측정 날짜 행은 minutes=null을 유지하며0으로 보간하지 않는다.

기간에 여러 상태가 섞인 경우 totalMinutes/measurementStatus/updatedAt을 고르는 규칙, denied 전 과거값 노출, 미래 일자는 RC-D03 승인 전 확정하지 않는다. 단순 SUM(non-null)만 반환해 부분 합계를 전체 합계로 보이게 하지 않는다. 숫자 결측을0으로 접는 legacy screenMinutesOrZero는 신규 resolver에서 사용 금지다. 새 completeness enum을 임의 추가하지 않는다.

## 3. 집중 집계와 안정된 페이지

PR743의 단일 계산식을 사용한다. ACTIVE 구간은 `[start,end)`, 진행 중 열린 구간의 end는 asOf로 임시 닫는다. REST를 wall-clock 길이에 포함하지 않는다. 마이크로초로 합산한 뒤 최종 초를 내리고, 날짜별 누적 길이 C(d)에 대해 `min(ceil(C(d)/1e6),floor(totalMicros/1e6))`의 전일 차를 배분한다. 요청 구간부터 새로 반올림하면 같은 날짜를 주/월에서 다르게 계산하므로 **세션 전체의 정본 날짜 기여를 만든 뒤** 요청 날짜를 선택한다.

| 실제 KST 구간 | 결과 |
| --- | --- |
| ACTIVE 23:50~23:55 / REST 23:55~00:05 / ACTIVE 00:05~00:10 | 전일300초·당일300초, 총600초 |
| ACTIVE 23:59~00:00 정확 종료 | 전일60초, 다음날0 |
| ACTIVE 23:59:59.800~00:00:00.800 | 총1초, 정본 누적 규칙으로 전일1·당일0 |

완료 날짜 기여·진행 상태·구간은 lifecycle 공유 잠금 획득 후 READ COMMITTED TX의 단일 SELECT statement snapshot에서 함께 읽는다. 완료 projection 캐시와 현재 Redis live 값을 별도 조회해 더하지 않는다. finish와 경쟁해도 동일 세션이 완료+진행 양쪽에 잡히지 않아야 한다. read projection의 순수 합산은 보상/종료 명령을 호출하지 않는다.

scope=me records 정렬은 completedAt DESC, UUID DESC, scope=island members는 UUID ASC다. 페이지 기본30/상한100은 A0를 따르고 선택 limit 확장은 기술 query다. limit/filter/scope를 바꾸면 첫 조회다. immutable snapshot에 total/series/records 또는 members의 정렬 결과와 asOf·정책 revision을 고정한다. Data READ COMMITTED 쓰기 TX의 단일 SELECT로 일관된 projection을 만들고 결과·역색인을 함께 저장한다. 같은 TX에서 첫 응답 내용을 확정하고 commit 후 전달하며 HTTP 사이 장시간 DB TX를 유지하지 않는다.

cursor는 A0의 별도 HMAC 키로 서명한 opaque 토큰이다. 내부 schemaVersion/snapshotId/주체scope digest/islandId-context digest/from/to/timezone/scope/limit/정렬/last key/정책 revision/발급·만료를 결합한다. 서명은 암호화가 아니므로 subject/name/원시 개인정보를 토큰에 넣지 않는다. 완료 시각·세션 ID의 실제 정렬 경계는 서버 snapshot에 보관하고 cursor에는 비민감 경계 참조를 써서 개인 활동 시각을 URL에 노출하지 않는다. 수명은15분, 이어지는 페이지로 만료를 연장하지 않는다. Data snapshot도 해당 원 cursor 만료까지 있어야 하며 조기 삭제·만료·PII 파기면409 CURSOR_EXPIRED 후 첫 페이지를 다시 읽는다. asOf만 남기고 현재 DB로 페이지를 재생성하지 않는다.

### 탈퇴와 snapshot 반환의 동일 원자 경계

요청자만 재인가하면 snapshot 안에 복사된 다른 주민의 PII를 보호할 수 없다. 초기 구현은 Data DB의
공통 transaction-scoped lifecycle 잠금 `public-statistics-snapshot-lifecycle`을 사용한다. snapshot 생성과
모든 페이지 반환은 공유 잠금, 중앙 withdraw와 공개 범위 축소·PII 파기는 같은 키의 배타 잠금을 취득한다.
이는 새 논리 잠금 계약이며 기준 main에 이미 있는 기능이 아니다. 단일 키는 초기 안전성을 위한 기술 선택이고,
나중에 분할하려면 같은 원자 조건과 잠금 순서를 경합 테스트로 다시 입증해야 한다.

잠금 순서는 **공통 lifecycle 잠금 → 사용자 lifecycle 행(ID 정렬) → 섬/context(ID 정렬) → snapshot(ID 정렬)**이다.
중앙 withdraw의 모든 진입점은 사용자 락을 잡기 전에 배타 잠금을 얻어야 한다. 이미 사용자/섬 락을 잡은
상태에서 이 공통 잠금을 뒤늦게 추가하지 않는다. snapshot 만료 정리도 lifecycle 잠금 후 snapshot 순서를
따르며, 기존 사용자→섬 순서를 역전시키지 않는다. 회관/랭킹 두 모듈은 정확히 같은 잠금 키·프로토콜을 사용한다.

1. 생성: 공유 잠금을 먼저 얻고 현재 인가/피관측자 공개 조건을 검사한 뒤 일관된 집계를 만든다. 정렬 결과와
   `snapshotId → 관련 사용자` 및 `사용자 → snapshotId` 역색인을 **같은 쓰기 TX**에 저장한다. 관련 사용자는
   현재 페이지뿐 아니라 전체 결과·myRank·분모·집계 기여에 포함된 사용자까지 포함한다. 초기 구현은 READ COMMITTED
   TX에서 잠금을 먼저 취득한 다음, **다음 SQL statement의 단일 SELECT/CTE**로 집계 전체를 고정한다.
   REPEATABLE READ에서 잠금 SELECT가 대기 전에 고정한 오래된 view를 재사용하는 구현은 허용하지 않는다.
   잠금 전 읽기 결과는 권한·유효성 판정에 쓰지 않으며, 페이지 반환도 같은 READ COMMITTED 순서를 따른다.
2. 페이지: 공유 잠금 아래 현재 요청자의 활성 계정/소속/시설 권한을 재검사하고, 정본 snapshot의 유효 상태·TTL·
   scope·정책 revision을 함께 확인한 후 응답에 필요한 공개 결과를 확정한다. 중간에 TX를 끝내고 유효 상태를
   다시 확인하지 않은 payload를 별도 조회하지 않는다. Data 응답 DTO와 직렬화할 내용을 이 TX에서 확정하며
   lazy loading/후속 DB 조회를 하지 않는다. 정본 검사 전 Business 캐시에서 응답을 반환할 수 없다.
3. 탈퇴: 배타 잠금을 얻은 중앙 withdraw가 사용자 비활성/PII 파기와 함께 역색인으로 영향받는 **전체 snapshot**을
   찾아 무효화하고 복사된 결과 payload·개인정보 인덱스를 삭제한다. 원본 사용자 파기와 무효화/삭제는 같은 Data TX로
   커밋하거나 전부 rollback한다. 비동기 outbox/TTL/배치가 나중에 snapshot을 내릴 때까지 기다리는 방식은 금지다.
   외부 서비스 후속 파기가 있더라도 Data 안의 이 원자 작업을 대체하지 않는다.
4. 재조회: 현재 요청자 권한이 없으면 기존403/404가 우선한다. 요청자는 여전히 인가됐지만 snapshot이 타인의
   탈퇴로 무효화됐으면409 `CURSOR_EXPIRED`(field=cursor,retryable=false)로 첫 페이지 재조회를 요구한다.
   중간 행만 빼거나 분모/순위를 그대로 둔 수정본을 기존 snapshotId로 반환하지 않는다. 비민감 무효화 표시만
   남기거나 snapshot을 완전히 지울 수 있으며, 두 경우 모두 같은 cursor 오류로 처리한다.

반환의 선형화 지점은 공유 잠금 안의 최종 유효성 검사와 응답 내용 확정이다. 탈퇴가 먼저 커밋하면 이후 페이지는
이전 PII를 받을 수 없다. 페이지가 먼저 이 지점을 통과하면 탈퇴가 공유 잠금 해제까지 기다리므로 조회가 먼저
일어난 순서다. 이미 인가되어 전송 중인 HTTP 응답을 네트워크에서 회수한다는 보장은 하지 않는다. 여러 HTTP 요청
사이에 DB TX를 유지하지 않으며, TTL15분은 이 동기 파기 경계를 늦추는 유예 기간이 아니다.

현재 설계는 Data 밖 Redis/Business/local/CDN에 공개 snapshot payload를 복제·캐시하지 않는다. Business는
Data가 확정한 이번 응답을 전달할 뿐 재사용하지 않고 공개 HTTP에 `Cache-Control: no-store`를 지정한다.
다른 저장소 캐시는 원자 무효화와 반환 직전 정본 조건 검증을 같은 수준으로 증명하는 별도 설계 전까지 금지한다.
중앙 withdraw·공개 범위 writer 전수 참여, 전체 사용자 역색인, 실제 PostgreSQL 경합 검증이 없으면1769/1777의
snapshot 공개 경로를 활성화하지 않는다. 이 gate는 제품 분모·귀속·동점 정책 승인과 별개다.

## 4. 기기 측정 PUT: 실제 수집·내구 저장·CAS

요청 date는 측정한 KST 버킷의 날짜, measuredAt은 해당 관측의 UTC 시각이다. 둘을 혼동하지 않는다. 예를 들어9월11일 측정을12일에 전송해도 date는11일이다. measuredAt을 기존 reportedAt에 넣어 서버가12일로 계산하게 하면 안 된다.

| 필드 | strict 규칙 |
| --- | --- |
| minutes | authorized이면 필수0 이상 정수. 나머지 상태는 명시 null; 문자열·boolean·소수·음수 거절 |
| measurementStatus | 필수 authorized/denied/unavailable/pending. 없는 값400, 미지원 문자열422 |
| timezone | 생략 Asia/Seoul; 명시 값은 동일 문자열만 |
| measuredAt | 필수 UTC instant, 서버가 승인한 미래/과거 허용 창 검사 |
| deviceId | 필수 검증된 측정기기 식별자. 단순 FCM token이나 임의 사용자 UUID가 아님 |

각 기기의 측정 범위 최대치는 RC-D02 수집 계약에 의해 결정한다. 한 기기의 실제 KST24시간 사용량이면0~1440분을 넘길 수 없지만 기존 선택 범위 눈금900을 새 전체 OS 상한으로 고정하지 않는다. measuredAt 미래 관용치/마감 창은 RC-D04이며 기존 내기2분 상수를 복제하지 않는다. 입력에 achieved/isFinal/ownerUserId를 받지 않고 기본 true를 합성하지 않는다. 허용하지 않은 필드는400 INVALID_REQUEST다.

현재 iOS ScreenTimeModule:156~226은 로컬 하루의 선택 application/category/webDomain token을15분 눈금으로 관측하고900분 상한을 쓴다. MonitorExtension:31~59의 firedAt 타임라인도 실제 구간 전체를 측정하는 만능 원본이 아니다. 당일0분 미전송은 '측정됨0' 증거가 아니고 마지막 눈금90은 정확한90분 사용을 뜻하지 않는다. 새 화면의 샘플값을 OS 원본처럼 업로드하지 않는다.

screentimeSync:45~65의 로컬 정오→KST 전달은 UTC-3 이하에서 날짜가 밀리고 DST/여행 때 두 날짜가 접힐 수 있다. 새 어댑터는 승인된 KST 수집 범위/근사 정의를 확인해야 하며 총합만으로 구간별 사용량을 역산하지 않는다. 일치하지 않는 날을 authorized로 조용히 전송하지 않는다. 상태 선택과 지원 OS는 RC-D02/03에서 확정한다.

논리 저장은 (사용자,검증 기기,날짜,measuredAt)의 불변 관측값과 (사용자,기기,날짜)의 최신 선택 포인터, 사용자/날짜 파생 projection·정책 revision이다. 기존 daily_screen_time_stats(user,date) 유일성을 device별로 바꾸지 않는다. 실제 테이블/컬럼/마이그레이션 번호는1769 조정자가 정하며 공통 receipt/outbox는 재사용한다. 원본 관측 보관기간·PII 삭제 정책은 계정 정책과 함께 정하고 영구 보존을 약속하지 않는다.

Data TX 순서: 영향 사용자 lifecycle 잠금·활성/session generation 재검증 → 공통 receipt 선점 → 영향을 받는 섬/context를 ID 순서로 잠금 → 측정기기 session 바인딩/소유 및 기기/날짜 최신 행 → 승인된 퀘스트 projection과 outbox. 다른 명령과 공통 잠금 순서를 맞추고 섬을 잡은 뒤 새 사용자 잠금을 역순 취득하지 않는다. 세션/기기 바인딩의 구체 등록 방식은 RC-D02 승인 전 gate이며 이번5계약에 임의 등록 endpoint를 만들지 않는다. user scope가 없는 전역 deviceId 조회를 쓰지 않는다.

- 같은 키의 확정 결과는 현재 사용자·세션·기기 재생 권한 확인 후 원 data를 재생한다. 이전 measuredAt이 되었다는 이유로 원 성공을 뒤집지 않는다.
- 새 키/동일 measuredAt/동일 정규 내용은 무변경200. 같은 시각 다른 minutes/status는409 STATE_CONFLICT(field=measuredAt), 첫 확정 관측을 보존한다. 비교 시 timezone 누락과 Asia/Seoul은 동일하다.
- 더 최신 measuredAt이면 관측과 포인터를 원자 갱신하고 승인된 병합 정책으로 날짜 projection을 대체 계산한다. `old+new`로 덧셈하지 않는다.
- 더 오래된 관측은 최신 포인터/집계를 바꾸지 않는다. 해당 업로드의200 data는 그 **기기·날짜의 최신 선택 관측** date/minutes/status이며 전체 계정 병합값을 뜻하지 않는다. 무변경 결과를 receipt에 저장하고 진행/경제 부수효과는0이다. 같은 키 재생이면 그때 반환한 data가 보존된다.
- 동시 첫 insert는 DB 유일성·조건부 upsert로 승자를 하나 정하고 최신 행을 다시 비교한다. unique 예외로 rollback-only가 된 JPA TX 안에서 계속 조회하지 않는다.

키 scope는 검증 사용자+PUT+경로 date+deviceId, fingerprint는 method/path/date와 minutes/status/정규 timezone/measuredAt/deviceId를 포함한다. requestId·자격·멱등키 자체는 fingerprint에서 제외한다. expectedVersion을 새로 요구하지 않으며 기기별 measuredAt/CAS가 순서를 담당한다.

## 5. 정산·릴레이·legacy 공존

측정 원본·projection 변경·receipt·후속 내구 작업은 한 Data TX로 보관한다. 해당 섬의 quest 진행이 실제 바뀌면 정본 `quest.progress.updated`를 그 projection version과 함께 생산한다. 임의 questId/occurrenceId를 만들어 모든 주민에게 측정값을 방송하지 않는다. 아직 계산이 비동기이면 기존 내구 전달을 통해 실제 quest 소유자가 처리하고 확정된 변경 TX에서 공개 사건을 만든다. 단순 메모리 ApplicationEvent만으로 원본 커밋 후 후속 작업을 잃지 않게 한다.

공개 사건은 schemaVersion/eventId/type/islandId/aggregateVersion/occurredAt/payload의7필드, payload의 questId/occurrenceId/version은 실제 공개 진행 정본이다. 개인 raw measurement/deviceId/선택 앱 목록을 사건에 넣지 않는다. Data 내부 결과의 events는 완성된 공개 봉투 배열이고 저장 outbox10필드 표현과 구분한다. 원본 upload 공개 응답에는 events를 추가하지 않는다.

기존 ScreenTimeService.saveScreenTimeTx는 reportedAt으로 날짜를 정하고 achieved/isFinal에 따라 개인 보상을 준다. 새 PUT이 이를 alias 호출하거나 achieved=true를 합성하면 안 된다. legacy device 없는 보고는 별도 provenance로 보존하고 새 기기들의 raw/latest를 덮거나 fake device를 생성하지 않는다. 어떤 쪽이 공용 사용자/날짜 projection을 소유할지는 RC-D02/05 이관 정책으로 정해 writer 혼재 전에 검증한다. 알 수 없는 legacy 범위를 새 정확 측정에 포함하지 않는다.

집중 finish가 이미 세션별 보상/날짜 기여를 반영한다. 새 집계 재구축/랭킹 새로고침/relay 재전달은 FocusService.recordCompletion 또는 기존 screen goal 지급을 호출하지 않는다. 퀘스트 회차 지급은 해당 도메인의 유일성/receipt/TX가 소유하며 screen PUT 성공만으로 보상을 발생시키지 않는다. 표시 정정과 이미 마감된 보상 변경은 RC-D04 별도 결정이다.

탈퇴와 수집은 사용자 lifecycle 동일 잠금 경계에 참여한다. §3의 snapshot 공통 lifecycle 배타 잠금을 사용자 잠금보다 먼저 취득하고, 영향 snapshot payload 파기/무효화를 중앙 withdraw와 같은 TX에서 수행한다. raw/latest/projection/receipt·내구 payload·snapshot의 사용자 PII를 계정 파기 전수표에 포함하고 지연 업로드/재전달이 부활시키지 않게 한다. 범용 로그에 user가 보낸 본문·deviceId·토큰·앱 목록을 남기지 않는다.

## 6. 오류·검증·실제 근거

공통 실패 `{error:{code,message,field,retryable},requestId}`를 사용한다. 409의 선택 current는 `{version,resource}`형 공개 DTO만 허용한다. 이 측정 timestamp 충돌에는 원본에 공개 version이 없으므로 current를 발명하지 않고 생략한다. 서버 X-Request-Id는 현재 시도값이다.

| HTTP/code | 조건 / field | retryable |
| --- | --- | --- |
|400 INVALID_PARAMETER / INVALID_REQUEST|query/JSON 타입·누락·timezone·금지 필드|false|
|400 INVALID_IDEMPOTENCY_KEY / INVALID_CURSOR|키·cursor 형식/서명/범위|false|
|401 UNAUTHORIZED|사용자 자격|false|
|403 FORBIDDEN / FACILITY_LOCKED|비주민·기기 소유 없음 / 회관 미해금|false|
|404 USER_NOT_FOUND / GROUP_NOT_FOUND|본인/섬 부재, 기존404 공개 매핑 등록을1769에서 확인|false|
|409 STATE_CONFLICT|동일시각 다른 측정, field=measuredAt|false|
|409 IDEMPOTENCY_KEY_REUSED / CURSOR_EXPIRED|같은 키 다른 본문 / snapshot 만료·파기|false|
|409 REQUEST_IN_PROGRESS|동일 명령 진행중, Retry-After:1|true|
|422 OUT_OF_RANGE|기간·범위·허용값·측정 데이터|false|
|429 RATE_LIMITED / 503 SERVICE_UNAVAILABLE / 504 UPSTREAM_TIMEOUT|공통 일시 실패, 명령은 같은 키·본문|true|
|502 UPSTREAM_CONTRACT_ERROR / UPSTREAM_AUTH_FAILED / 500 INTERNAL_ERROR|계약·서비스 인증·결함|false|

그 외405/413/415/빈406은 A0를 따른다. measurementStatus 미지원과 권한/수집 불가는 다르며 후자는200 상태 데이터다. 알려진 Retry-After와 유한 재시도만 사용한다.

main529a 근거(기존 동작과 신규 요구를 구분):

- [DailyFocusStat:28](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/focus/repository/domain/DailyFocusStat.java#L28): user/date 유일, islandId 없음. 개인 합계를 섬 기여로 직접 사용 불가.
- [StatsService:457](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/stats/service/StatsService.java#L457): KST 반열림·현재시각 클램프. 신규 ACTIVE 계산은 PR743 순수 구간 집계와 합류.
- [ScreenTimeService:89/108](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/screentime/service/ScreenTimeService.java#L89): 기존 user/date upsert와 새 TX 재시도, measuredAt CAS/기기 축 없음.
- [ScreenTimeRequest:15](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/screentime/dto/ScreenTimeRequest.java#L15): 기존 achieved/actualMinutes/reportedAt/isFinal 입력은 신규5필드가 아님.
- [ScreenTimeModule:156/205](https://github.com/OneOrThree/phone/blob/529a396/app/app-dev/ios/gromo/ScreenTimeModule.swift#L156), [Monitor:31](https://github.com/OneOrThree/phone/blob/529a396/app/app-dev/ios/GromoScreenTimeMonitor/DeviceActivityMonitorExtension.swift#L31), [sync:45](https://github.com/OneOrThree/phone/blob/529a396/app/app-dev/src/services/screentimeSync.ts#L45): 실제15분 선택 범위 측정과 로컬 날짜 한계.

1769 순서: 정책/기기 바인딩 확정 → ACTIVE/귀속 기반·legacy 호환 통합 → strict DTO/기기 원본/CAS → 승인 projection/내구 후속 → 조회 snapshot/cursor → 실제 PostgreSQL·HTTP·OS fixture 회귀. BFF는 이 재료가 준비된 뒤 구성한다.

검증 사례는 KST 자정/월경계/초 잔여, 진행→완료 중복0, 전체합의 페이지 독립, 같은날 A/B 기기와 시간 역순/동일시각 충돌/미래시각, 실제0/권한없음/결측·부분 기간, DST 두 날짜 접힘, 탈퇴와 저장 양방향 경합, legacy/new 동시 보고, receipt/outbox rollback·재전달 부수효과0, cursor 위조/타인/기간변조/만료/권한상실이다. snapshot 생성/페이지 반환과 포함된 타인의 탈퇴를 각 방향으로 경합시켜, 탈퇴 선커밋 후 이전 payload 반환0·조회 선확정 시 탈퇴 대기·역색인/파기 rollback 원자성·현재 페이지 밖 기여자 파기도 전체 snapshot 무효화를 확인한다. 서버 fixture만으로 OS 정확성 검증 완료라 하지 않으며 실제 지원 OS·선택 범위의 측정 근거를 남긴다.

관측 로그는 서버 requestId/commandId/eventId, operation/phase/outcome/durationMs·정책 revision만 연결한다. 역순/동일시각 충돌·측정 결측·snapshot 만료·relay 지연을 유한 label로 계측한다. 이 문서 작업에서는 빌드·실서비스 테스트를 실행하지 않는다.
