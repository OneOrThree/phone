# 회관 기록 정책·미결 결정

## 확정 규칙과 기술 선택

| ID | 규칙 | 근거 |
| --- | --- | --- |
| RC-P01 | 신규 경로에 /v1 없음, 기존 /api/v1 계약 보존 | 사용자·PR738 |
| RC-P02 | ~~from/to/date는 KST 날짜~~ → **from/to/date는 UTC 날짜**, 시각은 UTC instant. timezone 생략 또는 `UTC` 만, 그 외 값(`Asia/Seoul` 포함)/중복 400 INVALID_PARAMETER | 2026-09-19 결정 RC-축(섬 퀘스트 Q-6 과 같은 신규 기능 규칙). legacy KST 표(`daily_screen_time_stats`)는 읽지 않는다 |
| RC-P03 | 집중은 ACTIVE 구간 합만. pause는 증가0, 자정은 날짜별 실제 교집합 | PR743. 완료+진행은 같은 snapshot에서 중복 없이 계산 |
| RC-P04 | totalSeconds/series는 전체 조회 기간 합, records는 페이지. 페이지 합계를 다시 누적하지 않음 | 원본 설명·기술 확정 |
| RC-P05 | scope=island에 개인 records/subject를 보내지 않음. 주민 공개 집계와 개인 공개 토글/친구 정책은 별개 | 원본. legacy StatViewPolicy 변경 없음 |
| RC-P06 | 미수집 minutes=null, 실제 측정된0만0. authorized/denied/unavailable/pending 보존 | 원본. 오류 대신200 상태로 표현 |
| RC-P07 | 측정 PUT은 Idempotency-Key 필수, 검증 사용자+기기+날짜 scope, measuredAt 순서로 최신 선택 | PR738·원본 제안의 기술 구체화 |
| RC-P08 | 같은 기기/날짜/시각·같은 내용은 무변경 성공, 다른 내용은409 STATE_CONFLICT. 더 오래된 측정이 최신값을 덮지 않음 | 기술 선택. 시계 조작/미래 허용 범위는 별도 정책 gate |
| RC-P09 | 업로드는 실제 세션·측정기기 바인딩/소유를 검증. 임의 deviceId를 새 신뢰 기기로 자동 등록하지 않음 | 보안 기술 경계. FCM 토큰 ownership과 다른 식별자 |
| RC-P10 | 집중 GET data.asOf 추가. 한 snapshot 관측 시각이며 실제 snapshot identity는 cursor 내부 | 승인된 기술 확장. timestamp만으로 과거 DB snapshot 복원 불가 |
| RC-P11 | 측정 원본·최신 포인터·파생 projection·receipt·내구 후속 사건은 Data가 저장. GET/재전달/보정은 보상 지급 없음 | 기존 집중/경제/공통 원자 경계 |
| RC-P12 | Data snapshot 생성/페이지 반환과 중앙 withdraw는 공통 lifecycle 공유/배타 잠금으로 직렬화. 타인 포함 전체 사용자 역색인의 payload 파기·무효화는 탈퇴와 같은 TX. 무효 snapshot은409 CURSOR_EXPIRED, 외부 payload 캐시 금지 | 개인정보 기술 경계. 잠금 순서/실제 경합 검증 전 공개 활성화 금지 |

## 원본과 채택의 차이

| 원본 | 채택 | 상태 |
| --- | --- | --- |
| /v1 경로 | 접두어 제거 | 사용자 결정 |
| upload date는 사용자 시간대 날짜 | ~~KST~~ **UTC** YYYY-MM-DD, timezone은 생략 또는 UTC만 | 2026-09-19 결정 RC-축. 로컬 하루를 라벨만 바꾸지 않음 |
| 원본 세 JSON | 그대로 source-contracts.json에 보존 | 원본 예상 계약 |
| focus-stats 응답에 조회 시점 없음 | data.asOf UTC instant 추가 | 승인된 기술 확장 |
| scope=island 설명만 존재 | LLD의 명시 members DTO로 구체화 | 개인 상세 미포함 |
| OS가 미연동 샘플이라는 설명 | 새 화면 목업과 기존 iOS 실제15분 근사 측정을 구분 | 실제 코드 증거 |

