// 로그인 상태에서 푸시 알림을 초기화하는 무렌더 컴포넌트.
// 인증 브랜치(UserProvider 안)에 마운트한다 — 게스트(userId=null)는 서버 등록을 스킵하고,
// 로그인/재로그인으로 userId가 정해지면 권한 요청·토큰 등록·리스너 배선을 수행한다.
import { useEffect } from 'react';
import { useUser } from '@/store/UserContext';
import { registerPushToken, setupPushListeners, handleInitialNotification } from '@/services/push';

export function PushGate() {
  const { userId } = useUser();

  useEffect(() => {
    if (!userId) return; // 게스트: 서버 등록 스킵(로그인 후 등록)
    registerPushToken();
    handleInitialNotification();
    return setupPushListeners();
  }, [userId]);

  return null;
}
