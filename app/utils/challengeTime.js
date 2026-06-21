// 챌린지 시간창(window) 처리 유틸
//
// 백엔드는 windowStart/windowEnd를 그룹 타임존 기준 "HH:mm:ss" 문자열로,
// 함께 timeZone(IANA, 예: "Asia/Seoul")을 내려준다.
// "그룹 타임존 고정" 정책: 창은 그룹 타임존 기준 한 시각이므로,
// 표시는 문자열 그대로 쓰고, 진행중/예정 판정은 그룹 타임존 벽시계의
// '하루 중 초(seconds-of-day)' 공간에서 비교한다.

// "HH:mm:ss" → 하루 중 초 (0~86399). 잘못된 값이면 NaN.
export function timeStrToSeconds(timeStr) {
  if (!timeStr) return NaN;
  const [h, m, sec] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}

// 특정 타임존의 현재 벽시계 시각을 '하루 중 초'로 반환.
// Intl 미지원/오류 시 기기 로컬 기준으로 폴백.
export function nowSecondsInZone(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    let hour = get('hour');
    if (hour === 24) hour = 0; // 자정을 24로 주는 환경 보정
    return hour * 3600 + get('minute') * 60 + get('second');
  } catch {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }
}

// 타임존 약어 라벨 (예: "GMT+9"). 표시용. 실패하면 빈 문자열.
export function zoneLabel(timeZone) {
  if (!timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// 표시용 타임존 접미사 (예: " (GMT+9)"). 없으면 빈 문자열.
export function zoneSuffix(timeZone) {
  const label = zoneLabel(timeZone);
  return label ? ` (${label})` : '';
}

// 기기의 IANA 타임존 (예: "Asia/Seoul"). 실패 시 "UTC".
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
