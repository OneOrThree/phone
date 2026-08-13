# 1:1 문의 — 상세 설계 (Low Level Design)

> 정책 충돌 시 `policy.md`가 정본이다.

## 0. 변경 파일 목록

| # | 파일 | 신규/수정 | 내용 |
|---|---|---|---|
| 1 | `app/src/constants/inquiryContacts.ts` | 신규 | 담당자 3 · 카테고리 3 상수 |
| 2 | `app/src/screens/settings/InquiryScreen.tsx` | 신규 | 화면 |
| 3 | `app/src/screens/settings/components/InquiryContactCard.tsx` | 신규 | 담당자 카드 |
| 4 | `app/src/screens/settings/components/InquiryCategoryChips.tsx` | 신규 | 카테고리 칩 |
| 5 | `app/src/screens/settings/inquiryLink.ts` | 신규 | 링크 열기 + 실패 판정 |
| 6 | `app/src/screens/settings/index.ts` | 수정 | 배럴 export 1줄 |
| 7 | `app/src/navigation/types.ts` | 수정 | `SettingsInquiry: undefined` |
| 8 | `app/src/navigation/RootNavigator.tsx` | 수정 | `<Stack.Screen>` 1줄 + import |
| 9 | `app/src/screens/MenuScreen.tsx` | 수정 | `SettingsRow` 1개 |
| 10 | `app/src/services/analyticsEvents.ts` | 수정 | 이벤트 함수 3개 |
| 11 | `app/src/components/ConfirmCardModal.tsx` | 수정 | `bodySelectable?: boolean` 1개 |
| 12 | `app/src/constants/inquiryContacts.test.ts` | 신규 | 상수 무결성 테스트 |
| 13 | `app/src/screens/settings/inquiryLink.test.ts` | 신규 | 실패 폴백 테스트 |

**`back/**` 변경 없음** (`policy.md` D13). DB · Flyway · `schema.dbml` 변경 없음.

---

## 1. `constants/inquiryContacts.ts` (신규)

`theme.ts`와 같은 **import 없는 순수 상수 모듈**이다. 색은 `T.avatarPalette`를 import하지 않고 인덱스로 참조한다.

```ts
// 1:1 문의 담당자·카테고리 상수 — 단일 진실 원천.
// 담당자·링크 교체는 이 파일만 고치면 되고, JS 변경이라 hot-updater OTA로 심사 없이 배포된다
// (docs/prd/inquiry/policy.md D5). 여기에 import를 추가하지 말 것 — 순수 상수 모듈이다.

export type InquiryCategoryId = 'focus' | 'group' | 'etc';

export interface InquiryCategory {
  id: InquiryCategoryId;
  label: string;
}

export interface InquiryContact {
  /** 분석 이벤트용 안정 슬러그 — 닉네임조차 아니다(PII 금지, policy.md D11) */
  id: string;
  name: string;
  initial: string;
  /** T.avatarPalette 인덱스 — theme.ts를 import하지 않기 위해 숫자로 둔다 */
  avatarPaletteIndex: number;
  /** 키워드 3개 — 그 사람의 분위기. 담당 영역(소유권)이 아니다(policy.md D6).
      사람에 대한 서술이므로 **본인이 고른 표현만** 넣는다(D10과 같은 이유) */
  keywords: string;
  /** 이 담당자가 추천되는 카테고리 — 카테고리당 정확히 1명 */
  categoryId: InquiryCategoryId;
  /** https 오픈채팅 URL. 커스텀 스킴 금지(policy.md D7) */
  openChatUrl: string;
}

export const INQUIRY_CATEGORIES: readonly InquiryCategory[] = [
  { id: 'focus', label: '집중 · 스크린타임' },
  { id: 'group', label: '그룹 · 챌린지' },
  { id: 'etc', label: '계정 · 기타' },
] as const;

export const INQUIRY_CONTACTS: readonly InquiryContact[] = [
  // ⚠️ name 은 실명이 아니라 닉네임(활동명)이다(policy.md D10). 착수 전 3명에게 닉네임·소개·응답시간을 받는다.
  //    아래 값은 자리표시자다 — 오픈채팅방 3개를 만든 뒤 실제 URL로 교체할 것.
  {
    id: 'dev-focus',
    name: 'TODO',
    initial: 'T',
    avatarPaletteIndex: 0,
    categoryId: 'focus',
    openChatUrl: 'https://open.kakao.com/o/TODO',
  },
  // group · etc 담당자 동일 형식
] as const;
```

**불변식** (테스트로 잠근다 — §8):
- `INQUIRY_CONTACTS.length === INQUIRY_CATEGORIES.length`
- 모든 `categoryId`가 `INQUIRY_CATEGORIES`에 존재하고 **중복이 없다** (카테고리당 정확히 1명)
- 모든 `id`가 유일하고, **값 집합이 `categoryId`에서 파생된 `dev-{categoryId}` 형태로 고정**된다
  (`dev-focus` · `dev-group` · `dev-etc`)
- 모든 `openChatUrl`이 **`new URL()`로 파싱해서** `protocol === 'https:'` · `host === 'open.kakao.com'` ·
  `pathname`이 `/o/<영숫자>` 형식이다
