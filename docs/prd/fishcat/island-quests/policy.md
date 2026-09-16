# 섬 퀘스트 정책

[색인](README.md) · [상세 설계](low-level-design.md)

## 유지 규칙과 기술 선택

| ID | 규칙 | 상태·근거 |
| --- | --- | --- |
| Q01 | type=focus는 시간대 집중 목표, type=screen은 하루 사용 상한 | 원본2종. 기존4조합 챌린지와 구분 |
| Q02 | 날짜·창 시각은 Asia/Seoul. timezone 생략은 같은 값, 다른 값/중복은400 INVALID_PARAMETER | 공통1750의5개 timezone 입력 정본. 임의 사용자 타임존 신설 없음 |
| Q03 | 집중은 서버 ACTIVE 구간만 합산, REST는 제외. 측정 불가 screen rate는null | 집중1763/원본. 기존 start-end/5분 관용치를 그대로 쓰지 않음 |
| Q04 | 서버가 전체 판정 대상에 대해 claimable을 계산. cursor 한 페이지의 달성률로 판정하지 않음 | 원본의 본인100% reducer와 구분 |
| Q05 | 지급 owner는 해당 섬, currency=village_points. 개인 fish/coin 또는 내기 지급 아님 | 원본 계약. 10P는 목업, 운영 amount 미확정 |
| Q06 | 같은 island·occurrence 보상 정산은1회. claim/지갑/원장/receipt/outbox 단일 Data TX | 원본 원자 처리. 요청키와 도메인 지급 유일성은 별도 |
| Q07 | 회차 정의·보상 revision·판정 cohort를 명시 저장. 과거 결과는 원본5개 밖 | 기술 기반. snapshot을 언제 확정할지는 QQ01/02 |
| Q08 | 생성/수정/claim UUID Idempotency-Key 필수. claim만 expectedVersion 필수 | 공통1750. 새로운 PATCH 낙관락 입력을 원본에 몰래 추가하지 않음 |
| Q09 | claimDisplay/ack는 기존 결과 모달 표시 리스이며 보상 지급이 아니다 | 기존 ChallengeResultAckService. 호출해 정산을 대신하지 않음 |
| Q10 | 기존 챌린지·내기·coin 원장은 변경 없이 유지. 조회/claim이 FocusService.recordCompletion을 재호출하지 않음 | 중복 통계/개인 보상 방지 |

## 결정 대기와 출시 조건

| ID | 미결 정책 | 권고와 제한 |
| --- | --- | --- |
| QQ01 | 판정 주민 고정 시점, 중도 가입/탈퇴/강퇴·계정 탈퇴·측정 불가자 처리 | 회차 시작 cohort 고정 권고. 이탈 예외/필수 달성 대상은 답 필요. 현재 주민 모두로 매번 재구성하거나0명 전원성공으로 지급 금지 |
| QQ02 | 반복 주기·시작/종료일·자정 넘는focus창·진행 중 PATCH 적용 시점 및 입력 범위 | 열린 회차는 정의 불변, 변경은 다음 회차 적용 권고. 아직 제품 승인 아님. 회차 생성 scheduler/수정 출시 전 확정 |
| QQ03 | focus 관용치·rate 반올림, screen rate 표시식·최종 마감/grace·정정/측정권한 철회/다중기기 | KST 날짜축은 확정. 기존 내기5분·미측정=실패를 새 운영 기본값으로 쓰지 않음. screen이 오전에 상한 이하라고 성공 지급 금지 |
| QQ04 | 퀘스트 생성/수정/claim 역할 | 기존 챌린지OWNER는 참고이며 새 공통 권한 질문 답과 일치시켜야 함. 원본 claim은 주민 요청·서버 판정이며 관리자만으로 임의 축소하지 않음 |
| QQ05 | 보상 amount·revision/기존자산승계 | 10P 자동 채택 금지. 승인된 포인트 원장과 보상 설정이 준비돼야 지급 활성화. 0P 성공으로 미구현을 숨기지 않음 |

QQ01~05 및 집중/측정 정본이 해결되기 전 새 생산 데이터를 만드는 기능과 정산은 닫는다. 설계 완료가 이 제품 결정의 완료를 뜻하지 않는다. 유효한 기존 챌린지를 새 퀘스트로 자동 마이그레이션/중복 등록하지 않는다.
