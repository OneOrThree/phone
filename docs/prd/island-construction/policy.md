# 건설 정책·결정 기록

이 파일은 건설 세 계약의 정책 정본이다. 원본 v0.3-proposed의 예상 계약, 사용자 결정, 이번 기술 선택을 구분한다.

| ID | 계약 | 근거·상태 |
| --- | --- | --- |
| C01 | 회관→게시판 고정, 이후 전망대/우체통/방송기 선택, 전망대 AND 우체통→상점. 방송기 때문에 상점이 잠기지는 않음 | 원본 단계 그래프 보존. 운영 그래프 변경은 별도 정책 개정 |
| C02 | 방송기 gram=100 village_points. hall 기여20/board 추가 기여40(초기 합계60), tower300/mail400/shop500 및 현재 잔액150은 예시 | 원본·1766에서 방송기만 확정. 나머지 운영값 미답 |
| C03 | 목표 PUT은 항상 차감0, 선행 조건만 맞으면 잔액 부족이어도 선택 가능 | 원본. 권한 검사는 별도 |
| C04 | 건설은 시설·원장·잔액·버전·receipt·outbox를 같은 Data TX로 확정 | 공통·경제·외양 정본 재사용. Business에는 DB/돈 TX 없음 |
| C05 | 개인 `user/fish`와 공동 `island/village_points`만 지갑 축으로 사용 | PR742. 초기 집중 기여는 건설 진행량이며 `island/fish` 지갑을 만들지 않음 |
| C06 | 완료한 시설의 재건설은 새 키이면409 STATE_CONFLICT, 원 키이면 원 성공 재생 | 기술 선택. 이미 완료했다는 이유로 새 결제하지 않음 |
| C07 | 건설 직후 외양의 새 시설 기본 테마를 포함한 전체 buildingThemes와 외양 version 갱신·전체 사건을 같은 TX에 저장 | PR742. GET에서 버전 없이 키를 늘리지 않음 |
| C08 | GET options는 활성 주민 조회이며 변경 권한이 없는 주민도 항목별 FORBIDDEN 사유를 본다. PUT/POST 실행 권한은 별도이고 방장 UI가 서버 정책 승인을 뜻하지 않음 | 원본·공동 소비 권한 미결. P-D01 출시 차단 |
| C09 | 초기 집중 기여의 시간 배분·완공 경계·초과분 보존은 PR743 FR-D02를 따른다 | 미결. 개인 지급/기여를 중복하거나 초과분을 버리지 않음 |
| C10 | 가격 정책은 불변 revision과 현재 publication 포인터로 관리; GET costPolicyVersion, POST expectedCostPolicyVersion 필수 | 승인된 기술 확장. 섬 version과 별개이며 목표 PUT에는 불필요 |
| C12 | GET options와 POST 건설 응답의 walletVersion은 같은 snapshot의 공동 지갑 version. 잔액과 buildable의 최신성은 이 축으로 판정 | 명시 응답 확장. islandVersion/costPolicyVersion과 독립 |
| C11 | 실제 상태가 바뀔 때만 해당 aggregate version과 사건 증가. 같은 값 목표 PUT은 현재 version 확인 후 무변경200 | 기술 선택. receipt는 저장하되 새 사건/차감 없음 |

## 원본 대조·타입

| 원본 | 채택 계약 | 이유 |
| --- | --- | --- |
| 세 경로의 `/v1` | 접두어 없는 신규 Business 경로 | 사용자 결정. 기존 `/api/v1` 보존 |
| POST buildingId + expectedVersion | 두 필드 보존 + expectedCostPolicyVersion 필수 | 가격만 바뀌는 경우에도 사용자가 본 가격으로 동의했는지 확인 |
| GET islandVersion + selectedBuildingId + villagePoints + items | 보존 + costPolicyVersion | 가격 스냅샷과 실행 동의 연결 |
| 예시 가격300/400/500 | 원본 JSON에만 보존 | 운영 설정으로 발명하지 않음 |
| 공통 키·오류 없는 예시 | 쓰기 Idempotency-Key, 성공 {data}, 오류4필드+requestId | PR738. 원본 JSON은 수정하지 않음 |

UUID는 하이픈 포함 36자 형식 필수, v4/v7 생성 권고다. UUID 버전 자체를 v4/v7로 제한하지 않는다. 자원 version과 costPolicyVersion은 0 이상 JS 안전 정수, mutation 사건 version은 양수다. 비용·잔액은 음수가 아닌 정수이며 서버 산술·합산 overflow를 거절한다. `selectedBuildingId`는 목표가 없으면 null이다. 이미 완공된 목표를 GET에서 다른 시설로 자동 선택하지 않는다. 완료 시 선택된 목표의 처리(유지/해제/다음 목표)는 P-D02에서 제품 결정한다.

## 미결·출시 조건

| ID | 미결 | 승인 전 조건 |
| --- | --- | --- |
| P-D01 | 공동 포인트 소비와 목표 변경을 방장만 할지 주민에게 열지 | 권한 기본값을 ANY/OWNER로 발명하지 않고 해당 mutation 활성화 차단. 조회 selectable/buildable도 승인된 evaluator 없이는 출시하지 않음 |
| P-D02 | 초기 회관/게시판 필요량, FR-D02 시간 배분·초과분, 초기 완공 트리거 및 완공 후 목표 유지/해제 | 추천: 집중 정산과 동일 완공 primitive를 사용하고 진행량을 한 번만 소비. 목표 해제/다음 자동 선택은 미승인. 초기 경로 및 목표 후처리 활성화 전 결정표 필수 |
| P-D03 | 방송기 외 실제 가격 및 적용 시작 revision | 목업으로 운영 설정을 seed하지 않음. 설정 누락은 배포 구성 오류로 차단 |

방송기 100P 확정은 공유 돈을 누가 쓸 수 있는지까지 확정하지 않는다. 반대로 음악 재생 변경은 원본이 주민 누구나로 명시했으므로 P-D01을 음악 조작에 적용하지 않는다.
