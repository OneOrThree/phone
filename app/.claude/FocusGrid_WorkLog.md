# 집중 세션 소셜 그리드(LiveFocusGrid) WorkLog

집중 세션 페이저의 소셜 그리드(친구·그룹·같은 시험·전체 리그) 작업 로그.
인원 상한 제거 · 집중중 우선 정렬 · 가상화 전환의 결정(+why)과 검증 기록.

- **브랜치**: `flying-adventure/fix-focus-session-participant` (off `main`) — PR 전 `afix/GROMO-####-…`로 리네임 필요
- **티켓**: 미발행 (PR 준비 단계에 생성)
- **진행 상황**: 코드 완료 · 시뮬 A/B 검증 완료 (2026-08-13). 서버 `isFocusing` 실배포 여부 미확인.
- 관련 선행 작업: GROMO-656(친구 그리드) · 811/812(리그·같은 시험) · 824(라이브 필드) · 848(세로 스크롤) · 932(내 셀·핀 정렬) · F2(그룹 페이지)

---

## 발단 — "아직 12명밖에 안 뜨나?"

인원이 적어 보인다는 체감의 원인은 **상한 12가 아니라 자르는 기준**이었다.

`GET /league/me/ranking`은 **주간 랭킹 순** top-100을 준다. 종전 훅은 이걸 그대로 `slice(0, 12)` 했다.
→ 이번 주 랭커 12명(지금은 대부분 미집중)만 남고, **지금 집중 중인 13위~ 인원은 통째로 잘렸다.**

증상 두 가지:

1. 리그 그리드가 회색(비집중) 아바타로 덮인다.
2. 배너가 잘린 12명 안에서만 집중 인원을 세서 **항상 과소집계** — 리그에 30명이 켜져 있어도 "지금은 나만 집중하고 있어요"가 뜰 수 있었다.

---

## 핵심 결정 (+why)

1. **상한을 없애고 서버가 준 top-100을 전부 넘긴다.**
   - 부분 상한(30~40)이나 "집중중 우선 선별 후 컷"도 가능했지만, 컷이 남는 한 배너 인원은 여전히 틀린다. 컷을 없애면 배너 계산이 저절로 정확해진다(별도 prop 불필요).
   - 대신 렌더 비용을 아래 3·4로 감당한다.
2. **정렬 키에 `isFocusing`을 시간보다 **위**에 넣는다 — 핀 → 집중중 → 오늘 총 집중시간 내림차순.**
   - 이 그리드의 목적이 "지금 같이 집중 중"이라, 오늘 많이 한 비집중자가 상단을 차지하면 화면이 회색으로 덮인다.
   - 초 단위 요동은 없다. `isFocusing`은 60초 폴링으로만 바뀌므로 집중을 끝낸 셀이 그때 한 번 아래 구간으로 내려간다.
   - 핀은 종전 확정(“핀은 시간 무관하게 나보다 위”)을 유지해 최상위 키로 둔다. `||` 체인이라 **핀 안에서도 다시 집중중 → 시간순**이 적용된다.
   - `me`도 같은 규칙에 섞는다 → **일시정지·뽀모도로 휴식 중엔 내 셀이 집중중 아래로 내려간다.** 의도된 동작(거슬리면 `me`만 키에서 제외).
3. **`ScrollView` + `map` → `FlatList numColumns={3}`.**
   - 종전 구조는 화면 밖 셀까지 전부 마운트한다. 셀 1개 ≈ SVG 아바타(도형 4개) + Text 3줄 ≈ 네이티브 뷰 10개 → 100명이면 한 페이지에 ~1,000개.
   - 가로 페이저가 **모든 페이지를 마운트한 채 둔다**(캐릭터/친구/그룹×N/같은시험/전체리그). 두 리그 페이지를 풀면 안 보이는 셀 ~2,000개가 세션 내내 살아 있게 된다.
4. **셀을 `memo`로 분리하고, 표시값을 부모가 미리 계산해 원시값으로 내린다.**
   - `now`를 자식에 내리면 매초 전 셀의 props가 바뀌어 memo가 무의미해진다. 대신 부모가 `seconds`(라이브 반영분 포함)를 계산해 넘긴다 → **비집중 셀은 값이 안 변해 재렌더를 건너뛴다.**
   - 매초 실제로 다시 그려지는 건 화면에 보이는 집중중 셀뿐.
