export interface SystemVersions {
  local: boolean;
  data: { serverVersion: string | null; schemaVersion: string | null } | null;
  notification: { serverVersion: string | null; schemaVersion: string | null } | null;
  iosStore: { version: string | null; status: 'ok' | 'unpublished' | 'unavailable' | 'local' };
}
const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value.trim()) ? value.trim().split('.').map(Number) : null;
// 최소 버전이 스토어 버전보다 높으면 true. 형식이 숫자.숫자.숫자가 아니면 비교하지 않는다.
export function exceedsStoreVersion(min: string | null | undefined, store: string | null | undefined): boolean {
  const a = min ? parse(min) : null, b = store ? parse(store) : null;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export const storeWarning = (store: string) => `iOS 최소 버전이 App Store 공개 버전(${store})보다 높아 모든 iOS 사용자가 업데이트할 수 없게 막힙니다.`;
