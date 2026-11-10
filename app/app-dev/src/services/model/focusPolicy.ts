import { t } from '@/i18n';
import { uuid } from './fixtures';
import { balance, earnedBy, memberOf, residentCount, targetIds } from './islandPolicy';
import { dayKey, kstDayStart, weekStart } from './time';
import { Island, Quest, QuestRound, RecordItem, Session, State } from './types';

// 그 섬의 집중 기록인가 — 서버 섬 집계(findActiveSpansOnIsland)처럼 목적지가 그 섬인 바다 항해는 섬 집중이 아니다
export const islandFocusRecord = (r: RecordItem, islandId: string) =>
  r.islandId === islandId && r.kind !== 'sea';

export const recordSecondsBetween = (record: RecordItem, from: number, until: number) =>
  (record.intervals ?? [{ start: record.at - record.seconds * 1000, end: record.at }]).reduce(
    (seconds, interval) =>
      seconds + Math.max(0, Math.min(interval.end, until) - Math.max(interval.start, from)) / 1000,
    0,
  );

// 섬 평균 집중(초) = 이번 주 그 섬에서 집중한 시간 합계 ÷ 그 섬 주민 수
// 모든 주민의 기록을 같은 섬·같은 주간 구간으로 필터링한다.
export function islandWeeklyAverage(s: State, i: Island, now = Date.now()) {
  const residents = residentCount(i);
  if (!residents) return 0;
  const from = weekStart(now);
  const mine = s.records
    .filter((r) => islandFocusRecord(r, i.id))
    .reduce((a, r) => a + recordSecondsBetween(r, from, now), 0);
  return (
    (mine +
      [...i.members, ...(i.formerMembers ?? [])].reduce(
        (a, m) =>
          a +
          (m.records ?? [])
            .filter((r) => r.islandId === i.id)
            .reduce((n, r) => n + recordSecondsBetween(r, from, now), 0),
        0,
      )) /
    residents
  );
}

export const sessionSeconds = (session: Session | null, now = Date.now()) =>
  !session
    ? 0
    : session.seconds +
      (session.status === 'active' ? Math.max(0, (now - session.startedAt) / 1000) : 0);

// "오늘 집중" = KST 자정부터 지금까지 그 섬에서 끝낸 집중 기록의 합. 자정을 넘은 기록은 이후분만 센다.
// ponytail: 진행 중 세션은 뺀다 — 서버에서 복원한 세션은 과거 구간 없이 누적 초만 오고 startedAt 이
// 복원 시각이라, 자정을 넘긴 세션의 어제 집중을 오늘로 잘못 센다. 서버가 구간을 주면 그때 더한다.
export const todayFocusSeconds = (s: State, islandId: string, now = Date.now()) => {
  const from = kstDayStart(dayKey(now)),
    until = from + 86400000;
  return s.records
    .filter((r) => islandFocusRecord(r, islandId))
    .reduce((sum, r) => sum + recordSecondsBetween(r, from, until), 0);
};

export function questRate(s: State, q: Quest, islandId = s.islandId): number | null {
  if (q.type === 'screen')
    return !s.settings.permission ||
      !s.settings.screenTimeMeasurementReady ||
      (!!s.settings.screenTimeMeasurementDay && s.settings.screenTimeMeasurementDay !== dayKey()) ||
      s.screenTimeUnconfirmedDays?.includes(dayKey())
      ? null
      : s.screenMinutes <= q.target
        ? 100
        : Math.max(0, Math.round((q.target / s.screenMinutes) * 100));
  const seconds = focusTotal(s.records, islandId, dayKey(), {
    targets: [],
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  });
  return Math.min(100, Math.floor((seconds / (q.target * 60)) * 100));
}

function focusTotal(records: RecordItem[], islandId: string, day: string, q: QuestRound) {
  const from = kstDayStart(day),
    until = from + 86400000;
  const clock = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return from + (h * 60 + m) * 60000;
  };
  return records
    .filter((r) => islandFocusRecord(r, islandId))
    .reduce(
      (n, r) =>
        n +
        (r.intervals ?? [{ start: r.at - r.seconds * 1000, end: r.at }]).reduce(
          (sum, iv) =>
            sum +
            Math.max(
              0,
              Math.min(iv.end, until, q.windowEnd ? clock(q.windowEnd) : until) -
                Math.max(iv.start, from, q.windowStart ? clock(q.windowStart) : from),
            ) /
              1000,
          0,
        ),
      0,
    );
}

export function questMemberRate(
  s: State,
  q: Quest,
  id: string,
  islandId = s.islandId,
  now = Date.now(),
): number | null {
  const i = s.islands.find((i) => i.id === islandId)!;
  const member = memberOf(i, id);
  if (q.type === 'screen') {
    const v =
      id === 'me'
        ? s.settings.permission &&
          s.settings.screenTimeMeasurementReady &&
          (!s.settings.screenTimeMeasurementDay ||
            s.settings.screenTimeMeasurementDay === dayKey(now)) &&
          !s.screenTimeUnconfirmedDays?.includes(dayKey(now))
          ? s.screenMinutes
          : null
        : member?.screenDays?.[dayKey(now)];
    return v == null ? null : v <= q.target ? 100 : Math.max(0, Math.floor((q.target / v) * 100));
  }
  // 진행 중 바다 항해도 목적지 섬의 집중이 아니다
  const session = s.session?.kind !== 'sea' && s.session?.islandId === islandId ? s.session : null;
  const live = session
    ? [
        {
          id: session.id,
          islandId,
          subject: session.subject,
          seconds: sessionSeconds(session, now),
          at: now,
          fish: 0,
          contributed: true,
          intervals: session.intervals
            ? [
                ...session.intervals,
                ...(session.status === 'active' ? [{ start: session.startedAt, end: now }] : []),
              ]
            : undefined,
        },
      ]
    : [];
  const records = id === 'me' ? [...s.records, ...live] : (member?.records ?? []);
  const round: QuestRound = {
    targets: [],
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  };
  return Math.min(
    100,
    Math.floor((focusTotal(records, islandId, dayKey(now), round) / (q.target * 60)) * 100),
  );
}

