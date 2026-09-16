# 게시판 정책

[색인](README.md) · [상세 설계](low-level-design.md)

## 유지 규칙과 기술 선택

| ID | 규칙 | 상태·근거 |
| --- | --- | --- |
| B01 | 주민만 읽기/댓글, 게시판 완공 후 접근. 방문자는 거절 | 원본6계약. 시설 정본은 Data |
| B02 | 기존 공지는 OWNER 또는 announcement_permission=ALLOW가 작성·수정·삭제 가능하고 타인 공지도 대상 | main GroupAnnouncementService/GroupMember. legacy 실제 동작 보존 |
| B03 | 신규 공지 권한도 B02를 호환 기준으로 설계하되 최종 공통 권한 행렬 답과 대조하기 전 writer 활성화 금지 | 새 UI의 방장만 표시를 서버 정책 승인으로 간주하지 않음 |
| B04 | 공지 작성자 user는 nullable이며 탈퇴 후 공지 보존이라는 기존 의도를 유지 | 실제 nullify/지연 UPDATE 차단은 계정1756/1757과 함께 구현해야 함 |
| B05 | 공개 body는 기존 content에 매핑. 제목 상한100 UTF-16 단위와 공백 거절 유지 | 기존 CreateAnnouncementRequest. 본문/댓글 신규 상한은 BQ03 |
| B06 | 신규 PATCH는 title/body 중 하나 이상 제출, 생략은 유지·null/빈값 거절. 둘 다 보내는 원본도 허용 | 부분 변경의 기술 선택. legacy PUT의 두 필드 필수는 보존 |
| B07 | 4개 쓰기에는 UUID Idempotency-Key 필수. 동일 키/의미 본문은 원 결과, 다른 본문409 | 공통1750. 공지PATCH에 expectedVersion을 새 필수로 추가하지 않음 |
| B08 | 공지 자체와 댓글 변화가 같은 notice.version을 증가. 댓글 저장/count/버전/outbox/receipt 같은 TX | 이벤트1754의 무효화 key와 일치. 삭제 사건 버전도 내구화 |
| B09 | 목록은 createdAt DESC,id DESC, 댓글 페이지는 createdAt ASC,id ASC | 안정적인 동률 정렬의 기술 선택. 커서 actor/island/notice/filter 결박 |
| B10 | 현재 인가 없는 원 결과 재생 금지. 비활성 계정은404 USER_NOT_FOUND | 공통 제한 재생 예외를 이 도메인에 임의 확대하지 않음 |

## 결정 대기와 출시 조건

| ID | 입력이 필요한 부분 | 권고·활성화 조건 |
| --- | --- | --- |
| BQ01 | 공지 신규 권한 행렬 | 기존 OWNER/ALLOW와 타인 수정·삭제 유지 권고. 이미 대기 중인 공통 질문의 답으로 통일하며 legacy 제한은 소급 변경하지 않음 |
| BQ02 | 댓글 본인/관리자 삭제·공지 삭제 시 댓글 처리·계정 탈퇴 후 댓글 원문 보존 여부 | 댓글은 신규 저장물이다. 기존 공지 보존을 댓글에 자동 적용하지 않음. 본문/사용자FK/프로필 사본/receipt·outbox의 파기 범위를 함께 결정하기 전 댓글 writer 출시 금지. 댓글 DELETE endpoint 추가는 별도 범위 결정 |
| BQ03 | 신규 본문·댓글 크기와 운영 제한 | 기존 제목100은 유지하되 공지 본문 무제한이나 chat2000자를 새 댓글 정책으로 자동 채택하지 않음. 유한 저장/전송 한계 및 오류422의 구체 제한을 배포 설정·문서에 명시하기 전 writer 출시 금지 |

정책 미답을 빈 댓글/가짜 commentCount0 또는 임의 권한으로 숨기지 않는다. 저장소·커서·인가·원자성 테스트는 진행할 수 있지만 해당 새 기능은 준비 전 비활성으로 유지한다. 기술 수치인 페이지 기본30/최대100은 정책상의 게시물 제한이 아니며 성능 검증으로 조정 가능하다.
