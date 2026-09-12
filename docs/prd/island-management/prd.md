# 섬 관리·주민 — PRD

> GROMO-1761 · 2026-09-12 · **검토 초안 / 공용 권한·강퇴 보상 정책 결정 대기**
> [권한 행렬](./permissions.md) · [구성 설계](./high-level-design.md) · [상세 계약](./low-level-design.md) · [소속 설계](../island-membership/prd.md)

## 목적과 범위

섬의 현재 방장과 주민이 자신의 역할에 맞는 관리 작업만 수행하도록 한다. UI에서 버튼을 숨기는 것은 권한 검증이 아니다. 가입 요청 승인·방장 위임·강퇴·나가기는 최신 DB 권한을 검사하고 같은 TX에서 관련 상태를 일관되게 바꾼다.

| 계약 ID | 메서드 | 신규 경로 |
|---|---|---|
| manage | PATCH | `/islands/{islandId}` |
| members | GET | `/islands/{islandId}/members` |
| requests | GET | `/islands/{islandId}/join-requests` |
| request-answer | PATCH | `/islands/{islandId}/join-requests/{requestId}` |
| transfer | POST | `/islands/{islandId}/host-transfer` |
| kick | DELETE | `/islands/{islandId}/members/{userId}` |
| leave | DELETE | `/islands/{islandId}/memberships/me` |

구현 담당은 참고 티켓 1762다. 소속·초대 11계약과 합쳐 원본 18계약을 구성한다. 초대 발급 경로는 소속 문서에 한 번만 정의하고 이 문서에는 권한만 둔다.

## 기존 구현과 채택된 신규 요구의 구분

- 저장 역할은 group_members.role OWNER/MEMBER이고 외부는 host/member다. 별도 host_id를 되살리지 않는다.
- 정보 수정·위임·강퇴는 현재 방장. 일반 주민도 주민 목록을 읽고 본인만 자진 탈퇴할 수 있다.
- 방장 본인 강퇴는 불가. 남은 주민이 있으면 위임 후 나가며 마지막 1인 이탈은 그룹 종료다. 종료 TX에 island.updated/group.closed를 기록하고 모든 pending을 cancelled로 종결하여 신청자에게 비민감 개인 이벤트를 보낸다. 자동 방장 추첨 정책을 만들지 않는다.
- **원본의 신규 요구이며 main 미구현**: 자진 탈퇴는 진행 중 집중과 충돌한다(원본 leave 예외409). 1762가 active/paused 검사와 focus-start/leave의 공통 잠금을 새로 구현해야 한다. 현재 GroupMemberService.withdrawGroup에는 집중 검사가 없으며 UI가 상태를 보내 대신 판정하게 하지 않는다.
- 기존 강퇴 이력은 재가입 차단, 자진 탈퇴 재가입은 기존 membership 행을 재활성화한다. 링크 발급자 이탈/강퇴·계정 탈퇴 폐기는 기존 링크 문서와 아키텍처 장부 ⓑ·ⓚ에 채택된 **목표 정책이며 main의 모든 상환 경로에 구현된 것이 아니다**. 1659 선행 통합과1762가 발급자 현재 멤버십·epoch 대조, 폐기 outbox, 실제 가입 TX 검사를 연결해야 한다. 단순 위임 후 활성 멤버 링크 유지와 구분한다.
- 기존 코인 내기에서 자진 탈퇴는 OPEN 참가 해제·환불/정리, 강퇴는 판돈을 임의 변경하지 않는 기존 동작이다. 새 퀘스트/물고기 보상을 그 내기와 동일시하지 않는다.

근거는 [기존 운영 HLD](../group/features/04-operation/high-level-design.md), [기존 운영 LLD](../group/features/04-operation/low-level-design.md), [획득 링크 수명](../group/features/01-acquisition/high-level-design.md)다. 코드의 미구현/경합 한계는 본 문서의 LLD에서 별도로 밝힌다.

## 요구사항

| ID | 요구사항 |
|---|---|
| G01 | 권한 행렬의 각 행동×역할을 서버와 테스트가 같은 규칙으로 해석 |
| G02 | 방장 위임의 이전 강등·새 방장 승격은 하나의 TX; 타섬/탈퇴자/자기자신 위임 거절 |
| G03 | 승인과 취소/거절 경합에서 한 전이만 승리; 승인과 실제 membership 생성이 분리되지 않음 |
| G04 | 강퇴/탈퇴가 정원·현재 섬·실시간 수신·초대 자격에 일관되게 반영 |
| G05 | 다른 섬 requestId/userId 혼합과 이전 방장의 지연 요청을 차단 |
| G06 | 개인/공동 재화 및 미수령 보상을 이 문서가 임의 소각·환불·승계하지 않음 |
| G07 | 재시도는 저장된 명령 결과를 재생하고 새 처리/알림/차감을 만들지 않음 |
| G08 | 신규 API는 접두어 없는 경로·공통 봉투, 기존 `/api/v1` 동작 보존 |

## 아직 닫히지 않은 완료 조건

공동 건설·퀘스트 작성·공지 작성·공동 구매·테마 적용 권한은 사용자 질문 답변 대기다. [권한 행렬](./permissions.md)에서 TBD로 유지한다. 미정 권한을 '방장만' 또는 '모두'로 자동 확정하지 않는다.

강퇴 대상의 active/paused 세션을 종료할지, 종료 시점의 개인 보상과 공동 회차의 미수령 보상/기여를 어떻게 보존할지도 결정이 필요하다. 추천안은 개인 확정 보상 보존과 서버의 원자 종료이며, 채택 전에는 이 초안이 정책 완료를 뜻하지 않는다. 현재 섬 상실 후 이유별 복구와 시설 예외 여부는 소속 IM-D06의 미승인 추천 전이와 함께 결정한다. 복구 없는 null로 인한 영구 대기와 null 첫소속 처리에 의한 시설 우회를 출시 차단 조건으로 공개한다.
