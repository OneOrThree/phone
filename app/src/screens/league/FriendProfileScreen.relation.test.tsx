// FriendProfileScreen 관계 초기값 동기화(GROMO-1631) — 공개 프로필의 relation/isPinned를
// **로컬 state 초기값으로만** 쓰는 계약을 잠근다(계약 Do-not-change: profile?.relation 직접 렌더 금지).
//
// 잠그는 규칙:
//   ① relation이 오면 목록 3콜(fetchFriends/fetchPinnedFriends/fetchSentRequests) 없이 동기화된다
//   ② PENDING → '요청됨' (방향 무구분, 검색 화면과 동일 표기 — decisions N02)
//   ③ 핀 우선순위: route.params.isPinned(낙관 최신) > profile.isPinned > 기존값
//   ④ 이 화면에서 방금 누른 신청(true)을 뒤늦게 도착한 프로필(NONE)이 덮지 않는다 — OR 유지
//   ⑤ relation 미제공(구서버)이면 기존 목록 3콜 폴백이 살아 있다
//
// ⚠️ 통계·차트 영역은 이 테스트의 관심사가 아니다 — 통계 조회는 전부 실패로 목킹(요약 '비공개' 경로).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PublicProfileResponse } from '@/types/dto/user';
import FriendProfileScreen from './FriendProfileScreen';
import { getPublicProfile, getUserStats } from '@/services/userApi';
import {
  fetchFriends,
  fetchPinnedFriends,
  fetchSentRequests,
  sendFriendRequest,
} from '@/services/friendsApi';

let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return {
    SafeAreaView: RNView,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// 아이콘 name을 텍스트로 렌더 — 핀 on/off('pin'/'pin-outline') 판정을 텍스트로 단언한다.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Icon = ({ name }: { name: string }) => React.createElement(RNText, null, String(name));
  return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

// 차트·아바타·티저는 관심사 밖 — 렌더 비용과 svg 의존을 잘라낸다.
jest.mock('./components/MemberAvatar', () => ({ MemberAvatar: () => null }));
jest.mock('./components/TierBadge', () => ({ TierBadge: () => null }));
jest.mock('./components/DuoDayChart', () => ({ DuoDayChart: () => null }));
jest.mock('./components/SubjectCompareCard', () => ({ SubjectCompareCard: () => null }));
jest.mock('@/screens/stats/ComingSoon', () => ({ ComingSoon: () => null }));

jest.mock('@/services/userApi', () => ({
  getPublicProfile: jest.fn(),
  getUserStats: jest.fn(),
}));
jest.mock('@/services/statsApi', () => ({
  getFocusStatsByCategory: jest.fn(() => Promise.reject(new Error('n/a'))),
  getHeatmap: jest.fn(() => Promise.reject(new Error('n/a'))),
  getTodayStats: jest.fn(() => Promise.reject(new Error('n/a'))),
}));
jest.mock('@/services/friendsApi', () => ({
  deleteFriend: jest.fn(),
  fetchFriends: jest.fn(() => Promise.resolve([])),
  fetchPinnedFriends: jest.fn(() => Promise.resolve([])),
  fetchSentRequests: jest.fn(() => Promise.resolve([])),
  pinFriend: jest.fn(() => Promise.resolve()),
  sendFriendRequest: jest.fn(() => Promise.resolve()),
  unpinFriend: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logFriendPinToggled: jest.fn(),
  logFriendRequestSent: jest.fn(),
  logFriendUnfriended: jest.fn(),
}));

const profileOf = (over: Partial<PublicProfileResponse> = {}): PublicProfileResponse => ({
  userId: 'u1',
  nickname: '목친구',
  occupation: null,
  equipments: [],
  friendCount: 3,
  currentTier: 2,
  rank: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { userId: 'u1', nickname: '목친구', tierLevel: 2, isFriend: false };
  (getUserStats as jest.Mock).mockRejectedValue(new Error('n/a'));
});

test('relation=FRIEND → 목록 3콜 없이 친구 끊기 CTA', async () => {
  (getPublicProfile as jest.Mock).mockResolvedValue(profileOf({ relation: 'FRIEND' }));
  await render(<FriendProfileScreen />);
  expect(await screen.findByText('친구 끊기')).toBeTruthy();
  expect(fetchFriends).not.toHaveBeenCalled();
  expect(fetchPinnedFriends).not.toHaveBeenCalled();
  expect(fetchSentRequests).not.toHaveBeenCalled();
});

test('relation=PENDING → 요청됨 (방향 무구분 수용)', async () => {
  (getPublicProfile as jest.Mock).mockResolvedValue(profileOf({ relation: 'PENDING' }));
  await render(<FriendProfileScreen />);
  expect(await screen.findByText('요청됨')).toBeTruthy();
});

test('핀: route 파라미터 없으면 profile.isPinned 반영, 파라미터가 있으면 파라미터가 이긴다', async () => {
  (getPublicProfile as jest.Mock).mockResolvedValue(
    profileOf({ relation: 'NONE', isPinned: true }),
  );
  await render(<FriendProfileScreen />);
  expect(await screen.findByText('pin')).toBeTruthy(); // 서버 isPinned=true → 핀 on

  // 진입 파라미터가 핀 값을 준 경우(usePinned 낙관 최신) — 서버 스냅샷이 덮지 않는다.
  mockParams = { ...mockParams, isPinned: false };
  await render(<FriendProfileScreen />);
  await screen.findAllByText('친구 신청');
  await waitFor(() => expect(screen.getAllByText('pin-outline').length).toBeGreaterThan(0));
  expect(fetchPinnedFriends).not.toHaveBeenCalled();
});

test('이 화면에서 누른 신청(true)을 뒤늦게 도착한 프로필(NONE)이 덮지 않는다', async () => {
  let resolveProfile!: (p: PublicProfileResponse) => void;
  (getPublicProfile as jest.Mock).mockReturnValue(
    new Promise<PublicProfileResponse>((r) => {
      resolveProfile = r;
    }),
  );
  await render(<FriendProfileScreen />);
  await fireEvent.press(screen.getByText('친구 신청'));
  expect(await screen.findByText('요청됨')).toBeTruthy();
  expect(sendFriendRequest).toHaveBeenCalledWith('u1');

  await act(async () => {
    resolveProfile(profileOf({ relation: 'NONE' })); // 신청 전 스냅샷이 뒤늦게 도착
  });
  expect(screen.getByText('요청됨')).toBeTruthy(); // OR 유지 — 되돌아가지 않는다
  expect(screen.queryByText('친구 신청')).toBeNull();
});

test('relation 미제공(구서버) → 기존 목록 3콜 폴백으로 재동기화', async () => {
  (getPublicProfile as jest.Mock).mockResolvedValue(profileOf()); // relation·isPinned 없음
  (fetchFriends as jest.Mock).mockResolvedValue([{ userId: 'u1', nickname: '목친구' }]);
  await render(<FriendProfileScreen />);
  expect(await screen.findByText('친구 끊기')).toBeTruthy();
  expect(fetchFriends).toHaveBeenCalled();
  expect(fetchPinnedFriends).toHaveBeenCalled();
  expect(fetchSentRequests).toHaveBeenCalled();
});
