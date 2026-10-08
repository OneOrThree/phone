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
  const [selected, setSelected] = useState(currentId ?? '');
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
      title={mode === 'main' ? '내 메인 섬 변경하기' : '현재 섬 변경하기'}
      onBack={back}
      onClose={home}
      tall
    >
      <Txt kind="meta">
        {mode === 'main'
          ? '친구 목록과 프로필에 표시할 섬을 골라 주세요. 현재 접속한 섬은 그대로예요.'
          : '가입한 섬 중 지금 들어갈 섬을 골라 주세요. 대표 섬은 그대로예요.'}
      </Txt>
      {loading ? (
        <Txt>소속 섬을 불러오고 있어요.</Txt>
      ) : (
        <Group>
          {items.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              sub={`주민 ${item.memberCount}/${item.maxMembers}명${item.id === currentId ? ' · 현재 선택된 섬' : ''}`}
              selected={selected === item.id}
              disabled={writing}
              tail={<Txt>{selected === item.id ? '선택됨' : ''}</Txt>}
              onPress={() => setSelected(item.id)}
            />
          ))}
          {!items.length && <Txt>가입한 섬이 없어요.</Txt>}
        </Group>
      )}
      {sessionBlocksMove && <Txt kind="meta">집중이나 휴식을 마친 뒤 섬을 이동해 주세요.</Txt>}
      {!!error && (
        <View accessibilityRole="alert" style={{ gap: semanticTokens.spacing.control }}>
          <Txt>{error}</Txt>
          <Btn
            kind="ghost"
            title="다시 불러오기"
            disabled={writing}
            onPress={() => setReload((value) => value + 1)}
          />
        </View>
      )}
      <Btn
        title={
          writing
            ? '변경 중이에요'
            : mode === 'main'
              ? '대표 섬으로 저장하기'
              : '선택한 섬으로 가기'
        }
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
