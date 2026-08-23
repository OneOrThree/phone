// 앱별 사용 시간이 **아직 서버로 나가지 않는다**는 것을 잠근다.
//
// ## 왜 타입 파일에 가드가 붙나
//
// 화면은 지금 「기기에서만 처리 · 서버 미전송」이라고 고지한다. 이 고지는 코드가 지키는
// 약속인데, **타입만 있고 호출부가 없는 상태는 컴파일러도 테스트도 지켜주지 않는다.**
// 누군가 나중에 `AppUsageReportRequest` 를 가져다 `api.post` 한 줄만 쓰면 배선이 끝나고,
// 그 순간 화면 고지·개인정보 처리방침·Play 데이터 보안 폼이 전부 어긋난다.
// 그건 단순 버그가 아니라 **허위 고지**다.
//
// 그래서 "아직 아무 데서도 쓰지 않는다"를 테스트로 못박는다. 배선하려면 이 테스트를 지워야
// 하고, 지우려면 아래 세 가지를 확인하게 된다.
//
// ## 이 가드를 지워도 되는 때
//
//   1. 개인정보 처리방침에 '앱별 사용 시간' 수집이 반영됐다
//   2. 앱 내 동의를 받고 있다 (스크린타임 권한 동의와 **별개**다 — 권한은 측정, 이건 전송)
//   3. Play 데이터 보안 폼에 '앱 활동' 수집으로 신고했다
//
// 셋 다 끝났다면 이 파일을 지우고 전송을 배선한다. 하나라도 안 됐으면 지우면 안 된다.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(__dirname, '..', '..');
const APP = join(SRC, '..');
/**
 * 네이티브 소스 — **여기도 전송 주체가 될 수 있다**(코드리뷰 3·4차).
 *
 * 안드로이드는 `app/modules` 의 Kotlin 이 앱별 사용량을 읽고, 앱 자신의 네이티브 코드도
 * `app/android`(MainApplication·위젯 모듈 등)에 있다. iOS 는 `app/ios` 의
 * `screentimereport` 익스텐션(TotalActivityReport.swift)이 이미 앱 이름과 사용 시간을
 * 직접 구성한다. 둘 다 URLSession·HttpURLConnection 으로 바로 쏘면 TS 검사는 전부 통과한다
 * — '전송 자체를 막는다'는 가드가 데이터 발생 지점을 못 지키는 셈이다.
 */
const NATIVE_ROOTS = [join(APP, 'modules'), join(APP, 'ios'), join(APP, 'android')];

/** DTO 정의 파일의 절대 경로(확장자 없음) — 모듈 지정자를 여기에 맞춰 해석한다. */
const DTO_MODULE = join(SRC, 'types', 'dto', 'appUsage');

// 이 파일 자신과 DTO 정의는 당연히 예외다.
const ALLOWED = ['types/dto/appUsage.ts', 'types/dto/appUsage.guard.test.ts'];

/** 예정 엔드포인트의 **경로 조각**. 전체 경로가 아니라 조각으로 보는 이유는 아래 참고. */
const ENDPOINT_SEGMENT = 'app-usage';

/**
 * 훑지 않을 디렉터리 — **생성물과 의존성**(코드리뷰 5차).
 *
 * iOS 개발자가 `pod install` 이나 로컬 빌드를 한 뒤 `npm test` 를 돌리면 이 순회가
 * git 이 추적하지도 않는 수만 개 파일을 읽는다. 느린 것도 문제지만, 의존성 안에 우연히
 * `app-usage` 가 있으면 **우리 코드와 무관하게 테스트가 빨개진다.**
 * (app/jest.config.js 가 `roots: ['<rootDir>/src']` 로 같은 크롤링을 피하는 이유다.)
 */
const SKIP_DIRS = new Set(['Pods', 'build', 'DerivedData', 'node_modules', '.git', 'Frameworks']);

function walk(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.test(full) ? [full] : [];
  });
}

/**
 * 파일 하나에서 **모듈 지정자**와 **문자열 리터럴**을 따로 뽑는다 (코드리뷰 3차).
 *
 * ## 왜 파서인가
 *
 * 원문 정규식 → 주석을 배선으로 오인. 주석 문자열 치환 → 문자열 안의 구분자까지 먹음
 * (`'image/*'` 하나로 가드가 통째로 무력화). 어휘 분석은 파서가 해야 한다.
 *
 * ## 왜 둘을 나누나
 *
 * 앞선 라운드에선 모든 문자열을 한 바구니에 담아 두 검사가 같이 썼는데, 그러면
 * `const example = '@/types/dto/appUsage'` 같은 **예시 문자열 하나로 CI 가 빨개진다.**
 * DTO 검사는 실제 import/export/require 의 지정자만 봐야 한다.
 * 엔드포인트 검사는 반대로 넓어야 한다 — 경로는 어떤 문자열로도 조립될 수 있다.
 */
