# BFF 정책·결정 기록

## 출처와 공통 규칙

| ID | 규칙 | 근거·상태 |
| --- | --- | --- |
| B01 | 신규 GET /screens13종. 도메인66계약과 별도로 보존 | 사용자 화면당1콜 결정·1784~1787 |
| B02 | 적용 가능한 재료는 단일 Data read-model snapshot의 R(필수) 묶음 | 승인된 초기 기술 선택. Business 다중HTTP에 DB원자성을 기대하지 않음 |
| B03 | N은 검증된 비적용으로 **조회하지 않음**. 실제403은 전체 실패 | A0·PR741.1786의 권한 없는 조각 문구를 이 의미로 구체화 |
| B04 | 초기 13개에 O(일시 실패 선택 조각)는 없음 | 승인된 기술 선택. 동일DB TX 실패를 부분 성공으로 꾸미지 않음 |
| B05 | 추후 독립O를 추가하려면 공개 상태/복구/시간 차 허용을 개정. 허용된 일시 실패만null | A0. auth·계약 실패·전체504는 항상 화면 전체 실패 |
| B06 | 모든 성공은 {data}; 실패는 {error:{code,message,field,retryable},requestId} | A0. 내부오류·권한필터는 공개 DTO에 넣지 않음 |
| B07 | data.asOf는 같은 Data snapshot의 관측 UTC instant. 자원 버전/커서 snapshot ID가 아님 | 신규 BFF 기술 계약. 여러asOf 문자열을 맞추는 것으로 snapshot을 위조하지 않음 |
| B08 | 현재 주체는 서버검증 값, session/islandId/currentContext를 Data에서 재검사 | 사용자 입력·헤더 복사로 주체/role/현재 섬 선택 금지 |
| B09 | domain version/watermark/cursor를 원래 자원 축으로 보존 | PR737/738. maxversion 하나로 합치지 않음 |
| B10 | 첫 화면 페이지는 BFF, 다음 페이지/개별상세/재연결은 기존 도메인 GET | 기술 선택. 화면 BFF에서 cursor/offset을 임의 혼합하지 않음 |
| B11 |13개 외부 응답 TTL0, Cache-Control:no-store | 초기 기술 선택. 내부 불변 snapshot/자산 재사용도 현재 인가 필요 |
| B12 | 쓰기·자동 권한 복구·가입/세션 생성·정산·outbox는 화면GET의 부수효과가 아님 | 원본 행동 분리·공통 GET-only 조합 |
| B13 | MemberIslandDetail에 island.appearanceVersion 필수 제공. 실제 appearance.version에 직접 매핑 | 승인된 기술 확장. 원본/기존 부분 응답에 이미 있던 필드가 아님. island.version과 별도 watermark |
| B14 | focusMembers.items[].appearanceVersion은 같은 snapshot의 user appearance.version을 직접 반환 | 승인된 필수 응답 확장. 개인 외양 축 (member.appearance,userId)이며 focus.member/session/island 외양 버전과 비교하지 않음 |

## 화면별 적용표

| 화면 | R 필수 재료 | N 조회 생략 조건/공개 상태 | 외부 TTL |
| --- | --- | --- | --- |
|home|island,focusSummary,session 조회|없음. session 자체의 정상null은 R 조회의 성공값|0|
|travel|목적지 island, 적용되면playback|검증 목적지에gram 없음: playback=null,playbackAvailability=facility_locked|0|
|focus|session,focusMembers, 적용되면playback|검증 섬에gram 없음: playback=null,playbackAvailability=facility_locked|0|
|sound|sharedInventory,playback|없음. gram없음은 전체403 FACILITY_LOCKED|0|
|rest|session,restMembers|없음. 세션 없는 모닥불 방문은 session=null 정상값|0|
|hall|focusStatistics,screenTimeStatistics|없음. 측정 unavailable/null은 조각 전체 실패가 아닌 도메인 데이터|0|
|island-manage|island,members, host이면joinRequests|검증 일반주민: joinRequests=null,joinRequestsAvailability=host_only|0|
|board|quests,notices|없음. 비활성 탭도 초기 계약에서필수|0|
|tower|memberRankings,islandRankings|미결 eligibility를 임의 N으로 만들지 않음. 참가 정책/응답 확정 전gate|0|
|explore|islands,memberships|없음. 소속 조회 실패를 미소속으로 바꾸지 않음|0|
|visit|public island, 본인요청있으면joinRequest|본인 최신 요청 없음: joinRequest=null,joinRequestAvailability=none|0|
|shop|wallets,products,sharedInventory|없음. 금액/소유 오류를0/false로 합성하지 않음|0|
|boat|me,inventory|없음. 현재 섬 필수 아님|0|

availability의 available은 해당 조각이 도메인 계약대로 조회됐다는 뜻이다. playback이 미선택 상태(trackId=null)여도 방송기가 있고 정상 조회했다면 playbackAvailability=available, playback 객체는 유지한다. none은 본인 신청이 없다는 뜻이며 타인의 요청 유무를 알려주지 않는다. host_only는 원본의 공개 역할 차이를 설명하며 내부 caller allowlist/SQL 권한을 노출하지 않는다. 실제403을 이 상태로 바꾸지 않는다.

## 미결과 활성화 gate

| ID | 선행 결정/구현 | 영향/승인 전 규칙 |
| --- | --- | --- |
| BG01 | IM-D06 currentIsland=null 복구·가입/이동 context | home/현재 섬 화면. 임의 첫 소속·자동 생성·시설 우회 금지 |
| BG02 | 초기 건설 기여/목표 DTO·가격/공동권한, focus 보상·강퇴·입력정책 | 필요한 island/session 재료가 실제로완성되기 전 해당 화면 활성화 금지. 조회가미답 정책을 채택하지 않음 |
| BG03 | 기록 개인범위/측정기기 병합/기간 상태와 랭킹 분모·동점·참가·마감 | hall/tower. 미결을0초/eligible로 반환하지 않음 |
| BG04 | 신규 me/catColor 및 inventory·미디어 소유/길이·1759/1783 섬 외양 버전 및1765/1783 집중 주민 개인 외양 버전 제공 | boat/sound/shop 및 해당 섬 화면. 예시색/무료곡/샘플완공을 운영기본값으로 쓰지 않음. 두 appearanceVersion의 각 정본 직접매핑·역순 외양사건·늦은 GET 응답 회귀 필요. 집중 주민의 도메인 GET/BFF가 같은 개인 외양 버전을 제공하기 전 focus 화면 활성화 금지 |
| BG05 | private 비소속 visit의 초대 읽기자격 전달 | 기존 무자격GET403 유지. 원본resolve 공개요약 재사용 또는 명시자격 read-model 연동 전 해당 private 진입 활성화 금지 |
| BG06 | PR744의 구조화된 영구5xx strict 분류와 실제 HTTP 회귀 | 신규 public+composition 엄격 분류는 수정 중. legacy 동기호환과 분리하고 완료/배포로 가정하지 않음 |
| BG07 | Data 화면 read-model GET 제공자·정확 allowlist·strict DTO·인가/snapshot 검증 |13개 BFF controller만 추가해 완료로 계산하지 않음 |

현재 작업은 설계이며 O가 없다는 선택이 향후 제품 부분 실패 지원을 영구 금지하지 않는다. O를 추가할 때도 N의 의미와 auth 실패 처리를 바꾸지 않는다.
