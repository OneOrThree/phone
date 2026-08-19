// 버전 비교 가드 — 문자열 비교면 '1.9.0' > '1.10.0'으로 뒤집히는 함정을 잡는다
import { isOlder } from './UpdateAlert';

describe('isOlder', () => {
  it('마디별 숫자로 비교한다', () => {
    expect(isOlder('1.9.0', '1.10.0')).toBe(true);
    expect(isOlder('1.10.0', '1.9.0')).toBe(false);
    expect(isOlder('1.2.0', '1.2.0')).toBe(false);
    expect(isOlder('1.2.0', '2.0.0')).toBe(true);
    // 마디 수가 달라도 부족한 쪽은 0으로 본다
    expect(isOlder('1.2', '1.2.1')).toBe(true);
  });
});
