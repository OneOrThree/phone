// 웹 출처에서만 앱의 공개 API·WebSocket을 연결한다. 인증은 기존 서버가 담당한다.
const ORIGIN = 'https://try.oneorthree.world';
const UPSTREAM = 'https://catus-api-v2.oneorthree.world';
const PREFIX = '/service-api';
const PUBLIC_PATH =
  /^\/(auth|me|screens|islands|invitations|focus-sessions|friends|blocks|letters|rankings|customization|l|assets|static)(\/|\?|$)/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const websocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const write = !['GET', 'HEAD'].includes(request.method);
    if (url.origin !== ORIGIN || !url.pathname.startsWith(PREFIX + '/'))
      return new Response('Not found', { status: 404 });
    if (
      (origin && origin !== ORIGIN) ||
      ((websocket || write) && origin !== ORIGIN) ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site'
    )
      return new Response('Forbidden origin', { status: 403 });

    const path = url.pathname.slice(PREFIX.length);
    if (path.includes('%') || path.includes('\\') || path.includes('//'))
      return new Response('Invalid path', { status: 400 });
    if (websocket ? path !== '/ws/realtime' : !PUBLIC_PATH.test(path))
      return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
      return new Response('Method not allowed', { status: 405 });

    const upstream = new Request(UPSTREAM + path + url.search, request);
    const headers = upstream.headers;
    headers.delete('Cookie');
    headers.delete('Host');
    headers.delete('Referer');
    // 브라우저 출처는 위에서 검증했다. upstream에는 프록시 대상의 출처를 전한다.
    headers.set('Origin', UPSTREAM);
    const response = await fetch(upstream, { redirect: 'manual' });
    if (response.status === 101) return response;
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('X-Content-Type-Options', 'nosniff');
    result.headers.delete('Set-Cookie');
    result.headers.delete('Access-Control-Allow-Origin');
    return result;
  },
};
