import type { TelescopeItem } from '@/services/api/telescope';

/**
 * 서버의 무인도 후보(`slot=uninhabited`)는 일반 목록과 별개로 정해져 들어갈 섬이 있어도 함께 보인다.
 * 옛 서버의 예약 무인도(주민 0명·일반 slot)는 기존 섬이 없거나 들어갈 섬이 없을 때만 하나 보인다.
 */
export function visibleTelescopeItems(items: TelescopeItem[]): TelescopeItem[] {
  const inhabited = items.filter((item) => item.memberCount > 0);
  const canEnter = inhabited.some(
    (item) => item.membershipStatus === 'active' || item.slot === 'joined' || !item.full,
  );
  // 들어갈 섬이 있으면 옛 예약 무인도만 숨기고 서버 순서(추첨 무인도는 맨 앞)를 유지한다.
  if (canEnter) return items.filter((item) => item.memberCount > 0 || item.slot === 'uninhabited');
  const uninhabited = items.find((item) => item.memberCount === 0);
  return uninhabited ? [uninhabited] : inhabited;
}