/**
 * `'a' + 'b'` 처럼 **정적으로만 이어진** 문자열을 하나로 접는다. 변수가 섞이면 null.
 *
 * 이 가드가 노리는 건 '실수로 배선하는 것'이라 여기까지면 충분하다 — 변수까지 따라가려면
 * 타입 검사기와 제어 흐름 분석이 필요하고, 그 정도로 숨기는 사람은 어차피 테스트를 지운다.
 */
function foldConcat(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldConcat(node.left);
    const right = foldConcat(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isParenthesizedExpression(node)) return foldConcat(node.expression);
  return null;
}

function scan(code: string, fileName: string): { specifiers: string[]; literals: string[] } {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false);
  const specifiers: string[] = [];
  const literals: string[] = [];

  const visit = (node: ts.Node): void => {
    // import/export 선언의 모듈 지정자
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    // `import X = require('...')` — 이것도 CallExpression 이 아니라 별도 노드 쌍
    // (ImportEqualsDeclaration + ExternalModuleReference)이라 어느 분기에도 안 걸렸다.
    // 이 구문으로 DTO 를 요청 타입으로 써도 가드가 통과했다(코드리뷰 7차).
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    // `type X = import('...').Y` — 유효한 TS 문법인데 CallExpression 이 아니라 별도 노드다.
    // 이걸 빼면 DTO 를 서비스의 요청 타입으로 그대로 쓰면서도 가드를 통과한다(코드리뷰 4차).
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const lit = node.argument.literal;
      if (ts.isStringLiteral(lit)) specifiers.push(lit.text);
    }
    // 동적 import(...) · require(...)
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const first = node.arguments[0];
      if ((isDynamicImport || isRequire) && first && ts.isStringLiteralLike(first)) {
        specifiers.push(first.text);
      }
    }
    // 정적으로 이어붙인 문자열도 합쳐서 본다(코드리뷰 5차) —
    //   api.post('/screen-time/app-' + 'usage', body)
    // 처럼 조각을 나누면 리터럴 하나하나로는 안 걸린다. 상수 접기는 파서가 안 해 주므로
    // 여기서 직접 한다(`+` 로 이어진 문자열만 — 그 이상은 진짜 평가가 필요하다).
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const folded = foldConcat(node);
      if (folded !== null) literals.push(folded);
    }
    if (
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      literals.push((node as ts.LiteralLikeNode).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, literals };
}

/**
 * 모듈 지정자가 DTO 파일을 가리키는가.
 *
 * 문자열 매칭이 아니라 **경로로 해석해서** 비교한다(코드리뷰 3차) — 같은 폴더에 배럴을 두고
 * `export ... from './appUsage'` 로 재수출하면 지정자에 `dto/appUsage` 가 없어서, 문자열로만
 * 보면 그 배럴을 통해 얼마든지 가져다 쓸 수 있다.
 */
function pointsToDto(specifier: string, fromFile: string): boolean {
  // TypeScript 는 `./appUsage.js` 를 실제 `appUsage.ts` 로 치환한다(코드리뷰 5차).
  // 확장자를 안 벗기면 그 유효한 참조가 검사를 그대로 빠져나간다.
  const bare = specifier.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '');
  if (bare.startsWith('.')) {
    return resolve(dirname(fromFile), bare) === DTO_MODULE;
  }
  // 앨리어스 경로(@/…)는 src 기준이다(tsconfig paths 와 같은 규칙).
  if (bare.startsWith('@/')) return join(SRC, bare.slice(2)) === DTO_MODULE;
  return false;
}

/**
 * 검사 대상 소스.
 *
 * `app/src` 아래에 더해 **앱 진입점과 런타임 설정**도 본다 — package.json 의 main 인
 * `app/index.ts`(코드리뷰 6차), 그리고 앱이 `Constants.expoConfig` 로 읽는 `app.config.js`
 * 같은 저장소 밖 설정(코드리뷰 10차).
 *
 * @param allowed 자기 참조 제외 목록. **엔드포인트 검사에는 비워서 넘긴다** — DTO 파일 안에
 *   `reportAppUsage()` 를 같이 넣어 버리면 그 파일이 제외돼 전송까지 통과한다(코드리뷰 6차).
 *   DTO 정의 파일은 '자기 자신을 import 했나' 검사에서만 빼면 된다.
 */