5. **안 보이는 페이지는 1초 시계를 세운다(`visible` prop).**
   - 캐릭터의 `AnimatedCharacter active={page === 0}`(코덱스 리뷰)과 같은 부류.
   - **시간은 안 밀린다** — 표시값이 누적 카운터가 아니라 `base + (now − focusStartedAt)` 계산식이고, `useLiveFocusClock`이 `active` 진입 시 현재 시각을 즉시 1회 반영한다(`hooks/useLiveFocusClock.ts:36`). 다시 보이는 첫 프레임부터 정확한 값. (아래 GROMO-1572에서 이 훅이 공용 타이머 방식으로 바뀌었지만 이 성질은 그대로다.)
   - **서버 폴링은 게이팅하지 않는다.** 같이 끄면 페이지 진입 시 낡은 스냅샷이 잠깐 보인다.

---

## 코드 변경

### `screens/focus/useSessionLeagueMembers.ts`

- `MAX_MEMBERS = 12` 및 `slice` 제거 → `res.filter(내 행 제외).map(...)`.
- **핀 우선선별(`pinned`/`rest` 분리) 삭제** — 컷이 없어지면서 존재 이유가 사라졌다(표시 순서는 그리드가 잡는다).
- 그에 따라 **`pinnedIds` 파라미터 제거**. 부수 효과로 `refetch`가 핀 변경에 안 묶여 "핀 미반영 요청 → 핀 반영 요청" 재요청이 사라졌다. (`requestSeqRef`는 폴링·포그라운드 복귀·occupation 변경 겹침 때문에 유지.)

### `screens/focus/useSessionGroups.ts`

- `MAX_PER_GROUP = 12` 제거. 그룹 정원 10이라 실제로 걸리진 않았지만 방침 일치용.

### `screens/focus/components/LiveFocusGrid.tsx` (핵심)

- `GridCell`을 **평평한 원시값 형태**로 재정의(`id/isMe/nickname/color/isFocusing/tagName/seconds/pinned`). 종전 `{kind:'me'} | {kind:'member'}` 유니온 + 두 갈래 JSX 중복이 하나로 합쳐졌다.
- `Cell` = `memo` 컴포넌트로 분리.
- 정렬: `pinned desc || isFocusing desc || seconds desc`.
- `ScrollView` + `map` → `FlatList` (`numColumns={3}`, `keyExtractor`, `columnWrapperStyle`).
- 스타일 `grid`(flexWrap 컨테이너) → `row`(FlatList 행 래퍼, `justifyContent: 'flex-start'`). 셀의 `width: '31%'` · `marginHorizontal: '1.16%'`는 그대로.
- `visible?: boolean = true` prop 추가 → `useLiveFocusClock(visible && members.some(...))`.
- 셀 닉네임에 `testID="live.grid.name"` (정렬 테스트용).

### `screens/focus/FocusSessionScreen.tsx`

- `useSessionLeagueMembers` 호출 2곳에서 `pinnedIds` 인자 제거.
- 그리드 4곳에 `visible` 배선. 인덱스는 `viewForPage()`의 순서와 동일:

  | 페이지     | 인덱스  |
  | ---------- | ------- |
  | 캐릭터     | `0`     |
  | 친구       | `1`     |
  | 그룹 i번째 | `2 + i` |
  | 같은 시험  | `2 + N` |
  | 전체 리그  | `3 + N` |

  (페이저 도트가 `4 + sessionGroups.length`개 = 인덱스 `0…3+N`과 일치 — 상호 검증됨.)

### `screens/focus/components/LiveFocusGrid.test.tsx` (신규)

이 그리드엔 테스트가 없었다. 정렬이 유일한 노출 규칙이 됐으므로 5개 고정:

- 집중중이 시간 많은 비집중자보다 위
- 같은 집중 상태 안에서는 시간 많은 순
- 핀 최상단 + 핀 안에서 다시 집중중 → 시간순
- `me`도 같은 규칙 (일시정지 시 집중중 아래)
- 40명 렌더 시 배너 인원이 자르지 않은 수(20명)

> ⚠️ RNTL 14는 `render`가 **비동기**다. `await render(...)` 안 하면 `render function has not been called`로 전부 실패한다.

---

## 검증

### 자동

```
typecheck   통과
lint        0 errors (경고 2개는 미수정 파일의 기존 no-void)
format      통과
jest        1876 passed / 152 suites (신규 5개 포함)
```

### 시뮬 A/B (iPhone 17, iOS 26.5)

`LiveFocusGrid`만 단독 렌더하는 **임시 하네스**로 확인(로그인·세션 진입 우회). 하네스와 `index.ts` 우회는 확인 후 원복함.

