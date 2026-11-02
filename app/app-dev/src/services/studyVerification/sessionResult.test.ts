import {
  clearVerificationResult,
  openVerificationCapture,
  verificationResult,
} from './sessionResult';

let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));

beforeEach(() => {
  clearVerificationResult('session');
  clearVerificationResult('next');
  mockGeneration = 1;
});

test('미사용과 사용했으나 0초를 구분하고 다음 세션에 섞지 않는다', () => {
  expect(verificationResult('session')).toBeUndefined();
  const capture = openVerificationCapture('session');
  expect(verificationResult('session')).toBe(0);
  capture.observe(true, 0);
  capture.observe(true, 1500);
  expect(verificationResult('session')).toBe(1);
  expect(verificationResult('next')).toBeUndefined();
  openVerificationCapture('next');
  expect(verificationResult('next')).toBe(0);
  expect(verificationResult('session')).toBeUndefined();
});

test('연속으로 확인된 구간만 누적하고 실패·중단·오래된 프레임·닫힌 촬영은 제외한다', () => {
  const capture = openVerificationCapture('session');
  capture.observe(true, 0);
  capture.observe(true, 1000);
  capture.observe(false, 1300);
  capture.observe(true, 2000);
  capture.observe(true, 3000);
  capture.pause();
  capture.observe(true, 10_000);
  capture.observe(true, 11_000);
  capture.observe(true, 20_000);
  capture.close();
  capture.observe(true, 21_000);
  expect(verificationResult('session')).toBe(3);
});

test('전환 뒤 이전 촬영의 늦은 프레임과 이전 계정의 결과를 버린다', () => {
  const previous = openVerificationCapture('session');
  previous.observe(true, 0);
  previous.observe(true, 1000);
  const next = openVerificationCapture('session');
  previous.observe(true, 2000);
  next.observe(true, 2000);
  next.observe(true, 3000);
  expect(verificationResult('session')).toBe(2);
  mockGeneration++;
  next.observe(true, 4000);
  expect(verificationResult('session')).toBeUndefined();
  openVerificationCapture('session');
  expect(verificationResult('session')).toBe(0);
});

test('결과는 총 집중 초를 넘지 않고 닫으면 폐기한다', () => {
  const capture = openVerificationCapture('session');
  capture.observe(true, 0);
  capture.observe(true, 1500);
  capture.observe(true, 3000);
  expect(verificationResult('session', 2)).toBe(2);
  clearVerificationResult('next');
  expect(verificationResult('session')).toBe(3);
  clearVerificationResult('session');
  expect(verificationResult('session')).toBeUndefined();
  expect(capture.observe(true, 4000)).toBeUndefined();
});

describe('20초 주기 검사 사이 유효 판정 집계', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  test('한 번 성공하면 다음 확인까지 초 단위로 흐르고 종료 전 짧은 구간도 포함한다', () => {
    const capture = openVerificationCapture('session', { holdMs: 22000 });
    capture.observe(true);
    jest.advanceTimersByTime(10000);
    expect(verificationResult('session')).toBe(10);
    jest.advanceTimersByTime(3000);
    capture.close();
    expect(verificationResult('session')).toBe(13);
    jest.advanceTimersByTime(60000);
    expect(verificationResult('session')).toBe(13);
  });

  test('다음 확인이 오지 않으면 유효 기한까지만 합산하고 조회로 연장하지 않는다', () => {
    const capture = openVerificationCapture('session', { holdMs: 22000 });
    capture.observe(true);
    jest.advanceTimersByTime(20000);
    expect(verificationResult('session')).toBe(20);
    jest.advanceTimersByTime(60000);
    expect(verificationResult('session')).toBe(22);
    expect(verificationResult('session')).toBe(22);
  });

  test('실패·중단은 누적을 멈추고 다음 성공부터 다시 센다', () => {
    const capture = openVerificationCapture('session', { holdMs: 22000 });
    capture.observe(true);
    jest.advanceTimersByTime(20000);
    capture.observe(false);
    jest.advanceTimersByTime(20000);
    expect(verificationResult('session')).toBe(20);
    capture.observe(true);
    jest.advanceTimersByTime(5000);
    capture.pause();
    jest.advanceTimersByTime(60000);
    expect(verificationResult('session')).toBe(25);
  });

  test('촬영 교체와 계정 전환 뒤 이전 판정의 유효 기한은 넘어오지 않는다', () => {
    const previous = openVerificationCapture('session', { holdMs: 22000 });
    previous.observe(true);
    jest.advanceTimersByTime(5000);
    const next = openVerificationCapture('session', { holdMs: 22000 });
    jest.advanceTimersByTime(5000);
    expect(verificationResult('session')).toBe(5);
    previous.observe(true);
    next.observe(true);
    mockGeneration++;
    jest.advanceTimersByTime(5000);
    expect(verificationResult('session')).toBeUndefined();
  });
});