function tsSources(
  allowed: string[],
): { rel: string; path: string; scanned: ReturnType<typeof scan> }[] {
  // 앱이 소비하는 **저장소 밖 설정**도 본다(코드리뷰 10차). analytics 가 이미
  // `Constants.expoConfig` 를 런타임에 읽으므로, app.config.js 의 extra 에 경로를 두고
  // `api.post(Constants.expoConfig.extra.…, body)` 로 쓰면 소스엔 문자열이 없어 통과한다.
  const runtimeConfigs = ['index.ts', 'app.config.js', 'app.config.ts', 'app.json'].map((f) =>
    join(APP, f),
  );
  // `.js`·`.jsx` 도 본다(코드리뷰 8차) — Metro 는 그대로 번들에 넣고 package.json 의 lint
  // 대상에도 들어 있다. TS 만 훑으면 `.js` 서비스 하나로 가드를 빠져나간다.
  const files = [
    ...walk(SRC, /\.(ts|tsx|js|jsx)$/),
    ...runtimeConfigs.filter((f) => existsSync(f)),
  ];
  return files
    .filter((f) => !allowed.some((a) => f.endsWith(a.split('/').join(sep))))
    .map((f) => ({
      rel: f.startsWith(SRC) ? f.slice(SRC.length + 1) : f.slice(APP.length + 1),
      path: f,
      scanned: scan(readFileSync(f, 'utf8'), f),
    }));
}

test('앱별 사용 시간 DTO는 아직 어디에서도 쓰이지 않는다 (서버 미전송 고지 보호)', () => {
  const offenders = tsSources(ALLOWED)
    .filter(({ path, scanned }) => scanned.specifiers.some((sp) => pointsToDto(sp, path)))
    .map(({ rel }) => rel);

  expect(offenders).toEqual([]);
});

// DTO 를 안 가져와도 배선은 된다(코드리뷰 반영). 이 저장소엔 본문 객체를 인라인으로 넘기는
// axios 호출이 이미 많아서, `api.post('/screen-time/app-usage', { entries: [...] })` 한 줄이면
// DTO 검사를 그대로 통과한 채 전송이 시작된다. **막으려는 건 타입 사용이 아니라 전송 자체**다.
//
// 전체 경로가 아니라 **조각**(`app-usage`)으로 보는 이유: 경로 상수화만으로 우회된다.
//     const base = '/api/v1/screen-time';
//     api.post(`${base}/app-usage`, body);   // 전체 경로가 한 리터럴에 없다
// 템플릿 꼬리 조각이 `/app-usage` 라 조각으로 보면 그대로 잡힌다.
//
// ⚠️ **네이티브도 본다**(코드리뷰 3차). 앱별 사용량을 실제로 읽는 구현은 Kotlin 에 있고,
//    거기서 HttpURLConnection 으로 바로 쏘면 TS 검사는 전부 통과한다 — '전송 자체를 막는다'는
//    가드가 데이터 발생 지점을 못 지키는 셈이다. Kotlin 은 파서가 없어 원문을 훑는다.
//    주석에 이 경로를 적어도 걸리는데, 그건 받아들인다 — 왜 여기 있는지 한 번 보는 게 낫다.
test('앱별 사용 시간 엔드포인트를 호출하는 코드가 없다 (서버 미전송 고지 보호)', () => {
  // ⚠️ 여기엔 이 테스트 파일만 뺀다 — **DTO 정의 파일은 뺴지 않는다**(코드리뷰 6차).
  //    거기에 reportAppUsage() 를 같이 넣으면 파일째 제외돼 전송이 그대로 통과한다.
  const tsOffenders = tsSources(['types/dto/appUsage.guard.test.ts'])
    .filter(({ scanned }) => scanned.literals.some((l) => l.includes(ENDPOINT_SEGMENT)))
    .map(({ rel }) => rel);

  // ⚠️ **번들 리소스도 본다**(코드리뷰 9차). 안드로이드는 strings.xml 에 경로를 두고
  //    Kotlin 에서 getString(R.string.…) 으로 읽으면, XML 은 검사 밖이고 Kotlin 에도
  //    `app-usage` 문자열이 없어 **실제 전송 코드가 생겨도 둘 다 통과한다.**
  //    iOS 의 plist 도 같은 구조라 함께 넣는다.
  const nativeOffenders = NATIVE_ROOTS.flatMap((root) =>
    walk(root, /\.(kt|java|swift|m|mm|h|xml|plist|json)$/),
  )
    .filter((f) => readFileSync(f, 'utf8').includes(ENDPOINT_SEGMENT))
    .map((f) => f.slice(APP.length + 1));

  expect([...tsOffenders, ...nativeOffenders]).toEqual([]);
});
