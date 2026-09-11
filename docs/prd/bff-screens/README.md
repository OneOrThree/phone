# 화면당 한 번 조회하는 BFF 계약

GROMO-1784 설계. 구현은1785(생활5),1786(회관·게시판·전망대4),1787(탐색·상점·내 배4)로 나눈다. [PRD](prd.md) → [정책](policy.md) → [아키텍처](high-level-design.md) → [상세 계약·13개 응답](low-level-design.md) 순서로 읽는다. 정책 충돌 시 policy.md가 정본이다.

[source-contracts.json](source-contracts.json)은 **원본66개 도메인 계약 중 필요한 GET22개**의 요청/응답과 원본 화면 연결을 그대로 보존하고, 별도로 신규13개 BFF 경로를 표시한다. HTML의 다중 GET 화면 그룹14개 중 stats는 hall의 동일 UI 상태여서13개로 합친다. 첫 항해arrival은 단일GET이며 travel44와 구분한다. 원본에13개 /screens endpoint가 이미 있었다는 뜻이 아니다.

원본 GROMO-1739 HTML:154704 bytes, SHA-256 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`. [공통 원본 보존 PR738](https://github.com/OneOrThree/phone/pull/738)을 참조한다. 원본 HTML과 canonical JSON을 이 작업에서 수정하지 않았다. 티켓의 screen-aggregation 대신 배정된 bff-screens 경로를 사용한다.

선행: [공통 문서738](https://github.com/OneOrThree/phone/pull/738), [공통 구현744](https://github.com/OneOrThree/phone/pull/744), [실시간737](https://github.com/OneOrThree/phone/pull/737), [계정740](https://github.com/OneOrThree/phone/pull/740), [소속·관리741](https://github.com/OneOrThree/phone/pull/741), [경제·외양742](https://github.com/OneOrThree/phone/pull/742), [집중743](https://github.com/OneOrThree/phone/pull/743), [건설·음악746](https://github.com/OneOrThree/phone/pull/746), [기록·랭킹748](https://github.com/OneOrThree/phone/pull/748).

이 문서는 구현 완료 보고가 아니다. 기준 main529a에는13개 BFF와 새 도메인 대부분이 없다. core2e11b50b4 계열의 ScreenComposer는 공통 기반이며 구조화된 영구5xx의 엄격 분류는 PR744에서 수정/검증 중이다. 해당 검증과 각 도메인 정책·제공자 준비 전 화면을 활성화하지 않는다.

문서 정적 검증(2026-09-12):13개 응답 JSON 파싱, 원본 GET22개 객체 일치·재료 참조30개·BFF13개 확인, N/null·방문자 whitelist·예시 합계/분모 점검, 로컬 링크 누락0 및 fence 정합을 확인했다. 빌드·실서비스 테스트 결과는 이 문서 작업의 증거로 주장하지 않는다.

개인 외양 복구 보완: 집중 주민 항목의 `appearanceVersion`을 실제 user appearance.version에서 직접 매핑한다. 섬 외양/집중 투영과 다른 축이며1765/1783 제공자·도메인 주민 GET/BFF·앱의 역순 사건 및 늦은 응답 회귀가 활성화 조건이다. 원본22개 GET JSON은 이 확장 때문에 변경하지 않았다.

구현 배정은 독립 활성화를 뜻하지 않는다. home/travel/island-manage/focus/sound/shop/boat는 [BG04 제공자 gate](policy.md)를 충족해야 하며 나머지 화면도 공통 인가·필수 재료·정책 gate를 따른다.

목록은 도메인의 페이지 여부를 보존한다. memberships는 전량이고, host 신청 목록은 PR741에서 명시한
cursor 확장을 사용한다. [LLD](low-level-design.md)에 두 정본 근거와 출시 전 상호운용 검증을 연결했다.
공개 오류의 `retryable`은 [A0 고정 커밋의 코드별 표](https://github.com/OneOrThree/phone/blob/0646e6e764bba5340cc23f9be8f6e30e25a863fd/docs/prd/api-platform/policy.md#http-상태외부-오류-코드)를 따른다.
