// InquiryScreen 테스트 — docs/prd/inquiry/low-level-design.md §8.3.
//
// 이 화면의 계약 중 문서로만 두면 반드시 깨지는 것들을 잠근다:
//  1) 닫기 계약 — target·failed·pending을 함께 되돌린다(§5.4). 안 그러면 담당자 A의 실패가
//     담당자 B의 모달로 새어 「시도하지도 않은 실패」가 뜬다.
//  2) 요청 세대 — await 사이에 닫았다가 **같은 담당자**를 다시 열면 늦게 온 이전 결과가
//     새 모달을 실패 화면으로 갈아 끼운다. 대상 객체 비교로는 못 잡는다(상수라 같은 객체).
//  3) 「다시 시도」는 새로운 「선택」이 아니다 — 모달 1회 = 이벤트 1건(prd.md §5 추천 일치율).
//  4) 카테고리 정렬은 목록에서 빼지 않는다 — 항상 3장(policy.md D2).
//  5) CTA 3개가 화면 읽기에서 구분된다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import InquiryScreen from './InquiryScreen';
import { openInquiryChat } from '@/screens/settings/inquiryLink';
import {
  logInquiryCategorySelected,
  logInquiryContactOpened,
  logInquiryScreenViewed,
} from '@/services/analyticsEvents';
import { INQUIRY_CONTACTS } from '@/constants/inquiryContacts';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

// analyticsEvents는 firebase 네이티브 모듈을 물어 온다 — 목으로 막지 않으면 스위트가
// 로드 단계에서 죽는다(AccountScreen.test와 동일한 이유).
jest.mock('@/services/analyticsEvents', () => ({
  logInquiryScreenViewed: jest.fn(),
  logInquiryCategorySelected: jest.fn(),
  logInquiryContactOpened: jest.fn(),
}));

// 링크 열기는 목으로 성공/실패를 제어한다(Linking 자체는 inquiryLink.test.ts가 본다).
jest.mock('@/screens/settings/inquiryLink', () => ({
  openInquiryChat: jest.fn(),
}));

const mockOpenInquiryChat = openInquiryChat as jest.MockedFunction<typeof openInquiryChat>;
const mockLogScreenViewed = logInquiryScreenViewed as jest.MockedFunction<
  typeof logInquiryScreenViewed
>;
const mockLogCategorySelected = logInquiryCategorySelected as jest.MockedFunction<
  typeof logInquiryCategorySelected
>;
const mockLogContactOpened = logInquiryContactOpened as jest.MockedFunction<
  typeof logInquiryContactOpened
>;

const FOCUS = INQUIRY_CONTACTS[0];
const GROUP = INQUIRY_CONTACTS[1];

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** 카드 CTA를 눌러 확인 모달을 연다. */
async function openConfirm(contactId: string) {
  await press(`inquiry.card.${contactId}.cta`);
}

/** 화면에 보이는 담당자 카드 순서(CTA·모달 testID는 제외하고 카드 루트만 잡는다). */
function cardOrder(): string[] {
  return screen
    .getAllByTestId(/^inquiry\.card\.[^.]+$/)
    .map((node) => String(node.props.testID).replace('inquiry.card.', ''));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenInquiryChat.mockResolvedValue(true);
});

describe('InquiryScreen — 닫기 계약', () => {
  // §5.4에서 가장 나오기 쉬운 실수. target만 갈아끼우는 구현이 자연스러워 보인다.
  test('실패 후 닫고 다른 담당자를 누르면 확인 모달이 뜬다(실패 화면이 아니다)', async () => {
    mockOpenInquiryChat.mockResolvedValueOnce(false);
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');
    expect(screen.getByText('카카오톡을 열 수 없어요')).toBeOnTheScreen();

    await press('inquiry.confirm.secondary'); // 「닫기」
    expect(screen.queryByText('카카오톡을 열 수 없어요')).toBeNull();

    await openConfirm(GROUP.id);
    expect(screen.getByText('카카오톡으로 이동할까요?')).toBeOnTheScreen();
    expect(screen.queryByText('카카오톡을 열 수 없어요')).toBeNull();
    expect(screen.getByTestId('inquiry.confirm.primary')).toBeOnTheScreen();
  });

  test('백드롭 탭도 같은 닫기 경로다 — 실패 상태가 남지 않는다', async () => {
    mockOpenInquiryChat.mockResolvedValueOnce(false);
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');
    await press('inquiry.confirm.backdrop');

    await openConfirm(FOCUS.id);
    expect(screen.getByText('카카오톡으로 이동할까요?')).toBeOnTheScreen();
  });
});