- 모든 `openChatUrl`이 **서로 다르다** (담당자끼리 같은 방을 가리키지 않는다)
- `avatarPaletteIndex`가 `T.avatarPalette` 범위 안이다

**URL 중복 금지가 필요한 이유.** 호스트·경로 형식만 보면 담당자 둘에게 **같은 정상 URL**을 넣어도
전부 통과한다. 그러면 서로 다른 담당자를 고른 사용자가 같은 방으로 들어가 D2(직접 지목)와 D3(담당자별
방 3개)가 동시에 깨지는데, Q5(링크가 살아 있는지 확인)는 **셋 다 열리므로 이걸 못 잡는다.** 복사해서
붙여넣다 생기는 실수라 OTA 교체 때 가장 나오기 쉽다.

**`contact_id`는 사람이 아니라 카테고리에 묶는다.** `id`를 닉네임 기반 슬러그로 두면 담당자를 교체할
때 값이 같이 바뀌고, §7의 GA4 계약(`dev-focus | dev-group | dev-etc`)과 기존 대시보드 필터가 **새
이벤트를 놓친다.** 담당자별 시계열도 교체 시점에서 끊긴다. `dev-{categoryId}`로 고정하면 사람이 바뀌어도
계측이 이어지고, D10(닉네임 표시)이 바뀌어도 영향이 없다 — 애초에 `contact_id`에 PII를 안 넣기로 한
이유와 같은 방향이다.

**URL 검증은 접두사 비교로 하지 않는다.** `startsWith('https://')`만 보면 `https://example.com`도
통과하고, 그 값이 `Linking.openURL`로 그대로 열린다. 이 상수는 담당자·링크 교체 때 **OTA로 자주
손대는 파일**이라(D5) 오타 한 번이 사용자를 카카오가 아닌 임의의 사이트로 보낼 수 있다. D7이 정한
계약은 「https 이기만 하면 된다」가 아니라 **`https://open.kakao.com/o/…`** 이므로, 호스트와 경로
형식까지 잠근다.

## 2. `screens/settings/inquiryLink.ts` (신규)

부수효과를 화면에서 떼어 내 테스트 가능하게 만든다.

```ts
import { Linking } from 'react-native';

// 오픈채팅 링크 열기. 성공/실패만 돌려주고 UI는 건드리지 않는다.
//
// ⚠️ Linking.canOpenURL 로 사전 검사하지 않는다 — iOS 에서는 Info.plist 의
//    LSApplicationQueriesSchemes 화이트리스트에 걸려 멀쩡한 링크에도 false 를 뱉는다.
//    그러면 우리가 정상 링크를 스스로 막게 된다. 곧장 열고 예외를 잡는다.
export async function openInquiryChat(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
```

## 3. `screens/settings/components/InquiryContactCard.tsx` (신규)

표시 전용. props in, `onPress` out. 상태를 갖지 않는다.

```ts
interface InquiryContactCardProps {
  contact: InquiryContact;
  recommended: boolean;   // 「추천」 배지 표시
  onPress: (contact: InquiryContact) => void;
}
```

레이아웃 (`ux.html` A안 · 값은 `T` 토큰):

| 요소 | 스펙 |
|---|---|
| 카드 | `bg T.white`, `border 1 T.paperAlt`, `radius 16`, `padding T.space.lg` |
| 그림자 | `shadowColor T.shadow`, `opacity .16`, `radius 16`, `offset {0,10}`, `elevation 3` |
| 아바타 | 44×44 원, `bg T.avatarPalette[avatarPaletteIndex]`, 흰 이니셜 `T.text.subtitle` (**새 조합** — 아래) |
| 이름 | `T.text.label`, `color T.ink` |
| 키워드 3개 | `T.text.caption`, `color T.accentDeep` (가운뎃점으로 이어 한 줄) |
| 「추천」 배지 | `bg T.accentBg`, `border 1 T.noteBorder`, `radius 999`, `color T.accentDeep`, `T.text.caption` |
| CTA | `bg T.kakao`, `color T.kakaoInk`, `radius 12`, `padding T.space.md/T.space.lg`, `minHeight 44`, `T.text.label`, Ionicons `chatbubble` 16 |

CTA는 `PressableScale`로 감싼다 (`scaleTo` 기본 0.96, `haptic: 'light'`). 최소 터치 타겟 44pt를 지킨다.

**CTA에 담당자를 포함한 `accessibilityLabel`을 붙인다.**

```tsx
accessibilityRole="button"
accessibilityLabel={`${contact.name}에게 카카오톡으로 문의하기`}
```

버튼 라벨 텍스트는 카드 3장이 전부 `카카오톡으로 문의하기`로 같고, 담당자 닉네임은 버튼의 **형제
요소**라 버튼의 접근성 이름에 들어가지 않는다. 화면 읽기 사용자가 버튼 단위로 넘기면 **똑같은 버튼
3개**로 읽혀 어느 방이 열리는지 알 수 없다 — 「사용자가 직접 지목한다」(D2)가 그 사용자에게만
성립하지 않게 된다. §8.3에서 세 라벨이 서로 다른지 테스트한다.

