import { t } from '@/i18n';
import { useRef, useState } from 'react';
import { Share } from 'react-native';
import { issueInvitation } from '@/services/api/islands';
import { ApiError, uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { isMockMode } from '@/services/demoMode';

/** 발급 응답을 받은 뒤 공유한다. 응답 유실 시 재시도는 같은 멱등 키를 쓴다. */
export function useInviteShare(
  islandId: string,
  islandName: string,
  notify: (message: string) => void,
) {
  const intent = useRef<{ islandId: string; generation: number; key: string } | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (running.current) return;
    if (isMockMode()) {
      notify(t('ui.invite.requiresIsland'));
      return;
    }
    if (!islandId) {
      notify(t('ui.invite.waitForIsland'));
      return;
    }
    const generation = sessionGeneration();
    if (intent.current?.islandId !== islandId || intent.current.generation !== generation)
      intent.current = { islandId, generation, key: uuid() };
    running.current = true;
    setBusy(true);
    try {
      const invitation = await issueInvitation(islandId, intent.current.key);
      if (sessionGeneration() !== generation) return;
      if (!/^https:\/\/[^\s]+$/.test(invitation.url))
        throw new Error('초대 링크 응답이 올바르지 않아요.');
      intent.current = null;
      // Android 공유는 url 필드를 지원하지 않으므로 본문에 링크를 담는다.
      await Share.share({ message: t('ui.invite.share', { v0: islandName, v1: invitation.url }) });
    } catch (error) {
      // 결과가 불명인 오류만 기존 키로 재시도한다. 확정된 거절 뒤에는 새 의도다.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        !['UPSTREAM_TIMEOUT', 'SERVICE_UNAVAILABLE'].includes(error.code)
      )
        intent.current = null;
      if (sessionGeneration() === generation) notify(t('ui.invite.shareFailed'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { share, busy };
}
