# 공통 API 계약 — 정책과 결정 장부

GROMO-1750 · 2026-09-12 · [색인](README.md) · [LLD](low-level-design.md)

이 문서에서 **채택**은 이번 신규 API 구현의 기준이라는 뜻이다. 이미 배포된 코드의 동작이나 미답변 제품 정책이 확정됐다는 뜻이 아니다. 사용자 결정과 기존 아키텍처 정본을 바꾸는 권한은 이 문서에 없다.

## 공통 정책

| ID | 채택 규칙 | 근거·범위 |
| --- | --- | --- |
| P01 | 신규 Business 경로에는 `/api`·`/v1` 접두어 없음. 기존 Data/chat 공개 계약 유지 | 사용자 결정. 새로운 URI가 자동으로 기존 URI 폐기를 뜻하지 않음 |
| P02 | JSON 성공 `{data:...}`. 빈 단건 `data:null`, 목록 `{items:[],nextCursor:null}`. PNG·파일 스트림·관리 Actuator·기존 호환 경로는 JSON 성공 봉투 대상 제외 | HTML 제안 + 바이너리 보존 결정. 신규 JSON은 데이터 없는 성공도200+data:null이며204로 바꾸지 않음 |
| P03 | JSON 실패는 `error.code/message/field/retryable` 4필드와 top-level `requestId`. 409에만 선택 top-level `current` 허용 | 신규 외부 계약. `current`는 인가된 공개 자원 DTO와 최신 version이며 DB행·내부정보·타인 데이터 금지 |
| P04 | 앱 소유 UUID Idempotency-Key, scope는 검증 사용자+작업+키. 확정된 같은 본문 재시도는 현재 재생 권한·응답 계약 호환성을 검사한 뒤 원 결과·HTTP 상태 재생, 저장된 처리중/확정 키의 다른 본문409 | 아키텍처 ㉼. **대상은 LLD 표로 열거**, 모든 POST나 모든 인증 경로에 일괄 적용하지 않음 |
| P05 | 키는 정확한 UUID 문자열36자(v4/v7 생성 권고), 누락/형식 오류400. 대소문자 UUID는 동일 값으로 정규화. 같은 키 새 의도 재사용 금지 | 신규 키 필수 대상만. 내부 1659 기본키150자 상한/접미단계 규약과 호환. 기존 API optional 키를 소급 변경하지 않음 |
| P06 | 확정 receipt는 초기 구현에서 자동 TTL 삭제하지 않음. 보존·키 폐기 정책 승인 전 GC 금지 | 응답 유실 후 오래된 키가 새 실행으로 바뀌는 결함 방지. 영구·무제한 운영 보관 약속은 아님. 보존 변경 때 만료 receipt 거절/키 재사용 금지/PII 파기를 함께 설계 |
| P07 | expectedVersion은 LLD 열거 자원에만 필수. 동일 키의 성공 재생을 버전 재검사보다 먼저 수행 | 응답 유실 후 원 요청의 오래된 version이 이미 성공한 명령을409로 만들면 안 됨 |
| P08 | 커서는 불투명 문자열, nextCursor=null이면 끝. 사용자·자원·필터·정렬이 다른 곳에 재사용 불가 | 검색/탭/기간 변경 시 앱 초기화. 잘못된 커서를 첫 페이지로 조용히 대체하지 않음 |
| P09 | 외부 X-User-Id는 모든 헤더 접근에서 제거. 내부 요청은 검증 subject로 딱 한 번 새로 설정 | 아키텍처 ㉸. Authorization 등 앱 헤더 일괄 복사 금지, 서비스토큰+audience·메서드/경로 허용목록 적용 |
| P10 | Business는 DB 없이 인증·정책 조합·화면 읽기를 담당. 돈·보상·소유·정산 불변식은 Data 단일 원자 명령에서 완료 | 아키텍처 A4/A9. HTTP 여러 쓰기를 순서대로 호출하는 분산 TX 흉내 금지 |
| P11 | 화면 첫 조회는 BFF 1콜. 사용자·현재 섬 context를 한 번 확정하고 독립 읽기를 전체 deadline 아래 병렬 조합 | 사용자 결정. 여러 HTTP 결과를 같은 DB snapshot이라고 부르지 않음. 버전 정합성이 필요한 조합은 Data snapshot 계약 필요 |
| P12 | 전체 deadline 안에서 발생한 선택 조각의 개별 일시 장애만 null 허용. 전체 예산 소진은 504 우선이며 인증·인가 실패·상류 계약 위반도 전체 오류 | 권한 상실·잘못된 DTO를 데이터 없음으로 숨기지 않음. 공개/방문 화면에는 권한 없는 조각을 호출 자체에서 제외 |
| P13 | requestId는 서버 생성 UUID, 요청마다 새 값. 응답 X-Request-Id와 오류 본문 requestId가 일치 | 앱 제공 ID/키/URL/토큰으로 생성하지 않음. 재생 receipt에는 원 결과·상태만 있고 현재 requestId·Retry-After·cookie는 재생하지 않음 |
| P14 | 집중 쓰기는 REST, 집중/휴식 구독·emote는 STOMP. 공통 HTTP 봉투가 STOMP 이벤트 봉투를 덮지 않음 | 사용자 결정. 토픽·schemaVersion을 포함한 7필드 이벤트·개인 수신자·만료는 실시간 설계 1754 소유 |
| P15 | 시각 전달은 UTC instant. 날짜 집계는 KST이며 timezone 입력 5종은 Asia/Seoul만 허용, 누락 시 같은 값으로 정규화 | 임의 사용자 타임존 지원을 이 문서에서 신설하지 않음. 별도 제품 결정 시 기존 저장/집계/조회 정책까지 함께 검토 |

