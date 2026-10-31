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
