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
      title="바다 건너 섬"
      onBack={e.back}
      onClose={e.back}
      tall
    >
      {loading ? (
        <Txt>섬 정보를 불러오고 있어요.</Txt>
      ) : (
        data && (
          <>
            <Txt kind="h17">{data.island.name}</Txt>
            <Txt>{data.island.intro}</Txt>
            <Txt kind="meta">{`주민 ${data.island.memberCount}/${data.island.maxMembers}명 · ${joined ? '소속된 섬' : request?.status === 'pending' ? '승인 대기 중' : '방문 중'}`}</Txt>
            <Group>
              {data.members.items.map((member) => (
                <Row key={member.id} title={member.name ?? '주민'} />
              ))}
            </Group>
            {state.onboarded && !joined && (
              <Btn
                title="섬 둘러보기"
                disabled={writing || !!error || !canBrowse}
                onPress={() => {
                  if (state.session) return e.notify('집중이나 휴식을 마친 뒤 섬을 구경해 주세요.');
                  e.dispatch({ type: 'SERVER_VISITING', islandId: id });
                  e.replace('visitIsland', id);
                }}
              />
            )}
            {state.onboarded && !joined && !canBrowse && (
              <Txt kind="meta">섬 모습을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</Txt>
            )}
            {state.onboarded && !joined && request?.status === 'pending' && (
              <Txt kind="meta">
                가입 신청 대기 중이에요. 신청 취소는 이 섬 마을회관에서 할 수 있어요.
              </Txt>
            )}
            {(!state.onboarded || joined) &&
              (request?.status === 'pending' ? (
                <Btn title="가입 신청 확인하기" onPress={() => e.go('approval', id)} />
              ) : (
                <Btn
                  title={
                    writing
                      ? '처리 중이에요'
                      : joined
                        ? '이 섬으로 이동하기'
                        : data.island.approvalRequired
                          ? '가입 신청'
                          : '이 섬에 가입하기'
                  }
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
          <Btn title="다시 불러오기" onPress={() => setReload((value) => value + 1)} />
        </>
      )}
    </IslandSheet>
  );
}
