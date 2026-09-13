# 링크·어트리뷰션 정책·결정 기록

결정자 조재영, 2026-09-13. PRD·HLD·LLD 와 어긋나면 이 문서가 맞다.

| ID | 결정 | 근거·상태 |
| --- | --- | --- |
| L01 | **별도 링크 서비스를 만들지 않는다.** 공개 표면·콘솔은 business-api, 원장·트랜잭션·집계는 data-api | 분리안(별도 저장소 · Vercel · Neon)은 [아키텍처 A22](../../architecture/decisions.md)의 링크 불변식(membershipEpoch · 서명 자격 · claim relay · 클릭 이관 정지 창)을 만들었다. 한 DB 트랜잭션이면 전부 필요 없다. 조재영: "원래 아예 분리할라 했는데 그냥 붙일라고". 아키텍처 A23 |
| L02 | 링크 경로의 외부 진입은 **nginx → business-api 뿐**이다. data-api 는 `/internal/*` 만 받는다 | A7 · A8. 조재영: "바로 data-api 에 쏘지 말고 bff 로 쏘면 bff 가 data-api 에 쏘고, data-api 를 private area 에" |
| L03 | IP 해시는 data-api 가 만든다. business-api 는 신뢰 헤더에서 뽑은 IP 를 내부 호출 바디로 넘긴다 | `LINK_IP_SALT` 를 한 곳에만 둔다. 솔트가 바뀌면 이전 클릭이 매치되지 않으므로 값은 현행 그대로 쓴다 |
| L04 | 초대 링크의 수명(발급 · 반복 발급 · 폐기 · 재발급)과 비공개 가입 검증은 **그룹 획득 문서가 정본**이다 | [그룹 획득 HLD §2](../group/features/01-acquisition/high-level-design.md), [LLD §2.1](../group/features/01-acquisition/low-level-design.md). 이 설계는 `status`·`revoked_at` 컬럼과 active 부분 unique 만 제공하고, 잠금 순서·폐기 트리거는 그 문서를 따른다 |
| L05 | **광고 플랫폼이 주는 숫자(광고비 · 노출 · 클릭 · CPI)는 만들지 않는다** | 조재영: "cpi 랑 campaign 은 다 추적해주는데 … 어떤 광고 보고 얼마나 들어왔는지만 보면 되는 거 아냐". 광고비 수기 입력은 폐기 |
| L06 | **iOS 광고는 Apple SKAN 포스트백 복사본을 우리도 저장한다** | 조재영: "iOS 는 meta 만 믿지 말고 우리도 저장". 광고 네트워크가 받는 것과 같은 원본이라 대조 근거가 된다. 한계: 집계값, 측정 창이 끝난 뒤 늦게 도착, 크라우드 익명성에 따라 전환값·source-identifier 자릿수가 줄어듦, 유저 단위 불가 |
| L07 | SKAN 포스트백의 귀속은 **기본이 광고 네트워크(= 채널) 단위**다. 캠페인 단위는 광고 네트워크가 자기 캠페인과 source-identifier 대응을 알려줄 때만 콘솔에서 수동 매핑한다 | source-identifier 는 광고 네트워크가 정한다. 우리가 발급해 광고 계정에 넣는 값이 아니다. 크라우드 익명성이 낮아 포스트백 자릿수가 줄면 Apple 은 **끝자리(least significant digits)** 를 남기므로(예 `5239` → `39`) 등록 값의 끝자리로 대조하고, 후보가 둘 이상이면 채널 단위로 남긴다 |
| L08 | **iOS 광고에 fingerprint 매치를 쓰지 않는다** | 광고 목적지를 랜딩으로 잡아야 해서 앱 설치 최적화가 깨지고(CPI 악화), Apple 은 동의 여부와 무관하게 fingerprinting 을 금지한다(ATT 정책 · App Store 심사 지침 5.1.2). 초대·오가닉 링크의 fingerprint 는 광고 목적이 아니므로 현행 유지 |
| L09 | SKAN 전환값: fine **0 = 설치, 1 = 가입, 2 = 첫 집중 완료**. coarse 는 low · medium · high 를 같은 순서로 쓴다. 값은 올리기만 한다 | 대시보드가 답할 질문이 설치·가입이라 최소 단계만 둔다. 수익 단계는 범위 밖 |
| L10 | Android 설치 신호는 **Install Referrer 가 1순위**다. 출처를 LINK(우리 slug) · META(암호화 payload) · GOOGLE(gclid) · ORGANIC(Play 기본값) · UNKNOWN 으로 판별한다 | 광고는 플랫폼이 referrer 를 채우고, 우리 링크는 랜딩이 Play 스토어 URL 의 `referrer` 파라미터에 slug·click 을 심는다 |
| L11 | Google Android 광고는 **채널 단위까지만** 센다 | gclid 는 불투명하다. 캠페인별 설치는 Google 대시보드(Play 직접 집계)에서 본다. Google Ads API 연동은 범위 밖 |
| L12 | 앱은 referrer 출처가 LINK · META · GOOGLE 이면 fingerprint 매치를 건너뛴다. ORGANIC · UNKNOWN · 전송 실패면 기존 매치를 시도한다 | 결정적 신호가 확률 매치보다 우선이다. 랜딩을 거쳤는데 referrer 가 안 남은 경우(스토어 직접 검색 등)는 fingerprint 가 받는다 |
| L13 | 캠페인 링크의 목적지는 **`gromo://` 스킴의 허용 경로 목록 안에서만** 고른다. 자유 입력을 받지 않는다 | 콘솔 입력이 그대로 앱 네비게이션이 되기 때문이다. 목록은 앱 라우트를 추가하는 앱 PR 과 같은 시점에 서버 상수로 갱신한다 |
| L14 | 폐기된 캠페인 링크의 랜딩은 스토어 버튼만 보여주고 **클릭을 기록하지 않는다.** 매치·referrer 귀속 후보도 되지 않는다 | 기본값 채택. 이미 뿌린 게시물의 방문자가 막다른 길을 만나지 않게 한다 |
| L15 | **PR #745 는 링크 분리 전제 코드를 포함한 채 머지한다.** 사장 코드와 V52 링크 테이블 제거는 링크 구현 PR 이 진다 | 조재영(09-13): "745에서 링크는 제외하지 않는다 일단". 머지 뒤 켜지 말아야 할 설정과 걷어낼 목록은 [LLD §9](low-level-design.md#9-pr-745-와의-관계) |
| L16 | **콘솔 = business-api 안 Thymeleaf 서버 렌더링.** 팀원별 비밀번호 슬롯 + 서명 쿠키, 실패 잠금·폼 토큰은 Redis. DB 테이블 없음. 2차 비밀번호 없음 | 사용자 2~4명 · 화면 3장 · 폼과 표뿐이다. React 빌드는 Gradle CI 에 Node 툴체인을 끌어들인다. 알림 콘솔은 같은 `/console/**` 인증에 나중에 붙는다(이번 범위 밖) |
| L17 | 개인정보: 원본 IP 는 저장하지 않는다(현행) — **레이트리밋·로그인 잠금의 Redis 키도 원본 IP 대신 business-api 전용 비밀로 HMAC 한 값**을 쓴다. `link_clicks`·`install_referrers` 의 `claimed_user_id` 는 **탈퇴 트랜잭션에서 NULL** 로 만들고, claim 은 유저 행 공유 락으로 탈퇴(배타 락)와 직렬화한다. SKAN 포스트백에는 기기·유저 식별자가 없다 | A22 ⓐ 의 익명화 요구를 같은 트랜잭션으로 닫는다. TTL 이 있어도 Redis 키에 적힌 동안은 원본 IP 저장이다. 락이 없으면 탈퇴의 UPDATE 뒤·커밋 전에 끼어든 claim 이 연결을 남긴다 |
| L18 | `/l/match`·`/l/referrer`·`/l/resolve` 는 **결과가 없으면 200 `{matched:false}`**, **data-api 오류·타임아웃은 503 + `Retry-After`**, **레이트리밋은 429** 로 응답한다. SKAN 수신은 **서명을 통과한 우리 앱 포스트백만 저장**하고, 서명 실패·모르는 버전·다른 앱은 저장 없이 200(건수만 셈), 본문 16KB 초과는 413, 저장 실패만 5xx 다 | 현 앱 `deferredInvite.matchOnce` 는 2xx 일 때만 완료 플래그를 세우고 오류·타임아웃이면 다음 실행에 다시 묻는다(`deferredInvite.ts:94-108`) — 일시 장애를 200 으로 접으면 귀속이 영구 유실된다. SKAN 경로는 무인증이라 서명 실패까지 저장하면 누구나 DB 를 채울 수 있다. 저장 실패는 Apple 의 재전송에 기대지 않고 로그로 잡는다 |
| L20 | 스키마는 **expand / contract** 로 나눈다. 테이블 rename 과 V52 링크 테이블 DROP 은 공개 경로 전환이 안정된 **마지막 단계**에서 하고, 그 전 단계는 모두 이전 이미지로 되돌릴 수 있게 한다 | prod `ddl-auto: validate` 라 rename 직후 이전 이미지는 기동하지 못한다. contract 단계의 되돌리기는 LLD §1.1 의 복구 SQL 로 한다 |
| L21 | Android 설치 단위는 **기기 + Play 설치 시작 시각**(`install_key`)이다. 같은 기기의 재설치는 새 설치로 센다 | 앱이 `android:allowBackup="true"` 라 기기 식별자·완료 플래그가 재설치 뒤 복원될 수 있다. 기기 단위로 멱등을 잡으면 다른 광고로 재설치한 성과가 과거 귀속에 묻힌다 |
| L19 | 개인정보처리방침에 **IP 해시 · 기기 식별자 · Install Referrer 수집**이 적혀 있어야 출시한다 | IP 기반 매치는 심사 회색지대이고, 방어 논리는 "자사 링크 안에서만 닫히고 광고 목적이 아니다"와 고지다 |
