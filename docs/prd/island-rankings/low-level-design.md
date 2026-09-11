# 주간 랭킹 상세 설계

[정책](policy.md)의 분모·동점·참가·진행분·마감 규칙이 승인되기 전 이 문서를 임의 운영 기본값으로 실행하지 않는다. 기간과 snapshot·권한·페이지 경계는 독립 기술 계약이다.

## 1. 원본 요청·응답 보존

다음은 v0.3-proposed 원본이며 성공200이다. GET 요청 예시는 query를 나타내고 body가 아니다. 첫 cursor:null은 query 생략이며 문자열 null을 받는 규칙이 아니다.

### GET `/islands/{islandId}/rankings/members`

원본 `/v1/islands/{islandId}/rankings/members`.

요청:

```json
{
  "week": "2026-W37",
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "eligibility": "eligible",
    "items": [
      {
        "rank": 1,
        "userId": "minji",
        "name": "민지",
        "catColor": "ginger",
        "focusSeconds": 1320
      }
    ],
    "myRank": 4,
    "nextCursor": null
  }
}
```

### GET `/rankings/islands`

원본 `/v1/rankings/islands`.

요청:

```json
{
  "week": "2026-W37",
  "cursor": null
}
```

응답:

```json
{
  "data": {
    "items": [
      {
        "rank": 1,
        "islandId": "soda",
        "name": "소다 섬",
        "averageFocusSeconds": 18000
      }
    ],
    "nextCursor": null
  }
}
```

## 2. 채택 스키마·기간·인가

| API | query | data |
| --- | --- | --- |
| members | week 필수, cursor 선택, limit 선택(기술 확장) | eligibility,items[{rank,userId,name,catColor,focusSeconds}],myRank nullable,nextCursor,**asOf** |
| islands | week 필수, cursor 선택, limit 선택(기술 확장) | items[{rank,islandId,name,averageFocusSeconds}],nextCursor,**asOf** |

asOf는 승인된 추가 UTC instant다. 원본 예시를 변경하지 않고 실제 data에 `"asOf":"2026-09-11T09:10:00Z"`를 추가한다. 이 값은 현재 주 실시간 점수를 포함하자는 제품 결정이 아니다. 완료분만 사용하는 정책도 어떤 snapshot을 관측했는지는 필요하다. 실제 snapshot ID와 정책 revision은 서버/opaque cursor 내부에 있다.

week는 `YYYY-Www` 형태의 ISO week-based-year이며 누락/중복/구문 오류400 INVALID_PARAMETER(field=week), 존재하지 않는53주 등 달력 범위 오류422 OUT_OF_RANGE다. 예: 2026-W37은 KST 2026-09-07 00:00 포함~09-14 00:00 제외, UTC로09-06T15:00:00Z~09-13T15:00:00Z다. 2020-W53은 KST2020-12-28~2021-01-04이며 calendar-year2021의 첫 주라고 다시 명명하지 않는다. UTC 날짜나 서버 기본 timezone으로 주를 자르지 않는다. 미래/허용 과거 주의 공개 범위는 RK-D04 결정과 별도로 명시할 때까지 활성화 gate다.

응답 ID는 UUID36이며 원본 minji/soda는 실제 식별자로 허용하지 않는다. name/catColor는 계정·섬 공개 projection 정본이다. 6색 목록이나 빈 이름의 제품 초기값을 여기서 만들지 않는다. seconds는 음수가 아닌 JS 안전 정수, rank는 양의 정수다. averageFocusSeconds의 출력 정수/소수·반올림은 RK-D06 미결이므로 원본18000만으로 내림 정수 정책을 확정하지 않는다. 산술은 충분한 정밀도의 정수합/분모로 계산하고 overflow를 검사한다.

members GET는 검증 사용자와 경로 섬의 현재 활성 membership·tower를 확인한다. islands GET는 검증 사용자에서 Data의 currentIslandId/contextVersion을 한 번 확정해 tower와 참가 조건을 검사한다. 이 context는 cursor 범위에도 고정한다. 앱 헤더의 X-User-Id/currentIslandId나 cursor에 적힌 옛 섬을 권한으로 신뢰하지 않는다. 섬 이동 후 옛 cursor의 context 불일치는400 INVALID_CURSOR, 현재 시설/소속 부재는403이다. 존재하지 않는 본인/섬은 기존404 계약을 보존한다.

