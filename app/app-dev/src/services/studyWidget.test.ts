import type { RecordItem } from './model';

// 2026-10-01 12:00 KST
const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);
const HOUR = 3600 * 1000;

const record = (over: Partial<RecordItem>): RecordItem => ({
  id: over.id ?? 'r',
  islandId: 'island-1',
  subject: '영어',
  seconds: 600,
  at: NOW - HOUR,
  fish: 0,
  contributed: false,
  ...over,
});

// 플랫폼·네이티브 모듈을 바꿔 가며 래퍼를 새로 불러온다
function load(os: string, nativeModule: unknown) {
  jest.resetModules();
  const resolve = jest.fn(() => nativeModule);
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('expo', () => ({ requireOptionalNativeModule: resolve }));
  return { mod: require('./studyWidget') as typeof import('./studyWidget'), resolve };
}

afterEach(() => {
  jest.dontMock('react-native');
  jest.dontMock('expo');
  jest.useRealTimers();
});

describe('안드로이드 홈 위젯 브리지', () => {
  test.each(['ios', 'web'])('%s 에서는 네이티브를 찾지도 부르지도 않는다', async (os) => {
    const native = { updateSnapshot: jest.fn() };
    const { mod, resolve } = load(os, native);
    await expect(mod.updateStudyWidget({ totalSeconds: 60, subjects: [] })).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(native.updateSnapshot).not.toHaveBeenCalled();
  });

  test('모듈이 없는 안드로이드 바이너리에서는 no-op', async () => {
    const { mod, resolve } = load('android', null);
    expect(resolve).toHaveBeenCalledWith('StudyWidgetModule');
    await expect(mod.updateStudyWidget({ totalSeconds: 60, subjects: [] })).resolves.toBe(false);
  });

  test('안드로이드에서는 과목 JSON과 총합을 넘기고, 같은 스냅샷은 다시 보내지 않는다', async () => {
    const native = { updateSnapshot: jest.fn().mockResolvedValue(true) };
    const { mod } = load('android', native);
    const snap = {
      totalSeconds: 900,
      subjects: [{ name: '영어', seconds: 600, color: '#FFA6BC' }],
    };

    await expect(mod.updateStudyWidget(snap)).resolves.toBe(true);
    await mod.updateStudyWidget({ ...snap });
    expect(native.updateSnapshot).toHaveBeenCalledTimes(1);
    expect(native.updateSnapshot).toHaveBeenCalledWith(
      '[{"name":"영어","seconds":600,"color":"#FFA6BC"}]',
      900,
    );

    await mod.updateStudyWidget({ ...snap, totalSeconds: 960 });
    expect(native.updateSnapshot).toHaveBeenCalledTimes(2);
  });

  test('네이티브 실패는 삼키고 false — 다음 호출에서 다시 시도한다', async () => {
    const native = {
      updateSnapshot: jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(true),
    };
    const { mod } = load('android', native);
    const snap = { totalSeconds: 60, subjects: [] };
    await expect(mod.updateStudyWidget(snap)).resolves.toBe(false);
    await expect(mod.updateStudyWidget(snap)).resolves.toBe(true);
    expect(native.updateSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('위젯 스냅샷 계산', () => {
  test('오늘 이 섬 기록만 과목별로 합쳐 상위 2과목을 내림차순으로 고른다', () => {
    const { mod } = load('ios', null);
    const snap = mod.buildStudyWidgetSnapshot(
      [
        record({ id: 'a', subject: '영어', seconds: 600 }),
        record({ id: 'b', subject: '수학', seconds: 1200 }),
        record({ id: 'c', subject: '영어', seconds: 900, at: NOW - 2 * HOUR }),
        record({ id: 'd', subject: '국어', seconds: 300 }),
        // 다른 섬·어제 기록은 제외
        record({ id: 'e', subject: '과학', seconds: 5000, islandId: 'island-2' }),
        record({ id: 'f', subject: '과학', seconds: 5000, at: NOW - 30 * HOUR }),
      ],
      'island-1',
      3000.7,
      NOW,
    );
    expect(snap.totalSeconds).toBe(3000);
    expect(snap.subjects.map((s) => [s.name, s.seconds])).toEqual([
      ['영어', 1500],
      ['수학', 1200],
    ]);
    expect(snap.subjects.every((s) => /^#[0-9A-F]{6}$/i.test(s.color))).toBe(true);
  });

  test('자정을 넘긴 기록은 오늘분만 센다', () => {
    const { mod } = load('ios', null);
    // KST 자정(= NOW - 12h) 30분 전 시작해 30분 뒤 끝난 1시간 기록
    const midnight = NOW - 12 * HOUR;
    const snap = mod.buildStudyWidgetSnapshot(
      [record({ subject: '영어', seconds: 3600, at: midnight + HOUR / 2 })],
      'island-1',
      1800,
      NOW,
    );
    expect(snap.subjects).toEqual([{ name: '영어', seconds: 1800, color: expect.any(String) }]);
  });

  test('기록이 없어도 총합(서버 스냅샷)은 그대로 넘긴다', () => {
    const { mod } = load('ios', null);
    expect(mod.buildStudyWidgetSnapshot([], 'island-1', 120, NOW)).toEqual({
      totalSeconds: 120,
      subjects: [],
    });
  });
});
