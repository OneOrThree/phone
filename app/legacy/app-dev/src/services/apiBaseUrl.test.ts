import { DEV_API_URL, LOCAL_WEB_API_URL, resolveApiUrl } from './apiBaseUrl';

describe('resolveApiUrl', () => {
  it('웹 개발 서버는 로컬 API를 사용한다', () => {
    expect(resolveApiUrl('web', 'https://api.production.invalid', true)).toBe(LOCAL_WEB_API_URL);
  });

  it('웹 배포 빌드는 production URL이 주입돼도 dev API를 사용한다', () => {
    expect(resolveApiUrl('web', 'https://api.production.invalid', false)).toBe(DEV_API_URL);
  });

  it('네이티브는 주입된 API URL을 유지한다', () => {
    expect(resolveApiUrl('ios', 'https://api.production.invalid', true)).toBe(
      'https://api.production.invalid',
    );
  });
});
