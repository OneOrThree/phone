export const GROUP_DECK_SIDE_PEEK = 24;

export function groupDeckCardWidth(windowWidth: number): number {
  return Math.max(240, windowWidth - GROUP_DECK_SIDE_PEEK * 2);
}
