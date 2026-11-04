// 동일 규칙으로 리팩토링 전후를 비교한다. 후보 목록은 삭제 허가가 아니다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const walk = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
const isTest = (file) => /\.(test|spec|testing)\.[jt]sx?$|\/__fixtures__\//.test(file);
const files = walk(path.join(root, 'src')).filter((file) => /\.[jt]sx?$/.test(file));
const production = files.filter((file) => !isTest(file));
const fileSet = new Set(production);
const options = { baseUrl: root, paths: { '@/*': ['./src/*'] }, allowJs: true };
const graph = new Map();
const metrics = [];
const windows = new Map();
const dynamicImports = [];

for (const file of production) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges = new Set();
  let any = 0;
  let branches = 0;
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) any++;
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCaseClause(node) ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isCatchClause(node)
    )
      branches++;
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      specifier = node.arguments[0];
      if (specifier && !ts.isStringLiteral(specifier)) {
        dynamicImports.push({
          file: relative(file),
          line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      const resolved = ts.resolveModuleName(specifier.text, file, options, ts.sys).resolvedModule;
      if (resolved && fileSet.has(resolved.resolvedFileName)) edges.add(resolved.resolvedFileName);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  graph.set(file, [...edges]);
  const tokens = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source);
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push({ text: scanner.getTokenText(), position: scanner.getTokenPos() });
  }
  // 동일한 100 토큰 창을 1 토큰 간격으로 비교한다. 일반적인 중복률 도구와는 다른 보조 지표다.
  for (let start = 0; start + 100 <= tokens.length; start++) {
    const key = hash(
      tokens
        .slice(start, start + 100)
        .map((token) => token.text)
        .join('\0'),
    );
    const record = {
      file: relative(file),
      line: ast.getLineAndCharacterOfPosition(tokens[start].position).line + 1,
    };
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push(record);
  }
  metrics.push({
    file: relative(file),
    lines: source.split('\n').length - Number(source.endsWith('\n')),
    any,
    branches,
    imports: edges.size,
  });
}

// 강결합 요소: 타입 전용 의존도 포함한다. 런타임 순환과 동일하다고 단정하지 않는다.
let serial = 0;
const indices = new Map(),
  low = new Map(),
  stack = [],
  active = new Set(),
  cycles = [];
function connect(file) {
  indices.set(file, serial);
  low.set(file, serial++);
  stack.push(file);
  active.add(file);
  for (const next of graph.get(file)) {
    if (!indices.has(next)) {
      connect(next);
      low.set(file, Math.min(low.get(file), low.get(next)));
    } else if (active.has(next)) low.set(file, Math.min(low.get(file), indices.get(next)));
  }
  if (low.get(file) !== indices.get(file)) return;
  const component = [];
  let next;
  do {
    next = stack.pop();
    active.delete(next);
    component.push(relative(next));
  } while (next !== file);
  if (component.length > 1) cycles.push(component.sort());
}
for (const file of production) if (!indices.has(file)) connect(file);
const incoming = new Map(production.map((file) => [file, 0]));
for (const edges of graph.values())
  for (const edge of edges) incoming.set(edge, incoming.get(edge) + 1);
const tracked = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const media = tracked.filter(
  (file) =>
    /\.(png|jpe?g|webp|gif|avif|ttf|mp4|m4a|tflite)$/.test(file) &&
    fs.existsSync(path.join(root, file)),
);
const assets = media.map((file) => {
  const bytes = fs.readFileSync(path.join(root, file));
  const result = { file, bytes: bytes.length, sha256: hash(bytes) };
  if (file.endsWith('.png') && bytes.subarray(1, 4).toString() === 'PNG') {
    result.width = bytes.readUInt32BE(16);
    result.height = bytes.readUInt32BE(20);
    result.rgbaBytesEstimate = result.width * result.height * 4;
  }
  return result;
});
const duplicates = [...windows.values()].filter(
  (group) => new Set(group.map((x) => x.file)).size > 1,
);
const result = {
  schema: 1,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  lockfileSha256: hash(fs.readFileSync(path.join(root, 'package-lock.json'))),
  definitions: {
    code: 'src의 JS/TS. test/spec/testing와 __fixtures__ 제외. 번역 코드 포함. 생성 JSON 제외.',
    clones:
      '주석·공백을 제외한 동일한 100 토큰 창(1 토큰 간격)이 서로 다른 파일에 존재하는 수. 중첩 창이 있으므로 코드 중복률이 아님.',
    cycles:
      'import/export/문자열 require를 TypeScript 해석기로 연결한 강결합 요소. 타입 전용 포함.',
    unreferenced:
      'src 내부에서 들어오는 정적 참조가 없는 후보. 앱/네이티브/스크립트 진입점 검증 필요.',
    assets:
      'Git 추적 중인 앱 폴더의 미디어. 원본·플랫폼별 필수 복사본 포함. 번들/설치 크기가 아님.',
  },
  totals: {
    sourceFiles: production.length,
    testFiles: files.length - production.length,
    lines: metrics.reduce((sum, x) => sum + x.lines, 0),
    explicitAny: metrics.reduce((sum, x) => sum + x.any, 0),
    filesOver1000Lines: metrics.filter((x) => x.lines > 1000).length,
    cyclicGroups: cycles.length,
    duplicatedTokenWindows: duplicates.length,
    mediaFiles: assets.length,
    mediaBytes: assets.reduce((sum, x) => sum + x.bytes, 0),
  },
  files: metrics.sort((a, b) => b.lines - a.lines),
  cycles,
  unreferencedCandidates: [...incoming]
    .filter(([, count]) => count === 0)
    .map(([file]) => relative(file)),
  dynamicImports,
  duplicateWindows: duplicates,
  assets,
};
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
