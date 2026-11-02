export interface ReleaseUnit { commit: string; tag: string | null; runUrl: string | null; deployedAt: string | null }
export type Verdict =
  | { status: 'server-first'; changedFiles: number; aheadBy: number; compareUrl: string }
  | { status: 'ship'; changedFiles: 0; aheadBy: number; compareUrl: string }
  | { status: 'unknown' };
export interface StoreVersion { version: string | null; status: string }
export interface ReleaseStatusResponse {
  local: boolean;
  verdict?: Verdict;
  units?: Record<'server' | 'backoffice' | 'kafka' | 'redis', ReleaseUnit | null>;
  androidStore?: StoreVersion | null;
}

// 판정 문구. 응답이 없거나 모양이 다르면 판정 불가로 본다.
export function verdictText(verdict: Verdict | null | undefined): { title: string; detail: string | null; tone: 'warn' | 'ok' | 'unknown' } {
  if (verdict?.status === 'server-first')
    return { title: '서버 먼저 배포', detail: `main에 운영에 없는 서버 변경 ${verdict.changedFiles}파일`, tone: 'warn' };
  if (verdict?.status === 'ship') return { title: '앱 출시 가능', detail: null, tone: 'ok' };
  return { title: '판정 불가', detail: '운영 서버 버전이나 GitHub 조회를 확인하지 못했습니다. 출시 전에 직접 확인하세요.', tone: 'unknown' };
}

// 시각은 KST(UTC+9)로 고정해 보여 준다. 해석할 수 없으면 null.
export function kst(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return null;
  const d = new Date(time + 9 * 3600000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} KST`;
}