P04의 결과 재생은 확정 receipt가 있는 요청을 대상으로 한다. 실행 전 검증4xx로 rollback되어 receipt가 남지 않은 요청은 결과 재생 보장 밖이다. 앱은 입력 수정·버전 재확인으로 의도가 바뀌면 이 경우에도 새 키를 사용한다. 이미 저장된 처리중/확정 scope/key와 다른 본문은409로 거절한다.

P06은 저장 비용을 숨기지 않는다. receipt 건수·바이트 증가를 계측하고 보관량 알림을 둔다. 이름·메시지·원문 토큰 등 민감 데이터를 중복 저장하지 않도록 도메인별 최소 결과를 설계한다. 탈퇴 시 기존 PII 파기 정책이 우선한다. 탈퇴한 사용자의 receipt를 응답 재생 때문에 복구하거나 개인 응답을 보존하지 않는다. 비활성 계정은 일반 재생을 거절한다. 계정 설계 1756의 신규 계약은 탈퇴 후404 USER_NOT_FOUND, 위조·만료 자격은 401이며 탈퇴 완료 증거도 범용 재생으로 열지 않는다.

계정 비활성과 **활성 사용자의 자원 권한 소멸**은 구분한다. 현재 권한이 있으면 승인된 원 결과를 재생할 수 있다. leave/host-transfer 완료 때문에 소속·관리 권한을 잃은 활성 본인에게는, 원 명령의 주체·operation scope·fingerprint가 일치하고 해당 도메인이 명시한 경우에만 비민감 최소 완료 증거를 제한 재생한다. 저장 응답 전체·관리자 정보·초대 자격을 돌려주거나 현재 권한 검사를 전역으로 우회하지 않는다. 제한 증거 계약이 없는 도메인은 현재 접근 정책의 403/404로 거절한다.

모든 확정 receipt에는 `contractVersion`을 저장한다. 이 버전은 자원 version이나 이벤트 schemaVersion과 다르며, 저장 결과 형식과 원 요청의 정규화 규칙을 식별한다. 구버전 reader와 검증된 순수 응답 변환으로 현재 공개 계약을 충족할 때만 재생한다. 지원하지 않는 버전은 409 `STATE_CONFLICT`(retryable=false, field=null)로 거절하고 원 명령을 다시 실행하지 않는다. 상세 호환·파기 규칙은 LLD의 receipt 계약을 따른다.

## HTTP 상태·외부 오류 코드

