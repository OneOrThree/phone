# 랭킹 정책·결정 기록

| ID | 규칙 | 출처·상태 |
| --- | --- | --- |
| RK-P01 | 주는 KST 월요일00:00 포함~다음 월요일00:00 제외, ISO week-year 파싱 | 날짜 축·기존 LeagueWeek 순수 달력 계산 재사용 |
| RK-P02 | 주민 랭킹은 활성 소속·전망대·최소2명, 섬 간도 현재 섬 context의 전망대/참가 검사 | 원본. 인원 판정 시점/모수는 RK-D01 미결 |
| RK-P03 | 1인 순위 잠금과 섬 발견은 별도 권한 | 원본. 발견 endpoint를 랭킹 eligibility로 차단하지 않음 |
| RK-P04 | 휴식은 집중 점수에 더하지 않음. 진행분을 포함하는 정책이면 같은 asOf의 ACTIVE 구간만 | PR743. 진행분 포함 여부 자체는 RK-D03 |
| RK-P05 | 두 GET data.asOf 추가, 실제 snapshot ID·정책·인가 범위는 opaque cursor에 결합 | 승인된 기술 확장. timestamp만으로 DB snapshot을 복원할 수 없음 |
| RK-P06 | rank/items/myRank/분모/표시 점수는 같은 immutable snapshot | 기술 결정. 안정된 keyset만으로 변하는 점수 snapshot이 생기지 않음 |
| RK-P07 | 다음 페이지도 현재 계정/소속/시설 검사. cursor15분 만료, 만료/파기409 CURSOR_EXPIRED | A0 공통. 서명은 인가/암호화가 아님 |
| RK-P08 | 사용자·섬 이름/색은 공개 projection, 개인 subject/내부 지갑은 금지 | 원본 공개 DTO 최소화. 실제 UUID 및 계정 catColor 정본 재사용 |
| RK-P09 | Data snapshot 생성/페이지 반환과 중앙 withdraw는 공통 lifecycle 공유/배타 잠금으로 직렬화. 타인 포함 전체 사용자 역색인의 payload 파기·무효화는 탈퇴와 같은 TX. 무효 snapshot은409 CURSOR_EXPIRED, 외부 payload 캐시 금지 | 개인정보 기술 경계. 잠금 순서/실제 경합 검증 전 공개 활성화 금지 |

## 미결과 추천을 구분한다

| ID | 결정할 정책 | 추천·근거 | 승인 전 조건 |
| --- | --- | --- | --- |
| RK-D01 | 평균 분모 전체 주민/활동 주민/재적 인일, 중도 가입·탈퇴·재가입·비활성, 최소2명 판정 시점, 섬 간 참가 조건 | 주차별 cohort·가입 이력 고정 추천. 강퇴로 분모를 줄여 점수를 높이는 조작을 막을 필요. 현재 원본의2명 숫자는 유지 | 실제 cohort/분모/eligibility 계산·공개 출시 차단 |
| RK-D02 | 동점 공동순위인지 별도순번인지, 다음 순위 건너뛰기 여부 | 공동순위1,1,3 추천하되 미채택. UUID는 안정 정렬 보조키일 뿐 공동순위 정책을 대신하지 않음 | 순위 부여 함수·동점 golden case 결정 전 출시 차단 |
| RK-D03 | 현재 주는 완료분만인지 진행 ACTIVE 포함인지; 관측 시점·갱신 주기 | 같은 asOf snapshot은 확정 기술. 진행분 포함·새 표 생성 주기는 제품 미결 | 두 방법을 섞지 않고 승인 policy revision으로만 계산 |
| RK-D04 | 지난 주 확정 시각·지연 finish/측정/보정 수용 창·확정 표 재개정 | cutoff+정책 revision으로 고정하고 늦은 데이터 처리 이력 남기는 안 추천 | 과거 순위 확정/재정산 자동 활성화 금지 |
| RK-D05 | 개인 전체 시간 또는 섬에서 집중한 시간, 과거 섬 이동 이력 부족 | 회관 RC-D01과 같은 사용자 질문. session.islandId 고정 기여 사용 추천, 답변 대기 | 임의 현 주민 개인합 JOIN·추측 백필 금지 |
| RK-D06 | 평균 소수초 반올림·0분모 처리, 비적격 eligibility 구체 enum/응답, 원본 설명의 섬 썸네일 DTO | 평균은 정확한 초 합/분모로 계산 후 마지막 표시 반올림 추천. 원본에 없는 썸네일 URL을 임의 생성하지 않음 | 숫자/비적격/이미지 계약 결정 전 관련 화면 출시 차단 |

eligibility=eligible은 원본 확정 문자열이다. 비적격 상태에 대해 추천은200 `{eligibility:"insufficient_members",items:[],myRank:null,nextCursor:null}`지만 **enum과 응답 방식은 미승인**이다. 이를 실제 계약인 JSON 확정 예시로 추가하지 않는다. 시설 미해금403 FACILITY_LOCKED는 원본·1777 완료 조건으로 확정이다.

원본 두 JSON은 그대로 보존하고 /v1 제거와 data.asOf만 승인된 추가다. rank/myRank는 양의 정수 또는 의미상 미참가 myRank=null이며 어떤 사용자가 미참가인지는 RK-D01이 정한다. 평균 분모가0이면 숫자0을 임의 순위 점수로 만들지 않는다.
