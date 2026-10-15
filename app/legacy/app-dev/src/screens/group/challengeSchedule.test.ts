// challengeSchedule 순수 유틸 테스트 — 카드 요일 배지(1274)·다음 활성일(1419)·주간 대상
// 산출(1276)이 전부 이 계산 위에 선다. 날짜 산술은 UTC 공간이라 기기 시간대와 무관해야 한다.
import {
  addDaysStr,
  fmtKoreanDuration,
  fmtMonthDayDow,
  fmtRelativeDay,
  hhmmOf,
  kstDateOfInstant,
  repeatDayOf,
  weekRemainingActiveDates,
  weekdayIndexOf,
} from './challengeSchedule';

describe('요일 계산', () => {
  test('2026-08-01은 토요일, 2026-08-03은 월요일이다', () => {
    expect(repeatDayOf('2026-08-01')).toBe('SAT');
    expect(repeatDayOf('2026-08-03')).toBe('MON');
    expect(weekdayIndexOf('2026-08-03')).toBe(0); // 월=0
    expect(weekdayIndexOf('2026-08-02')).toBe(6); // 일=6
  });

  test('무효 입력은 null — 지어내지 않는다', () => {
    expect(repeatDayOf('not-a-date')).toBeNull();
    expect(weekdayIndexOf('2026-8-1')).toBeNull();
  });
});

describe('날짜 산술·표기', () => {
  test('addDaysStr는 월 경계를 넘는다', () => {
    expect(addDaysStr('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysStr('2026-08-01', 6)).toBe('2026-08-07');
  });

  test('kstDateOfInstant — UTC 자정 직전 instant는 KST 다음 날이다', () => {
    // 8/2 15:00Z = KST 8/3 00:00 (하루형 회차 시작).
    expect(kstDateOfInstant('2026-08-02T15:00:00Z')).toBe('2026-08-03');
    expect(kstDateOfInstant('broken')).toBeNull();
  });

  test('fmtMonthDayDow — 날짜와 요일을 같이 적는다(선행 0 제거)', () => {
    expect(fmtMonthDayDow('2026-08-03')).toBe('8/3(월)');
    expect(fmtMonthDayDow('2026-12-06')).toBe('12/6(일)');
    // 무효면 원문 유지 — 깨진 날짜보다 원문이 낫다.
    expect(fmtMonthDayDow('???')).toBe('???');
  });

  test('fmtRelativeDay — 오늘·내일만 상대 표기, 그 밖은 절대 날짜다', () => {
    expect(fmtRelativeDay('2026-08-01', '2026-08-01')).toBe('오늘');
    expect(fmtRelativeDay('2026-08-02', '2026-08-01')).toBe('내일');
    expect(fmtRelativeDay('2026-08-03', '2026-08-01')).toBe('8/3(월)');
  });

  test('hhmmOf — 서버 HH:mm:ss에서 HH:mm만 뽑는다', () => {
    expect(hhmmOf('09:00:00')).toBe('09:00');
    expect(hhmmOf('9시')).toBe('9시'); // 형식이 다르면 원문
  });
});

describe('weekRemainingActiveDates — 이번 주(월~일) 남은 활성일', () => {
  test('목요일에 본 월·수·금 — 남은 건 금요일뿐이다(다음 주는 세지 않는다)', () => {
    // 2026-08-06은 목요일. 그 주는 8/3(월)~8/9(일).
    expect(weekRemainingActiveDates(['MON', 'WED', 'FRI'], '2026-08-06', false)).toEqual([
      '2026-08-07',
    ]);
  });

  test('includeToday — 오늘이 활성 요일이면 오늘부터 담는다', () => {
    expect(
      weekRemainingActiveDates(
        ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
        '2026-08-06',
        true,
      ),
    ).toEqual(['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
  });

  test('일요일엔 오늘 말고 남은 날이 없다', () => {
    expect(weekRemainingActiveDates(['MON', 'SUN'], '2026-08-09', false)).toEqual([]);
    expect(weekRemainingActiveDates(['MON', 'SUN'], '2026-08-09', true)).toEqual(['2026-08-09']);
  });

  test('무효한 오늘은 빈 배열 — 예약 대상을 지어내지 않는다', () => {
    expect(weekRemainingActiveDates(['MON'], 'garbage', true)).toEqual([]);
  });
});

describe('fmtKoreanDuration', () => {
  test('시간·분 조합을 접는다', () => {
    expect(fmtKoreanDuration(372)).toBe('6시간 12분');
    expect(fmtKoreanDuration(60)).toBe('1시간');
    expect(fmtKoreanDuration(45)).toBe('45분');
  });

  test('0 이하는 0분 — 마이너스를 지어내지 않는다', () => {
    expect(fmtKoreanDuration(0)).toBe('0분');
    expect(fmtKoreanDuration(-10)).toBe('0분');
  });
});