시설 미해금403 FACILITY_LOCKED는 확정이다. 최소2명의 인원 모수/시점과 비적격 eligibility enum/응답은 정책 미결이며 문서의 추천200 응답을 승인 없이 활성화하지 않는다. 섬 간 조회의 참가 조건과 노출할 섬의 참가 조건도 별개로 검증한다. 1인 섬이 랭킹 비적격이어도 섬 발견 endpoint의 원래 접근 규칙을 바꾸지 않는다.

원본 설명의 썸네일은 JSON에 필드가 없다. 내부 섬 엔티티·비공개 초대 자격·전체 외양을 통째로 추가하지 않는다. 별도 공개 썸네일 확장이 승인되거나 기존 승인된 화면 집계 자산으로 표현될 때 연결하며 RK-D06으로 추적한다.

## 3. 주간 점수·분모·순위: 확정 기술과 미결 함수

공통 입력은 세션별 고정 islandId와 ACTIVE 날짜 기여, 승인된 주차 cohort/가입 이력, 같은 관측 시각 asOf, 확정된 rankingPolicyRevision이다. 개인 전체 이력을 사용할지 섬 귀속 기여를 사용할지는 RC-D01/RK-D05 답변을 기다린다. 세션 islandId가 원본에 없는 legacy 기록은 현재 멤버십으로 추정해 백필하지 않는다.

```text
window = [KST ISO-week Monday 00:00, next Monday 00:00)
memberScore(u) = approvedAttributionAndLivePolicy(u, window, asOf)
N = sum(memberScore for approved numerator cohort)
D = approvedDenominator(cohort, membershipIntervals, window)
average = exact(N / D), only if approved D > 0
rank = approvedTiePolicy(scores)
```

N과 D의 모수·가입 처리·부분 주 계산은 같은 policy revision에서 나온다. 먼저 각 주민 시간을 분으로 내리고 평균내지 않는다. 표시 소수 처리·동률 판단에 반올림을 쓸지 여부도 RK-D02/06에서 함께 결정한다. 내부 정렬 점수와 표시값이 다른 순위를 만들지 않도록 같은 승인 기준으로 equality와 order를 정의한다. 분모0을0점 참가로 자동 전환하지 않는다.

진행분을 포함하기로 승인하면 PR743의 열린 ACTIVE 구간을 asOf로 닫아 합산한다. pause는 증가0, resume 이후만 증가하고 finish가 일집계로 이동하는 순간 완료+진행 이중 합은0이다. 기존 now-startedAt 식을 쓰면 휴식이 가산되므로 재사용하지 않는다. 완료분만으로 승인하면 진행분은 정렬·표시·myRank 모두에서 제외한다. 기존 리그처럼 top에는 live, 페이지에는 settled를 혼용하지 않는다.

같은 점수의 페이지 순서를 안정화하려고 UUID ASC 보조키를 사용한다. 이것은 동점자의 rank를1,2로 구분하자는 결정이 아니다. 공동1위/다음3위 등 순위 함수는 RK-D02 승인을 요구한다. myRank는 해당 페이지의 위치가 아니라 **전체 같은 snapshot 모집단**에서의 본인 순위다. 참여하지 않는 본인에만 null을 쓰며 없다는 이유를0위로 만들지 않는다. 어떤 경우 미참가인지는 RK-D01이 정한다.

중도 가입·탈퇴·강퇴·재가입·1인→2인 전환은 현재 GroupMember 한 행만으로 복원할 수 없다. 주차 cohort와 가입/이탈 구간 또는 검증된 불변 기여를 논리 저장해야 한다. 어떤 이력을 저장할지와 개인정보 파기는 소속·계정 설계와 합류하고 새로운 물리 migration 번호는 구현 조정자가 배정한다. 강퇴 뒤 모수를 줄여 점수를 올리는 조작을 정책 결정 테스트에 반드시 넣는다.

## 4. immutable snapshot과15분 cursor

동적 정렬에 keyset만 붙여서는 페이지 사이 점수 변경으로 생기는 누락/중복을 막을 수 없다. 첫 페이지는 승인된 policy/cohort에 대해 Data 단일 SELECT 또는 REPEATABLE READ에서 점수·순위·myRank·평균 분모·공개 행·asOf를 고정한 immutable snapshot을 만든다. 이후 HTTP는 같은 저장 결과를 읽는다. HTTP 사이 DB transaction을 계속 열어두지 않는다.

