import React, { useEffect, useState } from 'react';
import { t } from '@/i18n';
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
        notify(t('settings.permissions.androidPicker.savedAllowed'));
      } else {
        if (!screenTimeNative?.setAndroidSelection) throw new Error('UNAVAILABLE');
        const result = await screenTimeNative.setAndroidSelection(owner!, selected, all);
        if (!current()) return;
        notify(
          result.pending
            ? t('settings.permissions.androidPicker.savedTomorrow')
            : t('settings.permissions.androidPicker.savedNow'),
        );
        await syncAndroidMeasurement().catch(() => {
          if (current()) notify(t('settings.permissions.androidPicker.syncLater'));
        });
      }
      if (current()) onDone();
    } catch {
      if (current()) notify(t('settings.permissions.androidPicker.saveFailed'));
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <>
        <Txt>{t('settings.permissions.androidPicker.loadFailed')}</Txt>
        <Btn title={t('common.retry')} onPress={() => setReload((n) => n + 1)} />
      </>
    );
  if (!apps) return <Txt>{t('settings.permissions.androidPicker.loading')}</Txt>;
  const filtered = apps.filter((app) =>
    `${app.label} ${app.packageName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Txt kind="section">
        {mode === 'allowed'
          ? t('settings.permissions.sheet.allowedApps')
          : t('settings.permissions.measuredApps.title')}
      </Txt>
      <Txt>
        {mode === 'allowed'
          ? t('settings.permissions.androidPicker.descAllowed')
          : t('settings.permissions.androidPicker.descMeasured')}
      </Txt>
      {mode === 'measured' && (
        <Row
          title={t('settings.permissions.androidPicker.allApps')}
          tail={
            <Toggle
              label={t('settings.permissions.androidPicker.allApps')}
              value={all}
              onChange={setAll}
              disabled={busy}
            />
          }
        />
      )}
      <Field
        label={t('settings.permissions.androidPicker.search')}
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
                label={t('settings.permissions.androidPicker.select', { label: app.label })}
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
      {filtered.length === 0 && (
        <Txt kind="meta">{t('settings.permissions.androidPicker.none')}</Txt>
      )}
      {filtered.length > limit && (
        <Btn
          title={t('settings.permissions.androidPicker.more')}
          kind="ghost"
          onPress={() => setLimit((n) => n + 40)}
        />
      )}
      <Btn
        title={
          busy
            ? t('settings.permissions.androidPicker.saving')
            : t('settings.permissions.androidPicker.save')
        }
        onPress={save}
        disabled={busy || (mode === 'measured' && !all && !selected.length)}
      />
      <Btn
        title={t('settings.permissions.androidPicker.back')}
        kind="ghost"
        onPress={onDone}
        disabled={busy}
      />
    </>
  );
}