**아바타는 기존 컴포넌트를 베끼는 게 아니라 두 선례의 새 조합이다.** 크기 44는 `MemberTile`
(`const AVATAR = 44`)에서 오지만 그건 `T.sand` 배경 + `CharacterImage`(마스코트)라 이니셜도
팔레트도 안 쓴다. 이니셜 + `T.avatarPalette` 조합은 `GroupCardBack`의 `MemberAvatars`인데 거기는
**36×36**이다. 즉 「44 + 팔레트 + 이니셜」을 한꺼번에 만족하는 기존 컴포넌트는 **없다** — 새로
만드는 것이니 재사용을 찾다 시간을 쓰지 말 것.

**색을 하드코딩하지 않는다** — `app/.claude/CLAUDE.md`의 Styling 규칙. `T.kakao`/`T.kakaoInk`가 이미 있으므로 카카오 브랜드색도 토큰으로 나온다.

## 4. `screens/settings/components/InquiryCategoryChips.tsx` (신규)

```ts
interface InquiryCategoryChipsProps {
  selected: InquiryCategoryId | null;
  onSelect: (id: InquiryCategoryId | null) => void;  // 같은 칩 재탭 시 null
}
```

**앱에 알약(radius 999) 선택 칩이 없다.** 실재하는 칩은 두 종류뿐이고, 이 화면은 둘을 이렇게 나눠 쓴다:

| 부분 | 값 | 출처 |
|---|---|---|
| 상자 | `radius 13`, `borderWidth 1.5 T.border`, `bg T.white`, `padding T.space.md/T.space.lg`, `T.text.label` | `OccupationScreen`의 `s.chip` — 같은 설정 하위 화면의 단일 선택 칩 |
| 선택 상태 | `bg T.accentBg`, `borderColor T.accent`, `color T.accentDeep`, `fontWeight '700'` | `ChallengeComposeSheet`의 `s.chipOn`·`s.chipTextOn` |
| 배치 | `flexDirection: 'row'`, `flexWrap: 'wrap'`, `gap T.space.sm` | `OccupationScreen`의 `s.chips` |

**상자와 선택 상태의 출처가 갈리는 건 의도한 것이다.** `OccupationScreen`의 선택 상태는
accent 채움 + 흰 글자라 화면에서 가장 강한 요소가 되는데, 카테고리는 담당자를 고르기 위한
길잡이일 뿐이라(`policy.md` D6) 담당자 카드보다 앞서면 안 된다. 그래서 선택 표현만
`ChallengeComposeSheet`의 옅은 틴트 쪽을 쓴다. 두 값 모두 코드에 실재하므로 새 값은 없다.

`accessibilityRole="button"` + `accessibilityState={{ selected }}`.

## 5. `screens/settings/InquiryScreen.tsx` (신규)

상태 4개 + 요청 세대 ref 1개뿐이다. 서버가 없으므로 로딩·에러·캐시 상태가 아예 없다.

```ts
const [category, setCategory] = useState<InquiryCategoryId | null>(null);
const [target, setTarget] = useState<InquiryContact | null>(null);   // 모달 대상
const [failed, setFailed] = useState(false);                          // 모달 실패 전환
const [pending, setPending] = useState(false);                        // openURL 대기 중
const reqIdRef = useRef(0);                                           // 요청 세대 — §5.4
```

`target`과 `failed`는 **한 몸이다.** 아래 `closeModal()` 말고 다른 경로로 모달을 닫으면 안 된다(§5.4).

### 5.1 정렬 규칙

```ts
// 선택된 카테고리의 담당자를 맨 앞으로. 나머지는 상수 순서 유지.
// 목록에서 빼지 않는다 — 「직접 지목」(policy.md D2)이 유지되려면 항상 3장 다 보여야 한다.
const ordered = useMemo(() => {
  if (!category) return INQUIRY_CONTACTS;
  return [...INQUIRY_CONTACTS].sort(
    (a, b) => Number(b.categoryId === category) - Number(a.categoryId === category),
  );
}, [category]);
```

`Array.prototype.sort`는 안정 정렬이므로 나머지 2장의 상대 순서가 보존된다.

### 5.2 화면 조립

```
SettingsScaffold title="1:1 문의" onBack={navigation.goBack}
├── 안내 문단   무엇을 도와드릴까요? / 담당 개발자에게 카카오톡으로 직접 물어보실 수 있어요.
├── 「어떤 내용인가요?」 + InquiryCategoryChips
├── 「담당 개발자」 + ordered.map(c => <InquiryContactCard recommended={c.categoryId === category} …/>)
│                (카드는 아바타+닉네임+키워드+CTA 세 줄 — 소개·응답시간 없음, D9 개정)
└── 안내 박스   bg T.noteBg / border T.noteBorder / Ionicons information-circle
                「카카오톡 앱으로 이동해요. 24시간 응대는 어려워 답장이 하루 이틀 걸릴 수 있어요.」
+ ConfirmCardModal
```

`SettingsScaffold`가 `SafeAreaView edges={['top']}` + ScrollView + 좌우 `T.space.xl`을 이미 처리한다.