논리 snapshot은 임의의 snapshotId, kind,week,policyRevision,asOf,참가/cohort revision,검증 주체/context 범위 digest,만료시각,정렬된 공개 결과/순위 인덱스로 구성한다. 실제 저장소는 Data의 제한된 projection 저장을 사용하고 Business 메모리에만 둬 인스턴스마다 다른 표를 만들지 않는다. 1769/1777이 함께 구현할 Data 불변 조회 snapshot 공통 모듈을 사용한다. 기준 main의 LeagueRankSnapshot은 사용자·날짜별 rank를 덮어쓰는 저장소이므로 이 불변 페이지 정본을 대신하지 못하며, 공통 HMAC cursor 역시 snapshot 보관소가 아니다. 일관된 조회 결과를 snapshot/역색인과 함께 저장하는 TX는 쓰기 가능해야 하고 readOnly TX에서 INSERT하지 않는다. 서비스별 새 HTTP 클라이언트는 만들지 않는다. DB 원본을 asOf로 재조회하면 같은 내용일 것이라고 가정하지 않는다.

cursor는 A0의 HMAC 서명·별도 키/키회전 규약을 따른다. 내부 snapshotId/kind/week/scope/currentIsland context/policyRevision/limit/정렬/마지막 결정적 경계/발급·만료를 묶는다. 원문 사용자명·민감 ID·점수 조합을 URL에 노출하지 않도록 snapshot 내 비민감 행 경계 참조를 쓸 수 있다. 서명은 암호화가 아니므로 원시 개인정보를 넣지 않는다. 다음 페이지의 현재 인가와 cursor 무결성은 각각 검사한다.

- 첫 limit 기본30,1~100. 페이지 크기도 scope digest에 묶는다. cursor 없이 새 조회하면 새 snapshot을 선택하며 이전 페이지와 합치지 않는다.
- 발급 시점 기준15분 후 만료. 다음 페이지를 읽어도 연장하지 않는다. snapshot은 적어도 그 cursor 유효기간 동안 유지하되 개인정보 파기·인가 관련 무효화가 우선한다.
- 만료 또는 snapshot 조기 파기면409 CURSOR_EXPIRED(retryable=false,field=cursor). 새 첫 페이지로 시작한다. 조용히 최신 표로 넘어가지 않는다.
- 서명/사용자/week/kind/context/limit 불일치는400 INVALID_CURSOR. 조회자 비활성404 USER_NOT_FOUND, 현재 소속/시설 상실403이 우선하며 cursor 자체가 과거 인가를 유지하지 않는다.
- included user의 PII 파기나 공개 범위 변화로 원 snapshot을 내릴 수 없으면 전체 해당 snapshot을 무효화한다. 일부 행만 삭제하고 순위/분모는 옛값으로 남겨 새 표처럼 전달하지 않는다. 사용자 역색인과 탈퇴 파기 작업을 연결한다.
- snapshot TTL은 조회 기술 수명이고 과거 주 결과 보관/마감 수정 정책과 다르다. 현재 주 snapshot 갱신 주기·과거 주 final cutoff는 RK-D03/04에서 확정한다.

권한 검사 이후 추가 멤버십 변화가 생길 수 있으므로 snapshot 생성/조회에서 정책이 요구하는 lifecycle/context 일관성을 확보한다. Redis 캐시에 공개 결과를 두더라도 현재 사용자/시설 판정을 생략하지 않고, 같은 snapshot identity로만 읽는다. cache miss를 현재 DB 재계산으로 채우지 말고 저장 정본 또는 CURSOR_EXPIRED로 처리한다.

## 5. 저장·부수효과·계약 경계

집중 날짜 기여는1764 종료 TX가 세션별 유일성으로 만든다. 랭킹 projection은 그 정본의 순수 투영이며 과거 결과 재구축에도 기존 FocusService.recordCompletion/League 보상 정산을 재실행하지 않는다. 소속/이력·지연 완료 보정이 점수 projection을 바꾸면 source ID+source version으로 멱등 적용하고 이미 확정된 주차 처리 여부는 RK-D04 정책을 따른다. 같은 사건 재전달로 점수를 두 번 더하지 않는다.

GET은 읽기 응답 외의 경제 효과0이다. snapshot 생성에는 지갑/보상 원장 호출이 없고 새로운 realtime ranking 이벤트를 원본14종에 몰래 추가하지 않는다. 필요한 화면 새로고침은 이미 승인된 집중/섬 상태 이벤트와 조회를 연결하되 GET이 사건 producer가 되지 않는다. 만약 이후 실시간 순위 사건을 추가하려면 별도 도메인/실시간 계약 개정이 필요하다.

Business는 검증 주체/서버 requestId/하나의 current context/deadline과 cursor 검증 결과를 기존 내부 클라이언트로 전달한다. Data는 모집단과 집계 정본을 소유한다. 필수 호출 timeout을 빈 랭킹200으로 바꾸지 않는다. 조회마다 주민별 다른 서비스 HTTP를 호출하는 N+1 없이 한 집계 DTO를 반환한다. 신규 profile 색상·시설·소속 기반이 아직 main에 없으므로 mock값을 실제 랭킹으로 포장하지 않는다.