## 복수 기기 규칙과 입력·응답 예시 (GROMO-1806)

**규칙: 같은 UTC 날짜의 복수 기기 관측은 병합하지 않는다.** 날짜마다 기기(= 서명된 로그인 세션, 2026-09-19 결정 RC-D02-기기)별로 `measuredAt` 이 가장 늦은 관측 하나를 고르고 — 정정은 합산이 아니라 대체다(RC-P08) — 그 후보가 둘 이상이면 그날은 `minutes=null`·`measurementStatus=unavailable` 이다. 후보 셋은 모두 반려다: **합산**은 같은 화면 시간을 두 기기가 겹쳐내면 이중 합산이고 겹침을 가를 원본이 없으며, **최대·대표1대**는 다른 기기의 관측 누락을 숨겨 누락을 전체처럼 표시한다(미승인 — 2026-09-19 결정 로그 RC-D02-기기). 기획 정본의 「데이터 없음·권한 없음·실제 0은 구분한다」·「측정이 확인되지 않은 값은 0%로 표시하지 않는다」와도 이 규칙만 맞는다 — 병합된 수는 어느 기기의 관측도 아니다. 원본 관측은 기기별 불변 행(`screen_time_observations`)으로 보관되므로, 병합 정책이 나중에 승인되면 같은 원본으로 다시 계산할 수 있다.

이 규칙의 정본 구현은 `server/data-api/.../screentime/support/ScreenTimeDayPick.java` 한 곳이다 — 도서관 조회(기간 resolver, RC-D03)와 일일 스크린타임 퀘스트 판정([island-quests 정책](../island-quests/policy.md) Q01-screen, GROMO-2001)이 그것을 공유한다. 규칙이 갈라지면 도서관이 「측정 불가」로 보여 주는 날을 퀘스트가 「달성」으로 정산하므로, 규칙 변경은 두 소비자를 한 커밋에서 바꾼다.

날짜 축은 [날짜 축 규약](../../../conventions/date-axis.md)을 따른다 — 신규 기능이라 D8 전환(1930, date-axis §7)을 기다리지 않고 처음부터 UTC 다(RC-P02, 2026-09-19 결정 RC-축). 관측 버킷 `measured_date`·`measuredAt` 은 UTC 날짜·UTC instant 이고, KST 라벨인 legacy `daily_screen_time_stats` 는 읽지 않는다 — 한 체인 안에서 축을 섞지 않는다.

### 입력·기대 응답 예시

공통 입력: `PUT /me/screen-time/{date}` + `Idempotency-Key` — 본문 `{minutes, measurementStatus, timezone:"UTC", measuredAt, deviceId}`. `deviceId` 는 AT 의 `sid` 와 같아야 하고 다르면 403 `FORBIDDEN` field=deviceId 다(RC-P09 — 세션 = 기기). PUT 응답은 그 **기기·날짜**의 최신 선택 관측이지 계정 병합값이 아니다. 조회는 `GET /islands/{islandId}/statistics/screen-time?from=…&to=…&scope=me`. 예시의 「오늘」은 `2026-09-22`(UTC)다.

