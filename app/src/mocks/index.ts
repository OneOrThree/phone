import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { findHandler } from './handlers';

// 개발용 API 목킹 — .env 에 EXPO_PUBLIC_USE_MOCK=true 를 켠 dev 빌드에서만 api.ts 가 호출한다.
// axios 어댑터(네트워크 직전 단계)에서 가로채므로 인터셉터(JWT 주입·401 갱신)와 서비스 레이어는
// 실제와 동일하게 탄다. handlers 에 등록된 요청만 목으로 응답하고, 나머지(로그인 등)는 그대로
// 실서버로 나가는 부분 목킹이다.

const MOCK_DELAY_MS = 300; // 네트워크 지연 재현 — 로딩 상태 UI 확인용

const passthrough = axios.getAdapter(axios.defaults.adapter);

export function enableApiMocks(instance: AxiosInstance): void {
  instance.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const handler = findHandler(config.method ?? 'get', config.url ?? '');
    if (!handler) {
      return passthrough(config);
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
