import { t } from '@/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { IslandSheet } from '@/screens/island/IslandSheet';
import { Btn, Group, Row, Txt } from '@/design-system/patterns';
import { islandErrorMessage } from '@/services/islandErrors';
import { sessionGeneration } from '@/services/api/session';
import { pendingVisitRequest, type State } from '@/services/model';

/** 방문 공개 DTO만 표시한다. 주민 화면의 현재 섬·시설·지갑을 빌려오지 않는다. */
export function ServerVisit({ e }: { e: any }) {
  const state: State = e.state;
  const id: string = e.detail || state.serverIslands?.visit?.island.id || '';
  const commands = e.islands;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const visit = state.serverIslands?.visit;
  const data = visit?.island.id === id ? visit : null;
  const joined = state.serverIslands?.memberships.some((item) => item.id === id);
  const canBrowse = Array.isArray(data?.buildings);
  const request = pendingVisitRequest(state, id);
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
    commands
      .visit(id)
      .catch((thrown: unknown) => {
        if (live) setError(islandErrorMessage(thrown));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [commands, id, reload]);
  const enter = async () => {
    if (pending.current) return;
    pending.current = true;
    setWriting(true);
    setError('');
    const gen = sessionGeneration();
    try {
      if (joined) await commands.switchCurrent(id);
      else {
        const result = await commands.join(id);
        if (result.status === 'pending') return;
      }
      if (mounted.current && gen === sessionGeneration())
        e.reset(state.tutorialEnrollment === 'awaiting-first-island' ? 'guide' : 'home');
    } catch (thrown) {
      if (mounted.current && gen === sessionGeneration()) setError(islandErrorMessage(thrown));
    } finally {
      pending.current = false;
      if (mounted.current && gen === sessionGeneration()) setWriting(false);
    }
  };
  return (
    <IslandSheet
      bg="tower"
      sign="island/whole"
      title={t('islandVisit.title')}
      onBack={e.back}
      onClose={e.back}
      tall
    >
      {loading ? (
        <Txt>{t('islandVisit.loading')}</Txt>
      ) : (
        data && (
          <>
            <Txt kind="h17">{data.island.name}</Txt>
            <Txt>{data.island.intro}</Txt>
            <Txt kind="meta">
              {t('islandVisit.residents', {
                count: data.island.memberCount,
                max: data.island.maxMembers,
                status: t(
                  joined
                    ? 'islandVisit.joined'
                    : request?.status === 'pending'
                      ? 'islandVisit.pending'
                      : 'islandVisit.visiting',
                ),
              })}
            </Txt>
            <Group>
              {data.members.items.map((member) => (
                <Row key={member.id} title={member.name ?? t('islandVisit.resident')} />
              ))}
            </Group>
            {state.onboarded && !joined && (
              <Btn
                title={t('islandVisit.browse')}
                disabled={writing || !!error || !canBrowse}
                onPress={() => {
                  if (state.session) return e.notify(t('islandVisit.sessionBlocksBrowse'));
                  e.dispatch({ type: 'SERVER_VISITING', islandId: id });
                  e.replace('visitIsland', id);
                }}
              />
            )}
            {state.onboarded && !joined && !canBrowse && (
              <Txt kind="meta">{t('islandVisit.sceneryUnavailable')}</Txt>
            )}
            {state.onboarded && !joined && request?.status === 'pending' && (
              <Txt kind="meta">{t('islandVisit.pendingHint')}</Txt>
            )}
            {(!state.onboarded || joined) &&
              (request?.status === 'pending' ? (
                <Btn title={t('islandVisit.checkRequest')} onPress={() => e.go('approval', id)} />
              ) : (
                <Btn
                  title={t(
                    writing
                      ? 'islandVisit.writing'
                      : joined
                        ? 'islandVisit.enter'
                        : data.island.approvalRequired
                          ? 'islandVisit.requestJoin'
                          : 'islandVisit.join',
                  )}
                  disabled={writing || !!error}
                  onPress={() => {
                    void enter();
                  }}
                />
              ))}
          </>
        )
      )}
      {!!error && (
        <>
          <Txt accessibilityRole="alert">{error}</Txt>
          <Btn title={t('islandVisit.reload')} onPress={() => setReload((value) => value + 1)} />
        </>
      )}
    </IslandSheet>
  );
}
