import React, { useEffect, useRef, useState } from 'react';
import { getSession, sessionGeneration } from '@/services/api/session';
import { ApiError } from '@/services/api/client';
import { unknownOutcome } from '@/services/islandCommands';
import { errorTextOr } from '@/i18n';
import type { TelescopeItem } from '@/services/api/telescope';
import {
  arriveFirstVoyage,
  clearFirstVoyageIntent,
  completeFirstVoyage,
  prepareFirstVoyage,
  readFirstVoyage,
  type FirstVoyageIntent,
} from '@/services/firstVoyage';
import { FirstVoyageScene } from './FirstVoyageScene';

/** 첫 대화 망원경과 재실행 뒤 일반 망원경이 같은 설치 단위 체험을 사용한다. */
export function useFirstVoyage(e: any, preview = false) {
  const owner = getSession()?.userId ?? 'local';
  const generation = sessionGeneration();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [intent, setIntent] = useState<FirstVoyageIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const lock = useRef<number | null>(null);
  const mounted = useRef(false);
  const latest = useRef(e);
  latest.current = e;
  useEffect(() => {
    mounted.current = true;
    let live = true;
    setEligible(null);
    setIntent(null);
    setPending(false);
    setError('');
    setUnavailable(false);
    lock.current = null;
    if (e.focusBlockingIntroPreview) setEligible(false);
    else if (preview) setEligible(true);
    else
      readFirstVoyage(owner)
        .then((saved) => {
          if (live && sessionGeneration() === generation) {
            setEligible(saved.eligible);
            setIntent(saved.pending);
          }
        })
        .catch(() => {
          // 저장소를 읽지 못하면 최초 여부를 단정하지 않고 일반 항해를 유지한다.
          if (live) setEligible(false);
        });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [owner, generation, preview, e.focusBlockingIntroPreview]);
  useEffect(() => {
    if (!intent || !e.backOverride) return;
    const block = () => true;
    e.backOverride.current = block;
    return () => {
      if (e.backOverride.current === block) e.backOverride.current = null;
    };
  }, [intent, e.backOverride]);
  const alive = () => mounted.current && sessionGeneration() === generation;
  const start = async (destination: TelescopeItem) => {
    if (lock.current === generation || !eligible) return;
    lock.current = generation;
    setPending(true);
    try {
      const next = preview
        ? { destination, key: 'preview' }
        : await prepareFirstVoyage(owner, destination);
      if (alive()) {
        setIntent(next);
        setError('');
      }
    } catch (thrown) {
      if (alive()) latest.current.notify?.(errorTextOr(thrown, 'errors.GENERIC'));
    } finally {
      if (lock.current === generation) lock.current = null;
      if (alive()) setPending(false);
    }
  };
  const arrive = async () => {
    if (!intent || lock.current === generation || !alive()) return;
    lock.current = generation;
    setPending(true);
    setError('');
    try {
      if (preview) {
        latest.current.onFirstVoyageArrival?.(intent.destination);
        if (!latest.current.onFirstVoyageArrival) latest.current.reset('sea');
        return;
      }
      const result = await arriveFirstVoyage(intent, generation);
      if (!alive()) return;
      const member = result.membershipStatus === 'active';
      if (member) {
        // 도착은 이미 확정됐다. 목록 재조회 실패로 소속 없는 바다 가드에 되돌아가지 않도록 현재 섬을 먼저 맞춘다.
        latest.current.dispatch({
          type: 'ISLAND_SYNC',
          memberships: {
            items: latest.current.state.serverIslands?.memberships ?? [],
            currentIslandId: result.currentIslandId,
            lossReason: null,
          },
        });
        await latest.current.islands.sync().catch(() => {});
      } else await latest.current.islands.visit(result.islandId);
      if (!alive()) return;
      await completeFirstVoyage(owner);
      if (!alive()) return;
      latest.current.dispatch({ type: 'ONBOARDING_STORY', checkpoint: 'done' });
      if (!member) latest.current.dispatch({ type: 'SERVER_VISITING', islandId: result.islandId });
      // 첫 항해 체험이 무인도에 도착했으면 이번에 새 섬이 생겼다 — 홈에서 이름 짓기 모달을 띄운다(GROMO-2649).
      // 일반 바다 항해는 finish 의 createdIsland 로 같은 모달을 띄운다(SeaVoyageHost).
      if (member && intent.destination.slot === 'uninhabited' && result.currentIslandId)
        latest.current.dispatch({ type: 'ISLAND_NAMING', islandId: result.currentIslandId });
      latest.current.reset(member ? 'home' : 'visitIsland', member ? undefined : result.islandId);
    } catch (thrown) {
      if (!alive()) return;
      const code = (thrown as { code?: string }).code;
      // 결과 불명인 HTTP 400도 있으므로 retryable 하나로 의도를 버리면 무인도를 중복 생성할 수 있다.
      setUnavailable(
        thrown instanceof ApiError &&
          thrown.status >= 400 &&
          thrown.status < 500 &&
          !thrown.retryable &&
          !unknownOutcome(thrown),
      );
      if (code === 'STATE_CONFLICT') {
        const route = await latest.current.focus?.recover().catch(() => null);
        if (alive() && route) {
          latest.current.reset(route);
          return;
        }
      }
      setError(errorTextOr(thrown, 'openSea.retry'));
    } finally {
      if (lock.current === generation) lock.current = null;
      if (alive()) setPending(false);
    }
  };
  const chooseAgain = async () => {
    await clearFirstVoyageIntent(owner);
    if (alive()) {
      setIntent(null);
      setError('');
      setUnavailable(false);
    }
  };
  const scene = intent ? (
    <FirstVoyageScene
      key={`${generation}:${intent.key}`}
      self={{
        userId: owner,
        name: e.state.name,
        color: e.state.color,
        outfit: e.state.equipped,
        focusing: true,
        activeSeconds: 0,
      }}
      destination={intent.destination.name}
      onArrive={arrive}
      pending={pending}
      error={error}
      onChooseAgain={unavailable ? chooseAgain : undefined}
    />
  ) : null;
  return { eligible, pending, start, scene };
}
