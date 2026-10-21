/**
 * 남의 고양이 외양(GROMO-2390) — 서버 `appearance` 의 머리·목·신발과 단조 version.
 * 주민 목록·홈 주민·바다 방 응답과 `member.appearance.updated` 사건이 모두 이 모양으로 모인다.
 * 키 없음(옛 서버·차단 상대)과 null 은 모두 «미착용» 이다.
 */
export type MemberLook = {
  head: string | null;
  neck: string | null;
  shoes: string | null;
  /** 단조 증가 값 — 없으면 순서를 못 가린다(옛 서버). */
  version: number | null;
};

const id = (v: unknown) => (typeof v === 'string' && v ? v : null);
const ver = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 서버 `appearance` 객체 → 외양. 객체가 아니면 null(= 외양을 모른다). */
export function parseLook(raw: unknown): MemberLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  return { head: id(a.head), neck: id(a.neck), shoes: id(a.shoes), version: ver(a.version) };
}

/**
 * 같은 사람의 두 외양 중 보일 쪽 — 둘 다 version 이 있으면 큰 쪽(같으면 갖고 있던 것),
 * 한쪽이라도 없으면 순서를 모르니 새로 받은 쪽을 쓴다.
 */
export function newerLook(
  current: MemberLook | null | undefined,
  incoming: MemberLook | null,
): MemberLook | null {
  if (!incoming) return current ?? null;
  if (!current) return incoming;
  if (current.version !== null && incoming.version !== null && incoming.version <= current.version)
    return current;
  return incoming;
}

/** `member.appearance.updated` 봉투 → 누구의 어떤 외양. 다른 섬·모양 불량은 null. */
export function parseAppearanceEvent(
  raw: unknown,
  islandId: string,
): { userId: string; look: MemberLook } | null {
  const env = raw as Record<string, unknown> | null;
  if (
    !env ||
    typeof env !== 'object' ||
    env.type !== 'member.appearance.updated' ||
    env.schemaVersion !== 1 ||
    env.islandId !== islandId
  )
    return null;
  const p = env.payload as Record<string, unknown> | null;
  const userId = id(p?.userId);
  const look = parseLook(p?.appearance);
  if (!userId || !look) return null;
  return {
    userId,
    look: { ...look, version: ver(p?.version) ?? look.version ?? ver(env.aggregateVersion) },
  };
}

/** 한 주민의 보일 외양 — 응답(스냅숏)의 appearance 와 실시간으로 받은 외양 중 새 것. */
export const lookOf = (
  live: Record<string, MemberLook> | undefined,
  userId: string,
  snapshot: unknown,
): MemberLook | undefined => newerLook(parseLook(snapshot), live?.[userId] ?? null) ?? undefined;
