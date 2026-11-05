// AWS 대상 부하 금지(2026-10-29 소유자 지시, 영구) 가드. config.js 가 BASE_URL 에 적용한다.
// k6 에는 URL 전역이 없어 정규식으로 호스트를 뽑는다. node 테스트도 읽으므로 .mjs 다.
// 호스트 이름만 본다. AWS 를 가리키는 다른 도메인 별칭이나 IP 직접 지정은 알 수 없다.

// [scheme://][userinfo@]host[:port][/경로] — userinfo 의 마지막 '@' 뒤가 실제 호스트다.
const HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)?(?:[^/?#]*@)?(\[[^\]]*\]|[^/?#:]*)/i;
// 금지 도메인 자신 또는 그 서브도메인. '.' 로 앵커해 notoneorthree.world 는 걸리지 않는다.
const AWS_HOST = /(?:^|\.)(?:oneorthree\.world|amazonaws\.com|cloudfront\.net)$/;

function hostOf(url) {
  const match = HOST.exec(String(url).trim());
  return match ? match[1].toLowerCase().replace(/\.+$/, '') : '';
}

export function assertNotAwsTarget(url) {
  const host = hostOf(url);
  if (AWS_HOST.test(host)) throw new Error(`AWS 대상 부하 금지(2026-10-29): ${host}`);
  return url;
}
