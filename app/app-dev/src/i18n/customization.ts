import { t } from '@/i18n';

/** 카탈로그 캐시는 원문을 유지하고, 화면을 그릴 때 현재 언어로 이름을 고른다. */
export function customizationTitle(productId: string, fallback: string): string {
  if (!productId.startsWith('cust.')) return fallback;
  const key = `customization.items.${productId.slice('cust.'.length)}`;
  const title = t(key);
  // 앱보다 먼저 추가된 상품은 서버 제목을 보존한다.
  return title === key ? fallback : title;
}
