// format.ts 유닛 테스트(GROMO-945 1단계) — 자정 경계 분할·달력 일수·첫 시작 시각 집계·잔디 경계값.
// 함수들이 내부에서 new Date()(현재 시각)를 쓰므로 fake timers로 '오늘'을 고정한다.
// 시간대는 jest.config.js에서 Asia/Seoul로 고정 — 세션 시각은 +09:00 오프셋으로 명시한다.
import {
  calendarPage,
  dailyFirstStartMinutes,
  dayNum,
  firstStartPoints,
  grassLevel,
  heatmapBars,
  heatmapRange,
  mergeCardOrder,
  rollingWeekRange,
  subjectColorForTag,
  tenMinuteFocusSlots,
  weekdayFocusBlocks,
} from './format';
import { FOCUS_COLOR } from './constants';
import type { HeatmapCellResponse } from '@/types/dto/stats';

// 고정 '오늘': 2026-07-15(수) 09:00 KST — 주간(월 7/13~일 7/19)·7월 주 분할(6/29 시작, 5주)을 손으로 검증해둔 날짜
const NOW = new Date('2026-07-15T09:00:00+09:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.setSystemTime(NOW); // 시계를 옮긴 테스트가 있어도 기본 '오늘'로 복귀
});

afterAll(() => {
  jest.useRealTimers();
});

describe('tenMinuteFocusSlots', () => {
  test('슬롯 경계에 걸친 세션은 두 칸에 비율로 나뉜다 (3:35~3:45)', () => {
    const slots = tenMinuteFocusSlots([
      {
        startedAt: '2026-07-15T03:35:00+09:00',
        endedAt: '2026-07-15T03:45:00+09:00',
        focusTagId: 't1',
      },
    ]);
    // 3:30 칸(idx 21)의 오른쪽 절반 + 3:40 칸(idx 22)의 왼쪽 절반
    expect(slots[21]).toEqual([{ start: 0.5, end: 1, tagId: 't1' }]);
    expect(slots[22]).toEqual([{ start: 0, end: 0.5, tagId: 't1' }]);
    expect(slots.flat()).toHaveLength(2);
  });

  test('자정 이전(어제) 부분은 잘리고 오늘 몫만 남는다', () => {
    const slots = tenMinuteFocusSlots([
      {
        startedAt: '2026-07-14T23:30:00+09:00',
        endedAt: '2026-07-15T01:00:00+09:00',
        focusTagId: null,
      },
    ]);
    // 00:00~01:00 = 슬롯 0~5만 가득 채워진다
    for (let i = 0; i < 6; i++) {
      expect(slots[i]).toEqual([{ start: 0, end: 1, tagId: null }]);
    }
    expect(slots.flat()).toHaveLength(6);
  });

  test('오늘 자정을 넘겨 내일로 이어지는 세션은 오늘 몫까지만 담긴다', () => {
    const slots = tenMinuteFocusSlots([
      {
        startedAt: '2026-07-15T23:50:00+09:00',
        endedAt: '2026-07-16T00:30:00+09:00',
        focusTagId: null,
      },
    ]);
    expect(slots[143]).toEqual([{ start: 0, end: 1, tagId: null }]);
    expect(slots.flat()).toHaveLength(1);
  });

  test('어제로만 끝난 세션·길이 0 세션은 무시된다', () => {
    const slots = tenMinuteFocusSlots([
      {
        startedAt: '2026-07-14T10:00:00+09:00',
        endedAt: '2026-07-14T11:00:00+09:00',
        focusTagId: null,
      },
      {
        startedAt: '2026-07-15T05:00:00+09:00',
        endedAt: '2026-07-15T05:00:00+09:00',
        focusTagId: null,
      },
    ]);
    expect(slots.flat()).toHaveLength(0);
  });

  test('정각 정렬 세션(4:00~4:10)은 한 칸을 정확히 가득 채운다', () => {
    const slots = tenMinuteFocusSlots([
      {
        startedAt: '2026-07-15T04:00:00+09:00',
        endedAt: '2026-07-15T04:10:00+09:00',
        focusTagId: null,
      },
    ]);
    expect(slots[24]).toEqual([{ start: 0, end: 1, tagId: null }]);
    expect(slots.flat()).toHaveLength(1);
  });
});

