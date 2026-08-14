// 라우트 배선 정합 — `types.ts`의 param list 키와 `RootNavigator.tsx`의 `Stack.Screen name` 집합.
//
// 이 둘이 어긋나도 **tsc 는 통과한다.** param list 는 순수 타입이라 실제로 등록된 화면 목록과
// 대조할 방법이 없기 때문이다. 그래서 라우트를 `types.ts`에만 추가하고 navigator 등록을 빠뜨리면
// 컴파일도 테스트도 전부 초록인데 런타임에 "screen doesn't exist" 로 터진다 — GROMO-1588 배선에서
// 실제로 이 구멍을 확인했고(수동 QA 말고는 잡을 방법이 없었다), 그걸 막으려고 만든 파일이다.
//
// 렌더가 없어 빠르다. 대신 **소스 텍스트를 정규식으로 읽는다** — 아래 두 파일의 표기 관례
// (한 줄에 `Name: ...;` / `<Stack.Screen name="Name"`)에 의존한다는 뜻이다.
// 잡는 것: 등록 자체의 누락·오타. 못 잡는 것: `component=`가 엉뚱한 화면을 가리키는 경우.
import { readFileSync } from 'fs';
import { join } from 'path';

const NAV_DIR = join(__dirname);

function read(file: string): string {
  return readFileSync(join(NAV_DIR, file), 'utf8');
}

/** `V2RootStackParamList` 본문에서 라우트 키를 뽑는다. */
function paramListRoutes(): Set<string> {
  const src = read('types.ts');
  const start = src.indexOf('export type V2RootStackParamList = {');
  expect(start).toBeGreaterThan(-1); // 타입 이름이 바뀌면 이 테스트가 조용히 빈 집합을 비교하게 된다

  // 중괄호 깊이로 본문 끝을 찾는다 — 중첩 params 객체({ groupId: string })가 있어 첫 '}' 로는 안 된다.
  const bodyStart = src.indexOf('{', start);
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  expect(bodyEnd).toBeGreaterThan(bodyStart);

  const body = src.slice(bodyStart + 1, bodyEnd);
  const routes = new Set<string>();
  // 최상위 키만 — 줄 시작(들여쓰기 2칸)에 붙은 `Name:` 형태. 중첩 객체 안의 키는 더 깊게 들여쓰여 있다.
  for (const line of body.split('\n')) {
    const m = /^ {2}(\w+)\??:/.exec(line);
    if (m) routes.add(m[1]);
  }
  return routes;
}

/** `RootNavigator.tsx`의 `<Stack.Screen name="...">` 을 뽑는다. */
function registeredRoutes(): Set<string> {
  const src = read('RootNavigator.tsx');
  const routes = new Set<string>();
  for (const m of src.matchAll(/<Stack\.Screen\s+name="(\w+)"/g)) routes.add(m[1]);
  return routes;
}

describe('라우트 배선 정합 (types.ts ↔ RootNavigator.tsx)', () => {
  // 정규식이 아무것도 못 뽑으면 아래 비교가 전부 공짜로 통과한다 — 먼저 잠근다.
  test('양쪽에서 라우트를 실제로 읽어낸다', () => {
    expect(paramListRoutes().size).toBeGreaterThan(10);
    expect(registeredRoutes().size).toBeGreaterThan(10);
  });

  // 이 방향이 이번에 실제로 뚫린 구멍이다 — 타입에만 있고 등록이 없으면 런타임에 터진다.
  test('param list 의 모든 라우트가 navigator 에 등록돼 있다', () => {
    const declared = paramListRoutes();
    const registered = registeredRoutes();

    // 탭 화면은 Tab.Screen 이라 Stack.Screen 정규식에 안 잡힌다 — 별도 관리.
    const TAB_ROUTES = new Set(['Home', 'League', 'Group', 'Menu', 'MainTabs']);

    const missing = [...declared].filter((r) => !registered.has(r) && !TAB_ROUTES.has(r));
    expect(missing).toEqual([]);
  });

  test('navigator 에 등록된 라우트가 전부 param list 에 선언돼 있다', () => {
    const declared = paramListRoutes();
    const undeclaredRoutes = [...registeredRoutes()].filter((r) => !declared.has(r));
    expect(undeclaredRoutes).toEqual([]);
  });

  // 이 기능이 이 파일을 만든 이유다 — 배선이 통째로 빠진 채 머지된 적이 있다.
  test('SettingsInquiry 가 양쪽에 다 있다', () => {
    expect(paramListRoutes().has('SettingsInquiry')).toBe(true);
    expect(registeredRoutes().has('SettingsInquiry')).toBe(true);
  });
});
