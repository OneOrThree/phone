import { majorityPass, maxSigmoid, rgbToFloat, scoreTensorIndex } from './palmScore';

describe('palmScore', () => {
  test('rgbToFloat scales 0~255 to 0~1', () => {
    const out = new Float32Array(rgbToFloat(new Uint8Array([0, 255, 51])));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(out[2]).toBeCloseTo(0.2, 6);
  });

  test('scoreTensorIndex picks the tensor whose last dim is 1', () => {
    expect(scoreTensorIndex([{ shape: [1, 2016, 18] }, { shape: [1, 2016, 1] }])).toBe(1);
    expect(scoreTensorIndex([{ shape: [1, 2016, 18] }])).toBe(-1);
  });

  test('maxSigmoid squashes the best anchor', () => {
    expect(maxSigmoid(new Float32Array([-5, 0, 2]))).toBeCloseTo(0.8808, 3);
    expect(maxSigmoid(new Float32Array([200]))).toBeCloseTo(1, 6); // 클램프
    expect(maxSigmoid(new Float32Array([]))).toBe(0);
  });

  test('majorityPass needs 2 of 3 by default', () => {
    expect(majorityPass([0.9, 0.1, 0.6])).toBe(true);
    expect(majorityPass([0.9, 0.1, 0.4])).toBe(false);
    expect(majorityPass([0.5, 0.5, 0.0])).toBe(true); // 경계 0.5 포함
  });
});
