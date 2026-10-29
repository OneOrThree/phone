import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyLocalePref } from '@/i18n';
import { customizationTitle } from './customization';

// 공개 보상 카탈로그 90종이 번역에서 빠지거나 다른 상품으로 연결되는 것을 잡는다.
const items = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../../server/scripts/customization/reward-design.json'),
    'utf8',
  ),
).items as { sourceId: string; title: string; category: string }[];

afterEach(() => applyLocalePref('system'));

test('현재 보상 90종은 한국어 원래 이름과 영어 이름을 모두 가진다', () => {
  expect(items).toHaveLength(90);
  for (const item of items) {
    const [category, ...parts] = item.sourceId.split('-');
    const slug = parts.join('-');
    const id = ['head', 'neck', 'shoes'].includes(category)
      ? `cust.${category}.${item.sourceId === 'head-duck' ? 'duck-plush' : slug}`
      : `cust.decor.${item.sourceId}`;
    applyLocalePref('ko');
    expect(customizationTitle(id, 'missing')).toBe(item.title);
    applyLocalePref('en');
    const title = customizationTitle(id, 'missing');
    expect(title).not.toBe('missing');
    expect(title).not.toMatch(/[가-힣]/);
  }
});

test('오리 모자와 오리 인형은 서로 다른 상품 이름을 유지한다', () => {
  applyLocalePref('en');
  expect(customizationTitle('cust.head.duck', '오리 모자')).toBe('Duck Hat');
  expect(customizationTitle('cust.head.duck-plush', '오리 인형')).toBe('Duck Plush');
});

test('캐시된 원문을 바꾸지 않고 현재 언어를 따르며 새 상품은 원문을 보존한다', () => {
  const cached = { id: 'cust.head.peach', title: '복숭아 한 알' };
  applyLocalePref('en');
  expect(customizationTitle(cached.id, cached.title)).toBe('Peach');
  expect(customizationTitle('cust.head.new-season', 'New Season')).toBe('New Season');
  expect(customizationTitle('shop.scarf', '스카프')).toBe('스카프');
  applyLocalePref('ko');
  expect(customizationTitle(cached.id, cached.title)).toBe(cached.title);
  expect(cached.title).toBe('복숭아 한 알');
});