describe('weekdayFocusBlocks', () => {
  // 이번 주 시작 = 월요일 2026-07-13 00:00 (로컬)
  const weekStartMs = new Date('2026-07-13T00:00:00+09:00').getTime();

  test('하루 안의 세션은 요일 칼럼 하나의 블록이 된다 (수요일 → col 2)', () => {
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-15T10:00:00+09:00',
          endedAt: '2026-07-15T11:30:00+09:00',
          focusTagId: 't1',
        },
      ],
      weekStartMs,
    );
    expect(blocks).toEqual([{ col: 2, startMin: 600, endMin: 690, tagId: 't1' }]);
  });

  test('자정을 넘긴 세션은 두 요일 칼럼으로 분할된다 (화 23:00 → 수 01:00)', () => {
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-14T23:00:00+09:00',
          endedAt: '2026-07-15T01:00:00+09:00',
          focusTagId: null,
        },
      ],
      weekStartMs,
    );
    expect(blocks).toEqual([
      { col: 1, startMin: 1380, endMin: 1440, tagId: null },
      { col: 2, startMin: 0, endMin: 60, tagId: null },
    ]);
  });

  test('전주 일요일에서 넘어온 세션은 월요일 몫만 남는다', () => {
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-12T23:00:00+09:00',
          endedAt: '2026-07-13T01:00:00+09:00',
          focusTagId: null,
        },
      ],
      weekStartMs,
    );
    expect(blocks).toEqual([{ col: 0, startMin: 0, endMin: 60, tagId: null }]);
  });

  test('일요일은 마지막 칼럼(col 6)에 담긴다', () => {
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-19T10:00:00+09:00',
          endedAt: '2026-07-19T10:30:00+09:00',
          focusTagId: null,
        },
      ],
      weekStartMs,
    );
    expect(blocks).toEqual([{ col: 6, startMin: 600, endMin: 630, tagId: null }]);
  });

  test('길이 0 이하 세션은 무시된다', () => {
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-15T10:00:00+09:00',
          endedAt: '2026-07-15T10:00:00+09:00',
          focusTagId: null,
        },
      ],
      weekStartMs,
    );
    expect(blocks).toEqual([]);
  });

  // 비KST 기기에선 주 시작(KST 자정 '순간')이 로컬 자정과 어긋나 조각 중간에 온다(GROMO-1236 P2
  // 5라운드) — 월요일 10:00를 주 시작으로 두어 그 상황을 재현한다.
  test('주 시작이 조각 중간이면 걸친 조각은 시작을 잘라 주 내 몫만 담는다', () => {
    const midWeekStart = new Date('2026-07-13T10:00:00+09:00').getTime();
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-13T09:00:00+09:00',
          endedAt: '2026-07-13T11:00:00+09:00',
          focusTagId: 't1',
        },
      ],
      midWeekStart,
    );
    expect(blocks).toEqual([{ col: 0, startMin: 600, endMin: 660, tagId: 't1' }]);
  });

  test('주 시작 이전에 끝난 조각은 통째로 버린다', () => {
    const midWeekStart = new Date('2026-07-13T10:00:00+09:00').getTime();
    const blocks = weekdayFocusBlocks(
      [
        {
          startedAt: '2026-07-13T08:00:00+09:00',
          endedAt: '2026-07-13T09:30:00+09:00',
          focusTagId: null,
        },
      ],
      midWeekStart,
    );
    expect(blocks).toEqual([]);
  });
});