**표면 색 주의 — 화면 배경은 회색이 아니라 흰색이다.** `SettingsScaffold`의 `root`는
`T.paperLight`(`#FFFFFF`)라, 설정 화면은 흰 바탕 위에 흰 카드가 1px `T.paperAlt`(`#F5F6F9`)
테두리로만 구분된다. `T.bg`(`#F4F5F8`)를 배경으로 깔지 말 것 — 카드가 실제보다 또렷해 보여
시안과 구현이 갈린다. 담당자 카드도 같은 규칙을 따르고, 「추천」 카드만 `borderColor`를
`T.accent`로 바꾼다(배경은 그대로 흰색).

### 5.3 모달 문구

| 상태 | title | body | primary | secondary |
|---|---|---|---|---|
| 기본 | `카카오톡으로 이동할까요?` | `{name}님의 1:1 오픈채팅방이 열려요.\n대화 내용은 카카오톡에 저장되고, gromo 서버에는 남지 않아요.` | `이동하기` | `취소` |
| 실패 | `카카오톡을 열 수 없어요` | `아래 주소를 길게 눌러 복사한 뒤 브라우저에서 열어 주세요.\n\n{openChatUrl}` | `다시 시도` | `닫기` |

실패 상태에서만 `bodySelectable`을 켠다.

`ConfirmCardModal`의 제목·본문에는 `textAlign`이 없어 **왼쪽 정렬**이다(버튼 라벨만 가운데).
문구를 가운데 정렬로 가정하고 줄바꿈을 넣지 말 것.

### 5.4 이동 핸들러 · 닫기 계약

**모달을 닫는 경로는 하나뿐이다.** 취소 버튼 · 백드롭 탭 · Android 뒤로 가기(`onRequestClose`) ·
실패 상태의 「닫기」 — 넷 다 같은 `closeModal()`을 부르고, `closeModal()`은 **세 상태를 함께**
되돌린다.

```ts
const closeModal = useCallback(() => {
  reqIdRef.current += 1;   // 진행 중이던 요청을 세대 교체로 폐기한다
  setTarget(null);
  setFailed(false);        // ← 이걸 빼면 아래 버그가 난다
  setPending(false);
}, []);
```

`failed`를 같이 리셋하지 않으면: 담당자 A에서 링크가 실패해 `failed=true`가 된 뒤 「닫기」로
모달을 내리고, 사용자가 담당자 B 카드를 누르면 — **B의 링크는 시도조차 안 했는데** 확인 모달이
아니라 「카카오톡을 열 수 없어요」가 곧바로 뜬다. `target`만 갈아끼우는 구현이 자연스러워 보여서
실제로 나오기 쉬운 실수다. §8.3으로 잠근다.

```ts
const handleConfirm = useCallback(async () => {
  if (!target || pending) return;   // 연타 차단 — 이벤트·openURL 중복 발화 방지
  setPending(true);
  const requested = target;         // 이 요청이 어느 담당자 것인지 고정
  const myId = ++reqIdRef.current;  // 이 요청의 세대 — 같은 담당자를 다시 열어도 새 번호를 받는다
  // ⚠️ 분석 이벤트는 openURL **앞에서** 쏜다 — 뒤에서 쏘면 앱이 백그라운드로
  //    넘어가는 타이밍과 겹쳐 유실된다(high-level-design.md §3.1).
  // ⚠️ 「다시 시도」(= failed 상태에서의 재호출)에서는 쏘지 않는다 — 모달 1회당
  //    최초 시도만 「선택」 1건이다. 아래 참조.
  if (!failed) {
    logInquiryContactOpened({
      category,
      contactId: requested.id,
      isRecommended: requested.categoryId === category,
    });
  }
  const ok = await openInquiryChat(requested.openChatUrl);
  // ⚠️ await 사이에 사용자가 모달을 닫았거나(백드롭 탭·Android 뒤로 가기), 혹은
  //    닫았다 **같은 담당자** 카드를 다시 열었을 수 있다. 그때 도착한 결과는
  //    **폐기한다** — 안 그러면 이미 닫힌 모달의 failed 가 다시 켜져, 다음에
  //    누른 담당자의 모달이 곧바로 실패 화면으로 열린다.
  if (reqIdRef.current !== myId) return;
  if (ok) closeModal();
  else {
    setFailed(true);
    setPending(false);   // 「다시 시도」를 누를 수 있어야 한다
  }
}, [target, pending, failed, category, closeModal]);
```

`reqIdRef`는 요청마다 1씩 올라가는 **세대 카운터**(`useRef(0)`)다.

**객체 동일성 비교(`targetRef.current !== requested`)로 하면 안 된다 — 그건 버그다.**
`INQUIRY_CONTACTS`는 모듈 최상단 `as const` 배열이라 원소가 앱 수명 내내 **같은 객체**다.
그래서 「요청 중 모달을 닫고 → **같은 담당자** 카드를 다시 연다」 순서에서는 `requested`가 가리키던
객체가 그대로여서 동일성 검사가 **그냥 통과하고**, 늦게 도착한 이전 요청의 결과가 새로 연 모달을
닫거나 실패 상태로 만든다. 담당자를 **바꾸면** 걸러지는데 **같은 담당자면** 안 걸러지는 비대칭이라
테스트도 담당자를 바꿔 짜면 통과해 버린다. 세대 번호는 요청마다 **항상 새 정수**를 받으므로 이
비대칭이 없다 — `closeModal()`도 세대를 올려, 어떤 경로로 닫히든 이후 도착하는 결과는 전부 폐기된다.

