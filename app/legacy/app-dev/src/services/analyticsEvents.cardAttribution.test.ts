import { track } from '@/services/analytics';
import {
  logFocusSessionStarted,
  logGroupCardActionClicked,
  logGroupRoomViewed,
} from './analyticsEvents';

jest.mock('@/services/analytics', () => ({
  track: jest.fn(),
  setUserProperty: jest.fn(),
}));

const mockTrack = track as jest.MockedFunction<typeof track>;

beforeEach(() => jest.clearAllMocks());

test('카드 action은 typed helper 한 경로로 interaction_id를 발행한다', () => {
  logGroupCardActionClicked({
    action: 'focus',
    role: 'owner',
    back_source: 'user',
    interaction_id: '11111111-1111-4111-8111-111111111111',
  });

  expect(mockTrack).toHaveBeenCalledWith('group_card_action_clicked', {
    action: 'focus',
    role: 'owner',
    back_source: 'user',
    interaction_id: '11111111-1111-4111-8111-111111111111',
  });
});

test('Room·Focus 결과는 entry_source를 필수로, 유효한 경우에만 같은 ID를 받는다', () => {
  logGroupRoomViewed({
    group_id: 'group-id',
    entry_source: 'group_card',
    interaction_id: '11111111-1111-4111-8111-111111111111',
  });
  logFocusSessionStarted({
    has_tag: true,
    mode: 'countup',
    entry_source: 'home_fab',
  });

  expect(mockTrack).toHaveBeenNthCalledWith(1, 'group_room_viewed', {
    group_id: 'group-id',
    entry_source: 'group_card',
    interaction_id: '11111111-1111-4111-8111-111111111111',
  });
  expect(mockTrack).toHaveBeenNthCalledWith(2, 'focus_session_started', {
    has_tag: true,
    mode: 'countup',
    entry_source: 'home_fab',
  });
});
