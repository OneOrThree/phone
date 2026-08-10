# 내 그룹 탐색 — 구현 착수 카드

## 왜 이 문서 세트가 있는가

카드 덱·플립·개인화·요약·첫 안내는 기존 세로 그룹 목록에 없는 **신규 계획**이다.
그래서 제품 결정부터 화면 구조, UX, 시스템 경계, 상태·검증을 분리한 PRD/IA/UX/HLD/LLD 세트를 둔다.
현재 상태와 남은 작업은 [공통 구현 상태의 `GRP-02`](../../shared/implementation-status.md)만 갱신한다. 이 문서 세트는 현행 앱·서버 계약을 바꾸지 않는다.

## 처음 30분 읽기

모든 문서를 처음부터 읽지 않는다. 먼저 [PRD 결정 요약](./prd.md#0-결정-요약) → [IA 화면 위치](./information-architecture.md#1-화면-위치-navigation-map) → 아래 맡은 작업 행만 읽는다.

| 작업                                   | 추가로 읽을 정본                                                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F02-T1`~`T2` 카드 골격·앞면           | [UX §2](./ux-design.md#2-캐러셀과-카드-골격) · [HLD §2·4](./high-level-design.md#2-화면-컴포넌트와-소유권) · [LLD §1·3](./low-level-design.md#1-그룹-카드의-정체성과-화면-복구)                                                                                 |
| `F02-T3`~`T4` 아이콘·순서              | [UX §4](./ux-design.md#4-제스처-충돌-해결-규칙) · [UX §8](./ux-design.md#8-내-카드-아이콘-개인-로컬-설정) · [LLD §2·3](./low-level-design.md#2-카드-순서아이콘-저장과-계정-경계)                                                                                |
| `F02-T5`~`T7` 뒷면·복귀                | [IA §3.3·4](./information-architecture.md#33-카드-뒷면-room-summary) · [HLD §3](./high-level-design.md#3-시스템api-경계와-데이터-흐름) · [LLD §4·5·9](./low-level-design.md#4-카드-뒷면-데이터와-늦은-응답)                                                     |
| `F02-T8`~`T9` 운영·첫 안내·접근성·계측 | [UX §7](./ux-design.md#7-그룹-설정) · [UX §1.1](./ux-design.md#11-첫-카드-덱-코치마크) · [HLD §6](./high-level-design.md#6-그룹-카드-첫-노출-코치마크-계약) · [공통 분석 계약](../../shared/analytics.md) · [LLD §6~8](./low-level-design.md#6-첫-카드-덱-안내) |
| `F02-T10` 평가·확대                    | [PRD §6·8](./prd.md#6-성공-지표와-실험-계약) · [UX §12](./ux-design.md#12-출시-전-형성평가와-ux-gate) · [규모 gate 실행](../../shared/implementation-status.md#02-규모-출시-gate-실행)                                                                          |

`ux.html`은 검토용 비정본 프로토타입이다. 구현과 UX 판단의 정본은 반드시 `ux-design.md`다.

## 실제 앱·테스트 시작점

- 화면 진입·목록: `app/src/screens/group/GroupScreen.tsx`, `GroupListScreen.tsx`
- 방·생성·설정: `GroupRoomScreen.tsx`, `GroupCreateScreen.tsx`, `GroupSettingsScreen.tsx`
- 기존 API: `app/src/services/groupApi.ts`, `app/src/services/leagueApi.ts`
- 회귀 테스트: 위 화면의 `*.test.tsx`, `app/src/services/groupApi.test.ts`, `leagueApi.test.ts`

카드 덱·플립·재정렬·로컬 아이콘·guide 전용 컴포넌트와 테스트는 아직 없다.

## 지금 시작할 첫 변경 단위

`F02-P0` 문서 gate는 끝났으므로 `F02-T1`부터 구현할 수 있다. 첫 PR은 **덱의 폭·페이지·indicator 상태만** 만들고 production `GroupScreen` 전환, flip, 원격 조회, 로컬 저장, analytics는 포함하지 않는다.

- 계획 파일: `app/src/screens/group/components/GroupCardDeck.tsx`, 같은 위치의 `GroupCardDeck.test.tsx`, 필요하면 순수 계산을 분리한 `groupDeckLayout.ts`와 테스트.
- 입력은 `GroupSummaryResponse[]`와 active stable `groupId`; `FindMoreCard`는 `groups.length + 1`번째 표시 항목이지만 서버/저장 배열에는 넣지 않는다.
- 완료: 320·390·430·768pt × 그룹 1·5·6·7·10개에서 page 수, dots/compact, active `groupId` 보존 단위 테스트가 통과한다.
- 검증 명령: `cd app && npm test -- --runInBand GroupCardDeck && npm run typecheck`.
- 실제 `GroupListScreen` 교체는 앞면·입력 계약을 함께 만족하는 다음 패키지 이후에 한다. 사용되지 않는 덱을 production route에 먼저 연결하지 않는다.

## 담당과 작업 묶음

- 앱: [`F02-T1`~`F02-T8`](./prd.md#12-작업-패키지와-후속-결정) 구현·회귀
- 앱·분석·QA: [`F02-T9`](./prd.md#12-작업-패키지와-후속-결정) 4단계 첫 안내·계측·접근성·E2E
- 제품·분석·운영: [`F02-T10`](./prd.md#12-작업-패키지와-후속-결정) 형성평가·기준선·규모 경고

## 구현과 출시 gate

- 문서상 책임·의존성·완료 기준은 확정됐다. 사람 assignee와 Jira 번호 연결은 스프린트 배정 기록이며 로컬 구현 착수의 추가 제품 결정이 아니다.
- 운영 `eligible_user_count` 점검과 90/100 조치는 [공통 상태 정본의 실행 절차](../../shared/implementation-status.md#02-규모-출시-gate-실행)를 따른다. 값이 unknown 또는 100 이상이어도 구현은 계속할 수 있지만 출시는 차단한다.
- 앱 런타임은 성공 raw ranking 응답 길이 `<100`일 때만 집중 인원을 계산하며, `100`·loading·error를 0명으로 표시하지 않는다.
- [PRD 수용 기준](./prd.md#10-수용-기준과-테스트)과 [LLD 출시 검증](./low-level-design.md#8-구현출시-검증)을 통과하기 전에는 제한 출시하지 않는다.
