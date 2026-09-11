# 집중·휴식 정책과 출시 결정

> GROMO-1763 · [PRD](prd.md) · [LLD](low-level-design.md). 규칙의 출처와 미결 상태를 구분한다.

## 확정한 규칙

| ID | 규칙 | 근거 |
| --- | --- | --- |
| FR-P01 | 집중 방식은 낚시, pause된 같은 세션은 모닥불 휴식. 방문만으로 세션 생성 없음 | 원본 focusSetup/rest §§13/18 및 rest-members |
| FR-P02 | 사용자당 진행 세션 하나. active와 paused 둘 다 진행 상태 | 원본 start, 이동 제한, 사용자 REST/STOMP 결정 |
| FR-P03 | 시작은 현재 소속 섬에서만. 세션 islandId는 시작 뒤 불변, 진행 중 현재 섬 이동 금지 | 원본 start/switch 및 1758 소속 설계 |
| FR-P04 | 서버 UTC 시각의 ACTIVE 구간만 순수 집중으로 계산. 휴식 중 activeSeconds 증가 없음 | 원본 session/pause/resume/home-summary |
| FR-P05 | 수명주기 쓰기는 REST. focus/rest 스냅샷 GET, 이후 STOMP; emote만 SEND | 사용자 D03 |
| FR-P06 | 시작·pause·resume·finish는 앱 UUID Idempotency-Key 필수. UUID36자, v4/v7 생성 권고 | 공통 PR738. 누락·중복 헤더·형식400, 대소문자 정규화 |
| FR-P07 | expectedVersion 필수는 pause/resume/finish 3개. start에 임의 version 추가 없음 | 원본 요청 예시·공통 버전 표 |
| FR-P08 | 완료된 명령 재생은 새 상태/version 검사보다 먼저. 계정 활성·현재 결과 열람 권한은 유지 | 공통 receipt 정책 |
| FR-P09 | 종료 기록·보상·기여·receipt·outbox는 동일 Data TX, 세션별 정산 유일성 별도 | 원본 원자 처리 및 1764 완료 조건 |
| FR-P10 | 화면 닫기·취소는 무지출. 종료 확인 취소는 finish를 호출하지 않음 | 원본 finish 및 로컬 동작 |
| FR-P11 | 같은 섬 active 집중 사용자만 응원 송·수신. 5종은 hello/cheer/sleepy/laugh/hearts | 원본 응원과 1754 payload 정본 |
| FR-P12 | 섬 사건과 개인 지갑 사건은 audience 분리. 개인 fish 지갑은 본인만, 섬 물고기 지갑 신설 금지 | 원본 재화2종·1754 wallet.updated |
| FR-P13 | 집중 중 채팅 차단은 유지하고 CONNECT 전체를 집중 상태로 막지 않음 | 사용자 D04·1754/1755 |
| FR-P14 | HTTP data 봉투, error4필드+requestId, 409의 current는 인가된 공개 DTO만 | 공통 PR738 |
| FR-P15 | 이벤트 schemaVersion=1 포함 7필드. sessionVersion·주민 projection version·receipt contractVersion 구분 | D23·PR737/739 |
| FR-P16 | 신규 상세 세션의 legacy live 랭킹·표시도 ACTIVE 구간 합을 사용. pause 고정·resume 추가분·finish 중복 없는 조회 회귀 전 신규 활성화 금지 | 기존 now-start 쿼리의 휴식 가산 결함 방지, LLD §5.1 |
| FR-P17 | 신규 API 비활성 상태로 상세를 인식하는 legacy writer/reader를 먼저 전량 배포하고, 실제 rollback 최소 호환 baseline 이동·구 이미지 실행 차단 후 신규 활성화 | 기존 이미지 존재 확인만 하는 rollback과 마커 자동 종료의 결함 방지, LLD §5.2 |
| FR-P18 | 완료 목록과 앱의 재계산도 ACTIVE 합·실제 구간을 사용. 최소 호환 앱/접근 경계 또는 모든 소비처의 의미를 보존하는 검증된 읽기 projection을 준비하기 전 신규 활성화 금지. REST를 totalDistractionSeconds에 넣지 않음 | 완료 목록 소비처의 휴식 가산·시간표 오류 방지, LLD §5.1.1 |

본 문서의 원자성은 Data 내부 상태에 대한 약속이다. DB commit과 Redis/TCP 전달을 하나의 트랜잭션이라고
표현하지 않는다. 후자는 outbox/relay, 현재 인가, 스냅샷 복구로 처리한다.

## 날짜 입력

