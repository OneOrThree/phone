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
 * 가입하지 않고 구경을 떠날 때 한 번 묻는다 — 뗏목 행선지와 방문 지도의 「다시 바다로」(GROMO-2405)가 같이 쓴다.
 * 이미 가입 신청을 낸 사람(join === 'cancel')은 「가입하지 않고 떠나는」 사람이 아니므로 묻지 않는다.
 * membershipStatus 가 아직 'none' 인 프레임에도 확인창의 「취소」가 하단 「신청 취소」와 헷갈리지 않게 한다.
 * 가입할 수 있는 섬이면 취소 자리에 가입 버튼을 둬 떠나는 순간 한 번에 가입하게 한다 — 즉시 가입이면 훅이 구경을
 * 끝내고 홈으로 보내므로 떠나기 동작(action)은 돌리지 않는다. 정원이 찼거나 막혔으면 기본 「취소」다.
 */
export function confirmLeaveVisit(
  e: any,
  s: State,
  visit: { island: { membershipStatus: string } } | null,
  visitorJoin: ReturnType<typeof useVisitorJoin>,
  action: () => void,
) {
  if (
    visit &&
    visit.island.membershipStatus === 'none' &&
    visitorJoin.join !== 'cancel' &&
    !s.visitLeaveAsked
  ) {
    e.dispatch({ type: 'VISIT_LEAVE_ASKED' });
    const canJoin = !visitorJoin.disabled;
    e.confirm(
      t('islandVisit.leaveWithoutJoinTitle'),
      t('islandVisit.leaveWithoutJoinBody'),
      action,
      {
        ok: t('islandVisit.leaveWithoutJoinLeave'),
        ...(canJoin && {
          cancel: visitorJoin.label,
          onCancel: () => void visitorJoin.serverJoin(),
        }),
      },
    );
    return;
  }
  action();
}

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