| 항목                             | 결과                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| 레이아웃 기하 (14명, 구현 전/후) | **픽셀 동일** — 3열·셀 크기·여백·배너 위치 그대로. FlatList 전환 회귀 없음                        |
| 순서                             | 구: 초록/회색 뒤섞임 → 신: 핀 → 초록 전부 → 회색 전부                                             |
| 100명 렌더                       | 정상. 배너 `34명이 지금 같이 집중하고 있어요` = 실제 집중 인원과 일치(구 상한에선 최대 12로 눌림) |

**워크트리 시뮬 검증 메모** (기존 절차 대비 달라진 점):

- 워크트리에 `node_modules`가 없어 `npm ci` 필요. 본 체크아웃과 `react-native-reanimated` 패치 버전이 달라(4.5.3 vs 4.5.0) **심링크 재사용 불가**.
- `pod install`/`xcodebuild` 없이 진행 — 변경이 JS 전용이라 **기존 시뮬에 설치된 Debug 빌드**에 Metro만 물렸다.
- **8082·8083 모두 사용 중**(8082 = 본 체크아웃 Metro, 죽이면 안 됨) → **8085** 사용. `simctl spawn <sim> defaults write com.oneorthree.gromo RCT_jsLocation "localhost:8085"`, 끝나고 `defaults delete`로 원복.
- 워크트리 파일 워처가 안 붙어 HMR 미동작 → 코드 수정마다 Metro 재시작 + `simctl terminate`/`launch` 필요(기존 메모와 동일).

---

## 후속 — 리그 랭킹 목록에 같은 처방 (GROMO-1572, 2026-08-13)

