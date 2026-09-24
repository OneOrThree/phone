import {
  buildLiveActivityPayload,
  REST_AUTO_CLOSE_MS,
  shouldReconcileExpiredRest,
} from './liveActivity';
import type { Color, Session } from './model';

const base: Session = {
  id: 'session-1',
  islandId: 'island-1',
  subject: '영어 공부',
  status: 'active',
  startedAt: 1_000_000,
  seconds: 120,
};

describe('Live Activity payload', () => {
  it.each<Color>(['black', 'ginger', 'cream', 'gray', 'white', 'calico'])(
    'reflects selected %s cat in focus and rest',
    (color) => {
      expect(buildLiveActivityPayload(base, color).catColor).toBe(color);
      expect(buildLiveActivityPayload({ ...base, status: 'paused' }, color).catColor).toBe(color);
    },
  );

  it('starts focus count-up from accumulated time and includes live counts', () => {
    expect(buildLiveActivityPayload(base, 'black', { focus: 12, rest: 3 })).toEqual({
      sessionId: 'session-1',
      phase: 'focus',
      subject: '영어 공부',
      catColor: 'black',
      anchorMs: 880_000,
      focusCount: 12,
    });
  });

  it('uses the rest start and removes the focus subject during rest', () => {
    expect(
      buildLiveActivityPayload({ ...base, status: 'paused', restStartedAt: 1_050_000 }, 'calico', {
        focus: 12,
        rest: 3,
      }),
    ).toEqual({
      sessionId: 'session-1',
      phase: 'rest',
      subject: '',
      catColor: 'calico',
      anchorMs: 1_050_000,
      restCount: 3,
    });
  });

  it('reconciles a server-backed rest only after the one-hour expiry', () => {
    const rest = { ...base, status: 'paused' as const, version: 3, restStartedAt: 1_050_000 };
    expect(shouldReconcileExpiredRest(rest, 1_050_000 + REST_AUTO_CLOSE_MS - 1)).toBe(false);
    expect(shouldReconcileExpiredRest(rest, 1_050_000 + REST_AUTO_CLOSE_MS)).toBe(true);
    expect(
      shouldReconcileExpiredRest({ ...rest, status: 'active' }, 1_050_000 + REST_AUTO_CLOSE_MS),
    ).toBe(false);
    expect(
      shouldReconcileExpiredRest({ ...rest, version: undefined }, 1_050_000 + REST_AUTO_CLOSE_MS),
    ).toBe(false);
  });
});