요청 중에는 `ConfirmCardModal`의 기존 `primaryDisabled` prop에 `pending`을 넘겨 버튼 연타도 함께
막는다(이미 있는 prop이라 §6.1의 추가 대상이 아니다).

성공 시 모달을 닫아 두는 이유: 카카오톡에서 돌아왔을 때 모달이 떠 있으면 「아직 안 갔나?」로 읽힌다.

**재시도는 새로운 「선택」이 아니다.** 「다시 시도」는 같은 `handleConfirm`을 다시 타므로 그대로 두면
이벤트가 두 번, 세 번 발화한다. `prd.md` §5의 추천 일치율이 **이벤트 단위**로 세므로(세션 distinct로는
왜곡되기 때문), 재시도가 그대로 집계되면 **링크나 기기가 나쁜 쪽의 유형이 과대표집된다** — 실패가
잦은 담당자의 추천/비추천 값이 실제보다 여러 배로 잡히고, 그 값으로 D6 매핑을 판단하게 된다.
`failed` 상태에서의 호출은 정의상 재시도뿐이므로 그것만 건너뛰면 **모달 1회 = 선택 1건**이 성립한다.
`closeModal()`이 `failed`를 리셋하니 다음에 카드를 다시 누르면 정상적으로 1건이 기록된다.

## 6. 기존 파일 수정

### 6.1 `components/ConfirmCardModal.tsx`

**(1) 옵셔널 prop 1개 추가.** 기본값이 `undefined`(=미선택)라 **기존 호출부 3곳**
(`AccountScreen.tsx` · `GroupSettingsScreen.tsx` · `GroupOwnerTransferScreen.tsx`)은 손대지 않아도
그대로 동작한다. `Toast.tsx`에도 이름이 나오지만 그건 렌더가 아니라 주석이다.

```ts
  /** 본문을 길게 눌러 복사할 수 있게 한다(링크 폴백 등) */
  bodySelectable?: boolean;
```
```tsx
  <Text style={s.cardBody} selectable={bodySelectable}>{body}</Text>
```

**(2) 카드 높이를 화면 안으로 제한하고 본문만 스크롤시킨다.** 현재 `card`에는 `maxHeight`가 없고
`overlay`가 `justifyContent: 'center'`라, **내용이 길어지면 카드가 위아래로 화면 밖까지 자란다.**
이 화면의 실패 모달은 안내문 + 긴 URL을 함께 담는 데다 접근성 글자 배율까지 곱해지므로, 작은
기기에서 **URL과 「다시 시도」·「닫기」 버튼이 화면 밖으로 밀려난다.** 실패 모달은 D7이 정한 **유일한
수동 복구 경로**라, 여기서 버튼에 손이 닿지 않으면 사용자는 아무것도 할 수 없다.

```tsx
  card: { …, maxHeight: '80%' },              // 스크림이 보여야 모달로 읽힌다
  bodyScroll: { flexGrow: 0, flexShrink: 1 }, // ⚠️ flexShrink 가 핵심 — 아래 참조
  // 본문만 ScrollView 로 감싼다 — 버튼은 밖에 둬서 항상 눌린다
  <ScrollView style={s.bodyScroll} contentContainerStyle={s.bodyScrollInner}>
    <Text style={s.cardBody} selectable={bodySelectable}>{body}</Text>
  </ScrollView>
```

**`flexShrink: 1`을 빠뜨리면 이 변경은 아무 일도 하지 않는다.** RN의 기본값은 `flexShrink: 0`이라,
카드가 `maxHeight`에 걸려도 `ScrollView`는 내용 높이를 그대로 고집하고 **버튼을 카드 밖으로 밀어낸다** —
정작 이 스크롤을 넣은 이유(작은 기기 + 큰 글자 배율)에서만 안 듣는 셈이다. `maxHeight`만 걸고
끝내지 말 것.

**버튼을 `ScrollView` 안에 넣지 말 것.** 스크롤해야 닿는 버튼은 「없는 버튼」과 같다 — 사용자는
잘린 화면에서 아래에 뭐가 더 있는지 모른다. 짧은 본문에서는 `ScrollView`가 내용 높이만큼만
차지하므로 위 3곳의 겉모습은 변하지 않는다 — 세 화면의 기존 테스트로 무회귀를 증명한다.

### 6.2 `navigation/types.ts`

```ts
SettingsInquiry: undefined; // 1:1 문의 (카카오톡 오픈채팅 안내)
```

### 6.3 `screens/settings/index.ts`

```ts
export { default as InquiryScreen } from './InquiryScreen';
```

### 6.4 `navigation/RootNavigator.tsx`

`SettingsAccount` 아래에 한 줄:

```tsx
<Stack.Screen name="SettingsInquiry" component={InquiryScreen} />
```

딥링크(`navigationRef.ts`)에는 **추가하지 않는다** (`information-architecture.md` §4.1).

### 6.5 `screens/MenuScreen.tsx`

「계정 · 정보」 `SettingsSection` 안, `계정 설정` 다음:

