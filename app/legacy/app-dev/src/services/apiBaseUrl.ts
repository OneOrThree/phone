export const DEV_API_URL = 'https://oneorthree.dev.mooo.com';
export const LOCAL_WEB_API_URL = 'http://localhost:8080';

export function resolveApiUrl(
  platform: string,
  configuredUrl: string | undefined,
  development: boolean,
): string {
  if (platform === 'web') return development ? LOCAL_WEB_API_URL : DEV_API_URL;
  return configuredUrl ?? DEV_API_URL;
}