describe('dayNum', () => {
  test('연속한 날은 1 차이', () => {
    expect(dayNum(2026, 6, 15) - dayNum(2026, 6, 14)).toBe(1);
  });

  test('월 경계를 넘어도 일수 차이가 정확하다 (6/30 → 7/1)', () => {
    expect(dayNum(2026, 6, 1) - dayNum(2026, 5, 30)).toBe(1);
  });

  test('윤년 2월은 29일까지 센다 (2024: 2/28 → 3/1 = 2일)', () => {
    expect(dayNum(2024, 2, 1) - dayNum(2024, 1, 28)).toBe(2);
    expect(dayNum(2026, 2, 1) - dayNum(2026, 1, 28)).toBe(1); // 평년은 1일
  });
});

describe('dailyFirstStartMinutes', () => {
  test('같은 날 여러 세션 중 가장 이른 시작 시각(분)을 남긴다', () => {
    const byDay = dailyFirstStartMinutes([
      { startedAt: '2026-07-15T10:30:00+09:00' },
      { startedAt: '2026-07-15T08:15:00+09:00' },
      { startedAt: '2026-07-15T22:00:00+09:00' },
    ]);
    expect(byDay.get('2026-07-15')).toBe(495); // 08:15
    expect(byDay.size).toBe(1);
  });

  test('파싱 불가능한 시각은 건너뛴다', () => {
    const byDay = dailyFirstStartMinutes([
      { startedAt: '2026-07-14T09:05:00+09:00' },
      { startedAt: 'not-a-date' },
    ]);
    expect(byDay.get('2026-07-14')).toBe(545);
    expect(byDay.size).toBe(1);
  });
});

