// 번역 키 존재 검사(GROMO-2878) — src 의 t('키')·t(`접두.${…}`) 호출이 ko·en 표에 있는지 본다.
// t() 는 표에 없는 키를 키 문자열 그대로 돌려줘서, 빠진 키는 화면에서만 드러난다. GROMO-2832 가 글자를 키로 바꾸며
// 표에 넣지 않은 shop.tab.*·shop.ordersTab.*·ui.hall.miscellaneousConstruction 이 운영 iOS 2.3.6 에 키 그대로 보였다.
// 변수로 넘긴 키(t(key))는 정적으로 알 수 없어 보지 않는다.
import fs from 'fs';
import path from 'path';
import en from './locales/en.json';
import ko from './locales/ko.json';

const SRC = path.join(__dirname, '..');
const TABLES: Record<string, unknown> = { ko, en };

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });

const nodeAt = (table: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      table,
    );

// 화면에 그릴 값 — ko 문자열 또는 en 복수 객체({ one, other }). 네임스페이스 객체를 t() 로 부르면 키가 그대로 보인다.
const isText = (node: unknown) =>
  typeof node === 'string' ||
  (!!node && typeof node === 'object' && typeof (node as { other?: unknown }).other === 'string');

// t( 바로 앞이 글자·숫자·_·$·점이면 다른 함수다(tForLocale( · i18n.t( · format( 등).
const CALL = /(?<![\w$.])t\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;

type Call = { where: string; key: string; template: boolean };

const calls: Call[] = sourceFiles(SRC).flatMap((file) => {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(CALL)].map((match) => ({
    where: `${path.relative(SRC, file)}:${text.slice(0, match.index).split('\n').length}`,
    key: match[2],
    template: match[1] === '`' && match[2].includes('${'),
  }));
});

const missingIn = (check: (table: unknown) => boolean, call: Call) =>
  Object.entries(TABLES)
    .filter(([, table]) => !check(table))
    .map(([locale]) => `${locale} ${call.where} ${call.key}`);

test('스캔이 호출을 찾는다 — 정규식이 깨져 0개가 되면 아래 검사가 아무것도 안 보고 통과한다', () => {
  expect(calls.filter((call) => !call.template).length).toBeGreaterThan(1500);
  expect(calls.filter((call) => call.template).length).toBeGreaterThan(10);
});

test("t('키') 의 키는 ko·en 표에 그릴 값으로 모두 있다", () => {
  const missing = calls
    .filter((call) => !call.template)
    .flatMap((call) => missingIn((table) => isText(nodeAt(table, call.key)), call));
  expect(missing).toEqual([]);
});

test('t(`접두.${…}`) 의 접두 네임스페이스는 ko·en 표에 객체로 있다', () => {
  const missing = calls
    .filter((call) => call.template)
    .flatMap((call) => {
      const head = call.key.slice(0, call.key.indexOf('${'));
      const namespace = head.slice(0, head.lastIndexOf('.'));
      // `${prefix}.x` 처럼 접두가 없는 키는 정적으로 알 수 없다
      if (!namespace) return [];
      return missingIn((table) => {
        const node = nodeAt(table, namespace);
        return !!node && typeof node === 'object';
      }, call);
    });
  expect(missing).toEqual([]);
});