## 6. 오류와 검증

실패는 `{error:{code,message,field,retryable},requestId}`. cursor 만료409에 임의 최신 순위 current를 넣지 않고 새 조회를 유도한다. 기존 코드를 등록 없이502로 바꾸지 않도록1777에서 실제 상류 조합을 대조한다.

| HTTP/code | 의미 | retryable |
| --- | --- | --- |
|400 INVALID_PARAMETER|week/cursor 외 query 형식·누락·중복|false|
|400 INVALID_CURSOR|서명·scope·week·context·limit 불일치|false|
|401 UNAUTHORIZED|사용자 인증 실패|false|
|403 FORBIDDEN / FACILITY_LOCKED|현재 소속/참가 접근 불가 / tower 미해금|false|
|404 USER_NOT_FOUND / GROUP_NOT_FOUND|본인·섬 부재; 기존404 공개 등록/명시매핑 검증|false|
|409 CURSOR_EXPIRED|15분 만료·snapshot 파기, field=cursor|false|
|422 OUT_OF_RANGE|없는 ISO 주차·limit 범위|false|
|429 RATE_LIMITED / 503 SERVICE_UNAVAILABLE / 504 UPSTREAM_TIMEOUT|공통 일시 제한·필수 집계 실패|true|
|502 UPSTREAM_CONTRACT_ERROR / UPSTREAM_AUTH_FAILED / 500 INTERNAL_ERROR|잘못된 집계 DTO·서비스 자격·결함|false|

빈 적격 집합의 items=[]와 비적격 응답은 같지 않다. myRank=null도 시스템 장애를 숨기는 대체값으로 쓰지 않는다.405/413/415/빈406 등 일반 경계는 A0를 따른다.

main529a 실제 코드 근거:

- [LeagueWeek:11/35/60](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/league/support/LeagueWeek.java#L11): KST 월요일 경계와 동일 now 주입은 재사용. ISO week query는 추가 검증 필요.
- [LeagueRankingQueryRepository:45](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/league/repository/LeagueRankingQueryRepository.java#L45): 실제 daily_focus_stats 합산이지만 섬 귀속 JOIN 없음.
- [같은 쿼리:124/146/170](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/league/repository/LeagueRankingQueryRepository.java#L124): live now-start와 top 정렬, settled keyset은 새 ACTIVE 휴식/불변 snapshot을 보장하지 않음.
- [LeagueService:148](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/league/service/LeagueService.java#L148): i+1은 공동순위 정책이 아님.
- [DailyFocusStatRepository:165/220](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/focus/repository/DailyFocusStatRepository.java#L165): 기존 평균의 행 존재 사용자 분모·전체기간 그룹 합을 새 주차 cohort로 사용하지 않음.
- [GroupMember:94~114](https://github.com/OneOrThree/phone/blob/529a396/server/data-api/src/main/java/com/oneorthree/phone/group/repository/domain/GroupMember.java#L94): 재가입 복구는 전체 소속 이력을 보존하지 않음.

1777 구현 순서: RC-D01/랭킹 정책 결정 → 고정 기여·cohort 및 legacy 이관 → 순수 집계/순위 함수 → immutable snapshot·인가된 cursor → 공개 HTTP → 실제 PostgreSQL·경합 검증. BFF는 뒤에서 이 재료를 사용한다.

필수 회귀는 ISO week-year/자정/휴식, 진행→완료 중복0, 페이지 경계 동점·myRank 전체순위, 분모0/0초 주민/중도가입/강퇴·재가입/1→2→1, 개인전체와 섬귀속 이동, 같은 snapshot에 완료·이름변경이 끼어도 페이지 안정, cursor 위조·타인·다른주·scope·limit·만료, 다음 페이지 전 탈퇴/시설·소속 상실·PII 파기, 과거 cutoff 뒤 지연반영, relay 중복/재집계 보상0이다. 미결 정책은 승인된 fixture 표가 생긴 뒤 테스트 통과를 판단한다.

로그는 requestId, snapshot lookup outcome, operation, durationMs, policyRevision, bounded counts로 남기고 cursor 원문·사용자명·전체 결과·토큰을 남기지 않는다. snapshot 생성시간/보관량/만료율·집계 지연·분모 이상을 유한 label로 계측한다. 빌드·실서비스 검증을 이 문서 작성의 완료 증거로 주장하지 않는다.
