import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { sessionGeneration } from '@/services/api/session';
import { islandErrorMessage } from '@/services/islandErrors';
import {
  pendingVisitRequest,
  visitorJoinLabel,
  visitorJoinState,
  type Island,
  type State,
} from '@/services/model';

/**
 * 방문자 가입 버튼의 상태와 서버 가입·신청 취소 동작(GROMO-2259) — 회관 방문자 카드와 방문 지도 하단 버튼이 같이 쓴다.
 * 즉시 가입이면 구경을 끝내고 홈으로 간다.
 */
export function useVisitorJoin(e: any, s: State, i: Island, notify: (text: string) => void) {
  const pending = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const join = visitorJoinState(s, i);
  const disabled = busy || join === 'full' || join === 'blocked';
  const label = busy ? t('islandVisit.visitorJoin.busy') : visitorJoinLabel[join];
  const serverJoin = async () => {
    if (pending.current || disabled) return;
    if (s.session) return notify(t('islandVisit.visitorJoin.sessionActive'));
    pending.current = true;
    setBusy(true);
    const generation = sessionGeneration();
    // 즉시 가입의 재조회가 current/방문 상태를 바꿔도, 같은 화면·인증의 성공 처리는 마친다.
    const alive = () => mounted.current && generation === sessionGeneration();
    try {
      if (join === 'cancel') {
        const request = pendingVisitRequest(s, i.id);
        if (!request) return;
        await e.islands.cancel(request.id);
        if (alive()) notify(t('islandVisit.visitorJoin.cancelled'));
      } else {
        const result = await e.islands.join(i.id, { showApproval: false });
        if (!alive()) return;
        if (result.status === 'pending') {
          notify(t('islandVisit.visitorJoin.requested'));
        } else {
          e.dispatch({ type: 'END_VISIT' });
          e.reset('home');
          e.notify(t('islandVisit.visitorJoin.joined', { name: i.name }));
        }
      }
    } catch (error) {
      if (alive()) notify(islandErrorMessage(error));
    } finally {
      pending.current = false;
      if (alive()) setBusy(false);
    }
  };
  return { join, disabled, label, busy, serverJoin };
}