```tsx
<SettingsRow
  icon="chatbubble-ellipses-outline"
  iconColor={T.inkSub}
  iconBg={T.sandLight}
  label="1:1 문의"
  sub="궁금한 점 · 오류 신고"
  onPress={() => navigation.navigate('SettingsInquiry')}
/>
```

`SettingsSection`이 마지막을 제외한 자식에 `divider`를 자동 주입하므로 구분선은 손대지 않는다.

### 6.6 `services/analyticsEvents.ts`

```ts
// ── 1:1 문의 [C] ── (docs/prd/inquiry/policy.md D11)
// 서버에 아무것도 남지 않는 기능이라 이 세 이벤트가 유일한 계측 수단이다.
// contact_id 는 닉네임조차 아닌 고정 슬러그다 — 이 파일 상단의 PII 금지 규칙.
export function logInquiryScreenViewed(): void {
  track('inquiry_screen_viewed', { entry_point: 'menu' });
}

export function logInquiryCategorySelected(category: InquiryCategoryId): void {
  track('inquiry_category_selected', { category });
}

export function logInquiryContactOpened(p: {
  category: InquiryCategoryId | null;
  contactId: string;
  isRecommended: boolean;
}): void {
  track('inquiry_contact_opened', {
    category: p.category ?? 'none',
    contact_id: p.contactId,
    is_recommended: p.isRecommended,
  });
}
```

`logInquiryScreenViewed`는 `InquiryScreen`의 마운트 `useEffect`에서 호출한다. 칩 해제(`null`)는 이벤트를 쏘지 않는다 — 선택만 센다.

**마운트 1회로는 부족하다 — `AppState` 복귀에서도 쏜다.** 이 화면은 사용자를 카카오톡으로
내보내는 화면이라, **앱을 떠났다 돌아오는 것이 정상 경로**다. 그 사이 GA4 세션(기본 타임아웃
30분)이 새로 시작되면 화면은 계속 마운트돼 있어 `useEffect`가 다시 안 돈다. 그러면 새 세션에는
`inquiry_contact_opened`만 있고 `inquiry_screen_viewed`가 없어, **`prd.md` §5의 「분자가 분모의
부분집합」 전제가 깨지고 전환율이 100%를 넘는다.**

```ts
// ⚠️ 재는 것은 「마지막으로 노출을 쏜 시각」이 아니라 **「마지막 활동 시각」**이다 —
//    GA4 세션은 **어떤 이벤트로든** 연장되므로, 발화를 건너뛴 호출도 시각을 갱신해야 한다.
const lastEventAt = useRef(0);
const markViewed = () => {
  const now = Date.now();
  const sessionLikelyExpired = now - lastEventAt.current >= 30 * 60 * 1000;
  lastEventAt.current = now;   // 발화 여부와 무관하게 항상 갱신
  if (sessionLikelyExpired) logInquiryScreenViewed();
};
useEffect(() => {
  markViewed();
  const sub = AppState.addEventListener('change', s => s === 'active' && markViewed());
  return () => sub.remove();
}, []);
```

30분은 GA4 기본값이라 콘솔에서 세션 타임아웃을 바꾸면 이 상수도 같이 바꿔야 한다.

**발화를 건너뛴 호출도 시각을 갱신해야 하는 이유.** 갱신하지 않으면: 0분 노출 → 20분 카테고리
선택(건너뜀, 기준 시각은 0분 그대로) → 31분 담당자 확정에서 「30분 지났다」고 판단해 **노출을 다시
쏜다.** 그런데 GA4에서는 20분 이벤트가 세션을 연장해 **여전히 같은 세션**이라, 한 세션에 분모가
2번 잡혀 **전환율이 실제보다 낮게** 나온다. §8.3이 이 시나리오를 그대로 테스트한다.

**이 가드가 못 잡는 것 두 가지** — 둘 다 분모 **과다** 계상(전환율이 낮아지는 방향)이라 「분자 ⊄ 분모」
같은 구조 파괴는 아니지만, 수치를 볼 때 감안한다.
- GA4가 30분 무입력 **외의 조건**(콘솔 설정 변경 등)으로 세션을 끊으면 이 로컬 재구현은 모른다.
  착수 전 체크리스트에서 콘솔의 세션 설정을 한 번 확인한다.
- 이 ref는 **이 화면 전용**이라, 다른 화면에서 이벤트가 나가 GA4 세션이 실제로는 이어지고 있어도
  그 사실을 알지 못한다.

**`AppState`만으로는 아직 새는 구멍이 있다 — 다른 이벤트를 쏘기 직전에도 `markViewed()`를 부른다.**
자동 잠금을 꺼 둔 기기에서 이 화면을 **포그라운드에 그대로 둔 채** 30분이 지나면 GA4 세션은 만료되는데
`AppState` 변화가 없어 위 리스너가 안 돈다. 그 뒤에 「이동하기」를 누르면 새 세션에 `contact_opened`만
남아, 백그라운드 경로에서 막은 것과 **똑같은 「분자 ⊄ 분모」가 그대로 재현된다.**

