# 제품 PRD 인덱스

기능 문서는 제품 세대별로 나눈다. 폴더 이름만 보고도 어느 앱에 적용되는지 판단할 수 있어야 한다.

| 제품 | 적용 범위 | 앱 코드 | 문서 |
| --- | --- | --- | --- |
| GROMO 1.x | 스토어 1.1.0까지의 기존 제품과 호환 유지 | `app/legacy/app-dev/` | [`gromo/`](gromo/) |
| Fishcat 2.0 | 현재 개발 중인 2.0 제품과 1.x→2.0 전환 계약 | `app/app-dev/` | [`fishcat/`](fishcat/) |

## 분류 원칙

- 기존 GROMO의 그룹·챌린지·코인·스크린타임·그로몬 기능은 `gromo/`에 둔다.
- Fishcat의 섬·고양이·낚시·물고기 기능과 신규 API 계약은 `fishcat/`에 둔다.
- Fishcat 출시를 위해 기존 GROMO 데이터나 API를 승계하는 문서는 `fishcat/`에 둔다. 문서 안에서 `gromo/` 문서를 호환 근거로 참조할 수 있다.
- 두 제품에 모두 적용되는 시스템 아키텍처와 팀 규약은 각각 `docs/architecture/`, `docs/contracts/`, `docs/conventions/`에서 관리한다.
- 새 기능 폴더는 반드시 `gromo/` 또는 `fishcat/` 아래에 만든다. `docs/prd/` 바로 아래에는 기능 폴더를 만들지 않는다.

각 기능 폴더의 문서 역할과 작성 규칙은 상위 [문서 인덱스](../README.md)를 따른다.
