import { t } from '@/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { IslandSheet } from '@/screens/island/IslandSheet';
import { Btn, Group, Row, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { islandErrorMessage } from '@/services/islandErrors';
import { sessionGeneration } from '@/services/api/session';
import type { createIslandCommands } from '@/services/islandCommands';
import type { Route, State } from '@/services/model';

type Props = {
  mode: 'current' | 'main';
  state: State;
  islands: ReturnType<typeof createIslandCommands>['commands'];
  back: () => void;
  home: () => void;
  reset: (route: Route) => void;
};

export function ServerIslandPicker({ mode, state, islands, back, home, reset }: Props) {
  const currentId = mode === 'main' ? state.mainIslandId : state.serverIslands?.currentIslandId;
  // 직접 행을 고르기 전에는 동기화된 서버 선택을 그대로 따른다.
  const [chosenId, setSelected] = useState<string | null>(null);
  const selected = chosenId ?? currentId ?? '';
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const items = state.serverIslands?.memberships ?? [];
  const target = items.find((item) => item.id === selected);
  const sessionBlocksMove = mode === 'current' && !!state.session && selected !== currentId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    islands
      .sync()
      .catch((thrown) => {
        if (live) setError(islandErrorMessage(thrown));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [islands, reload]);

  const save = async () => {
    if (!target || pending.current || loading || sessionBlocksMove) return;
    pending.current = true;
    setWriting(true);
    setError('');
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    try {
      if (mode === 'main') await islands.setMain(target.id);
      else await islands.switchCurrent(target.id);
      if (alive()) {
        if (mode === 'main') back();
        else reset(state.tutorialEnrollment === 'awaiting-first-island' ? 'guide' : 'home');
      }
    } catch (thrown) {
      if (alive()) setError(islandErrorMessage(thrown, mode === 'current' ? 'tower' : undefined));
    } finally {
      pending.current = false;
      if (alive()) setWriting(false);
    }
  };

  return (
    <IslandSheet
      bg="dock"
      sign="island/whole"
      title={t(mode === 'main' ? 'islandPicker.mainTitle' : 'islandPicker.currentTitle')}
      onBack={back}
      onClose={home}
      tall
    >
      <Txt kind="meta">
        {t(mode === 'main' ? 'islandPicker.mainDescription' : 'islandPicker.currentDescription')}
      </Txt>
      {loading ? (
        <Txt>{t('islandPicker.loading')}</Txt>
      ) : (
        <Group>
          {items.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              sub={`${t('islandPicker.members', { count: item.memberCount, max: item.maxMembers })}${item.id === currentId ? t('islandPicker.currentSuffix') : ''}`}
              selected={selected === item.id}
              disabled={writing}
              tail={<Txt>{selected === item.id ? t('islandPicker.selected') : ''}</Txt>}
              onPress={() => setSelected(item.id)}
            />
          ))}
          {!items.length && <Txt>{t('islandPicker.empty')}</Txt>}
        </Group>
      )}
      {sessionBlocksMove && <Txt kind="meta">{t('islandPicker.sessionBlocksMove')}</Txt>}
      {!!error && (
        <View accessibilityRole="alert" style={{ gap: semanticTokens.spacing.control }}>
          <Txt>{error}</Txt>
          <Btn
            kind="ghost"
            title={t('islandPicker.reload')}
            disabled={writing}
            onPress={() => setReload((value) => value + 1)}
          />
        </View>
      )}
      <Btn
        title={t(
          writing
            ? 'islandPicker.saving'
            : mode === 'main'
              ? 'islandPicker.saveMain'
              : 'islandPicker.enter',
        )}
        disabled={
          loading ||
          writing ||
          !target ||
          sessionBlocksMove ||
          (mode === 'main' && selected === currentId)
        }
        onPress={() => {
          void save();
        }}
      />
    </IslandSheet>
  );
}