```ts
// 이 화면의 다른 이벤트는 전부 markViewed() 를 먼저 통과시킨다.
// markViewed() 자체가 30분 가드를 들고 있으므로 같은 세션에서는 아무 일도 하지 않는다.
const handleSelectCategory = (id) => { markViewed(); logInquiryCategorySelected(id); … };
const handleConfirm = async () => { …; markViewed(); if (!failed) logInquiryContactOpened({…}); … };
```

**규칙으로 적어 두면 지표가 안 깨진다: 「이 화면에서 이벤트를 쏘기 전에는 항상 `markViewed()`를
먼저 부른다.」** 세션이 어디서 끊겼는지 일일이 따지는 대신 분모를 먼저 보장하는 쪽이 확실하다.

## 7. GA4 이벤트 계약

| 이벤트 | 파라미터 | 값 |
|---|---|---|
| `inquiry_screen_viewed` | `entry_point` | `'menu'` (현재 진입점이 하나뿐) |
| `inquiry_category_selected` | `category` | `focus` \| `group` \| `etc` |
| `inquiry_contact_opened` | `category` | 위 3종 \| `'none'` (미선택) |
| | `contact_id` | `dev-focus` \| `dev-group` \| `dev-etc` |
| | `is_recommended` | TS 타입은 `boolean`, **전선 위 값은 문자열 `'true'`/`'false'`** |

**서버(MP)에서 발행하지 않는다** — 백엔드가 이 기능을 모르므로 이중 집계 위험이 없다.

**generic `screen_viewed`와 공존한다 — 중복 계측이 아니다.** PR #650(`GROMO-1194`)이 머지되면
`RootNavigator`가 **모든 화면 전환마다** `screen_viewed`(`screen_name`)를 쏘므로, 이 화면은
`screen_viewed`와 `inquiry_screen_viewed`를 둘 다 발행하게 된다. **오너 결정(2026-08-14): 둘 다 둔다.**
이름과 파라미터가 달라 GA4에서 서로 덮어쓰지 않고, `inquiry_screen_viewed`는 generic이 갖지 못한
두 가지를 갖는다 — `entry_point`(D11)와 **§6의 세션 경계 재발화**(generic은 화면 전환에만 붙으므로
같은 화면에 머문 채 세션이 바뀌면 안 쏜다). 대시보드에서 둘을 보고 「실수로 두 번 쏜다」고 판단해
한쪽을 지우지 말 것 — `prd.md` §5의 전환율은 `inquiry_screen_viewed`를 분모로 쓴다.

⚠️ `services/analytics.ts`의 `sanitizeParams`가 boolean을 `'true' | 'false'` 문자열로 변환한다
(GA4 파라미터 값 통일 규약). 호출부는 `boolean`을 그대로 넘기면 되지만, **대시보드·탐색에서
`is_recommended = true`를 boolean으로 필터하면 0건이 나온다.** `prd.md` §5의 추천 일치율이
이 값을 쓴다.

## 8. 테스트

> **이 repo는 `it(...)`이 아니라 `test(...)`를 쓰고, RTL v14라 `render`를 `await` 한다.**
> 선례: `app/src/screens/settings/AccountScreen.test.tsx`.

### 8.1 `constants/inquiryContacts.test.ts` (신규)

§1의 불변식을 그대로 검증한다. 이 테스트의 목적은 **담당자를 교체하다 계약을 깨는 것을 막는 것**이다 — 상수 파일은 OTA로 자주 손대는 파일이고, 손대는 사람이 IA 문서를 다시 읽지 않는다.

```ts
test('카테고리마다 담당자가 정확히 1명이다', () => { … });
test('오픈채팅 URL 이 https://open.kakao.com/o/… 다', () => { … });  // 호스트·경로까지(D7)
test('오픈채팅 URL 이 서로 겹치지 않는다', () => { … });             // 복붙 사고 — D2·D3
test('담당자 id 가 dev-{categoryId} 형태로 고정돼 있다', () => { … }); // GA4 계약 §7
test('담당자 id 가 유일하다', () => { … });
test('avatarPaletteIndex 가 T.avatarPalette 범위 안이다', () => { … });
test('오픈채팅 URL 에 자리표시자(TODO) 가 남아 있지 않다', () => { … });  // 형식 검사가 TODO 를 통과시킨다
```

### 8.2 `screens/settings/inquiryLink.test.ts` (신규)

`Linking`을 모킹한다.

```ts
test('openURL 성공 시 true', … );
test('openURL 이 throw 하면 false — 예외가 밖으로 새지 않는다', … );
test('canOpenURL 을 호출하지 않는다', … );   // 사전 검사 금지 규약을 잠근다
```

### 8.3 `screens/settings/InquiryScreen.test.tsx` (신규)

§5.4의 닫기 계약은 문서로만 두면 반드시 깨진다. 컴포넌트 테스트로 잠근다.

