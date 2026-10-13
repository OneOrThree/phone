import React, { useEffect, useState } from 'react';
import { Btn, Field, Group, Row, Toggle, Txt } from '@/design-system/patterns';
import { screenTimeNative, type InstalledApp } from '@/services/ScreenTimeModule';
import { getSession, sessionGeneration } from '@/services/api/session';
import { syncAndroidMeasurement } from '@/services/androidScreenTime';

/** legacy 피커의 측정/허용 모드를 현재 디자인과 계정 경계에 맞춰 사용한다. */
export function AndroidAppPicker({
  mode,
  onDone,
  notify,
}: {
  mode: 'measured' | 'allowed';
  onDone: () => void;
  notify: (message: string) => void;
}) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [generation] = useState(sessionGeneration);
  const [owner] = useState(() => getSession()?.userId);
  const current = () =>
    !!owner && owner === getSession()?.userId && generation === sessionGeneration();
  useEffect(() => {
    let active = true;
    setError(false);
    (async () => {
      if (!owner || !screenTimeNative?.getInstalledApps) throw new Error('UNAVAILABLE');
      await screenTimeNative.bindMeasurementOwner?.(owner);
      const [list, selection, allowed] = await Promise.all([
        screenTimeNative.getInstalledApps(),
        mode === 'measured' ? screenTimeNative.getAndroidSelection?.() : null,
        mode === 'allowed' ? screenTimeNative.getAllowedPackages?.() : null,
      ]);
      if (!active || !current()) return;
      setApps(list);
      setAll(selection?.allApps ?? false);
      setSelected(mode === 'allowed' ? (allowed ?? []) : (selection?.packages ?? []));
    })().catch(() => {
      if (active && current()) setError(true);
    });
    return () => {
      active = false;
    };
  }, [mode, reload, generation]);
  const save = async () => {
    if (busy || !current()) return;
    setBusy(true);
    try {
      if (mode === 'allowed') {
        if (!screenTimeNative?.setAndroidAllowedPackages) throw new Error('UNAVAILABLE');
        await screenTimeNative.setAndroidAllowedPackages(owner!, selected);
        if (!current()) return;
        notify('집중 중 허용 앱을 저장했어요.');
      } else {
        if (!screenTimeNative?.setAndroidSelection) throw new Error('UNAVAILABLE');
        const result = await screenTimeNative.setAndroidSelection(owner!, selected, all);
        if (!current()) return;
        notify(result.pending ? '측정 앱을 내일부터 적용해요.' : '선택한 앱의 측정을 시작했어요.');
        await syncAndroidMeasurement().catch(() => {
          if (current()) notify('앱 선택은 저장했어요. 사용량은 다시 확인할게요.');
        });
      }
      if (current()) onDone();
    } catch {
      if (current()) notify('앱 선택을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <>
        <Txt>설치된 앱 목록을 불러오지 못했어요.</Txt>
        <Btn title="다시 시도" onPress={() => setReload((n) => n + 1)} />
      </>
    );
  if (!apps) return <Txt>앱 목록을 불러오는 중이에요.</Txt>;
  const filtered = apps.filter((app) =>
    `${app.label} ${app.packageName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Txt kind="section">{mode === 'allowed' ? '집중 중 허용 앱' : '측정 앱'}</Txt>
      <Txt>
        {mode === 'allowed'
          ? '선택한 앱은 집중 중에도 사용할 수 있어요. 선택하지 않으면 추가 허용 앱이 없어요.'
          : '최초 선택은 바로, 기존 대상 변경은 다음 날 한국 시각 자정부터 적용해요.'}
      </Txt>
      {mode === 'measured' && (
        <Row
          title="전체 앱 측정"
          tail={<Toggle label="전체 앱 측정" value={all} onChange={setAll} disabled={busy} />}
        />
      )}
      <Field
        label="앱 검색"
        value={query}
        onChange={(value: string) => {
          setQuery(value);
          setLimit(40);
        }}
      />
      <Group>
        {filtered.slice(0, limit).map((app) => (
          <Row
            key={app.packageName}
            title={app.label}
            sub={app.packageName}
            tail={
              <Toggle
                label={`${app.label} 선택`}
                disabled={busy || all}
                value={all || selected.includes(app.packageName)}
                onChange={(checked: boolean) =>
                  setSelected((values) =>
                    checked
                      ? [...new Set([...values, app.packageName])]
                      : values.filter((v) => v !== app.packageName),
                  )
                }
              />
            }
          />
        ))}
      </Group>
      {filtered.length === 0 && <Txt kind="meta">일치하는 앱이 없어요.</Txt>}
      {filtered.length > limit && (
        <Btn title="앱 더 보기" kind="ghost" onPress={() => setLimit((n) => n + 40)} />
      )}
      <Btn
        title={busy ? '저장 중…' : '선택 저장'}
        onPress={save}
        disabled={busy || (mode === 'measured' && !all && !selected.length)}
      />
      <Btn title="돌아가기" kind="ghost" onPress={onDone} disabled={busy} />
    </>
  );
}