export function ensureQuestRound(i: Island, q: Quest, day: string) {
  q.rounds ??= {};
  if (q.rounds[day]) return;
  if (
    (q.createdDay && day < q.createdDay) ||
    (i.joinedDay && day < i.joinedDay) ||
    (i.boardCompletedDay && day < i.boardCompletedDay)
  )
    return;
  q.rounds[day] ??= {
    targets: targetIds(i),
    achieved: [],
    claimed: [],
    bonus: false,
    target: q.target,
    kind: q.type,
    windowStart: q.windowStart,
    windowEnd: q.windowEnd,
  };
}

export function evaluateQuests(s: State, now: number) {
  s.rewards ??= [];
  for (const i of s.islands.filter((i) => i.joined && i.buildings.includes('board')))
    for (const q of i.quests) {
      q.rounds ??= {};
      const today = dayKey(now);
      ensureQuestRound(i, q, today);
      for (const [day, round] of Object.entries(q.rounds)) {
        if (day > today) continue;
        if (
          round.kind === 'screen' &&
          day < today &&
          (!s.settings.screenTimeHistoryReady ||
            (s.settings.screenTimeMeasurementDay && s.settings.screenTimeHistoryDay !== today))
        )
          continue;
        if (round.kind === 'screen' && s.screenTimeUnconfirmedDays?.includes(day)) continue;
        for (const id of round.targets) {
          const member = memberOf(i, id);
          let achieved = round.achieved.includes(id);
          if (!achieved) {
            const live =
              s.session?.kind !== 'sea' && s.session?.islandId === i.id
                ? [
                    {
                      id: s.session.id,
                      islandId: i.id,
                      subject: s.session.subject,
                      seconds: sessionSeconds(s.session, now),
                      at: now,
                      fish: 0,
                      contributed: true,
                      intervals: s.session.intervals
                        ? [
                            ...s.session.intervals,
                            ...(s.session.status === 'active'
                              ? [{ start: s.session.startedAt, end: now }]
                              : []),
                          ]
                        : undefined,
                    },
                  ]
                : [];
            const records = id === 'me' ? [...s.records, ...live] : (member?.records ?? []);
            const screen = id === 'me' ? s.screenDays?.[day] : member?.screenDays?.[day];
            achieved =
              round.kind === 'focus'
                ? focusTotal(records, i.id, day, round) >= round.target * 60
                : day < today && screen != null && screen <= round.target;
          }
          if (!achieved) continue;
          if (!round.achieved.includes(id)) round.achieved.push(id);
          if (id === 'me') {
            const rewardId = `${i.id}/${q.id}/${day}/me`;
            if (!round.claimed.includes(id) && !s.rewards.some((reward) => reward.id === rewardId))
              s.rewards.push({
                id: rewardId,
                islandId: i.id,
                questId: q.id,
                day,
                amount: 10,
                kind: 'personal',
                acknowledged: false,
              });
          } else {
            if (round.claimed.includes(id)) continue;
            round.claimed.push(id);
            i.fish = balance(i) + 10;
            i.earned ??= {};
            i.earned[id] = earnedBy(i, id) + 10;
            i.ledger.unshift({
              id: uuid(),
              text: t('ui.policy.v0_quest_reward_10_fish_c22f7', {
                v0: member?.name ?? t('onboarding.residentFallbackName'),
              }),
              at: now,
              memberId: id,
            });
          }
        }
        if (
          !round.bonus &&
          round.targets.length &&
          round.targets.every((id) => round.achieved.includes(id))
        ) {
          round.bonus = true;
          i.fish = balance(i) + round.targets.length * 5;
          i.ledger.unshift({
            id: uuid(),
            text: t('ui.policy.v0_all_complete_bonus_v1_fish_3e305', {
              v0: q.title,
              v1: round.targets.length * 5,
            }),
            at: now,
          });
          if (round.targets.includes('me'))
            s.rewards.push({
              id: `${i.id}/${q.id}/${day}/bonus`,
              islandId: i.id,
              questId: q.id,
              day,
              amount: round.targets.length * 5,
              kind: 'bonus',
              acknowledged: false,
            });
        }
      }
      q.claimed = q.rounds[today]?.claimed.includes('me') ?? false;
    }
}

// TICK 이 이 state 를 그 날(KST)에 훑어 바뀐 게 없음을 확인했으면 그 날을 적어 둔다(GROMO-2372).
// TICK 이 시각에 따라 바꾸는 것은 ① 공사 완공(endsAt) ② 날짜(오늘 스크린타임 칸·퀘스트 회차) ③ 퀘스트 섬의
// 진행 중 집중(달성 판정)뿐이라, 같은 state·같은 날이면 ①③만 따로 보면 된다.
export const idleTicks = new WeakMap<State, string>();

/** 이 TICK 이 아무것도 바꾸지 않음이 확실하면 true — 깊은 복사 없이 같은 state 를 돌려줘도 된다. */
export function tickIdle(state: State, now: number): boolean {
  if (idleTicks.get(state) !== dayKey(now)) return false;
  if (state.islands.some((i) => i.construction && now >= i.construction.endsAt)) return false;
  const session = state.session;
  return !(
    session &&
    session.kind !== 'sea' &&
    state.islands.some(
      (i) =>
        i.id === session.islandId && i.joined && i.buildings.includes('board') && i.quests.length,
    )
  );
}
