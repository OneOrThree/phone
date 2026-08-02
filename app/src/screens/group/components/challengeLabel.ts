import type { GroupChallengeResponse } from '@/types/dto/group';

// 챌린지 미션 한 줄 요약 — 챌린지 카드와 내기 시트가 **같은 문장**을 써야 해서 여기로 뺐다.
// (원래 ChallengeCard 안에 있던 함수다. GroupInviteSheet의 그룹용 라벨과는 DTO도 문구 조건도
//  달라 여전히 별개로 둔다 — 여기 승격은 그룹 챌린지 DTO를 쓰는 두 곳 사이의 공유일 뿐이다.)

// 'HH:mm:ss' · ISO 등 서버 시각 문자열에서 HH:mm만 뽑는다. 형식이 다르면 원문 유지.
function hhmm(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

// 값이 모자라면 null — 호출부가 카테고리 명사('집중 시간'·'스크린타임')로 떨어뜨린다.
export function missionLabel(c: GroupChallengeResponse): string | null {
  const what = c.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중';
  if (c.missionType === 'DURATION' && c.durationMinutes) {
    return `하루 ${c.durationMinutes}분 ${what}`;
  }
  if (c.missionType === 'TIME_WINDOW' && c.windowStart && c.windowEnd) {
    // 창 목표분(V20 additive)이 있으면 함께 적는다 — 창 시각만 적으면 '그 시간 내내'로 읽힌다.
    // 없으면(구 창 챌린지·구서버) 기존 문장 그대로 — 목표를 지어내지 않는다.
    return c.durationMinutes
      ? `매일 ${hhmm(c.windowStart)}~${hhmm(c.windowEnd)} ${c.durationMinutes}분 ${what}`
      : `매일 ${hhmm(c.windowStart)}~${hhmm(c.windowEnd)} ${what}`;
  }
  return null;
}

// 라벨을 못 만든 카드의 폴백 — 고르는 자리(세그먼트)의 카테고리 명칭과 맞춘다.
export function categoryLabel(c: GroupChallengeResponse): string {
  return c.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중 시간';
}
