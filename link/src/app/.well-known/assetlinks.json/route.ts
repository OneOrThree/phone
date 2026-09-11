import { optional } from '@/lib/env';

export const dynamic = 'force-dynamic';
export function GET() {
  const fingerprints = optional('ANDROID_SHA256_FINGERPRINTS')?.split(',').map(value => value.trim());
  const packageName = optional('ANDROID_PACKAGE_NAME');
  // 현행에는 없던 파일이다. 실제 배포 서명이 확인되기 전 가짜 지문을 발급하지 않는다.
  if (!fingerprints?.length || !packageName) return new Response(null, { status: 404 });
  if (!fingerprints.every(value => /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value))) {
    return Response.json({ code: 'INVALID_ANDROID_ASSOCIATION_CONFIG' }, { status: 503 });
  }
  return Response.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: {
    namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints,
  } }]);
}
