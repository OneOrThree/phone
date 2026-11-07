import { ApiError, uuid } from './api/client';

const MESSAGE = 'cattus-google-login';

export function openGoogleWebLogin(): Promise<string> {
  const state = uuid();
  const nonce = uuid();
  const url = new URL('/google-login.html', window.location.origin);
  url.hash = new URLSearchParams({ state, nonce }).toString();
  const popup = window.open(url.href, '_blank', 'popup,width=480,height=640');
  if (!popup)
    return Promise.reject(
      new ApiError('CLIENT_POPUP_BLOCKED', '팝업을 허용한 뒤 다시 눌러 주세요.', 0),
    );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (token?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', receive);
      window.clearInterval(closed);
      window.clearTimeout(timeout);
      popup.close();
      if (token) resolve(token);
      else reject(error ?? new ApiError('SIGN_IN_CANCELLED', '로그인을 취소했어요.', 0));
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      const data = event.data;
      if (data?.type !== MESSAGE || data.state !== state) return;
      if (typeof data.credential !== 'string') return finish();
      try {
        const encoded = data.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(encoded));
        if (payload.nonce !== nonce) throw new Error('nonce mismatch');
        // 서명·aud·만료 검증은 기존 로그인 API가 수행한다. 자격은 메모리에서만 전달한다.
        finish(data.credential);
      } catch {
        finish(
          undefined,
          new ApiError('CLIENT_LOGIN_RESPONSE_INVALID', '다시 로그인해 주세요.', 0),
        );
      }
    };
    window.addEventListener('message', receive);
    const closed = window.setInterval(() => {
      if (popup.closed) finish();
    }, 500);
    const timeout = window.setTimeout(() => finish(), 5 * 60 * 1000);
  });
}

export function sendGoogleWebCredential(credential?: string) {
  const state = new URLSearchParams(window.location.hash.slice(1)).get('state');
  if (!state || !window.opener) return;
  window.opener.postMessage({ type: MESSAGE, state, credential }, window.location.origin);
}