아래 이름은 **신규 외부 계약의 구체 상수**다. 구현1751의 enum/계약 테스트가 이 표와 같은 이름·상태를 고정한다. 기존 Data/chat의 상수는 변경하지 않고 외부 어댑터에서 매핑한다. 도메인 코드가 추가되면 해당 정책·계약 테스트를 함께 추가하며 전부 `INVALID_REQUEST`로 접지 않는다. 1659의 기존 compat 경로는 기존 상류 domain status/code 보존 계약을 유지한다. 신규 경로는 등록된 domain status/code를 대조해 동일 이름을 보존하거나 명시한 외부 코드로 매핑하며, 미등록 code·status 조합은502 `UPSTREAM_CONTRACT_ERROR`다. 신규 매핑표를 기존 compat에 소급 적용하지 않는다.

`retryable=true`는 **조건을 바꾸지 않고 다시 시도할 가치가 있는 일시 실패**다. 쓰기는 반드시 같은 키·본문으로, `Retry-After`가 있으면 기다린다. false는 영원히 불가능하다는 뜻이 아니라 입력 수정·재인증·재조회·사용자 재확인이 먼저라는 뜻이다. 재시도는 한도를 두며 앱이 무한 루프를 만들지 않는다.

| HTTP | code | retryable | field / 복구 |
| --- | --- | --- | --- |
|400|INVALID_REQUEST|false|깨진 JSON·필수 필드 누락·타입 오류. 가능한 공개 필드 경로, 없으면null|
|400|INVALID_PARAMETER|false|지원하지 않는 timezone 등 명시한 입력 정책 위반. field는 해당 입력 이름|
|400|INVALID_IDEMPOTENCY_KEY|false|필수 키 누락/UUID 형식 오류. field=`Idempotency-Key`|
|400|INVALID_CURSOR|false|서명/형식/사용자·자원·필터 불일치. field=`cursor`, 현재 필터로 처음부터 조회|
|400|UNSUPPORTED_PROVIDER|false|field=`provider`, 지원 집합 밖 또는 해당 provider 어댑터 미구성. 기존 AuthErrorCode의400을 보존; 지원 provider의 credential 조합 유효성422와 구분|
|401|UNAUTHORIZED|false|없거나 위조·만료된 사용자 자격. 재인증 후 별도 시도. 내부 서비스토큰 거부를 이 코드로 오인시키지 않음|
|401|REFRESH_TOKEN|false|field=null, refresh 및 RT-only logout의 기존 RT 타입·서명·만료·해시 검증 오류 보존|
|401|KAKAO_TOKEN / APPLE_TOKEN / GOOGLE_TOKEN / LINE_TOKEN / INSTAGRAM_TOKEN / FACEBOOK_TOKEN|false|field=`provider`, 신규 로그인의 제공자 자격 검증 실패. 우리 AT 인증 오류 및 내부 서비스 인증401과 구분|
|403|FORBIDDEN|false|주체에게 행위 권한 없음. field=null|
|403|FACILITY_LOCKED|false|필요한 시설 미해금. field=null, 도메인 선행 조건 확인|
|404|NOT_FOUND|false|기존 preview 및 그룹 내부 자원 호환 의미 보존. 아래 명시한 위임·강퇴의 대상 사용자/멤버 부재에도 사용. 그 밖의 신규 대상 부재에 일괄 재사용하지 않음|
|404|USER_NOT_FOUND|false|field=null, 본인 계정 부재/탈퇴. 기존 사용자 코드 보존, 로그인 상태 정리·재인증|
|404|RESOURCE_NOT_FOUND|false|field=null, 존재하지 않는 HTTP 경로. 사용자나 섬 부재로 해석하지 않음|
|404|PRODUCT_NOT_FOUND|false|field=null, 미등록/접근 불가 상품. 상점·외양의 구체 대상 부재|
|404|SLUG_NOT_FOUND|false|field=`code`, 존재하지 않는 초대 코드. 기존 InviteLinkErrorCode의404 보존, 입력 수정/새 초대 확인. 같은 잘못된 코드 자동 재시도 금지|
|405|METHOD_NOT_ALLOWED|false|신규 공개 경로의 미지원 method. Allow 헤더 유지|
|409|VERSION_CONFLICT|false|field는 제출한 버전 필드(`expectedVersion`, `expectedWalletVersion`, `expectedProductVersion`, `expectedCostPolicyVersion`), 허용된 current 제공 후 사용자 재확인|
|409|STATE_CONFLICT|false|현재 상태에서 실행 불가. 공개 current가 안전하면 포함|
|409|SOCIAL_ACCOUNT_ALREADY_LINKED|false|field=`provider`, 다른 계정에 이미 연결된 소셜 계정으로 게스트 승격 시도. 기존 AuthErrorCode409 보존; 신규 로그인1757 활성화 전 registry/실제 HTTP 검증 필수|
|409|GUEST_ALREADY_PROMOTED|false|field=null, 같은 게스트의 승격 경쟁에서 이미 다른 계정으로 승격됨. 기존 AuthErrorCode409 보존; 신규 로그인1757 활성화 전 registry/실제 HTTP 검증 필수|
|409|ALREADY_MEMBER / GROUP_LIMIT_EXCEEDED / ROOM_FULL|false|field=null, 기존 섬 가입의 참여 중·가입 수 제한·정원 충돌. 신규 가입1760 활성 전 같은 code/status 등록과 실제 HTTP 회귀|
|409|INSUFFICIENT_FUNDS|false|잔액 부족. 같은 요청 자동 반복 금지|
|409|IDEMPOTENCY_KEY_REUSED|false|저장된 처리중/확정 scope/key에 다른 본문. 일반 명령 field=`Idempotency-Key`, 메시지는 field=`clientMessageId`. **기존 요청 본문·결과는 노출하지 않음**|
|409|REQUEST_IN_PROGRESS|true|같은 명령의 실행이 아직 확정 전. Retry-After:1, 같은 키·본문으로 재시도|
|409|CURSOR_EXPIRED|false|field=`cursor`, 같은 필터로 첫 페이지를 새로 조회|
|410|INVITATION_EXPIRED|false|POST `/invitations/resolve`의 만료 초대. field=`code`, 새 유효 초대를 받아 다시 해석. 같은 만료 코드 자동 재시도 금지|
|413|REQUEST_TOO_LARGE|false|바디 상한 초과. field=null, 본문 축소|
|415|UNSUPPORTED_MEDIA_TYPE|false|해당 신규 JSON 요청은 application/json 필요|
|422|OUT_OF_RANGE|false|해석 가능한 값이 길이·범위·허용값 제약 위반. field는 첫 오류 공개 필드 경로|
|429|RATE_LIMITED|true|Retry-After:양의 초. 서버가 해당 제한기의 잔여 시간을 계산|
|500|INTERNAL_ERROR|false|분류되지 않은 결함. 원문 예외/SQL 금지; requestId로 조사, 무한 자동 재시도 금지|
|502|UPSTREAM_CONTRACT_ERROR|false|잘못된 상류 DTO·미지원 오류 계약. 운영 수정 필요|
|502|UPSTREAM_AUTH_FAILED|false|서비스토큰·caller 권한 거부. 사용자 로그아웃 유도 금지|
|503|SERVICE_UNAVAILABLE|true|Redis/DB 연결·서비스 과부하·회로 열림. Retry-After는 알려진 대기시간일 때만|
|504|UPSTREAM_TIMEOUT|true|필수 호출/화면 전체 deadline 초과. 쓰기의 커밋 여부는 미확정이므로 같은 키로 복구|

