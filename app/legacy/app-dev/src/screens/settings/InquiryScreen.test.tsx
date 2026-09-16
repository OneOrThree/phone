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
import { AppState } from 'react-native';
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

// AppState는 파일 전역에서 한 번만 목한다 — 개별 테스트에서 spyOn/mockRestore를 하면
// 복원이 새어 뒤따르는 테스트의 언마운트(sub.remove())가 통째로 깨진다.
const appStateHandlers: ((state: string) => void)[] = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _event: string,
  handler: (state: string) => void,
) => {
  appStateHandlers.push(handler);
  return { remove: jest.fn() };
}) as never);

/** AppState 'active' 복귀를 흉내 낸다. */
async function returnToForeground() {
  await act(async () => {
    appStateHandlers.forEach((h) => h('active'));
  });
}

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
  appStateHandlers.length = 0;
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

  // 위 테스트는 **1차 요청**이 늦게 오는 경우만 본다. 재시도는 failed 상태에서 출발해
  // 경로가 달라, 같은 reqIdRef를 타더라도 이 조합만 깨뜨리는 리팩터링을 CI가 못 잡는다.
  test('재시도 진행 중에 닫으면, 늦게 온 재시도 결과도 폐기된다', async () => {
    let settleRetry: ((ok: boolean) => void) | undefined;
    mockOpenInquiryChat
      .mockResolvedValueOnce(false) // 1차 → 실패 화면
      .mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          settleRetry = resolve;
        }),
      );
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    await press('inquiry.confirm.primary');
    expect(screen.getByText('카카오톡을 열 수 없어요')).toBeOnTheScreen();

    await press('inquiry.confirm.primary'); // 「다시 시도」 — 응답이 오지 않는다
    await press('inquiry.confirm.backdrop'); // 재시도 대기 중 닫기

    await act(async () => {
      settleRetry?.(false); // 폐기됐어야 할 재시도가 이제야 실패로 도착
    });

    // 모달이 닫힌 채로 남아야 한다 — 실패 화면이 되살아나면 안 된다.
    expect(screen.queryByText('카카오톡을 열 수 없어요')).toBeNull();
    expect(screen.queryByText('카카오톡으로 이동할까요?')).toBeNull();
  });

  // 이미 디스패치된 openURL 은 되돌릴 수 없다 — 「취소」를 눌러도 카카오톡이 그대로 뜬다.
  // 취소가 아닌 것을 취소라고 부르지 않는다(백드롭은 탈출구로 남긴다).
  test('요청 중에는 「취소」 버튼을 노출하지 않는다', async () => {
    mockOpenInquiryChat.mockReturnValueOnce(new Promise<boolean>(() => {}));
    await render(<InquiryScreen />);

    await openConfirm(FOCUS.id);
    expect(screen.getByTestId('inquiry.confirm.secondary')).toBeOnTheScreen();

    await press('inquiry.confirm.primary'); // 응답이 오지 않는 요청
    expect(screen.queryByTestId('inquiry.confirm.secondary')).toBeNull();
    // 백드롭은 남는다 — openURL 이 영영 안 끝나면 갇히기 때문이다.
    expect(screen.getByTestId('inquiry.confirm.backdrop')).toBeOnTheScreen();
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

// 이 배선(30분 가드 + AppState 복귀)이 이 화면 계측 설계의 핵심인데, 여기가 안 잠기면
// 다음 리팩터링에서 리스너를 실수로 지워도 CI가 못 잡는다.
describe('InquiryScreen — 세션 경계 재발화', () => {
  test('활동 없이 30분이 지난 뒤 복귀하면 노출을 다시 쏜다', async () => {
    jest.useFakeTimers();
    try {
      await render(<InquiryScreen />);
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // 29분 뒤 복귀 — 아직 같은 세션이라 다시 쏘지 않는다.
      await act(async () => {
        jest.advanceTimersByTime(29 * 60 * 1000);
      });
      await returnToForeground();
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // ⚠️ 위 복귀가 **활동으로 집계돼 기준 시각이 갱신**됐다. 그래서 여기서 다시 31분을
      //    흘려야 세션이 끊긴 것으로 본다 — 최초 마운트로부터 31분이 아니다.
      //    (GA4가 어떤 이벤트로든 세션을 연장하는 것과 같은 규칙이다.)
      await act(async () => {
        jest.advanceTimersByTime(31 * 60 * 1000);
      });
      await returnToForeground();
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // 실패 모달을 오래 열어 뒀다 재시도하는 경로. 세션이 바뀌었으면 그 재시도는 새 세션의
  // **첫 이동**이므로 분자로 세야 한다 — 억제하면 새 세션에 분모만 남아 전환율이 낮아진다.
  test('세션이 바뀐 뒤의 첫 재시도는 이동 이벤트로 기록한다', async () => {
    jest.useFakeTimers();
    try {
      mockOpenInquiryChat.mockResolvedValue(false);
      await render(<InquiryScreen />);
      await openConfirm(FOCUS.id);
      await press('inquiry.confirm.primary'); // 1차 실패
      expect(mockLogContactOpened).toHaveBeenCalledTimes(1);
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // 같은 세션 안의 재시도는 여전히 억제된다(모달 1회 = 선택 1건).
      await press('inquiry.confirm.primary');
      expect(mockLogContactOpened).toHaveBeenCalledTimes(1);

      // 모달을 연 채 31분 경과 — 세션이 끊긴 것으로 본다.
      await act(async () => {
        jest.advanceTimersByTime(31 * 60 * 1000);
      });
      await press('inquiry.confirm.primary');

      // 새 세션에 분모(노출)와 분자(이동)가 **둘 다** 잡혀야 한다.
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(2);
      expect(mockLogContactOpened).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // ⚠️ AppState 복귀가 「새 세션」 신호를 먼저 소비하는 경합. 위 테스트는 시간만 흘리므로
  //    이 조합(복귀 → 곧바로 재시도)을 못 잡는다.
  test('앱 복귀로 세션이 갱신된 직후의 재시도도 이동 이벤트로 기록한다', async () => {
    jest.useFakeTimers();
    try {
      mockOpenInquiryChat.mockResolvedValue(false);
      await render(<InquiryScreen />);
      await openConfirm(FOCUS.id);
      await press('inquiry.confirm.primary'); // 1차 실패
      expect(mockLogContactOpened).toHaveBeenCalledTimes(1);
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // 실패 모달을 띄운 채 앱을 떠났다 31분 뒤 복귀 — 리스너가 노출을 먼저 쏜다.
      await act(async () => {
        jest.advanceTimersByTime(31 * 60 * 1000);
      });
      await returnToForeground();
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(2);

      // 그 직후의 「다시 시도」 — 새 세션의 첫 이동이므로 분자로 잡혀야 한다.
      await press('inquiry.confirm.primary');
      expect(mockLogContactOpened).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('이벤트를 쏘지 않은 호출도 기준 시각을 갱신한다 — 같은 세션에서 분모가 두 번 잡히지 않는다', async () => {
    jest.useFakeTimers();
    try {
      await render(<InquiryScreen />);
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // 20분 뒤 카테고리 선택 — 노출은 안 쏘지만 활동이므로 기준 시각이 갱신된다.
      await act(async () => {
        jest.advanceTimersByTime(20 * 60 * 1000);
      });
      await press(`inquiry.chip.${FOCUS.categoryId}`);
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);

      // 다시 11분 뒤(마운트로부터 31분) 담당자 확정 — GA4에선 11분 전 이벤트가 세션을
      // 연장했으므로 **같은 세션**이다. 노출을 또 쏘면 분모가 2번 잡혀 전환율이 낮아진다.
      await act(async () => {
        jest.advanceTimersByTime(11 * 60 * 1000);
      });
      await openConfirm(FOCUS.id);
      await press('inquiry.confirm.primary');
      expect(mockLogScreenViewed).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
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