describe('firstStartPoints', () => {
  test('WEEK: 월~일 7점, 기록 없는 날은 null, 오늘 강조·미래 요일은 future', () => {
    const points = firstStartPoints(
      'WEEK',
      new Map([
        ['2026-07-13', 480], // 월 08:00
        ['2026-07-15', 540], // 수(오늘) 09:00
      ]),
    );
    expect(points).toHaveLength(7);
    expect(points.map((p) => p.label)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(points[0]).toEqual({ label: '월', minutes: 480, current: false, future: false });
    expect(points[1].minutes).toBeNull();
    expect(points[2]).toEqual({ label: '수', minutes: 540, current: true, future: false });
    // 목~일은 아직 안 온 요일 — 점 없이 future 처리
    expect(points.slice(3).every((p) => p.future === true && p.minutes === null)).toBe(true);
  });

  test('MONTH: 이달 1일이 낀 주의 월요일부터 주 분할, 기록 있는 날만 평균에 넣는다', () => {
    const points = firstStartPoints(
      'MONTH',
      new Map([
        ['2026-06-30', 300], // 0주차(6/29~7/5) — 전달 조각도 포함된다
        ['2026-07-13', 400], // 2주차(이번 주)
        ['2026-07-14', 501], // → 평균 round(450.5) = 451
      ]),
    );
    // 7월: 6/29(월) 시작, 5주(마지막 주는 8/2까지)
    expect(points.map((p) => p.label)).toEqual(['6/29~7/5', '6~12', '13~19', '20~26', '7/27~8/2']);
    expect(points[0].minutes).toBe(300);
    expect(points[1].minutes).toBeNull(); // 기록 없는 주는 null(라벨만)
    expect(points[2]).toEqual({ label: '13~19', minutes: 451, current: true, future: false });
    expect(points[3].future).toBe(true);
    expect(points[4].future).toBe(true);
  });
});

describe('grassLevel', () => {
  test('경계값 0/30/60/120분에서 강도가 바뀐다', () => {
    expect(grassLevel(-5)).toBe(0);
    expect(grassLevel(0)).toBe(0);
    expect(grassLevel(1)).toBe(1);
    expect(grassLevel(29)).toBe(1);
    expect(grassLevel(30)).toBe(2);
    expect(grassLevel(59)).toBe(2);
    expect(grassLevel(60)).toBe(3);
    expect(grassLevel(119)).toBe(3);
    expect(grassLevel(120)).toBe(4);
    expect(grassLevel(600)).toBe(4);
  });
});

describe('heatmapRange', () => {
  test('DAY=오늘 하루, WEEK=이번 주 월요일~오늘, MONTH=이달 1일~오늘', () => {
    expect(heatmapRange('DAY')).toEqual({ from: '2026-07-15', to: '2026-07-15' });
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-07-13', to: '2026-07-15' });
    expect(heatmapRange('MONTH')).toEqual({ from: '2026-07-01', to: '2026-07-15' });
  });

  test('일요일에도 WEEK 시작은 같은 주 월요일이다 (다음 주로 넘어가지 않음)', () => {
    jest.setSystemTime(new Date('2026-07-19T09:00:00+09:00')); // 일요일
    expect(heatmapRange('WEEK')).toEqual({ from: '2026-07-13', to: '2026-07-19' });
  });
});

describe('calendarPage', () => {
  test('WEEK: 이번 주(offset 0)=7월 3주차 월(7/13)~일(7/19), 지난 주(-1)=7월 2주차', () => {
    const p0 = calendarPage('WEEK', 0);
    expect(p0.days).toHaveLength(7);
    expect(p0.days[0]).toBe('2026-07-13');
    expect(p0.days[6]).toBe('2026-07-19');
    expect(p0.label).toBe('7월 3주차'); // 7/1(수)이 낀 주(6/29 시작)가 1주차
    expect(p0.sublabel).toBe('7.13 – 7.19');
    expect(p0.leadingBlanks).toBe(0);
    const p1 = calendarPage('WEEK', -1);
    expect(p1.days[0]).toBe('2026-07-06');
    expect(p1.label).toBe('7월 2주차');
  });

  test('WEEK: 월 경계에 걸친 주는 월요일이 속한 달 기준 주차 (6/29 주 = 6월 5주차)', () => {
    const p = calendarPage('WEEK', -2);
    expect(p.days[0]).toBe('2026-06-29');
    expect(p.days[6]).toBe('2026-07-05');
    expect(p.label).toBe('6월 5주차'); // 6/1이 월요일이라 6월은 정확히 주 단위
    expect(p.sublabel).toBe('6.29 – 7.5');
  });

  test('MONTH: 이번 달(offset 0) 1~31일 + 1일 요일 정렬 빈 칸(수요일=2)', () => {
    const p = calendarPage('MONTH', 0);
    expect(p.days).toHaveLength(31);
    expect(p.days[0]).toBe('2026-07-01');
    expect(p.days[30]).toBe('2026-07-31');
    expect(p.label).toBe('2026년 7월');
    expect(p.sublabel).toBe('1일 – 31일');
    expect(p.leadingBlanks).toBe(2);
  });

  test('MONTH: 지난 달(-1)=6월(1일이 월요일 → 빈 칸 0), 연 경계(-7)=작년 12월', () => {
    const p = calendarPage('MONTH', -1);
    expect(p.days).toHaveLength(30);
    expect(p.label).toBe('2026년 6월');
    expect(p.leadingBlanks).toBe(0);
    const py = calendarPage('MONTH', -7);
    expect(py.label).toBe('2025년 12월');
    expect(py.days[0]).toBe('2025-12-01');
  });
});

describe('rollingWeekRange', () => {
  test('오늘 포함 최근 7일 [오늘-6, 오늘]', () => {
    expect(rollingWeekRange()).toEqual({ from: '2026-07-09', to: '2026-07-15' });
  });

  test('월 경계를 거슬러 넘어간다 (7/3 → 6/27부터)', () => {
    jest.setSystemTime(new Date('2026-07-03T09:00:00+09:00'));
    expect(rollingWeekRange()).toEqual({ from: '2026-06-27', to: '2026-07-03' });
  });
});

// 히트맵 셀 생성 헬퍼 — 집중 분만 지정하고 나머지 필드는 기본값
function cell(date: string, totalFocusMinutes: number): HeatmapCellResponse {
  return {
    date,
    totalFocusMinutes,
    sessionCount: 1,
    focusGoalAchieved: false,
    actualScreenTimeMinutes: 0,
    screenTimeGoalAchieved: false,
  };
}

describe('heatmapBars', () => {
  const pick = (c: HeatmapCellResponse) => c.totalFocusMinutes;

  test('DAY: 오늘 단일 막대', () => {
    expect(heatmapBars('DAY', [cell('2026-07-15', 42)], pick)).toEqual([
      { label: '오늘', value: 42, current: true },
    ]);
  });

  test('WEEK: 월~일 7칸 — 없는 날은 0, 오늘 강조, 안 온 요일은 future', () => {
    const bars = heatmapBars('WEEK', [cell('2026-07-13', 60), cell('2026-07-15', 30)], pick);
    expect(bars).toEqual([
      { label: '월', value: 60, current: false, future: false },
      { label: '화', value: 0, current: false, future: false }, // 지나갔지만 기록 없음 → 0
      { label: '수', value: 30, current: true, future: false },
      { label: '목', value: 0, current: false, future: true },
      { label: '금', value: 0, current: false, future: true },
      { label: '토', value: 0, current: false, future: true },
      { label: '일', value: 0, current: false, future: true },
    ]);
  });

  test('MONTH: 일 번호 7일 단위 주차 합산, 오늘이 낀 주차 강조', () => {
    const cells = [
      cell('2026-07-01', 10), // 1주차(1~7일)
      cell('2026-07-08', 20), // 2주차(8~14일)
      cell('2026-07-09', 5), //  2주차 — 같은 주차로 합산
      cell('2026-07-15', 30), // 3주차(15~21일) = 오늘
    ];
    expect(heatmapBars('MONTH', cells, pick)).toEqual([
      { label: '1주', value: 10, current: false },
      { label: '2주', value: 25, current: false },
      { label: '3주', value: 30, current: true },
    ]);
  });
});

describe('subjectColorForTag', () => {
  const subjects = [{ name: '수학', color: '#123456' }];
  const tagNames = new Map([
    ['t1', '수학'],
    ['t2', '과탐'],
  ]);

  test('서버 tagId → 태그명 → 같은 이름의 로컬 과목 색', () => {
    expect(subjectColorForTag('t1', tagNames, subjects)).toBe('#123456');
  });

  test('미분류(null)·모르는 tagId·과목 매칭 실패는 기본 집중색', () => {
    expect(subjectColorForTag(null, tagNames, subjects)).toBe(FOCUS_COLOR);
    expect(subjectColorForTag('unknown', tagNames, subjects)).toBe(FOCUS_COLOR);
    expect(subjectColorForTag('t2', tagNames, subjects)).toBe(FOCUS_COLOR); // 태그명은 있으나 과목 없음
  });
});

describe('mergeCardOrder', () => {
  test('저장이 없거나 비면 기본 순서 그대로', () => {
    expect(mergeCardOrder(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
    expect(mergeCardOrder(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c']);
    expect(mergeCardOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  test('카드 구성이 같으면 유저 재배열을 그대로 유지', () => {
    expect(mergeCardOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  test('이제 없는 카드 키(유령 키)는 버린다', () => {
    expect(mergeCardOrder(['a', 'b', 'c'], ['c', 'x', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  test('새 카드는 기본 순서상 바로 앞 카드 뒤에 끼운다 — 유저 순서는 안 건드림', () => {
    // 기본 [a,b,n,c]에서 n이 신규 — 유저 화면의 b 위치를 따라간다
    expect(mergeCardOrder(['a', 'b', 'n', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b', 'n']);
  });

  test('기본 순서 맨 앞의 새 카드는 맨 앞에 들어간다', () => {
    expect(mergeCardOrder(['n', 'a', 'b'], ['b', 'a'])).toEqual(['n', 'b', 'a']);
  });

  test('연속 새 카드는 기본 순서의 상대 순서를 유지한다', () => {
    expect(mergeCardOrder(['a', 'n1', 'n2', 'b'], ['b', 'a'])).toEqual(['b', 'a', 'n1', 'n2']);
  });

  test('유령 키 제거와 새 카드 삽입이 동시에 일어나도 안전하다', () => {
    expect(mergeCardOrder(['a', 'n', 'b'], ['b', 'x', 'a'])).toEqual(['b', 'a', 'n']);
  });
});
