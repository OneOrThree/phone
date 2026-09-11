# 계정·설정 API

GROMO-1756 · 2026-09-12 · **설계 문서. 구현/배포 완료가 아니다.**

| 문서 | 목적 |
| --- | --- |
| [PRD](prd.md) | 계정7개 계약의 범위·호환·완료 기준 |
| [정책](policy.md) | 기존 정책, 신규 필드, 결정 대기 항목 |
| [HLD](high-level-design.md) | 인증·세션·탈퇴·설정의 소유 경계와 흐름 |
| [LLD](low-level-design.md) | 7개 스키마·토큰 회전·PII 목록·검증 |
| [원본7계약](source-contracts.json) | 원본 예시를 바꾸지 않은 비교용 추출 |

조사 기준 main은 `529a396e5f0f88cb78c172110920e1fa6b9388a9`다. main과 다른 세션1659의 미통합 코드를 구분한다. 구현 코드 링크는 이 기준에 실제로 있는 파일만 사용한다.

원본은 화면별 API v0.3-proposed, 관련 티켓1739다. 원본 HTML SHA-256은 `2b56a4553d75863f1c1db50fd1c1f7123dd21ecf99bac4d38959ad945e9f9c30`이다. `source-contracts.json`은 원본을 대조한 배치 색인의 계정7행만 추출했고 샘플 필드는 그대로다. HTML 전체 복사본은 선행1750 API 플랫폼 문서 PR에서 보존한다. 아직 main에 없는 `../api-platform/` 링크를 만들지 않는다.

정본 우선순위는 사용자 결정 → [아키텍처 결정 장부](../../architecture/decisions.md)·기존 도메인 정책 → 이 세트의 `policy.md` → 예상 스펙이다. 1750의 공통 계약(무접두어, `{data}`, 오류4필드+requestId, 앱 키, 주체 위조 방지)은 선행 설계 의존이다. 미답변 제품 정책은 승인된 것으로 간주하지 않는다.

PR 740 검토 반영: 공지 작성자 FK 파기와 생성 경합, RT-only 로그아웃/기기 DELETE 분리, 본인 계정 부재 `USER_NOT_FOUND`, 로그인 CAS 경쟁의 동일 시도 재준비를 LLD·HLD·정책·검증 표에 일치시켰다. UUID는 하이픈 포함 36자 형식이 필수이고 v4/v7은 생성 권고다. 원본 예시 7개와 미답 제품 입력은 변경하지 않았다.

추가 검토 반영: 기기 DELETE의 고정 멱등 키와 ownership 변경 후 완료 재생, 창형 화면시간 원본의 같은 TX 파기·증거 확정 검증, 기존 `400 UNSUPPORTED_PROVIDER`, 신규 `/me` 진입 전 sidless AT의 강제 refresh 및 인증 묶음 원자 교체를 문서 전반에 반영했다. 현행 앱의 AT 유효기간 빠른 반환·분리 저장과 기존 증거 동결의 target 부재 skip은 후속 구현에서 해소할 차이로 명시했다. 기존 API 및 원본 7계약 예시는 보존한다.

최신 검토 반영: 양방향 `user_blocks`와 본인 `user_streaks`의 파기·writer 직렬화, 유효한 비게스트 AT의 정상 계정 전환, 제공자 6종 `*_TOKEN` 및 refresh/logout `REFRESH_TOKEN`의 기존 401을 유지한다. 최초 legacy RT 승격의 응답 유실에는 원 RT 해시·고정 서명 재료를 가진 전용 인증 receipt가 필요하다. 현재 미구현임을 구분하고, 동일 sid AT/RT 재생 조건과 폐기 우선 규칙을 정했다. 게스트의 복구창/장기 실패 처리(Q06)와 실패 주입 검증은 강제 전환 출시 조건으로 남긴다.

추가 호환·파기 보완: 구 앱의 새 AT/원 legacy RT 혼합 저장도 신규 진입을 막고 원 RT 승격 receipt로 복구한다. Ready는 AT/RT 타입·주체·sid·세대 일치를 요구하며 Q06 복구 시간은 미결로 유지한다. updateFocusTag의 새 채택·세션 재연결과 탈퇴를 직렬화하고 character_equipment 장착 행을 같은 탈퇴 TX에서 파기한다. 원본7계약과 보유/정산 증거 보존 규칙은 변경하지 않았다.

로그아웃 순서·잔존 초대 파기 보완: 기기 삭제 실패는 RT 폐기와 로컬 정리의 선행 조건이 아니다. 미완료 삭제의 기기 자격/원 키 큐를 보존하고 폐기 후 재전송 인증 복구는 별도 gate로 남긴다. 미사용 `group_invites`도 본인이 inviter/invitee인 모든 상태를 같은 탈퇴 TX에서 파기하고 타인 행·rollback을 검증한다. snapshot writer 잠금과 Redis 랭킹 파기는 후속 구현 의무이며 현재 구현 완료로 표시하지 않는다.