| 사례 | 입력(보고 순서) | 기대 응답 |
| --- | --- | --- |
| 실제 0 | 09-21 에 `{minutes:0, authorized, measuredAt:2026-09-22T00:30:00Z}` | `series:[{date:"2026-09-21", minutes:0, measurementStatus:"authorized", …}]`, 기간(09-21 하루) `measurementStatus:"authorized"`, `totalMinutes:0` — 측정된 0 만 0(RC-P06) |
| 관측 누락 | `from=09-19&to=09-21` 에 09-19(60분)·09-21(30분)만 보고, 09-20 은 관측 없음 | `series` 에 09-20 행이 없다(0 보간 금지). `measurementStatus:"authorized"`(최근 날짜 상태)지만 `totalMinutes:null` — 지난 날짜가 전부 authorized 가 아니다(RC-D03) |
| 권한 회수 | 09-19 `{authorized, 90}` 보고 뒤 09-20 `{denied, null}` 보고 | 기간 상태 = 최근 날짜 `denied`, 과거 authorized 날짜는 series 에서 제외 → `series:[{date:"2026-09-20", minutes:null, measurementStatus:"denied", …}]`, `totalMinutes:null` (denied 뒤 과거 숫자 비노출, RC-D03) |
| 재로그인 | 같은 폰 — 세션 A 가 09-21 60분 보고 → 로그아웃·재로그인 → 새 세션 B 가 09-21 을 다시 보고 | 같은 UTC 날짜에 기기(세션) 2대 → `{date:"2026-09-21", minutes:null, measurementStatus:"unavailable"}`. 알려진 한계(결정 로그 RC-D02-기기): 물리 기기가 하나여도 재로그인은 새 기기다 |
| 같은 UTC 날짜 기기 2대 | 세션 A(폰) 09-21 60분 + 세션 B(패드) 09-21 30분 | `{date:"2026-09-21", minutes:null, measurementStatus:"unavailable", updatedAt:<둘 중 늦은 measuredAt>}`, `totalMinutes:null` — 합 90·최대 60 어느 쪽도 내지 않는다 |

### minutes=null 을 부분 합으로 대체하지 않는 조건

기간 `totalMinutes` 는 아래를 **전부** 만족할 때만 값을 갖고 하나라도 걸리면 `null` 이다 — 관측된 날만 더한 `SUM(non-null)` 을 전체 합계로 내지 않는다(RC-D03):

- 지난 날짜(`from..min(to, 오늘 UTC)`)에 관측이 없는 날이 없다 — 결측은 0 이 아니다.
- 그 날짜들의 확정 상태가 전부 `authorized` 다 — `denied`·`pending`·`unavailable`(복수 기기 포함)가 하나라도 있으면 null.
- `series` 의 `minutes:null` 행을 0 으로 접어 표시·합산하지 않는다 — 실제로 측정된 0 만 0 이다(RC-P06). 오지 않은 미래 날짜는 결측으로 치지 않는다.

퀘스트 판정도 같은 조건이다(Q01-screen): 복수 기기 날은 **유예 없이 분모 밖**이고, `null` 을 「0분 사용 = 상한 이하」로 읽어 달성으로 정산하지 않는다 — 측정된 0 만 달성 후보다.

## 사용자 답변 대기와 출시 조건

