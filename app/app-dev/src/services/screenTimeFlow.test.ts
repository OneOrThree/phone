import { shouldGateScreenTimeBoard } from './screenTimeFlow';

describe('screenTime board entry', () => {
  it('gates only the first iOS board or external board-detail entry', () => {
    expect(shouldGateScreenTimeBoard('board', { isIOS: true, promptSeen: false })).toBe(true);
    expect(shouldGateScreenTimeBoard('quest', { isIOS: true, promptSeen: false })).toBe(true);
    expect(shouldGateScreenTimeBoard('board', { isIOS: true, promptSeen: true })).toBe(false);
    expect(shouldGateScreenTimeBoard('quest', { isIOS: true, promptSeen: true })).toBe(false);
    expect(shouldGateScreenTimeBoard('board', { isIOS: false, promptSeen: false })).toBe(false);
    expect(shouldGateScreenTimeBoard('home', { isIOS: true, promptSeen: false })).toBe(false);
  });
});
