export interface SystemVersions {
  local: boolean;
  data: { serverVersion: string | null; schemaVersion: string | null } | null;
  notification: { serverVersion: string | null; schemaVersion: string | null } | null;
  iosStore: { version: string | null; status: 'ok' | 'unpublished' | 'unavailable' | 'local' };
}
// 숫자 1~3개 조각만 받고 빠진 뒤쪽은 0으로 채운다("2.0" == "2.0.0"). 그 외 형식은 null.
const parse = (value: string) => {
  const v = value.trim();
  if (!/^\d+(\.\d+){0,2}$/.test(v)) return null;
  const n = v.split('.').map(Number);
  while (n.length < 3) n.push(0);
  return n;
};
// 최소 버전이 스토어 버전보다 높으면 true. 파싱할 수 없는 형식이면 비교하지 않는다.
export function exceedsStoreVersion(min: string | null | undefined, store: string | null | undefined): boolean {
  const a = min ? parse(min) : null, b = store ? parse(store) : null;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export const storeWarning = (store: string) => `iOS 최소 버전이 App Store 공개 버전(${store})보다 높아 모든 iOS 사용자가 업데이트할 수 없게 막힙니다.`;
export const unpublishedWarning = 'iOS 앱이 아직 App Store에 공개되지 않았습니다. iOS 최소 버전을 게시하면 iOS 사용자가 업데이트할 곳이 없어 막힙니다. 공개 뒤에 게시하세요.';
export const unavailableNotice = 'App Store 공개 버전을 확인하지 못했습니다. 게시 전에 스토어 버전을 직접 확인하세요.';
// iOS 최소 버전이 비어 있지 않을 때 보여 줄 안내 종류. 게시를 막지는 않는다.
export function iosStoreNotice(min: string | null | undefined, store: SystemVersions['iosStore'] | null | undefined): 'exceeds' | 'unpublished' | 'unavailable' | null {
  if (!min?.trim() || !store) return null;
  if (store.status === 'unpublished') return 'unpublished';
  if (store.status === 'unavailable') return 'unavailable';
  return store.status === 'ok' && exceedsStoreVersion(min, store.version) ? 'exceeds' : null;
}
