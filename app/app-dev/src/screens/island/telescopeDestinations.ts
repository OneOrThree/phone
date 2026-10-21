import type { TelescopeItem } from '@/services/api/telescope';

/** 기존 섬이 없거나 들어갈 수 있는 섬이 없으면 서버가 마련한 무인도 하나를 표시한다. */
export function visibleTelescopeItems(items: TelescopeItem[]): TelescopeItem[] {
  const inhabited = items.filter((item) => item.memberCount > 0);
  const canEnter = inhabited.some(
    (item) => item.membershipStatus === 'active' || item.slot === 'joined' || !item.full,
  );
  const uninhabited = items.find((item) => item.memberCount === 0);
  // 들어갈 섬이 있으면 이전 무인도 예약을 숨기고 기존 목록·순서를 유지한다.
  return !canEnter && uninhabited ? [uninhabited] : inhabited;
}
