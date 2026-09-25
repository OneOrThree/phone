import { CAT_FRAME_SEQUENCES, catFrameAt, nextIdleBehavior, normalizeCatMotion } from './catMotion';

describe('catMotion', () => {
  it('모든 반복 tick을 유효한 프레임으로 변환한다', () => {
    for (const [motion, sequence] of Object.entries(CAT_FRAME_SEQUENCES)) {
      for (let tick = -12; tick < 40; tick += 1) {
        expect(sequence).toContain(catFrameAt(motion as keyof typeof CAT_FRAME_SEQUENCES, tick));
      }
    }
  });

  it('걷기는 6 프레임을 순서대로 우선 재생한다', () => {
    expect(Array.from({ length: 8 }, (_, tick) => catFrameAt('walk', tick))).toEqual([
      0, 1, 2, 3, 4, 5, 0, 1,
    ]);
    expect(normalizeCatMotion('walking')).toBe('walk');
  });

  it('모션을 바꿀 때 사용할 첫 프레임은 항상 0번이다', () => {
    expect(catFrameAt('walk', 0)).toBe(0);
    expect(catFrameAt('read', 0)).toBe(0);
    expect(catFrameAt('focus', 0)).toBe(0);
    expect(catFrameAt('reel', 0)).toBe(0);
  });

  it('대기 자세 아틀라스는 neutral부터 settle까지 한 번씩 진행한다', () => {
    expect(Array.from({ length: 6 }, (_, tick) => catFrameAt('yawn', tick))).toEqual([
      0, 1, 2, 3, 0, 1,
    ]);
    expect(Array.from({ length: 4 }, (_, tick) => catFrameAt('stretch', tick))).toEqual([
      0, 1, 2, 3,
    ]);
    expect(Array.from({ length: 4 }, (_, tick) => catFrameAt('groom', tick))).toEqual([0, 1, 2, 3]);
  });

  it('idle은 첫 동작을 깜박임으로 시작하고 이후 동작을 섞는다', () => {
    expect(nextIdleBehavior(0, 0.8)).toBe('blink');
    expect(nextIdleBehavior(1, 0)).toBe('blink');
    expect(nextIdleBehavior(1, 0.99)).toBe('groom');
  });
});
