import { validColor, validName, type CatColor } from "./world";

export const PROFILE_KEY = "cattus-island-profile-v1";
export type Profile = { name: string; color: CatColor };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function profile(value: unknown): Profile | null {
  if (!value || typeof value !== "object") return null;
  const { name, color } = value as Partial<Profile>;
  const trimmed = typeof name === "string" ? name.trim() : "";
  return validName(trimmed) && validColor(color)
    ? { name: trimmed, color }
    : null;
}

export function readProfile(storage?: StorageLike): Profile | null {
  try {
    return profile(
      JSON.parse(
        (storage ?? globalThis.localStorage).getItem(PROFILE_KEY) ?? "null",
      ),
    );
  } catch {
    return null;
  }
}

export function saveProfile(value: Profile, storage?: StorageLike): boolean {
  const next = profile(value);
  if (!next) return false;
  try {
    (storage ?? globalThis.localStorage).setItem(
      PROFILE_KEY,
      JSON.stringify(next),
    );
    return true;
  } catch {
    // 저장소를 쓸 수 없어도 이번 방문은 고른 이름으로 입장한다.
    return false;
  }
}
