# 회관 기록 정책·미결 결정

## 확정 규칙과 기술 선택

| ID | 규칙 | 근거 |
| --- | --- | --- |
| RC-P01 | 신규 경로에 /v1 없음, 기존 /api/v1 계약 보존 | 사용자·PR738 |
| RC-P02 | from/to/date는 KST 날짜, 시각은 UTC instant. timezone 누락 Asia/Seoul, 그 외 값/중복400 INVALID_PARAMETER | 날짜 축 정본·공통 timezone5종 |
| RC-P03 | 집중은 ACTIVE 구간 합만. pause는 증가0, 자정은 날짜별 실제 교집합 | PR743. 완료+진행은 같은 snapshot에서 중복 없이 계산 |
| RC-P04 | totalSeconds/series는 전체 조회 기간 합, records는 페이지. 페이지 합계를 다시 누적하지 않음 | 원본 설명·기술 확정 |
| RC-P05 | scope=island에 개인 records/subject를 보내지 않음. 주민 공개 집계와 개인 공개 토글/친구 정책은 별개 | 원본. legacy StatViewPolicy 변경 없음 |
| RC-P06 | 미수집 minutes=null, 실제 측정된0만0. authorized/denied/unavailable/pending 보존 | 원본. 오류 대신200 상태로 표현 |
| RC-P07 | 측정 PUT은 Idempotency-Key 필수, 검증 사용자+기기+날짜 scope, measuredAt 순서로 최신 선택 | PR738·원본 제안의 기술 구체화 |
| RC-P08 | 같은 기기/날짜/시각·같은 내용은 무변경 성공, 다른 내용은409 STATE_CONFLICT. 더 오래된 측정이 최신값을 덮지 않음 | 기술 선택. 시계 조작/미래 허용 범위는 별도 정책 gate |
| RC-P09 | 업로드는 실제 세션·측정기기 바인딩/소유를 검증. 임의 deviceId를 새 신뢰 기기로 자동 등록하지 않음 | 보안 기술 경계. FCM 토큰 ownership과 다른 식별자 |
| RC-P10 | 집중 GET data.asOf 추가. 한 snapshot 관측 시각이며 실제 snapshot identity는 cursor 내부 | 승인된 기술 확장. timestamp만으로 과거 DB snapshot 복원 불가 |
| RC-P11 | 측정 원본·최신 포인터·파생 projection·receipt·내구 후속 사건은 Data가 저장. GET/재전달/보정은 보상 지급 없음 | 기존 집중/경제/공통 원자 경계 |

## 원본과 채택의 차이

| 원본 | 채택 | 상태 |
| --- | --- | --- |
| /v1 경로 | 접두어 제거 | 사용자 결정 |
| upload date는 사용자 시간대 날짜 | KST YYYY-MM-DD, timezone은 Asia/Seoul만 | 기존 날짜 축 정본 우선. 로컬 하루를 라벨만 KST로 바꾸지 않음 |
| 원본 세 JSON | 그대로 source-contracts.json에 보존 | 원본 예상 계약 |
| focus-stats 응답에 조회 시점 없음 | data.asOf UTC instant 추가 | 승인된 기술 확장 |
| scope=island 설명만 존재 | LLD의 명시 members DTO로 구체화 | 개인 상세 미포함 |
| OS가 미연동 샘플이라는 설명 | 새 화면 목업과 기존 iOS 실제15분 근사 측정을 구분 | 실제 코드 증거 |

## 사용자 답변 대기와 출시 조건

| ID | 결정할 내용 | 추천/주의 | 승인 전 gate |
| --- | --- | --- | --- |
| RC-D01 | scope=me 개인 전체인가 경로 섬 귀속인가; 섬 주민 합계/랭킹은 고정 session.islandId 기여인가 현 주민 개인 전체인가 | 개인 전체와 섬 기여 분리 추천. 이동 전 기록을 새 섬에 복사하지 않음. 부모가 사용자에게 질문했고 답변 대기 | 해당 집계 쿼리/백필 활성화 금지 |
| RC-D02 | 측정 대상 범위·OS별 정확도·대표1대/sum/max, 대표기기 변경/소유 바인딩 | 대표1대는 단순하나 승인 아님. sum 중복/max 누락 위험. FCM 토큰을 deviceId로 간주하지 않음 | 검증된 기기·수집 경계와 병합 정책 전 공개 일집계/신규 수집 활성화 금지 |
| RC-D03 | 일부 날짜/주민만 수집한 기간 합계·status, denied 후 과거 숫자 표시, 미래 날짜 그래프 | 결측 날짜를0으로 채우지 않고 불완전 합계는 전체처럼 표시하지 않는 안 추천. 상태 우선순위/기간 합 노출은 미승인 | 기간 resolver 결정표·화면 표시 검증 전 활성화 금지 |
| RC-D04 | measuredAt 미래 관용치·과거 보고 허용 창·마감 후 정정/보상 관계 | 서버 설정 revision으로 관리 추천. 기존 내기2분/오늘·어제 보상 창을 자동 승계하지 않음 | 유효 범위 설정과 마감/정정 규약 전 PUT 활성화 금지 |
| RC-D05 | 과거 섬 귀속/가입·탈퇴 이력 없는 legacy 데이터, 과거 주민 노출 | 추측 백필 금지. 확인된 provenance와 unknown 분리 추천 | unknown을 새 섬 통계로 포함하기 전 명시 정책 필요 |

RC-D01/02는 이미 질문 중인 제품 선택이다. RC-D03/04/05는 연관 기획·퀘스트 결정과 함께 확정하며 기본값을 발명하지 않는다. 내부 원본 저장·CAS·DTO·비활성 구현과 정적 검증은 독립 진행할 수 있다. '일단0분' 또는 '일단 보상0' 성공은 미측정/미결 의미를 영구 손상시키므로 금지한다.
