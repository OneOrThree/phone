import { t } from '@/i18n';
import type { GroupChallengeResponse } from '@/types/dto/group';

// 챌린지 미션 한 줄 요약 — 챌린지 카드와 내기 시트가 **같은 문장**을 써야 해서 여기로 뺐다.
// (원래 ChallengeCard 안에 있던 함수다. GroupInviteSheet의 그룹용 라벨과는 DTO도 문구 조건도
//  달라 여전히 별개로 둔다 — 여기 승격은 그룹 챌린지 DTO를 쓰는 두 곳 사이의 공유일 뿐이다.)

// 라벨을 만드는 데 실제로 쓰는 필드만 — **챌린지 응답이 아닌 소스도 같은 문장을 쓴다**
// (GROMO-1277 내역 화면은 챌린지 행이 삭제됐을 수 있어 회차의 미션 스냅샷으로 라벨을 만든다).
// 구조적 부분 타입이라 GroupChallengeResponse는 그대로 들어맞는다 — 기존 호출부 불변.
export interface MissionLabelSource {
  missionCategory: GroupChallengeResponse['missionCategory'];
  missionType: GroupChallengeResponse['missionType'];
  durationMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}

/**
 * 창형 문장의 **「매일」 접두**를 붙일지. 기본 true — 카드·시트는 같은 화면에 **요일 배지**를
 * 함께 세우므로 「매일 09:00~12:00 …」이 배지에 곧바로 정정된다.
 *
 * 내역 화면(GROMO-1277)만 false다: 이력 DTO에는 `repeatDays`가 없고 목록에도 요일 배지가 없어,
 * **월요일에만 도는 챌린지의 지난 기록까지 "매일 실행된 목표"로 설명**하게 된다(codex 리뷰).
 * 문장 사본을 하나 더 만들지 않고 접두만 끄는 이유는 나머지 규칙(HH:mm 접기·목표분 유무 분기)이
 * 그대로여야 하기 때문이다 — 사본이 갈리면 카드와 내역이 다른 문장을 말한다.
 * policy §A9의 목록 시안도 요일 없는 창 문장(`집중 09–12시 90분`)이다.
 */
export interface MissionLabelOptions {
  everyday?: boolean;
  /**
   * 스크린타임 목표의 **방향(이하)**을 문장에 실을지. 기본 false — 카드·시트는 같은 화면에
   * 전용 캡션(`오늘 스크린타임을 목표 이하로 유지해요`)을 세워 방향을 이미 말한다.
   *
   * 내역 화면(GROMO-1277)만 true다: 그 목록엔 캡션 자리가 없어 라벨이 유일한 설명인데,
   * 스크린타임은 집중과 **판정 방향이 반대**라(60분을 채우는 게 아니라 60분 이하로 유지)
   * 방향을 빼면 `55/60분`이 **달성으로 찍힌 줄**이 "목표에 못 미쳤는데 달성"으로 읽힌다
   * (codex 리뷰). policy §A9의 목록 시안도 `하루 폰 2시간 이하`로 방향을 명시한다.
   *
   * FOCUS에는 붙지 않는다 — 방향이 반대라 「이하」가 거짓이 된다.
   */
  direction?: boolean;
}

// 'HH:mm:ss' · ISO 등 서버 시각 문자열에서 HH:mm만 뽑는다. 형식이 다르면 원문 유지.
function hhmm(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

// 값이 모자라면 null — 호출부가 카테고리 명사('집중 시간'·'스크린타임')로 떨어뜨린다.
export function missionLabel(c: MissionLabelSource, opts: MissionLabelOptions = {}): string | null {
  const what = t(
    c.missionCategory === 'SCREEN_TIME'
      ? 'group.challengeLabel.screenTime'
      : 'group.challengeLabel.focus',
  );
  // 목표 방향 — 목표분이 실제로 적히는 문장에만 붙는다(분이 없으면 「이하」의 대상이 없다).
  const atMost =
    opts.direction === true && c.missionCategory === 'SCREEN_TIME'
      ? t('group.challengeLabel.atMost')
      : '';
  if (c.missionType === 'DURATION' && c.durationMinutes) {
    return t('group.challengeLabel.daily', { minutes: c.durationMinutes, atMost, what });
  }
  if (c.missionType === 'TIME_WINDOW' && c.windowStart && c.windowEnd) {
    // 창 목표분(V20 additive)이 있으면 함께 적는다 — 창 시각만 적으면 '그 시간 내내'로 읽힌다.
    // 없으면(구 창 챌린지·구서버) 기존 문장 그대로 — 목표를 지어내지 않는다.
    const when = t(
      opts.everyday === false
        ? 'group.challengeLabel.window'
        : 'group.challengeLabel.windowEveryday',
      { start: hhmm(c.windowStart), end: hhmm(c.windowEnd) },
    );
    return c.durationMinutes
      ? t('group.challengeLabel.windowWithMinutes', {
          when,
          minutes: c.durationMinutes,
          atMost,
          what,
        })
      : t('group.challengeLabel.windowOnly', { when, what });
  }
  return null;
}

// 라벨을 못 만든 카드의 폴백 — 고르는 자리(세그먼트)의 카테고리 명칭과 맞춘다.
export function categoryLabel(c: Pick<MissionLabelSource, 'missionCategory'>): string {
  return t(
    c.missionCategory === 'SCREEN_TIME'
      ? 'group.challengeLabel.categoryScreenTime'
      : 'group.challengeLabel.categoryFocus',
  );
}
