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
  /** 성격 설명 — 어떤 쪽 문의에 어울리는지. 담당 영역(소유권)이 아니다(policy.md D6) */
  scopeLabel: string;
  /** 한 줄 소개 (사용자 말) — 어떤 증상일 때 이 사람인지 */
  intro: string;
  availability: string;
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
    scopeLabel: '집중 · 스크린타임 · 통계',
    intro: '타이머가 안 멈추거나 사용 시간이 이상하면 저에게 알려 주세요.',
    availability: '평일 10:00–19:00',
    categoryId: 'focus',
    openChatUrl: 'https://open.kakao.com/o/TODO',
  },
  // group · etc 담당자 동일 형식
] as const;
```

**불변식** (테스트로 잠근다 — §8):
- `INQUIRY_CONTACTS.length === INQUIRY_CATEGORIES.length`
- 모든 `categoryId`가 `INQUIRY_CATEGORIES`에 존재하고 **중복이 없다** (카테고리당 정확히 1명)
- 모든 `id`가 유일하다
- 모든 `openChatUrl`이 **`new URL()`로 파싱해서** `protocol === 'https:'` · `host === 'open.kakao.com'` ·
  `pathname`이 `/o/<영숫자>` 형식이다
- `avatarPaletteIndex`가 `T.avatarPalette` 범위 안이다

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
| 아바타 | 44×44 원, `bg T.avatarPalette[avatarPaletteIndex]`, 흰 이니셜 `T.text.subtitle` |
| 이름 | `T.text.label`, `color T.ink` |
| 성격 설명 | `T.text.caption`, `color T.accentDeep` |
| 「추천」 배지 | `bg T.accentBg`, `border 1 T.noteBorder`, `radius 999`, `color T.accentDeep`, `T.text.caption` |
| 한 줄 소개 | `T.text.body`, `color T.inkSub`, `marginTop T.space.sm` |
| 응답 시간 | Ionicons `time-outline` 14 + `T.text.caption`, `color T.inkMuted`, `marginTop T.space.sm` |
| CTA | `bg T.kakao`, `color T.kakaoInk`, `radius 12`, `padding T.space.md/T.space.lg`, `minHeight 44`, `T.text.label`, Ionicons `chatbubble` 16 |

CTA는 `PressableScale`로 감싼다 (`scaleTo` 기본 0.96, `haptic: 'light'`). 최소 터치 타겟 44pt를 지킨다.

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

상태 3개뿐이다.

```ts
const [category, setCategory] = useState<InquiryCategoryId | null>(null);
const [target, setTarget] = useState<InquiryContact | null>(null);   // 모달 대상
const [failed, setFailed] = useState(false);                          // 모달 실패 전환
const [pending, setPending] = useState(false);                        // openURL 대기 중
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
  setTarget(null);
  setFailed(false);   // ← 이걸 빼면 아래 버그가 난다
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
  // ⚠️ 분석 이벤트는 openURL **앞에서** 쏜다 — 뒤에서 쏘면 앱이 백그라운드로
  //    넘어가는 타이밍과 겹쳐 유실된다(high-level-design.md §3.1).
  logInquiryContactOpened({
    category,
    contactId: requested.id,
    isRecommended: requested.categoryId === category,
  });
  const ok = await openInquiryChat(requested.openChatUrl);
  // ⚠️ await 사이에 사용자가 모달을 닫았거나(백드롭 탭·Android 뒤로 가기) 다른
  //    담당자로 바꿨을 수 있다. 그때 도착한 결과는 **폐기한다** — 안 그러면
  //    이미 닫힌 모달의 failed 가 다시 켜져, 다음에 누른 담당자의 모달이
  //    곧바로 실패 화면으로 열린다.
  if (targetRef.current !== requested) return;
  if (ok) closeModal();
  else {
    setFailed(true);
    setPending(false);   // 「다시 시도」를 누를 수 있어야 한다
  }
}, [target, pending, category, closeModal]);
```

`targetRef`는 현재 `target`을 그대로 따라가는 `useRef`다 — 상태를 클로저로 읽으면 `await` **이전**
값이 잡혀 이 검사가 무의미해진다. 요청 중에는 `ConfirmCardModal`의 기존 `primaryDisabled` prop에
`pending`을 넘겨 버튼 연타도 함께 막는다(이미 있는 prop이라 §6.1의 추가 대상이 아니다).

성공 시 모달을 닫아 두는 이유: 카카오톡에서 돌아왔을 때 모달이 떠 있으면 「아직 안 갔나?」로 읽힌다.

## 6. 기존 파일 수정

### 6.1 `components/ConfirmCardModal.tsx`

옵셔널 prop 1개만 추가한다. 기본값이 `undefined`(=미선택)라 기존 호출부 4곳은 손대지 않아도 그대로 동작한다.

```ts
  /** 본문을 길게 눌러 복사할 수 있게 한다(링크 폴백 등) */
  bodySelectable?: boolean;
