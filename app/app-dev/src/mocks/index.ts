import { AxiosError } from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { findHandler } from './handlers';

// 개발용 API 목킹 — .env 에 EXPO_PUBLIC_USE_MOCK=true 를 켠 dev 빌드에서만 api.ts 가 호출한다.
// axios 어댑터(네트워크 직전 단계)에서 가로채므로 인터셉터(JWT 주입·401 갱신)와 서비스 레이어는
// 실제와 동일하게 탄다. 가짜 세션이 실서버 401을 받아 전역 로그아웃되지 않도록, 등록되지 않은
// 요청은 네트워크로 보내지 않고 로컬 오류로 즉시 드러낸다.

const MOCK_DELAY_MS = 300; // 네트워크 지연 재현 — 로딩 상태 UI 확인용

export function enableApiMocks(instance: AxiosInstance): void {
  instance.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const handler = findHandler(config.method ?? 'get', config.url ?? '');
    if (!handler) {
      throw new AxiosError(
        `[mock] Unhandled ${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`,
        'ERR_MOCK_HANDLER_MISSING',
        config,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    console.log(`[mock] ${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`);
    const status = handler.status ?? 200;
    return {
      data: handler.respond(config),
      status,
      statusText: status === 204 ? 'No Content' : 'OK',
      headers: {},
      config,
    };
  };
}
