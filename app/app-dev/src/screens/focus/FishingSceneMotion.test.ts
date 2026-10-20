import {
  labBreath,
  labGlint,
  labMicro,
  labReelPose,
  labRing,
  labSplashDrop,
} from './FishingSceneMotion';

test('움직임 검토실 식: 집중 호흡·미세 회전, 낚아올리기 몸 변환, 물보라·물결', () => {
  expect(labBreath(1)).toBeCloseTo(0.01); // 4초 주기 최고점
  expect(labMicro(3)).toBeCloseTo(0.012); // 12초 주기 최고점
  // 줄 긴장 시작 시점은 정지 자세, 당기는 동안 뒤로(음수) 기울고, 안착 뒤 반동은 잦아든다.
  expect(labReelPose(5.5).rotation).toBeCloseTo(0, 6);
  expect(labReelPose(6.5).rotation).toBeCloseTo(-0.055, 3);
  expect(Math.abs(labReelPose(8.35).rotation)).toBeLessThan(0.01);
  // 키 포즈가 바뀌기 직전엔 살짝 눌리고(음수) 직후엔 튄다(양수).
  expect(labReelPose(6.15 - 0.065).squash).toBeLessThan(0);
  expect(labReelPose(6.15 + 0.05).squash).toBeGreaterThan(0);
  const drop = labSplashDrop(0, 1);
  expect(drop.alpha).toBe(0);
  expect(drop.y).toBeGreaterThan(labSplashDrop(0, 0.5).y); // 중력으로 떨어진다
  expect([0, 1, 2].map((i) => labRing(0, i))).toEqual([0, 1 / 3, 2 / 3]);
  expect(labGlint(4.5, 0)).toBeCloseTo(0.1);
});