`GET /me/focus-summary`의 `date`는 `YYYY-MM-DD` KST 날짜다. 날짜 누락은 조회 시점의 서버 KST 오늘로
정규화하는 기술 기본값을 채택한다. 명시한 잘못된 날짜는 422 `OUT_OF_RANGE`, field=`date`다.
동일 query의 date 중복·타입/구문 오류는 400 `INVALID_PARAMETER`로 거절한다.
`timezone` 누락은 `Asia/Seoul`, 명시 값은 정확히 `Asia/Seoul`만 허용한다. 빈 값·UTC·별칭·다른 IANA 값·
null 문자열·중복 query는 400 `INVALID_PARAMETER`, field=`timezone`다. 원본의 시간대 오류422는 공통 개정으로 대체한다.

이 규칙은 공통의 timezone 입력 5개 중 하나다. 집중 요약, 집중 통계, 스크린타임 통계, 측정 업로드,
퀘스트 생성이 같은 KST 규약을 공유하며 이 문서가 나머지 4개 API 구현을 맡지 않는다.
시각 필드는 UTC ISO-8601이고 단말 locale·저장된 옛 serverZone을 집계 축으로 쓰지 않는다.
과거 날짜 조회의 currentSessionSecondsToday도 이름에 관계없이 **요청한 날짜에 걸친 진행 구간**의 몫이다.
미래 날짜는 아직 기록/구간이 없어 0이며 미래 시간까지 미리 계산하지 않는다.

## 미결 제품 결정과 추천안

| ID | 질문 후보/근거 | 추천안 또는 비교할 선택지 | 결정 전 출시 조건 |
| --- | --- | --- | --- |
| FR-D01 | 300초/물고기, 최소 유효 시간·상한·나머지 초 이월은 어떻게 정할까? 원본405/797은 목업 | 산식/단위/반올림/캡/이월을 revision 있는 서버 정책으로 관리. 300과 기존 코인60초를 운영 기본값으로 자동 채택하지 않음 | fish 지급 경로 비활성. 확정 rate와 기존 자산 승계 결정 필요 |
| FR-D02 | 집중 도중 게시판 완성 시 시간별 분할인가 종료 시점 배분인가? 정원 초과 기여를 개인에게 돌릴까? 원본406 미정 | 시간별 분할은 시설 완성 instant와 구간 교집합 사용, 종료시점 방식은 종료 TX 상태 사용. 초과를 개인 환류하는 안 추천하되 승인 전 미채택 | 원장·cap·잔량 보존식 및 동시 완성 사례 결정 필요 |
| FR-D03 | 진행/휴식 중 강퇴·섬 종료 시 세션과 미수령 보상은? 관리 설계와 공동 질문 | 서버 시각 강제 종료+개인 확정 보상 보존을 관리 설계가 추천. 공동기여/퀘스트 자격은 별도 결정 | 정책 없는 강퇴가 세션을 CANCELED로 버리거나 임의 정산하지 않도록 해당 교차 기능 출시 차단 |
| FR-D04 | paused 상태에서 채팅을 허용할까? 기존 presence에는 paused 구분 없음 | active는 반드시 차단. paused도 차단 유지 또는 pause 이후 허용을 명시 결정. CONNECT를 차단하는 선택지는 제외 | pause 상태 채팅/구독 가드와 presence 투영 전이 정책 미확정 상태로 활성화 금지 |
| FR-D05 | 응원 TTL·사용자당/섬당 전송 빈도 상한은? 3초는 원본 목업, 빈도 미정 | TTL·burst·보충속도를 설정으로 명시, 모든 인스턴스 합산 제한. 데이터 보관 없이 만료 표시 | emote handler 활성화 전 승인 값·운영 계측/용량 검증 필요 |
| FR-D06 | 목표 시간의 허용 범위·드럼 간격, subject 길이/빈 값, 세션 최대 지속·orphan 처리 기준은? 원본 목표25분은 예시 | 카탈로그/입력 설정으로 관리. 목표 달성 자체는 종료하지 않음. 기존12h orphan·60초 코인 정책 자동 복제 금지 | 입력 validation과 새 세션 orphan 정책·복구 UX 확정 필요 |

FR-D02는 시설1766, FR-D03은 관리1761과 합의하고 중복 질문을 만들지 않는다. 공동 구매·건설·테마 권한은
별도 공용 권한 결정 대기다. 원본의 **초기 집중 기여 자동 반영**을 수동 구매권한과 같은 행으로 해석해
방장이 아닌 사람의 집중을 막지 않는다. 그러나 그 자동 반영의 실제 산식/잔량 규칙은 FR-D02가 필요하다.

키/정수/시각/원자성 같은 독립 기반은 진행할 수 있다. 실제 돈을 움직이는 기능을 '일단 0원 지급'으로
성공 처리하면 원래 받아야 할 보상을 영구 잃을 수 있으므로, 정책이 없을 때 성공 정산 receipt를 만들지 않는다.
미결 산식·강퇴 정책을 남겼으므로 GROMO-1763의 '보상 산식 확정' 완료 조건은 아직 충족하지 않았다.
