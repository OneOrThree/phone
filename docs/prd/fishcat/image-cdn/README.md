# 이미지 CDN과 기기 캐시

2026-10-29 설계. 구현/배포 상태는 [실행 계획](implementation-plan.md)에서 별도로 관리한다.

| 문서 | 내용 |
| --- | --- |
| [PRD](prd.md) | 문제·사용자 이야기·요구사항·완료 기준 |
| [정책](policy.md) | 기기 저장 수명·예산·삭제·호환·초기 기본값 정본 |
| [High-level design](high-level-design.md) | 컴포넌트·책임·다운로드/배포 데이터 흐름 |
| [Low-level design](low-level-design.md) | 스키마·공개 API·파일 배치·원자성·경합·GC 알고리즘 |
| [실행 계획](implementation-plan.md) | Jira 티켓·의존성·수용 조건·배포 순서 |
| [사전 검증](../../../architecture/image-cdn/README.md) | 초기 조사·자산 목록·공식 근거 |

정책 충돌 시 이 폴더의 policy를 먼저 수정하고 PRD/HLD/LLD/테스트를 맞춘다. 사전 조사에 남아 있는 초기 제안보다 이 구현 계약이 우선한다. 기존 맵 계약과 사용자별 카탈로그 권한은 변경하지 않는다.
