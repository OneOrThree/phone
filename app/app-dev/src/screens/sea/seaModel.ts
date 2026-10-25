import type { Outfit } from '@/components/CatOutfitLayers';
import type { Color } from '@/services/model';
import { t } from '@/i18n';

export const seaEmotes = ['hello', 'cheer', 'hearts', 'sleepy', 'laugh'] as const;

/** 호스트가 실패 이유를 문구로 알릴 때 던진다 — SeaScreen 은 이 메시지를, 그 밖의 실패는 `openSea.retry` 를 인라인 안내로 띄운다. */
export class SeaNotice extends Error {}
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
  /** 장착한 머리·목·신발(카탈로그 id). undefined·null은 미장착이다. 바다 서버는 현재 내 장착 정보만 별도로 알 수 있다. */
  outfit?: Outfit;
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
  /** 이번에 받은 꾸미기 productId 목록 — 이름·그림은 카탈로그로 푼다. */
  rewards: string[];
  /** 그중 처음 받은 것 — NEW! 배지(GROMO-2382). 구버전 서버면 없다. */
  newRewards?: string[];
  /** 다음 단계까지 남은 분 — 모르면 null. */
  minutesToNextTier: number | null;
  /**
   * 서버가 보상을 아직 모른다(seaReward=null) — 미획득(rewards=[] 이고 false)과 구분해
   * 「확인 중」 문구로 인벤토리 확인을 안내한다. 복원 응답만으로 지급을 추측하지 않는다.
   */
  rewardsUnknown: boolean;
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
