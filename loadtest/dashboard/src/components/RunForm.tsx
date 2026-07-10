import { useMemo, useState } from 'react';
import { dispatchRun } from '../api/github';
import { PROFILES, TARGETS, VERDICT_LABEL, type ProfileMeta } from '../catalog';
import { presetFor } from '../presets';

type Src = 'profile' | 'preset' | 'override';

// "10m" · "90s" · "~2.5m" → 분. 계단형 표시("100→200→400")는 null.
function parseMinutes(d: string): number | null {
  const s = d.replace('~', '').trim();
  let m = 0;
  const h = s.match(/(\d+(?:\.\d+)?)h/);
  const mm = s.match(/(\d+(?:\.\d+)?)m/);
  const sec = s.match(/(\d+(?:\.\d+)?)s/);
  if (h) m += parseFloat(h[1]) * 60;
  if (mm) m += parseFloat(mm[1]);
  if (sec) m += parseFloat(sec[1]) / 60;
  if (!h && !mm && !sec && /^\d/.test(s)) m = parseFloat(s);
  return m || null;
}

// 딸깍 버튼 — workflow_dispatch 호출 (run 은 concurrency 로 직렬화됨)
export function RunForm({ onDispatched }: { onDispatched: () => void }) {
  const [profile, setProfile] = useState('smoke');
  const [target, setTarget] = useState(TARGETS[0].value);
  const [updateBaseline, setUpdateBaseline] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [ovRate, setOvRate] = useState('');
  const [ovDuration, setOvDuration] = useState('');
  const [ovScale, setOvScale] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [err, setErr] = useState('');

  const p = useMemo(() => PROFILES.find((x) => x.value === profile) as ProfileMeta, [profile]);
  const t = useMemo(() => TARGETS.find((x) => x.value === target) ?? TARGETS[0], [target]);

  // precedence: 프로파일 기본 < preset < 고급설정 override
  const preview = useMemo(() => {
    const preset = presetFor(target, profile);
    const presetActive = preset.rate != null || preset.duration != null || preset.scale != null;
    const overrideActive = !!(ovRate || ovDuration || ovScale);
    const rateSrc: Src = ovRate ? 'override' : preset.rate != null ? 'preset' : 'profile';
    const durSrc: Src = ovDuration ? 'override' : preset.duration != null ? 'preset' : 'profile';
    const effRate = ovRate || preset.rate || p.rate;
    const effDur = ovDuration || preset.duration || p.duration;
    const effScale = ovScale || preset.scale || '1.0';
    const base = parseMinutes(effDur);
    const eta =
      base != null
        ? `~${Math.round(base + p.warmupMin + 1)}분 (warmup ${p.warmupMin}분 + 오버헤드 포함)`
        : `warmup ${p.warmupMin}분 + 실행 + 오버헤드`;
    const rateText = p.ramping && !ovRate ? `${effRate} rps 계단` : `${effRate} rps`;
    return { presetActive, overrideActive, rateSrc, durSrc, effDur, effScale, eta, rateText };
  }, [target, profile, ovRate, ovDuration, ovScale, p]);

  const rampingOverride = p.ramping && (!!ovRate || !!ovDuration);

  const run = async () => {
    setState('busy');
    try {
      await dispatchRun(profile, target, updateBaseline, {
        rate: ovRate.trim(),
        duration: ovDuration.trim(),
        scale: ovScale.trim(),
      });
      setState('ok');
      setTimeout(onDispatched, 3000); // dispatch 후 run 이 API 에 잡히기까지 지연
    } catch (e) {
      setErr(String(e));
      setState('err');
    }
  };

  return (
    <section className="card">
      <h2>run 트리거</h2>
      <div className="form-row">
        <label>
          프로파일 (부하 강도·시간)
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {PROFILES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          타겟 (무엇에 부하)
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGETS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 실행 전 "이 실행 요약" — 유효 값(precedence 반영) 미리보기 */}
      <div className="summary">
        <h3 className="summary-title">
          이 실행 요약
          <span className="chip cat">{t.category}</span>
          {t.star && <span className="chip star">⭐ Phase 1</span>}
        </h3>
        <dl className="summary-dl">
          <dt>엔드포인트</dt>
          <dd>{t.endpoint}</dd>
          <dt>부하</dt>
          <dd>
            <span className={preview.rateSrc !== 'profile' ? 'over' : ''}>{preview.rateText}</span>
            {' · '}
            <span className={preview.durSrc !== 'profile' ? 'over' : ''}>{preview.effDur}</span>{' '}
            <span className="muted">({p.model})</span>
            {(preview.rateSrc === 'preset' || preview.durSrc === 'preset') && (
              <span className="chip preset">preset</span>
            )}
            {(preview.rateSrc === 'override' || preview.durSrc === 'override') && (
              <span className="chip override">override</span>
            )}
          </dd>
          <dt>VU</dt>
          <dd>{p.vu}</dd>
          <dt>판정</dt>
          <dd>{VERDICT_LABEL}</dd>
          <dt>예상 소요</dt>
          <dd>{preview.eta}</dd>
        </dl>
        <div className="summary-src">
          값 출처: profile <b>{profile}</b>
          {preview.presetActive && (
            <>
              {' + '}preset <b>{target.split('/').pop()}·{profile}</b>
            </>
          )}
          {preview.overrideActive && (
            <>
              {' + '}
              <b>고급설정 override</b>
            </>
          )}
          {' · '}SCALE {preview.effScale}
        </div>
      </div>

      {/* 고급 설정 — 기본은 접힘, 필요 시 펼쳐 세밀 조정 */}
      <button className="adv-toggle" onClick={() => setAdvOpen((v) => !v)}>
        {advOpen ? '▾' : '▸'} 고급 설정 (비우면 프로파일·프리셋 기본값)
      </button>
      {advOpen && (
        <div className="adv">
          <div className="adv-row">
            <label>
              RATE (rps)
              <input
                className="short"
                value={ovRate}
                placeholder="기본"
                inputMode="numeric"
                onChange={(e) => setOvRate(e.target.value)}
              />
            </label>
            <label>
              DURATION
              <input
                className="short"
                value={ovDuration}
                placeholder="기본"
                onChange={(e) => setOvDuration(e.target.value)}
              />
            </label>
            <label>
              SCALE
              <input
                className="short"
                value={ovScale}
                placeholder="1.0"
                inputMode="decimal"
                onChange={(e) => setOvScale(e.target.value)}
              />
            </label>
          </div>
          <p className="adv-hint">
            RATE·DURATION 은 프로파일 기본값을 덮어씀. SCALE 은 시드 볼륨(0.01~1, 디버그용). 빈칸이면
            프리셋→프로파일 기본값 순 폴백.
          </p>
          {rampingOverride && (
            <p className="adv-warn">
              ⚠ 계단형(ramping) 프로파일 — RATE/DURATION override 는 smoke·load 같은 constant
              프로파일에 적용됩니다.
            </p>
          )}
        </div>
      )}

      <div className="run-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={updateBaseline}
            onChange={(e) => setUpdateBaseline(e.target.checked)}
          />
          PASS 시 baseline 승격 PR
        </label>
        <button onClick={run} disabled={state === 'busy'}>
          {state === 'busy' ? '요청 중…' : '실행 ▶'}
        </button>
      </div>
      {state === 'ok' && <p className="ok">디스패치 완료 — 잠시 후 히스토리에 나타납니다.</p>}
      {state === 'err' && <p className="err">실패: {err} (PAT 권한: actions rw 필요)</p>}
    </section>
  );
}