describe('InquiryScreen — 진행 중 요청', () => {
  // 세대 토큰. 「대상이 같은지」로 비교하면 상수 객체라 이 검사를 그대로 통과해 버린다.
  test('요청 중 모달을 닫고 같은 담당자를 다시 열면, 늦게 온 이전 결과가 새 모달을 건드리지 않는다', async () => {
    let settleFirst: ((ok: boolean) => void) | undefined;
    mockOpenInquiryChat.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        settleFirst = resolve;
      }),
    );
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary'); // 응답이 오지 않는 요청
    await press('inquiry.confirm.backdrop'); // 대기 중 닫기

    await openConfirm(FOCUS.id); // **같은** 담당자를 다시 연다
    expect(screen.getByText('카카오톡으로 이동할까요?')).toBeOnTheScreen();

    await act(async () => {
      settleFirst?.(false); // 폐기됐어야 할 이전 요청이 이제야 실패로 도착
    });

    expect(screen.getByText('카카오톡으로 이동할까요?')).toBeOnTheScreen();
    expect(screen.queryByText('카카오톡을 열 수 없어요')).toBeNull();
  });

  test('요청 중에는 주 버튼이 비활성이다 — 연타해도 요청·이벤트가 늘지 않는다', async () => {
    mockOpenInquiryChat.mockReturnValueOnce(new Promise<boolean>(() => {}));
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');

    const primary = screen.getByTestId('inquiry.confirm.primary');
    expect(primary.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));

    await press('inquiry.confirm.primary');
    await press('inquiry.confirm.primary');
    expect(mockOpenInquiryChat).toHaveBeenCalledTimes(1);
    expect(mockLogContactOpened).toHaveBeenCalledTimes(1);
  });
});

describe('InquiryScreen — 계측', () => {
  test('「다시 시도」는 contact_opened를 다시 쏘지 않는다(모달 1회 = 선택 1건)', async () => {
    mockOpenInquiryChat.mockResolvedValue(false);
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');
    expect(mockLogContactOpened).toHaveBeenCalledTimes(1);
    expect(mockLogContactOpened).toHaveBeenCalledWith({
      category: null,
      contactId: FOCUS.id,
      isRecommended: false,
    });

    await press('inquiry.confirm.primary'); // 「다시 시도」
    await press('inquiry.confirm.primary');
    expect(mockOpenInquiryChat).toHaveBeenCalledTimes(3);
    expect(mockLogContactOpened).toHaveBeenCalledTimes(1);
  });

  test('노출 이벤트는 마운트 1회만 쏜다(같은 세션에서는 중복 발화하지 않는다)', async () => {
    await render(<InquiryScreen />);
    expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

    await press(`inquiry.chip.${FOCUS.categoryId}`);
    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');
    expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);
  });

  test('칩 해제(null)는 이벤트를 쏘지 않는다 — 선택만 센다', async () => {
    await render(<InquiryScreen />);

    await press(`inquiry.chip.${FOCUS.categoryId}`);
    expect(mockLogCategorySelected).toHaveBeenCalledTimes(1);
    expect(mockLogCategorySelected).toHaveBeenCalledWith(FOCUS.categoryId);

    await press(`inquiry.chip.${FOCUS.categoryId}`); // 재탭 = 해제
    expect(mockLogCategorySelected).toHaveBeenCalledTimes(1);
  });

  test('추천 담당자를 고르면 is_recommended가 참으로 기록된다', async () => {
    await render(<InquiryScreen />);

    await press(`inquiry.chip.${FOCUS.categoryId}`);
    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');

    expect(mockLogContactOpened).toHaveBeenCalledWith({
      category: FOCUS.categoryId,
      contactId: FOCUS.id,
      isRecommended: true,
    });
  });
});

describe('InquiryScreen — 카테고리 정렬', () => {
  test('카테고리를 고르면 해당 담당자가 맨 앞이고 나머지 2장이 남는다', async () => {
    await render(<InquiryScreen />);
    const base = cardOrder();
    expect(base).toHaveLength(INQUIRY_CONTACTS.length);

    await press(`inquiry.chip.${GROUP.categoryId}`);
    const sorted = cardOrder();
    expect(sorted[0]).toBe(GROUP.id);
    // 목록에서 빼지 않는다 — 「직접 지목」(policy.md D2)이 유지되려면 항상 3장 다 보여야 한다.
    expect(sorted).toHaveLength(INQUIRY_CONTACTS.length);
    expect([...sorted].sort()).toEqual([...base].sort());
  });

  test('같은 칩을 다시 누르면 선택이 해제되고 원래 순서로 돌아온다', async () => {
    await render(<InquiryScreen />);
    const base = cardOrder();

    await press(`inquiry.chip.${GROUP.categoryId}`);
    expect(cardOrder()).not.toEqual(base);

    await press(`inquiry.chip.${GROUP.categoryId}`);
    expect(cardOrder()).toEqual(base);
  });
});

describe('InquiryScreen — 접근성', () => {
  // 버튼 라벨이 3장 다 같고 닉네임은 형제 요소라, 라벨이 없으면 똑같은 버튼 3개로 읽힌다.
  test('CTA 3개의 accessibilityLabel이 서로 다르다', async () => {
    await render(<InquiryScreen />);

    const labels = INQUIRY_CONTACTS.map(
      (contact) => screen.getByTestId(`inquiry.card.${contact.id}.cta`).props.accessibilityLabel,
    );
    expect(new Set(labels).size).toBe(INQUIRY_CONTACTS.length);
    labels.forEach((label) => expect(label).toEqual(expect.any(String)));
  });

  test('칩이 선택 상태를 접근성으로 노출한다', async () => {
    await render(<InquiryScreen />);
    const chipID = `inquiry.chip.${FOCUS.categoryId}`;

    expect(screen.getByTestId(chipID).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    await press(chipID);
    expect(screen.getByTestId(chipID).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });
});
