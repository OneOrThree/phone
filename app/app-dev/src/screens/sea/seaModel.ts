import type { Color } from '@/services/model';
import { t } from '@/i18n';

export const seaEmotes = ['hello', 'cheer', 'hearts', 'sleepy', 'laugh'] as const;
export type SeaEmote = (typeof seaEmotes)[number];

/** API DTO가 아니다. 바다 서버 어댑터가 정본 스냅샷을 이 표시 모델로 변환한다. */
export type SeaParticipant = {
  userId: string;
  name: string;
  color: Color;
  focusing: boolean;
  activeSeconds: number;
  subject?: string;
  message?: string;
  emote?: SeaEmote;
};

export type SeaVoyage = {
  sessionId: string;
  destinationId: string;
  destinationName: string;
  subject: string;
  activeSeconds: number;
  requiredSeconds: number;
  /** 서버 판정. 화면의 시간/진행률이 100%여도 이 값 없이 하선할 수 없다. */
  canDisembark: boolean;
};

export type SeaArrival = {
  recordId: string;
  destinationId: string;
  destinationName: string;
  activeSeconds: number;
  /** 서버 seaReward=null은 unknown으로 변환한다. none은 미지급이 확인된 경우에만 사용한다. */
  reward:
    { status: 'earned'; itemId: string; name: string } | { status: 'none' } | { status: 'unknown' };
};

export const seaClock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

export const seaDuration = (seconds: number) =>
  t('openSea.duration', {
    minutes: Math.floor(Math.max(0, seconds) / 60),
    seconds: Math.floor(Math.max(0, seconds) % 60),
  });

/** 나는 앞에 고정하고 다른 참여자는 최대 5명씩 배치한다. 10명 방은 5+4명이다. */
export function seaPeerPages(participants: readonly SeaParticipant[], selfId: string) {
  const peers = [...new Map(participants.map((p) => [p.userId, p])).values()].filter(
    (p) => p.userId !== selfId,
  );
  return Array.from({ length: Math.max(1, Math.ceil(peers.length / 5)) }, (_, index) =>
    peers.slice(index * 5, index * 5 + 5),
  );
}