- **브랜치**: `afix/GROMO-1572-league-ranking-render-perf` (off `main`)
- **티켓**: [GROMO-1572](https://romance.atlassian.net/browse/GROMO-1572) (버그)
- **진행 상황**: 코드 완료 · 자동 검증 통과 · **실기기/시뮬 체감 미검증**

### 발단 — 같은 원인, 안 고쳐진 화면

봇 190명(GROMO-1565) 투입 후 "리그 켜면 앱 전체가 굼뜬다"는 제보.
위 작업(1566)이 집중 세션 그리드에 가상화·memo·공용 시계를 넣는 동안, **리그 탭의 랭킹 목록은 같은 처방을 하나도 받지 않았다.** 랭킹 행이 3개 → 100개가 되면서 그 격차가 드러났다.

봇 이전엔 `visibleRanking`이 3명 수준이라 `listRows = visibleRanking.slice(3)`가 **0개**였다 — 4위 이하를 그리는 코드 경로가 실사용된 적이 없었다. GROMO-1570(랭킹 4위 이하 행 흰 화면)이 같은 시점에 터진 것도 같은 이유다.

### 원인 (심한 순)

1. **마감 카운트다운 1초 틱이 `useLeagueMeta` = 화면 루트 state** → 초당 1회 리그 화면 전체 리렌더. 아래 2·3의 비용에 매초 곱해진다. `HomeScreen`도 티어만 읽으려고 같은 훅을 써서 **홈 탭까지 매초 리렌더**되고 있었다.
2. `rank={visibleRanking.indexOf(row) + 1}` → 행마다 배열 전체 탐색 = **O(N²)**. N=100이면 초당 ~9,700회 비교.
3. `LiveFocusTime`이 행마다 `setInterval` 1개 → 집중 중인 행 수만큼 타이머. 이 그리드(1566)가 쓰는 "공용 시계 1개" 패턴이 랭킹 행엔 없었다.

### 코드 변경

#### `screens/league/components/LeagueDeadline.tsx` (신규)

- 마감 카운트다운 state와 `fmtDeadline`을 `useLeagueMeta`에서 여기로 이관. **틱을 라벨 하나에 가둔다.**
- 렌더 결과는 종전과 동일한 `<Text style={s.deadline} numberOfLines={1} maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}>` — 래퍼 뷰를 더하지 않아 헤더 레이아웃 회귀 없음.
- `seconds` prop이 바뀌면(포커스 재조회) 기준을 다시 맞추고 인터벌을 재시작한다. 종전은 `hasDeadline` 토글에만 재시작했는데, 보이는 동작은 같고 재조회 값 반영이 더 정확하다.

#### `screens/league/useLeagueMeta.ts`

- `setInterval` · `deadlineLabel` · `fmtDeadline` 제거 → `{ tier, remainingSeconds, refetch }`만 반환.
- 이 훅은 리그 화면·홈 탭·티어 가이드가 공유하므로, **틱을 여기서 빼는 것이 세 화면을 한 번에 고치는 지점**이다.

#### `screens/league/LeagueScreen.tsx`

- 헤더 마감 라벨 → `<LeagueDeadline seconds={remainingSeconds} style={s.deadline} />`.
- `rank={pinnedOnly ? visibleRanking.indexOf(row) + 1 : i + 4}` — 기본 목록은 `slice(3)` 결과라 인덱스가 곧 자리 번호(i=0 → 4위). `indexOf`는 행 수가 핀 개수로 묶이는 핀 모드에만 남겼다.

#### `hooks/useLiveFocusClock.ts`

- 훅마다 만들던 `setInterval`을 **모듈 레벨 타이머 1개 + 구독자 Set**으로 교체.
- 첫 구독자가 타이머를 켜고 마지막 구독자가 빠질 때 끈다 → `active=false`면 안 돈다는 성질 유지.
- 구독 시점에 즉시 현재 시각을 반영 → 페이지 재진입 시 값이 밀리지 않는 성질(위 핵심 결정 5번)도 유지.
- **이 그리드에도 함께 적용된다** — 같은 훅이라 페이지별 시계 1개 × 페이지 수가 앱 전체 1개로 줄었다.

#### `hooks/useLiveFocusClock.test.ts` (신규)

- `active=false`면 인터벌도 값 갱신도 없음
- 구독자 3개여도 `setInterval` 1회 / 마지막 구독자가 빠질 때만 `clearInterval`
- 늦게 구독해도 기존 구독자와 같은 시각을 잡음

> ⚠️ 이 RNTL 버전은 `renderHook`도 **비동기**다(`Promise<RenderHookResult>`). `await` 없이 쓰면 `result`가 `undefined`다. 위 1566 메모의 `render` 비동기와 같은 부류.

### 검증

```
typecheck   통과
lint        0 errors (경고 2개는 미수정 파일의 기존 no-void)
format      통과
jest        1891 passed / 154 suites (신규 3개 포함)
```

- **시뮬/실기기 체감은 미측정.** 코드 레벨 검증만 끝난 상태.
- 워크트리 `node_modules`는 이번엔 본 체크아웃(`~/phone/app/node_modules`) **심링크로 우회**했다 — JS 전용 검사(typecheck·lint·jest)만 돌려서 통했다. 1566 메모대로 reanimated 패치 버전이 갈릴 수 있으므로 **네이티브 빌드 전에는 반드시 심링크를 지우고 `npm install`** 할 것.

### 범위 밖으로 남긴 것

- `RankRow`/`RankRowShell` `memo` + 인라인 핸들러 안정화
- 랭킹 목록 `ScrollView` + `map` → `FlatList` (이 그리드가 이미 한 전환) — 재정렬 애니메이션(`rankSwap`)·내 행 자동 스크롤(`onLayout` → `scrollTo`)을 다시 검증해야 해서 분리했다
- 서버: `LeagueRankingQueryRepository.findRankOf`가 요청당 users 전체 집계를 2회 돌고 `league_rank_snapshot`을 읽지 않는 구조. 모수가 수백 행이라 **현재 체감의 원인은 아니다.**
- 서버: `focus_sessions.ended_at` 인덱스 부재. 봇이 하루 ~700행씩 영구 증식하므로 시간이 갈수록 나빠진다.

---

## 남은 것 / 다음 증분

- [ ] **서버 `isFocusing` 실배포 확인 (최우선).** 목데이터로만 검증했다. `/league/me/ranking` 응답에 라이브 필드가 안 오면 리그 그리드는 전원 회색이고 이번 정렬도 무의미해진다(GROMO-824 범위).
- [ ] **세션 화면 전체 기준 진입 렉 측정.** 하네스는 그리드 단독이라, 리그 100 + 같은시험 100 + 그룹 + 캐릭터가 동시 마운트되는 실제 진입 비용은 미측정. FlatList가 화면 밖을 안 그리므로 종전보다 나빠질 이유는 없다.
- [ ] **그룹 페이지 라이브 신호 부재.** `GroupDetailMemberResponse`에 `isFocusing/focusStartedAt/focusTagName`이 없어 전원 `isFocusing: false`다. 그래서 그룹 그리드는 이번 정렬이 사실상 무효(동률 → 시간순)이고, 배너도 항상 "지금은 나만 집중하고 있어요"다. BE 확장 필요.
- [ ] 일시정지 시 내 셀 이동이 실사용에서 거슬리는지 판단 → 거슬리면 정렬 키에서 `me` 제외(1줄).
- [ ] 브랜치명 `flying-adventure/…` → `afix/GROMO-####-…` 리네임 후 PR.
