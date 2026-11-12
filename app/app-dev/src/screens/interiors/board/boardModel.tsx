import { t } from '@/i18n';
import { outfitOf } from '@/components/CatOutfitLayers';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import {
  Building,
  Route,
  State,
  balance,
  buildMinutes,
  buildingCost,
  buildingNames,
  buildingReady,
  clockMinutes,
  dayKey,
  isHost,
  isOwnComment,
  kstDayStart,
  questMemberRate,
  targetIds,
  viewIsland,
} from '@/services/model';
import { LAST_KST_WINDOW_END_MINUTES } from '@/utils/questWindowTz';
import { buildOptions, interiorArt } from '../assets';
import { BlueprintView, NoticeView, QuestForm, QuestView, ResidentRate } from './types';

// 앱 라우트의 게시판 탭 이름 ↔ 종이
export const boardTabs = {
  notice: 'notice',
  quest: 'quest',
  blueprint: 'blueprint',
  guestbook: 'guestbook',
} as const;

// 건물 → 청사진 설명(buildOptions)과 완공 후 이동할 라우트
export const blueprintOption: Partial<Record<Building, string>> = {
  library: 'library',
  tower: 'observatory',
  mail: 'mailbox',
  gram: 'gramophone',
  shop: 'shop',
};

export const buildingRoute: Partial<Record<Building, Route>> = {
  library: 'library',
  tower: 'tower',
  mail: 'mail',
  gram: 'sound',
  shop: 'shop',
};

const minutesLabel = (m: number) =>
  m % 60 ? t('ui.diary.minutes', { v0: m }) : t('ui.board.hours', { v0: m / 60 });

// 공지 작성일: 오늘 · 어제 · M월 D일 (Asia/Seoul)
const dayLabel = (at: number | undefined, now: number) => {
  if (!at) return '';
  const diff = Math.round((kstDayStart(dayKey(now)) - kstDayStart(dayKey(at))) / 86400000);
  if (diff === 0) return t('magazine.rack.today');
  if (diff === 1) return t('ui.mail.yesterdayDate');
  const [, month, date] = dayKey(at).split('-').map(Number);
  return t('ui.board.monthDay', { v0: month, v1: date });
};

// 퀘스트 만들기 입력 검사 (목업·앱 공통)
// serverEdit 면 서버 PATCH 는 title/targetMinutes 만 보내고 창은 읽기 전용이다 — 창 검증을 건너뛴다.
// (목표 ≤ 창 길이는 서버 update() 가 저장된 UTC 창으로 재검증한다 — IslandQuestService.requireTargetFits.)
// 안 그러면 KST 자정을 넘는 기존 창(예: 23:00–02:00 KST = 14:00–17:00 UTC) 수정 시 end<=start 로 막혀
// 제목·목표도 못 고친다(GROMO-2672).
export const questError = (form: QuestForm, serverEdit = false) => {
  const target = Number(form.target);
  if (
    !form.title.trim() ||
    !Number.isInteger(target) ||
    target < 0 ||
    (form.type === 'focus' && target === 0)
  )
    return t('ui.board.requiredQuest');
  if (form.type === 'phone' || serverEdit) return '';
  const start = clockMinutes(form.startTime),
    rawEnd = clockMinutes(form.endTime);
  if (start === null || rawEnd === null) return t('ui.board.requiredTimes');
  // 창은 KST 벽시계 그대로 검증한다. 종료 피커는 23:59 까지고, 다른 길로 24:00 이 들어와도
  // 서버 어댑터(quests.ts createQuest)가 23:59 로 내려 보내므로 같은 끝으로 잰다(GROMO-2886).
  const end = Math.min(rawEnd, LAST_KST_WINDOW_END_MINUTES);
  if (end <= start) return t('ui.board.endAfterStart');
  if (target > end - start) return t('ui.board.goalWithinSchedule');
  return '';
};

// 앱 상태(e)를 게시판이 그리는 모양으로 바꾼다
export function boardFromApp(e: ScreenEnvironment) {
  // 다른 섬을 구경 중이면 그 섬 게시판을 읽기 전용으로 보여 준다
  const state: State = e.state,
    i = viewIsland(state),
    now: number = e.now;
  const member = (id: string) => i.members.find((m) => m.id === id);
  const notices: NoticeView[] = i.notices.map((n) => ({
    id: n.id,
    title: n.title,
    time: dayLabel(n.at, now),
    body: n.body,
    comments: n.comments.map((c) => ({
      id: c.id,
      name: c.name,
      text: c.text,
      mine: isOwnComment(state, c),
    })),
  }));
  const quests: QuestView[] = i.quests.map((q) => ({
    id: q.id,
    title: q.title,
    type: q.type === 'screen' ? 'phone' : 'focus',
    startTime: q.windowStart,
    endTime: q.windowEnd,
    target: q.target,
    rate: questMemberRate(state, q, 'me', i.id, now),
  }));
  // 오늘 회차가 있으면 보상 판정과 같은 대상 스냅숏으로, 회차 전이면 지금 주민으로 보여 준다
  const ratesOf = (quest: QuestView): ResidentRate[] => {
    const q = i.quests.find((x) => x.id === quest.id);
    const targets = q?.rounds?.[dayKey(now)]?.targets ?? targetIds(i);
    return targets.map((id) => {
      const who = member(id) ?? i.formerMembers?.find((m) => m.id === id);
      return {
        id,
        name:
          id === 'me'
            ? t('ui.board.meSuffix', { v0: state.name })
            : (who?.name ?? t('visitorBoard.formerResident')),
        color: id === 'me' ? state.color : (who?.color ?? 'gray'),
        outfit: id === 'me' ? outfitOf(state) : undefined,
        rate: q ? questMemberRate(state, q, id, i.id, now) : null,
      };
    });
  };
  const goal = i.buildingQuest,
    work = i.construction,
    b = work?.building ?? goal?.building ?? i.completed?.building;
  const option = buildOptions.find((o) => o.id === (b && blueprintOption[b]));
  const blueprint: BlueprintView = {
    buildingId: b ?? null,
    // 회관·게시판처럼 청사진 설명이 없는 건물은 보여 줄 청사진이 없다
    state: !option
      ? 'none'
      : work
        ? 'building'
        : goal
          ? buildingReady(i)
            ? 'ready'
            : 'waiting'
          : i.completed
            ? 'complete'
            : 'none',
    name: b ? buildingNames[b] : '',
    image: option?.image ?? interiorArt.buildings.library,
    price: t('ui.board.totalFish', { v0: b ? buildingCost(i, b) : 0 }),
    time: t('ui.board.constructionDuration', { v0: b ? minutesLabel(buildMinutes[b]) : '' }),
    detail: option?.detail ?? '',
    collected: balance(i),
    needed: b ? buildingCost(i, b) : 0,
    balance: balance(i),
    cost: b ? buildingCost(i, b) : 0,
    progress: work
      ? Math.round(
          Math.min(1, Math.max(0, (now - work.startedAt) / (work.endsAt - work.startedAt))) * 100,
        )
      : 0,
    residents: [],
  };
  return {
    island: i,
    owner: !state.visitingIslandId && isHost(i),
    visitor: !!state.visitingIslandId,
    notices,
    quests,
    ratesOf,
    blueprint,
    building: b,
  };
}
