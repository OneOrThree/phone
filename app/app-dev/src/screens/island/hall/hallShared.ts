import { getLocale } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { isMockMode } from '@/services/demoMode';
import type { Island, State } from '@/services/model';

// 회관 route 들(hall/*Route)이 같이 쓰는 값.
// App.tsx 의 REVIEW/DEMO 와 같은 판정(services/demoMode) — 모크 모드는 서버가 없으므로 가계부도 로컬 원장으로 그린다.
export const ledgerMockMode = () => isMockMode();
export const CARD_INK = '#3e352e';
export const MUTED = '#665348';
// 받침 유무로 조사 고르기 (을/를, 으로/로: ㄹ받침은 로)
const final = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c < 0 || c > 11171 ? -1 : c % 28;
};
export const eul = (w: string) => (getLocale() === 'ko' ? w + (final(w) > 0 ? '을' : '를') : w);
export const ro = (w: string) =>
  getLocale() === 'ko' ? w + (final(w) > 0 && final(w) !== 8 ? '으로' : '로') : w;
// 서버 훅이 부를 섬 — 서버 모드 current 는 로컬 목업 섬 목록에 없다(GROMO-2138). 서버 모드(e.islands)에선
// 서버 id 가 도착하기 전(null)에 목업 id 로 소식·관리를 부르지 않는다(GROMO-2460). 목업은 기존 섬 id
export const hallLiveIslandId = (e: ScreenProps['e'], s: State, i: Island) =>
  e.islands ? (s.serverIslands?.currentIslandId ?? null) : i.id;
