import { t } from '@/i18n';

/**
 * 섬 이름 표기 — 「바다」 → 「바다섬」, 이미 「섬」으로 끝나는 「바다섬」은 그대로(「바다섬섬」 방지, 구현계획 M6).
 * en 은 「Sea Island」. 잡지에서 새로 쓰는 문구는 전부 이 함수를 거친다.
 */
export function islandTitle(name: string): string {
  const n = name.trim();
  return /(섬|island)$/i.test(n) ? n : t('magazine.islandTitle', { name: n });
}