```ts
test('실패 후 닫고 다른 담당자를 누르면 확인 모달이 뜬다', … );  // failed 누수 — 가장 중요
test('요청 중에는 주 버튼이 비활성이다', … );                     // 연타 → 이벤트 중복
test('요청 중 모달을 닫고 **같은 담당자**를 다시 열면 이전 결과가 새 모달을 안 건드린다', … );  // 세대 토큰
test('재시도 진행 중에 닫으면, 늦게 온 재시도 결과도 폐기된다', … );  // 재시도는 failed 에서 출발해 경로가 다르다
test('활동 없이 30분이 지난 뒤 복귀하면 노출을 다시 쏜다', … );        // AppState 배선
test('이벤트를 쏘지 않은 호출도 기준 시각을 갱신한다', … );             // 같은 세션 분모 중복 방지
test('「다시 시도」는 contact_opened 를 다시 쏘지 않는다', … );    // 모달 1회 = 선택 1건
test('CTA 3개의 accessibilityLabel 이 서로 다르다', … );          // 담당자 구분
```

### 8.4 수동 QA (자동화 불가)

| # | 확인 |
|---|---|
| Q1 | 「전체」 › 계정 · 정보에 `1:1 문의`가 약관보다 위에 있다 |
| Q2 | 카테고리 선택 시 해당 담당자가 맨 위 + 「추천」 배지. 나머지 2장이 남아 있다 |
| Q3 | 같은 칩 재탭 시 선택 해제 + 원래 순서 복귀 |
| Q4 | 확인 모달에 「gromo 서버에는 남지 않아요」가 있다 |
| Q5 | **오픈채팅 링크 3개가 실제로 살아 있는 방으로 연결된다** — 앱이 감지 못 하는 실패라 릴리즈마다 수동 확인 (`high-level-design.md` §5) |
| Q6 | 카카오톡 미설치 기기에서 브라우저로 열린다 |
| Q7 | 기기 글자 크기를 최대로 해도 닉네임·키워드·CTA가 잘리지 않는다 |
| Q8 | 작은 기기(iPhone SE)에서 카드 3장이 스크롤로 전부 도달 가능하다 |
| Q9 | **iPhone SE + 글자 크기 최대 + 실패 모달** (제목까지 스크롤 안에 들어간다)에서 URL이 스크롤로 전부 읽히고 「다시 시도」·「닫기」가 화면 안에 있다 (§6.1-(2)). **실패 모달은 유일한 수동 복구 경로**라 여기서 버튼에 손이 안 닿으면 사용자는 아무것도 못 한다 |
| Q10 | 화면 읽기(VoiceOver/TalkBack)로 버튼을 넘길 때 CTA 3개가 **담당자 닉네임으로 구분되어** 읽힌다 |
| Q11 | **`ConfirmCardModal` 기존 호출부 3곳의 겉모습이 안 바뀐다** — `AccountScreen` 탈퇴 확인 · `GroupSettingsScreen` 나가기 · `GroupOwnerTransferScreen` 넘기기. 레이아웃은 테스트가 못 잡는 축이라 **스크린샷 비교**로 확인한다 |

Maestro E2E는 붙이지 않는다 — 흐름의 종착점이 앱 밖이라 검증할 수 있는 구간이 「모달이 뜬다」까지뿐이다.

## 9. 착수 전 체크리스트

- [x] 담당자 3명 **닉네임(활동명)** 확정 — JAJO · 오스카 · Aiden (`policy.md` D10 — 실명이 아니다)
- [ ] **키워드 3개씩** 확정 — **담당자 본인이 고른 표현이어야 한다.** 남이 대신 정하면 D10에서 실명을 뺀 이유(공개 화면 · 되돌릴 수 없음 · 본인 동의)가 그대로 재현된다
- [x] 카카오톡 1:1 오픈채팅방 3개 개설 + 영구 URL 확보 (`policy.md` D3) — **다만 살아 있는 방인지는 사람이 직접 열어봐야 안다(Q5)**
- [ ] **오픈채팅 링크 운영 런북 합의** — 방별 책임자 · 주 1회 점검 · OTA 배포 전 확인 · 당일 복구 SLA (`high-level-design.md` §5.1)
- [ ] **개인정보 처리 범위 확정 + 법무·개인정보 책임자 승인** (`policy.md` 미결) — 수집 주체 · 예상 입력 항목 · 카카오에서의 보존·삭제 경로 · 처리방침 반영 여부. **승인 없이 출시하지 않는다**
- [ ] GA4 DebugView에서 이벤트 3개 수신 확인 — `is_recommended`가 문자열 `'true'`/`'false'`로 도착하는지 포함
- [ ] **GA4 콘솔에 이벤트 범위 커스텀 측정기준 등록** — `category` · `contact_id` · `is_recommended`.
      등록해야 탐색에서 분할·필터가 되고, **등록 이전 수집분은 소급 조회되지 않는다.** 이 기능은
      서버 기록이 0이라 GA4가 유일한 창이므로(D11), 등록을 놓치면 첫 릴리즈 기준선을 영구히 잃는다.
      같은 선행 조건이 `docs/prd/onboarding/prd.md`의 `step_viewed`에도 적혀 있다(그쪽은 미등록 상태) —
      **등록 후 탐색 보고서에서 실제로 분할되는 것까지 확인**하고 체크한다
- [ ] Jira 티켓 발행 (`docs/jira-conventions.md` — `도메인` 값 1개 필수)

## 10. 관련 문서

- `policy.md` — 결정 정본 · `prd.md` — 요구사항
- `information-architecture.md` · `high-level-design.md` · `ux.html`