| ID | 결정할 내용 | 추천/주의 | 승인 전 gate |
| --- | --- | --- | --- |
| RC-D01 | scope=me 개인 전체인가 경로 섬 귀속인가; 섬 주민 합계/랭킹은 고정 session.islandId 기여인가 현 주민 개인 전체인가 | **결정(2026-09-19 RC-D01, 권장안 승인)**: scope=me 개인 전체 · scope=island 현재 주민의 고정 session.islandId 기여. 개인 전체와 섬 기여 분리 추천. 이동 전 기록을 새 섬에 복사하지 않음. 부모가 사용자에게 질문했고 답변 대기 | 해당 집계 쿼리/백필 활성화 금지 |
| RC-D02 | 측정 대상 범위·OS별 정확도·대표1대/sum/max, 대표기기 변경/소유 바인딩 | **결정(2026-09-22 GROMO-1806, RC-D02-병합)**: 복수 기기 병합은 **하지 않는다** — 합산·최대·대표1대 어느 것도 채택하지 않고 「기기별 최신 하나, 같은 날 기기 둘 이상이면 minutes=null·unavailable」이 확정 계약이다(아래 「복수 기기 규칙과 입력·응답 예시」). 병합을 새로 켜려면 결정 로그의 새 행이 먼저다. **소비자 추가(2026-09-21 GROMO-2001)**: 일일 스크린타임 퀘스트 판정이 이 관측을 읽는다. 「기기별 최신 하나 · 같은 날 복수 기기는 병합 없이 측정 불가」 규칙의 정의는 `screentime/support/ScreenTimeDayPick` 한 곳이고 회관 기록 조회와 판정이 그것을 공유한다 — 규칙이 갈라지면 도서관이 「측정 불가」로 보여 주는 날을 퀘스트가 「달성」으로 정산한다. 판정에서 복수 기기는 «유예 없이» 분모 밖이다(기다린다고 기기 수가 줄지 않는다). 보상 정산 자체는 여전히 `island-quest.settlement-enabled`(기본 false) 뒤에 있다. **부분 결정(2026-09-19 RC-D02-기기, 유지)**: 기기 = 서명된 로그인 세션(deviceId=sid). ~~보류 — 2026-09-18 재영님 결정 D7~~ → D7 의 「표시·집계는 출시 후 결정」은 「병합 없음 유지」로 닫혔다. **미결로 남는 것**: 측정 대상 범위·OS별 정확도·legacy projection 귀속(RC-D05 연계) | 검증된 기기·수집 경계와 남은 미결 해소 전 공개 일집계/신규 수집 활성화 금지 — [결정 로그](../decision-log.md) |
| RC-D03 | 일부 날짜/주민만 수집한 기간 합계·status, denied 후 과거 숫자 표시, 미래 날짜 그래프 | **결정(2026-09-19 RC-D03, 권장안+보수안)**: 결측 비보간, 지난 날짜 전부 authorized 일 때만 합계, 기간 상태=최근 날짜, denied 뒤 과거 숫자 비노출, 미래 날짜는 결측 아님. 결측 날짜를0으로 채우지 않고 불완전 합계는 전체처럼 표시하지 않는 안 추천. 상태 우선순위/기간 합 노출은 미승인 | 기간 resolver 결정표·화면 표시 검증 전 활성화 금지 |
| RC-D04 | measuredAt 미래 관용치·과거 보고 허용 창·마감 후 정정/보상 관계 | **결정(2026-09-19 RC-D04, 권장안)**: measuredAt ∈ [날짜 00:00Z, 서버+1분], 마감 다음 날 12:00Z(설정값), 마감 후 정정 없음, PUT 보상 0. 서버 설정 revision으로 관리 추천. 기존 내기2분/오늘·어제 보상 창을 자동 승계하지 않음 | 유효 범위 설정과 마감/정정 규약 전 PUT 활성화 금지 |
| RC-D05 | 과거 섬 귀속/가입·탈퇴 이력 없는 legacy 데이터, 과거 주민 노출 | **결정(2026-09-19 RC-D05·범위)**: legacy·정산 없는 세션 제외, 과거 주민 비노출. 추측 백필 금지. 확인된 provenance와 unknown 분리 추천 | unknown을 새 섬 통계로 포함하기 전 명시 정책 필요 |

2026-09-19 소유자 결정(N26)으로 RC-D01·D03·D04·D05 는 권장안(권장안 없는 세부는 가장 보수적인 안)으로 확정됐고, RC-D02 는 기기 식별만 정했으나 **2026-09-22 GROMO-1806 으로 복수 기기 규칙(병합 없음 — null·unavailable)까지 닫혔다**(위 「복수 기기 규칙과 입력·응답 예시」, [결정 로그](../decision-log.md) RC-D02-병합). 남은 미결은 RC-D02 의 측정 대상 범위·OS별 정확도·legacy projection 귀속뿐이다 — 전체 표와 반려한 대안은 [결정 로그](../decision-log.md) 2026-09-19 RC-* 행. 이전 문장(아래)은 이력이다. ~~RC-D01/02는 이미 질문 중인 제품 선택이다. RC-D03/04/05는 연관 기획·퀘스트 결정과 함께 확정하며 기본값을 발명하지 않는다.~~ 내부 원본 저장·CAS·DTO·비활성 구현과 정적 검증은 독립 진행할 수 있다. '일단0분' 또는 '일단 보상0' 성공은 미측정/미결 의미를 영구 손상시키므로 금지한다.
