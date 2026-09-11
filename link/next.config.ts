import type { NextConfig } from 'next';

/**
 * 링크 서버는 phone 모노레포 바깥의 독립 프로젝트다 — 이 폴더가 곧 레포 루트다.
 * phone 쪽 코드를 import 하거나 빌드 의존으로 삼지 않는다(추출 시 그대로 깨진다).
 */
const nextConfig: NextConfig = {
  // 랜딩·매치·내부 API 전부 Node 런타임이 필요하다: Postgres 커넥션을 잡고
  // `SELECT … FOR UPDATE SKIP LOCKED` 를 같은 세션에서 돌려야 하기 때문이다(Edge 런타임 불가).
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // AASA 는 Apple CDN 이 캐시하고 전파에 24~48시간이 걸린다 — 응답 헤더도 고정한다.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
};

export default nextConfig;