```
```tsx
  <Text style={s.cardBody} selectable={bodySelectable}>{body}</Text>
```

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
// 마지막 발화 시각을 ref 로 들고, 활성 복귀 시 30분(GA4 기본 세션 타임아웃)이
// 지났으면 다시 쏜다. 카카오톡에 잠깐 다녀온 것은 같은 세션이라 중복 발화하지 않는다.
const lastViewedAt = useRef(0);
const markViewed = () => {
  const now = Date.now();
  if (now - lastViewedAt.current < 30 * 60 * 1000) return;
  lastViewedAt.current = now;
  logInquiryScreenViewed();
};
useEffect(() => {
  markViewed();
  const sub = AppState.addEventListener('change', s => s === 'active' && markViewed());
  return () => sub.remove();
}, []);
```

30분은 GA4 기본값이라 콘솔에서 세션 타임아웃을 바꾸면 이 상수도 같이 바꿔야 한다.

## 7. GA4 이벤트 계약

| 이벤트 | 파라미터 | 값 |
|---|---|---|
| `inquiry_screen_viewed` | `entry_point` | `'menu'` (현재 진입점이 하나뿐) |
| `inquiry_category_selected` | `category` | `focus` \| `group` \| `etc` |
| `inquiry_contact_opened` | `category` | 위 3종 \| `'none'` (미선택) |
| | `contact_id` | `dev-focus` \| `dev-group` \| `dev-etc` |
| | `is_recommended` | TS 타입은 `boolean`, **전선 위 값은 문자열 `'true'`/`'false'`** |

**서버(MP)에서 발행하지 않는다** — 백엔드가 이 기능을 모르므로 이중 집계 위험이 없다.

⚠️ `services/analytics.ts`의 `sanitizeParams`가 boolean을 `'true' | 'false'` 문자열로 변환한다
(GA4 파라미터 값 통일 규약). 호출부는 `boolean`을 그대로 넘기면 되지만, **대시보드·탐색에서
`is_recommended = true`를 boolean으로 필터하면 0건이 나온다.** `prd.md` §5의 추천 일치율이
이 값을 쓴다.

## 8. 테스트

### 8.1 `constants/inquiryContacts.test.ts` (신규)

§1의 불변식 5개를 그대로 검증한다. 이 테스트의 목적은 **담당자를 교체하다 계약을 깨는 것을 막는 것**이다 — 상수 파일은 OTA로 자주 손대는 파일이고, 손대는 사람이 IA 문서를 다시 읽지 않는다.

```ts
it('카테고리마다 담당자가 정확히 1명이다', () => { … });
it('오픈채팅 URL 이 https://open.kakao.com/o/… 다', () => { … });  // 호스트·경로까지(D7)
it('담당자 id 가 유일하다', () => { … });
it('avatarPaletteIndex 가 T.avatarPalette 범위 안이다', () => { … });
```

### 8.2 `screens/settings/inquiryLink.test.ts` (신규)

`Linking`을 모킹한다.

```ts
it('openURL 성공 시 true', … );
it('openURL 이 throw 하면 false — 예외가 밖으로 새지 않는다', … );
it('canOpenURL 을 호출하지 않는다', … );   // 사전 검사 금지 규약을 잠근다
```

### 8.3 `screens/settings/InquiryScreen.test.tsx` (신규)

§5.4의 닫기 계약은 문서로만 두면 반드시 깨진다. 컴포넌트 테스트로 잠근다.

```ts
it('실패 후 닫고 다른 담당자를 누르면 확인 모달이 뜬다', … );  // failed 누수 — 가장 중요
it('요청 중에는 주 버튼이 비활성이다', … );                     // 연타 → 이벤트 중복
it('요청 중 모달을 닫으면 늦게 온 실패 결과가 무시된다', … );   // 폐기된 요청
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
| Q7 | 기기 글자 크기를 최대로 해도 닉네임·성격 설명·CTA가 잘리지 않는다 |
| Q8 | 작은 기기(iPhone SE)에서 카드 3장이 스크롤로 전부 도달 가능하다 |

Maestro E2E는 붙이지 않는다 — 흐름의 종착점이 앱 밖이라 검증할 수 있는 구간이 「모달이 뜬다」까지뿐이다.

## 9. 착수 전 체크리스트

- [ ] 담당자 3명 **닉네임(활동명)** · 성격 설명 · 소개 문구 · 응답 시간 확정 (`policy.md` D10 — 실명이 아니라 노출 동의 절차 없음)
- [ ] 카카오톡 1:1 오픈채팅방 3개 개설 + 영구 URL 확보 (`policy.md` D3)
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
