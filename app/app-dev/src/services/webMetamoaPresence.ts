import { request } from './api/client';
import { getAccessToken } from './api/session';
import { isPublicWebDemo } from './demoMode';

/** 서버 인증이 성공한 웹 접속만 집계한다. 계측 테스트·자동화 브라우저는 보내지 않는다. */
export function startWebMetamoaPresence(): () => void {
  if (!isPublicWebDemo() || typeof window === 'undefined') return () => {};
  try {
    const top = window.parent.location.origin === window.location.origin ? window.parent : window;
    if (
      navigator.webdriver ||
      new URL(top.location.href).searchParams.get('analytics_test') === '1'
    )
      return () => {};
  } catch {
    return () => {};
  }
  let pending = false;
  let last = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped || pending || document.hidden || !getAccessToken() || Date.now() - last < 120_000)
      return;
    pending = true;
    last = Date.now();
    try {
      await request('/me', { headers: { 'X-Metamoa-Presence': '1' } });
    } catch {
      // 집계 장애는 앱 이용을 막지 않는다. 다음 주기에 다시 확인한다.
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  document.addEventListener('visibilitychange', tick);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}
