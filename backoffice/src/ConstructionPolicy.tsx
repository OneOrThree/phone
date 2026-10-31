export interface PolicyItem { buildingId: string; displayName: string; cost: number; buildSeconds: number }
export interface PolicySnapshot { costPolicyVersion: number; publishedAt: string; items: PolicyItem[]; snapshotId: string; digest: string; local?: boolean }
interface EditItem { buildingId: string; cost: number | null; buildSeconds: number | null }
export interface PolicyProposal { snapshotId: string; digest: string; base: PolicySnapshot; items: EditItem[] }

export function proposalFrom(dataText: string): PolicyProposal | undefined {
  try { return JSON.parse(dataText).construction; } catch { return undefined; }
}
function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '미입력';
  if (seconds === 0) return '대기 시간 없음 · 완공 처리 시 반영';
  return [Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}시간` : '', Math.floor(seconds % 3600 / 60) ? `${Math.floor(seconds % 3600 / 60)}분` : '', seconds % 60 ? `${seconds % 60}초` : ''].filter(Boolean).join(' ');
}
export function ConstructionEditor({ proposal, onChange, onLoad, loading }: {
  proposal?: PolicyProposal; onChange: (value: PolicyProposal) => void; onLoad: () => void; loading: boolean;
}) {
  function edit(index: number, field: 'cost' | 'buildSeconds', text: string) {
    if (!proposal) return;
    onChange({ ...proposal, items: proposal.items.map((item, i) => i === index ? { ...item, [field]: text === '' ? null : Number(text) } : item) });
  }
  return <section className="construction-editor">
    <button type="button" className="button secondary" onClick={onLoad} disabled={loading}>{loading ? '현재 정책 불러오는 중…' : proposal ? '현재 값으로 다시 불러오기' : '현재 건설 정책 불러오기'}</button>
    {!proposal ? <p className="field-hint">서버의 현재 건설 비용과 공사 시간을 불러온 뒤 변경할 수 있습니다.</p> : <>
      <p className="field-hint">{proposal.base.local ? '로컬 예제 정책' : '현재 정책'} · 버전 {proposal.base.costPolicyVersion}. 다시 불러오면 입력한 값이 현재 정책으로 바뀝니다.</p>
      <div className="policy-table-wrap"><table className="policy-table"><thead><tr><th>건물</th><th>물고기 비용</th><th>공사 시간(초)</th></tr></thead><tbody>{proposal.items.map((item, index) => {
        const before = proposal.base.items.find(row => row.buildingId === item.buildingId);
        return <tr key={item.buildingId}><th>{before?.displayName ?? item.buildingId}</th><td><input aria-label={`${before?.displayName} 비용`} type="number" min="1" max="2147483647" step="1" required value={item.cost ?? ''} onChange={e => edit(index, 'cost', e.target.value)} /><small>검토 기준 {before?.cost.toLocaleString()}마리</small></td><td><input aria-label={`${before?.displayName} 공사 시간(초)`} type="number" min="0" max="2147483647" step="1" required value={item.buildSeconds ?? ''} onChange={e => edit(index, 'buildSeconds', e.target.value)} /><small>{duration(item.buildSeconds)}</small></td></tr>;
      })}</tbody></table></div>
      <p className="field-hint">모든 건물의 정책을 함께 적용합니다. 이미 시작한 공사의 비용과 완료 시각은 유지됩니다.</p>
    </>}
  </section>;
}
export function ConstructionReview({ proposal }: { proposal?: PolicyProposal }) {
  if (!proposal) return <p className="field-hint">현재 정책을 불러오면 변경 전후 값을 비교할 수 있습니다.</p>;
  return <section><h4>건설 비용·공사 시간 변경</h4><p className="field-hint">검토 기준 버전 {proposal.base.costPolicyVersion} · 이미 시작한 공사는 유지</p><div className="policy-table-wrap"><table className="policy-table"><thead><tr><th>건물</th><th>비용(마리)</th><th>공사 시간</th></tr></thead><tbody>{proposal.items.map(item => {
    const before = proposal.base.items.find(row => row.buildingId === item.buildingId);
    const changed = item.cost !== before?.cost || item.buildSeconds !== before?.buildSeconds;
    return <tr key={item.buildingId} className={changed ? 'policy-changed' : ''}><th>{before?.displayName ?? item.buildingId}{changed && <small>변경</small>}</th><td>{before?.cost.toLocaleString()} → {item.cost?.toLocaleString() ?? '미입력'}</td><td>{duration(before?.buildSeconds ?? null)} → {duration(item.buildSeconds)}</td></tr>;
  })}</tbody></table></div></section>;
}
