# 공용 음악 정책·결정 기록

| ID | 계약 | 출처·상태 |
| --- | --- | --- |
| M01 | 활성 주민 + 완공된 gram 필요. 집중 중 접근 허용 | 원본 및 PR737. 채팅 집중 가드를 playback에 전파하지 않음 |
| M02 | 같은 섬 주민 누구나 곡/재생 변경, 방장 승인·투표 없음 | 원본 명시. 공유 포인트 소비 권한 미결과 구분 |
| M03 | 섬이 실제 소유한 ASMR만 선택. 소유 조회와 변경은 같은 TX | 원본·PR742. 로컬 보유 주장/임의 URL 금지 |
| M04 | volume/mute는 기기 로컬, 서버 PATCH 필드 아님 | 원본 |
| M05 | 위치는 effectiveAt에서의 positionSeconds. 재생 시 서버 경과를 더하고 곡 길이로 반복 | 원본 명시. 끝마다 DB 갱신·사건을 만들지 않음 |
| M06 | 재생 axis=(playback,islandId). PATCH expectedVersion+Idempotency-Key 필수 | PR737/738. version 증가와 사건은 실제 변경 때만 |
| M07 | trackId에 연결된 불변 서버 미디어 메타데이터의 durationSeconds를 응답/사건에 추가 | 승인된 기술 확장. 현재 PR737에 이미 있다는 뜻이 아님. 1779 producer 활성화 전 1754 payload·1755 validator/adapter·앱 동기화 및 회귀가 선행 조건 |
| M08 | 초기 GET: trackId=null, playing=false, positionSeconds=0, durationSeconds=null, changedBy=null | 기술 선택. 무료 곡/가짜 조작자 생성 금지. 초기 GET은 사건을 생산하지 않음 |
| M09 | 실제 PATCH 후 changedBy는 검증된 사용자 UUID, playback.updated에도 필수 | PR737 정본. 원본 minji/me는 예시이며 인증 주체 대용 아님 |
| M10 | 곡 변경은 위치0. pause는 현재 위치를 고정, resume은 그 위치부터. 같은 track 재전송은 곡 변경이 아님 | 기술 선택. source의 trackId/playing 부분 명령을 결정적으로 해석 |

## 원본 대조

| 원본 예시/설명 | 채택 |
| --- | --- |
| `/v1/islands/{islandId}/playback` | `/islands/{islandId}/playback`, 기존 API 보존 |
| 원본 GET/PATCH 응답7필드 | 모두 보존 + durationSeconds. 초기 GET의 nullable 상태는 별도 예시 |
| changedBy=minji/me | 인증 사용자 UUID36. 단 초기 미선택 GET만 null |
| PATCH trackId+playing+expectedVersion | trackId/playing 중 최소 하나 + expectedVersion, 각 명시 필드는 null 불허 |
| 반복 설명은 있으나 곡 길이 wire 없음 | 불변 미디어의 durationSeconds 추가. trackId가 있으면 양의 유한 초, 없으면 null |
| 원본 예시 JSON | source-contracts.json에 그대로 보존 |

미디어 길이는 양의 유한 숫자 초이며 소수초를 보존할 수 있다. 원본 positionSeconds도 초 단위 숫자로 읽되 공개 PR737 `Seconds` 정수 계약에 맞춰 positionSeconds는 음수가 아닌 정수로 내린다. 저장/공개 anchor를 같은 값으로 고정하여 GET 때만 정밀도를 바꾸지 않는다. 초 미만 정밀 재생 API를 새로 약속하지 않으며 단말 디코더·네트워크 차이에 따른 오차를 관측한다.

초기 GET의 version=0을 허용하고 첫 실제 변경은1이다. 이후 양의 JS 안전 정수 범위를 사용한다. UUID36 필수, v4/v7 생성 권고다. trackId는 서버 불변 미디어 식별자이며 같은 ID의 오디오와 duration을 몰래 교체하지 않는다. 미디어 개정은 새 ID와 소유 호환 정책 검토를 거친다.

공통 성공은 {data}, 오류는 code/message/field/retryable + requestId이며 허용된409에만 top-level current를 둔다. 재생 receipt 응답의 serverNow는 원 결과를 보존하고 X-Request-Id/오류 requestId는 현재 요청의 서버 ID다. 오래된 재생 응답의 serverNow를 현재 시각으로 오인하지 않는다.
