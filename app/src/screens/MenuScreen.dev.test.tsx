// 전체 메뉴의 dev 미리보기 진입점 테스트 — 챌린지 결과 모달(A3)을 실데이터 없이 여는 경로.
//
// 결과 모달은 '종료된 챌린지 + 미노출 가드'가 동시에 성립할 때만 뜨는 화면이라, 진입점이 깨져도
// 한참 뒤에야 알게 된다. 여기서 잠그는 것:
//  1) __DEV__ 빌드에서 3분기(달성·미달성·집계 중) 행이 서고, 누르면 실제 모달이 뜬다.
//  2) 미리보기는 **모달만** 띄운다 — 1회 노출 가드·GA4는 GroupRoomScreen이 쥐고 있어
//     아무리 열어도 실사용 가드/지표가 오염되지 않는다(오염되면 그날 진짜 결과가 증발한다).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MenuScreen from './MenuScreen';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({
    userId: 'me',
    nickname: '나',
    goalSeconds: 7200,
    screenTimeGoalSeconds: 7200,
  }),
}));

// 프로필 헤더가 캐릭터(누끼) 소스를 읽는다 — 테스트 트리엔 Provider가 없다.
jest.mock('@/store/CharacterContext', () => ({
  useCharacter: () => ({
    choice: 'default',
    customUri: null,
    setChoice: jest.fn(),
    setCustomUri: jest.fn(),
    activeSource: null,
  }),
}));

// 프로필 아래 시간조각(재화) 잔액 행이 useCoins/useRefreshCoinsOnFocus를 읽는다 — 테스트 트리엔
// CoinProvider가 없다(이 화면은 결과 모달만 미리보는 dev 진입점이라 실제 잔액이 필요 없다).
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: 0, coinsLoaded: true }),
  useRefreshCoinsOnFocus: jest.fn(),
}));

jest.mock('@/services/statsApi', () => ({ getStreak: jest.fn(async () => ({ current: 3 })) }));
jest.mock('@/services/screentimeSync', () => ({
  registerUsageBucketMonitoring: jest.fn(async () => true),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAllowedSelectionCounts: jest.fn(async () => ({ applications: 3 })),
    getAuthorizationStatus: jest.fn(async () => 'approved'),
    getUsageBucketDebugInfo: jest.fn(async () => null),
  },
}));

// 결과 모달의 노출 가드·계측이 미리보기에서 절대 불리지 않아야 한다(위 2번).
jest.mock('@/screens/group/challengeResult', () => ({
  ...jest.requireActual('@/screens/group/challengeResult'),
  markChallengeResultSeen: jest.fn(),
}));
const { markChallengeResultSeen } = jest.requireMock('@/screens/group/challengeResult');

jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeResultShown: jest.fn(),
  logGroupChallengeResultClosed: jest.fn(),
  logTabGuideCompleted: jest.fn(),
}));
const { logGroupChallengeResultShown } = jest.requireMock('@/services/analyticsEvents');

// MenuScreen은 포커스 이펙트에서 네이티브·API를 여러 개 호출한다 — 렌더 자체를 act로 감싸야
// 그 setState들이 한 배치로 정리되고, 이후 press의 리렌더가 정상 반영된다.
async function renderMenu() {
  await act(async () => {
    render(<MenuScreen />);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('dev 미리보기 — 챌린지 결과 모달', () => {
  test.each([
    ['챌린지 결과 모달 — 달성', '목표를 달성했어요!'],
    ['챌린지 결과 모달 — 미달성', '아쉽게 놓쳤어요'],
    ['챌린지 결과 모달 — 집계 중', '결과 집계 중이에요'],
  ])('%s 행을 누르면 그 분기의 모달이 뜬다', async (row, headline) => {
    await renderMenu();

    await act(async () => {
      fireEvent.press(screen.getByText(row));
    });

    expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText(headline)).toBeOnTheScreen();

    // 닫으면 사라진다 — 열어 둔 채 다른 분기를 누르는 것도 가능해야 하므로 상태가 남지 않는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.challengeResult.close'));
    });
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  // 미리보기가 실사용 경로를 오염시키면 그날의 진짜 결과가 '이미 봤다'로 묻힌다.
  test('미리보기는 1회 노출 가드도 GA4도 건드리지 않는다', async () => {
    await renderMenu();

    await act(async () => {
      fireEvent.press(screen.getByText('챌린지 결과 모달 — 달성'));
    });
    expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();

    expect(markChallengeResultSeen).not.toHaveBeenCalled();
    expect(logGroupChallengeResultShown).not.toHaveBeenCalled();
    // 스토리지에도 가드 키가 생기지 않는다(프리픽스 전수 확인).
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith('gromo:challengeResult'))).toEqual([]);
  });
});