후속 섬1759·집중1764는 신규 경로를 활성화하기 전에 기존 `GroupQueryService`의 `404 GROUP_NOT_FOUND`와 `FocusQueryService`의 `404 SESSION_NOT_FOUND`를 각각 같은 코드/404로 보존하거나 명시적인 공개404 매핑을 등록하고 계약 테스트로 고정해야 한다. 정상 대상 부재를 미등록502로 바꾸는 상태로 출시하지 않는다. 이 두 도메인 경로는 아직 구현 전이므로 이번 공통 enum에 모든 도메인 상수를 미리 추가하지 않으며, 매핑 구현·회귀는 해당 티켓의 진입/완료 조건으로 추적한다.

신규 섬 조회·관리·공지 어댑터가 기존 Data 경로를 연결할 때 `(403, MEMBER_ONLY)`, `(403, NOT_OWNER)`, `(403, NOTICE_FORBIDDEN)`은 공개 `403 FORBIDDEN`(`retryable=false`, `field=null`)으로 명시 매핑한다. 기준 main `529a396e5f0f88cb78c172110920e1fa6b9388a9`의 `GroupQueryService.getMembership`·`GroupMemberService.transferOwner/kickMember`·`GroupAnnouncementService.createAnnouncement`가 이 사유를 실제 반환하며 `GroupErrorCode`가 모두403을 고정한다. 1759/1762/1771의 해당 경로 활성화 전에 실제 HTTP 회귀에서 비소속·비방장·공지 권한 거절을 각각 검증한다. 잘못된 status/code 조합은 계속502이며, 내부 caller 거부를 사용자 권한 거부로 접지 않는다. legacy `/api/v1`과1659 compat는 기존 세 코드/403을 그대로 보존한다. 이 도메인 등록 의무는 아직 사용하지 않는 모든 상수를 공통 enum에 선제 추가하라는 뜻이 아니다.

