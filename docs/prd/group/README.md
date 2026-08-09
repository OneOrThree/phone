# 그룹 문서 지도

이 폴더는 **그룹 전체 제품 결정 → 정보 구조 → 기능 설계 → 구현 계약** 순서로 읽는다.

```text
prd.md                          그룹 생애주기·가치·공통 정책·지표
information-architecture.md     그룹 전체 정보·화면·권한·이동
high-level-design.md            01~04 기능 책임·데이터·연결 통합본
low-level-design.md             01~04 상태 전이·경합·복구·테스트 통합본
features/
├─ 01-acquisition/              찾기·초대·생성·가입
│  ├─ high-level-design.md
│  └─ low-level-design.md
├─ 02-my-groups/                소속 그룹 카드 덱·요약·집중/방 진입
│  ├─ prd.md
│  ├─ information-architecture.md
│  ├─ high-level-design.md
│  ├─ low-level-design.md
│  ├─ ux-design.md
│  └─ ux.html · ux-shared.js
├─ 03-activity/                 그룹 방·멤버·집중·공지
│  ├─ high-level-design.md
│  └─ low-level-design.md
├─ challenge/                   별도 PRD·IA·HLD·LLD 작성 예정
└─ 04-operation/                프로필·역할·멤버·권한·이탈
   ├─ high-level-design.md
   └─ low-level-design.md
```

## 정본 우선순위

1. [prd.md](./prd.md): 왜 만들며 무엇을 성공으로 볼지 결정한다.
2. [information-architecture.md](./information-architecture.md): 사용자가 보는 정보와 화면 관계를 결정한다.
3. [high-level-design.md](./high-level-design.md): 01~04 기능의 책임과 연결을 통합해 결정하고, 기능별 HLD가 세부 경계를 보완한다.
4. [low-level-design.md](./low-level-design.md): 생애주기 전체의 상태·경합·복구를 통합하고, 기능별 LLD가 세부 실행을 보완한다.
5. UX·목업: 확정된 기능 범위 안에서 시각·상호작용을 구체화한다.

상위 문서와 하위 문서가 충돌하면 상위 결정을 우선한다. 하위 문서에서 새로운 제품 목표나 권한 정책을 추가하지 않는다.

## 문서 작성 원칙

- 그룹 전체 PRD에 특정 화면의 픽셀·컴포넌트·API 호출 순서를 넣지 않는다.
- 기능 HLD에 제품 효과를 새로 주장하지 않는다.
- LLD는 코드 복사본이 아니라 놓치기 쉬운 상태·경합·복구·검증만 남긴다.
- 같은 이벤트·정책을 여러 문서에서 정본으로 선언하지 않는다.
- 현재 구현 사실, 확정 정책, 아직 검증할 가설을 문장 안에서 구분한다.