위임·강퇴가 지목한 대상 사용자 부재는 요청자 계정 부재와 구분한다. 기준 main `UserQueryService.getTargetForShare`는 없거나 탈퇴한 대상에 `404 TARGET_USER_NOT_FOUND`를 반환한다. 신규 `host-transfer`와 멤버 강퇴는 이 조합 및 같은 그룹의 대상 멤버 부재 `404 NOT_FOUND`를 공개 `404 NOT_FOUND`로 명시 매핑한다. field는 위임의 `targetUserId`, 강퇴의 경로 `userId`이며 retryable=false다. 요청자 본인 부재는 계속 `404 USER_NOT_FOUND`이고, 대상 탈퇴 때문에 멀쩡한 요청자를 로그아웃시키거나502로 바꾸지 않는다. legacy/compat의 `TARGET_USER_NOT_FOUND` 원 코드도 유지한다. [PR752의 위임 어댑터](https://github.com/OneOrThree/phone/blob/9288277f9d1db3049a81aa44cabed7d66279c333/server/business-api/src/main/java/com/oneorthree/business/usecase/IslandHostTransferUseCase.java#L69)는 이 매핑을 이미 구현했지만 공개 기능은 별도 활성화 조건 때문에 기본 비활성이다. 강퇴 구현도 대상 계정 삭제·대상 멤버 이탈·요청자 부재를 구분하는 HTTP 회귀를 통과하기 전 활성화하지 않는다.

집중 종료의 기존 `409 SESSION_ALREADY_ENDED`·`409 SESSION_DISCARDED`는 legacy 경로에서 보존한다. 신규 finish는 [집중 도메인의 완료 결과 복구 계약](https://github.com/OneOrThree/phone/blob/509fe0a68dfdb6e895121efd35d032049bea8827/docs/prd/focus-rest-session/low-level-design.md#L67)에 따라 별도 구현한다. 이미 완료된 새 세션은 현재 결과 열람 권한을 확인한 뒤 원 정산 결과200을 재생하고, legacy 완료행을 새 finish 대상으로 연결하지 않는다. 기존 종료 함수를 그대로 연결한 뒤 두 정상 충돌을 미등록502로 바꾸거나 새 정산을 추정해서 지급하지 않는다. legacy와 신규의 실제 HTTP 회귀를 각각 검증하기 전 신규 finish를 활성화하지 않는다.

신규 로그인1757의 게스트 승격은 기존 `AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED`와 `GUEST_ALREADY_PROMOTED`의 **409와 코드 이름을 그대로 보존**한다. 두 코드는 기준 main AuthErrorCode:20/25와 AuthService:252/296의 실제 충돌이며 신규 경로에서 미등록502로 바꾸지 않는다. 계정 PR740의 field/retryable 의미와 함께 로그인 활성화 전 공개 registry/handler 매핑·실제 HTTP 회귀를 완료한다. 이는 후속 로그인 구현의 진입 조건이며 이번 공통 구현에 아직 사용하지 않는 enum을 즉시 추가하라는 요구가 아니다. 이미 구현된 설정 경로의 오류 집합과도 구분한다.

계정 PR740의 제공자6종 `*_TOKEN`401과 refresh/RT-only logout의 `REFRESH_TOKEN`401도 신규 해당 경로를 활성화하기 전에 같은 code/status로 등록한다. 로그인 제공자 실패를 UNAUTHORIZED로 합치거나 미등록502로 바꾸지 않으며, 내부 서비스 토큰401은 기존 UPSTREAM_AUTH_FAILED502로 유지한다. 실제 provider/RT 실패 fixture와 위조 서비스 토큰을 따로 검증한다.

도메인 사유를 추가할 때는 이 표의 의미와 충돌하지 않게 구체 코드를 추가한다. 예를 들어 `FOCUS_IN_PROGRESS`는 기존 chat409/false 코드이고 새로운 우체통에도 같은 사유가 채택되면 그 명칭을 유지할 수 있다. 세션 종료 재시도는 이미 확정된 receipt가 있으면 오류 표로 가지 않고 성공을 재생한다.

`INVITATION_EXPIRED`는 원본의 초대 만료 HTTP410을 유지하기 위해 신규 공개 오류로 등록한다. 기준 main의 `InviteLinkErrorCode`에는 대응하는 만료 상수가 없으므로 기존 `SLUG_NOT_FOUND`404를 바꾸지 않고 위 공개 표에 같은 이름·상태와 field=`code`로 등록한다. 부재404와 만료410을502로 바꾸거나 서로 합치지 않는다. 신규 내부 제공자가 이 사유를 확정해 반환할 때 Business의 등록된410/INVITATION_EXPIRED 조합으로 전달한다. 초대 TTL·재발급·승인 생략 등 미결 제품 정책을 이 오류 이름으로 결정하지 않는다.

미리보기 호환 매핑은 분리한다. `RATE_LIMITED`·`NOT_FOUND`는 유지, 요청 유효성 `INVALID_REQUEST`는400으로 유지한다. 기존 provider 실패 코드(`FETCH_TIMEOUT` 등)가 **Preview 객체의 실패 상태 데이터**이면 POST200을 유지한다. 신규 경로는 data 안에, 기존 호환 경로는 원래 직접 반환하던 객체/목록 안에 남는다. 이를 HTTP504로 바꾸지 않는다. 예외로 나오는 미리보기400의 세부 코드는 1751에서 원 코드 목록을 그대로 계약 테스트에 고정한다. 기존 `/api/v1/link-previews`는 성공 본문과 `{code,message}` 평면 오류, 기존 `/api/v1/link-previews/{id}/thumbnail` URL을 보존한다. 신규 `/link-previews`는 JSON 봉투·공통 오류·신규 `/link-previews/{id}/thumbnail` URL을 사용한다. 공유 Preview 캐시의 저장 URL을 전역 변경하지 않고 신규 응답 매핑에서만 URL을 바꾼다. PNG 성공은 양쪽 모두 image/png이며 실패는 각 경로의 오류 형식을 따른다.

406은 JSON 오류 표의 예외다. [기존 오류 규약 §4](../../conventions/error-contract.md#4-상태-매핑-규칙)에 따라 지원할 수 없는 Accept는 **406+빈 본문**으로 반환하며 서버 X-Request-Id는 유지한다. JSON을 거부한 요청을 봉투 직렬화 때문에500으로 만들지 않는다. 이 빈 응답을 data:null 성공으로 감싸지 않는다.

## 원본과 채택 계약 대조

| 원본 HTML 내용 | 이번 채택 | 출처·주의 |
| --- | --- | --- |
| `/v1/focus-sessions` 등 모든 `/v1` API | 신규 Business `/focus-sessions` 등으로 `/v1` 제거 | 사용자 결정. 원본 HTML은 수정하지 않음 |
| `POST /v1/islands/{islandId}/emotes` | 집중 중 emote는 STOMP SEND, HTTP 명령 표에서 제외 | 사용자 결정. 실제 destination은1754 정본 |
| 전송 방식 WebSocket/SSE 미선정 | STOMP+Redis fanout을 활용해 chat→realtime 확장 | 사용자 결정. 프로세스 개명은 DB명/키 이관과 별개 |
| GET focus/rest-members 초기 조회 | REST 스냅샷 유지 + STOMP 갱신 구독 | snapshot과 subscribe 사이 유실 방지는1754 시퀀스에서 정의 |
| 성공 `{data}`, 실패 error4필드+requestId | 채택, 바이너리 예외·필터 오류 경계 추가 | 공통 기술 결정 P02/P03 |
| 409이면 최신 상태를 받아 재확인 | 409의 선택 `current`에 최신 공개 자원 DTO+version | 공통 기술 결정. 새 외부 확장, 원본에 이미 있다고 주장하지 않음 |
| 변경 요청 키 UUID 제안 | LLD 적용표 대상 필수, auth·메시지·조회형 POST 예외 명시 | 모든 POST 자동 필수화 금지 |
| 명시하지 않은 자원에 무조건 version 제출하지 않음 | 원본 expectedVersion 8개+구매 expectedWalletVersion 1개를 원본 표로 유지 | 아래 상점 한정1개와 건설 한정1개 기술 개정을 별도로 구분, 원본9+상품1+비용1=총11개 제출 축 |
| 구매 body의 productId+expectedWalletVersion | expectedProductVersion 추가 필수, 상품 정의 변경 시409 VERSION_CONFLICT | 2026-09-12 D18·상점 설계1780/PR742에서 이미 채택한 가격 동의 보호 계약의 공통 문서 반영 |
| 건설 POST body의 buildingId+expectedVersion | expectedCostPolicyVersion 추가 필수, GET construction-options에 costPolicyVersion 추가 | 2026-09-12 건설 설계1766의 승인된 가격 동의 보호. 차감 없는 construction-target PUT에는 추가하지 않음 |
| POST `/auth/sessions`에 시도 ID 전달 위치 없음 | 필수 `X-Login-Attempt-Id` UUID 헤더, 같은 로그인 재시도에 같은 값·자격·본문 유지 | [계정 PR740](https://github.com/OneOrThree/phone/pull/740) LLD §2.1의 기존 확장 동기화. loginAttemptId 본문 필드는 추가하지 않음 |
| POST `/islands` 이름 누락422 | 400 INVALID_REQUEST, field=name | 원본 api-create의 필수 입력 누락 상태를 공통 형식 검증으로 명시 override. 존재하는 이름의 길이/허용값 오류422와 구분 |
| GET `/islands/discover` 잘못된 cursor422 | 400 INVALID_CURSOR, field=cursor | 원본 api-island-discover의 커서 형식/서명 오류를 공통 커서 규칙으로 명시 override. 만료409 CURSOR_EXPIRED와 구분 |
| GET `/islands`의 cursor 형식/서명 오류422 | 400 INVALID_CURSOR, field=cursor | 원본 api-islands의 검색·페이지 인자 오류 중 cursor만 공통 규칙으로 override. 다른 검색 인자 의미 오류와 구분 |
| 본문 없는 DELETE `/auth/sessions/current` | 필수 `X-Refresh-Token`, 선택 AT, 동일 RT 해시로 철회·완료 복구 | [계정 설계 PR740](https://github.com/OneOrThree/phone/pull/740)의 전용 인증 계약. 원본에 없던 헤더 위치를 명시한 기술 보완이며 body는 추가하지 않음 |
| 초대 해석의410 만료 | 410 INVITATION_EXPIRED, field=code, retryable=false | 원본 상태 유지. 만료를502 상류 계약 오류로 바꾸지 않음 |
| 날짜/IANA timezone 표현 | 시각UTC, 집계KST. 아래 5개 입력은 누락 시 Asia/Seoul, 그 외 값은400 INVALID_PARAMETER | 퀘스트 생성의 원본 시간대 오류422도400으로 명시 변경. 원본 입력 예시는 HTML에 보존 |
| 300초/물고기·건설비·상품가격·퀘스트10P | 목업 표시 유지. 운영값 미채택 | 보상/경제 정책 질문 대기. 방송기100P는 원본이 확정 가격으로 표기 |
| 읽음/안읽음 필드 없음 | 새 우체통 UI 계약과 기존 내부 읽음커서를 구분 | 상세 사용자 선택 대기, 이 문서로DB삭제 결정하지 않음 |
| 66개 도메인 계약 중심 | BFF13종을 마지막 단계에 추가, 화면 첫 조회1콜 | 사용자 결정. mutation은 개별 명령 API |

## KST 날짜 입력의 채택 계약

| 신규 API | timezone 위치 | 날짜 의미 |
| --- | --- | --- |
| GET `/islands/{islandId}/statistics/focus` | query | from/to는 KST 날짜 |
| GET `/islands/{islandId}/statistics/screen-time` | query | from/to는 KST 날짜 |
| PUT `/me/screen-time/{date}` | JSON body | 경로 date는 KST 측정일 |
| GET `/me/focus-summary` | query | date는 KST 날짜 |
| POST `/islands/{islandId}/quests` | JSON body | windowStart/windowEnd는 KST 시각, 회차 날짜 경계도 KST |

5개 API 모두 `timezone`을 생략하면 `Asia/Seoul`로 정규화한다. 명시하면 정확한 문자열 `Asia/Seoul`만 허용한다. 다른 IANA 값·UTC·별칭·빈 문자열·JSON null·타입 불일치는 400 `INVALID_PARAMETER`, field=`timezone`, retryable=false다. 중복 query timezone도 같은 오류이며 임의 하나를 선택하지 않는다. 입력을 무시하거나 다른 시간대를 KST로 조용히 바꾸지 않는다. 누락과 명시한 Asia/Seoul은 같은 정규 요청이므로 측정 업로드와 퀘스트 생성 명령의 fingerprint도 동일하다. 측정 instant인 `measuredAt`은 UTC이고 날짜 버킷을 단말 시간대로 재해석하지 않는다.

원본 입력 예시는 [변경하지 않은 HTML](source-api-v03.html)의 `focus-stats`, `screen-stats`, `screen-upload`, `quest-create`, `home-summary` 항목에 별첨으로 보존한다. 원문 screen-upload의 사용자 시간대 날짜 설명은 이번 KST 채택 계약으로 대체한다. **quest-create의 원본 시간대 오류422는 공통 입력 정책에 맞춰400 INVALID_PARAMETER로 명시 변경한다.** 제목·목표·시간창의 다른 도메인 범위 오류422까지400으로 바꾸는 것은 아니다. 원본66개 endpoint의 요청 JSON/Query를 전수 확인한 timezone 입력은 이5개이며, 퀘스트 조회 응답의 timezone은 입력 건수에 포함하지 않는다. 복수 기기 측정 병합·집중의 섬 귀속 정책은 이 정규화로 확정되지 않는다.

## 결정 로그와 미결 항목

| 날짜 | 결정 | 상태/결정 주체 |
| --- | --- | --- |
|2026-09-11|무접두어 신규 경로, 기존 Data/chat 호환, 화면1콜 BFF, 집중REST/emoteSTOMP, realtime 개명|사용자 명시 결정|
|2026-09-12|1750/1754 문서와1755부터 착수, Business 공통은1659 기반 통합 후 확장|사용자 계획 승인. 미답 제품 정책 승인과 분리|
|2026-09-12|P02~P13의 직렬화/오류/키/버전/커서/추적 기술 규칙|공통 설계 채택. 조정자와409 current·현재 requestId·초기 receipt 비만료 경계를 대조|
|2026-09-12|메시지 clientMessageId는 도메인 중복키, emote는 휘발, 로그인은 인증 특수흐름으로 분리|범용 키 미들웨어가 인증·전송 계약을 임의 변경하지 않게 함|

미결 제품 정책: 기존 코인/보유품 승계, 새 경제 운영값, 건설 완료 전후 기여/잔량, 공동소비 권한, 우체통 상세 읽음·집중/휴식 접근, 계정 재인증·삭제 보존, 초대 승인 생략, 퀘스트 대상주민·랭킹 분모/섬 귀속, 복수기기 측정 정책. 이 설계로 정책 승인이나 운영 활성화가 이루어지지 않는다.

기술 후속: receipt 보존·파기 정책을 운영량과 계정 정책에 맞춰 확정, 1659 실제 통합 코드의 멱등 응답 저장·상류 오류 분류에 본 계약을 연결, 화면13종의 조각표/정합성/TTL은1784에서 확정한다. 구현이 미결 제품 정책에 의존하면 그 경계의 활성화만 보류하고 독립 기반을 진행한다.
