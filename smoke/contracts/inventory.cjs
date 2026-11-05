#!/usr/bin/env node
// 앱 API 호출을 TypeScript AST로 추출한다. 이 도구는 네트워크 요청을 보내지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let ts;
try { ts = require('typescript'); } catch { ts = require('../../app/app-dev/node_modules/typescript'); }
const root = path.resolve(__dirname, '../..');
function files(dir, suffix) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(path.join(dir, e.name), suffix) : suffix.test(e.name) ? [path.join(dir, e.name)] : []).sort();
}
const canonical = value => value.split('?')[0].replace(/\{[^}]*\}/g, '{}').replace(/\/$/, '') || '/';
function extractApp(names) {
  const program = ts.createProgram(names, { noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve });
  const checker = program.getTypeChecker();
  const endpoints = [], unresolved = [], otherFetches = [];
  function resolve(node, depth = 0) {
    if (!node || depth > 12) return node;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return resolve(node.expression, depth + 1);
    if (ts.isIdentifier(node)) {
      const decl = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (decl?.initializer) return resolve(decl.initializer, depth + 1);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const decl = checker.getSymbolAtLocation(node.expression)?.valueDeclaration;
      const fn = decl?.initializer || decl;
      if (fn && ts.isArrowFunction(fn)) return resolve(fn.body, depth + 1);
    }
    return node;
  }
  function route(node) {
    if (node && ts.isCallExpression(node) && /^(query|qs)$/.test(node.expression.getText())) return '?';
    node = resolve(node);
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isConditionalExpression(node)) {
      const a = route(node.whenTrue), b = route(node.whenFalse);
      return a !== null && b !== null && canonical(a) === canonical(b) ? a : null;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const text = span.expression.getText();
        // 쿼리 구성은 경로 대조에서 제외한다.
        if (text === 'API_URL') value += '';
        else if (/^(query|qs)\(/.test(text)) value += '?';
        else {
          const nested = route(span.expression);
          value += nested !== null && (nested === '' || nested.startsWith('?')) ? nested : '{}';
        }
        value += span.literal.text;
      }
      return value;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = route(node.left), b = route(node.right);
      return a !== null && b !== null ? a + b : null;
    }
    return null;
  }
  // 전개된 객체가 method를 바꾸지 않는다는 사실을 증명할 때만 허용한다.
  function cannotSetMethod(node) {
    node = resolve(node);
    if (node && ts.isConditionalExpression(node)) return cannotSetMethod(node.whenTrue) && cannotSetMethod(node.whenFalse);
    if (!node || !ts.isObjectLiteralExpression(node)) return false;
    return node.properties.every(p => ts.isSpreadAssignment(p) ? cannotSetMethod(p.expression) :
      p.name && !ts.isComputedPropertyName(p.name) && p.name.getText().replace(/['"]/g, '') !== 'method');
  }
  for (const name of names) {
    const source = program.getSourceFile(name);
    if (source.parseDiagnostics.length) {
      unresolved.push({file:path.relative(root,name),line:1,expression:'',reason:'TypeScript 구문 해석 실패'});
    }
    const aliases = new Set();
    source.forEachChild(node => {
      if (ts.isImportDeclaration(node) && /(?:^|\/)client$/.test(node.moduleSpecifier.text)) {
        for (const item of node.importClause?.namedBindings?.elements || []) {
          if ((item.propertyName || item.name).text === 'request') aliases.add(checker.getSymbolAtLocation(item.name));
        }
      }
    });
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const where = { file: path.relative(root, name), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
        if (aliases.has(checker.getSymbolAtLocation(node.expression))) {
          const url = route(node.arguments[0]);
          const options = resolve(node.arguments[1]);
          let method = 'GET';
          if (options) {
            if (!ts.isObjectLiteralExpression(options) || options.properties.some(p => ts.isSpreadAssignment(p) && !cannotSetMethod(p.expression))) method = null;
            else {
              const prop = options.properties.find(p => p.name?.getText().replace(/['"]/g, '') === 'method');
              if (prop) method = route(prop.initializer);
            }
          }
          if (!url?.startsWith('/') || !['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) {
            unresolved.push({ ...where, expression: node.getText(), reason: '경로 또는 HTTP 메서드 정적 해석 필요' });
          } else endpoints.push({ ...where, method, path: canonical(url), expression: node.arguments[0].getText() });
        } else if (node.expression.text === 'fetch') {
          // 공용 request 전송 자체는 제외하고, refresh와 외부 자산 호출은 따로 드러낸다.
          if (node.arguments[0]?.getText().includes('${API_URL}/auth/')) {
            const url = route(node.arguments[0]);
            const options = resolve(node.arguments[1]);
            const method = options?.properties?.find(p => p.name?.getText() === 'method');
            const verb = route(method?.initializer);
            if (url && verb) endpoints.push({...where,method:verb,path:canonical(url),expression:node.arguments[0].getText()});
            else unresolved.push({...where,expression:node.getText(),reason:'직접 인증 호출 해석 실패'});
          } else if (!node.arguments[0]?.getText().includes('${API_URL}${path}'))
            otherFetches.push({ ...where, expression: node.getText(), reason: '공용 request 밖의 호출 — 별도 검토' });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { endpoints, unresolved, otherFetches };
}
function extractServer(names) {
  const endpoints = [], unsupported = [];
  const constants = new Map();
  const business = path.join(root,'server/business-api/src/main/java/com/oneorthree/business');
  if (fs.existsSync(business)) for (const name of files(business, /Credentials\.java$/)) {
    const text = fs.readFileSync(name,'utf8');
    const value = text.match(/(?:public\s+)?static\s+final\s+String\s+PATH\s*=\s*"([^"]+)"/);
    if (value) constants.set(path.basename(name,'.java')+'.PATH', value[1]);
  }
  for (const name of names) {
    const text = fs.readFileSync(name, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const classAt = text.search(/\bclass\s/);
    const prefixText = text.slice(0, classAt);
    const prefixMatch = prefixText.match(/@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?"([^"]*)"\s*\)/);
    if (prefixText.includes('@RequestMapping') && !prefixMatch) unsupported.push({file:path.relative(root,name),annotation:'클래스 RequestMapping 해석 필요'});
    const prefix = prefixMatch?.[1] || '';
    const regex = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(\((?:[^()"']|"(?:\\.|[^"\\])*")*\))?/g;
    let match;
    while ((match = regex.exec(text))) {
      if (match.index < classAt) continue;
      if (match[1] === 'Request') { unsupported.push({file: path.relative(root, name), annotation:match[0]}); continue; }
      const args = match[2] || '';
      const literal = /^(?:\(\s*)(?:(?:value|path)\s*=\s*)?"([^"]*)"/.exec(args);
      const constant = constants.get(args.slice(1,-1).trim());
      const noPath = !args || /^\(\s*(consumes|produces|headers|params)\s*=/.test(args);
      if (args && !literal && !constant && !noPath) { unsupported.push({file: path.relative(root, name), annotation:match[0]}); continue; }
      endpoints.push({ method:match[1].toUpperCase(), path:canonical(prefix + (literal?.[1] || constant || '')), file:path.relative(root,name) });
    }
  }
  return { endpoints, unsupported };
}
function build(repo = root) {
  const appFiles = files(path.join(repo,'app/app-dev/src'), /\.(ts|tsx)$/).filter(f => !/\.(test|spec)\./.test(f));
  const serverFiles = files(path.join(repo,'server/business-api/src/main/java/com/oneorthree/business/api'), /Controller\.java$/);
  const app = extractApp(appFiles), server = extractServer(serverFiles);
  const digest = crypto.createHash('sha256');
  for (const file of [...appFiles,...serverFiles].sort()) digest.update(path.relative(repo,file)).update('\0').update(fs.readFileSync(file)).update('\0');
  const groups = new Map();
  for (const endpoint of app.endpoints) {
    const key = endpoint.method+' '+endpoint.path;
    if (!groups.has(key)) groups.set(key,{method:endpoint.method,path:endpoint.path,sources:[],server:[]});
    groups.get(key).sources.push({file:endpoint.file,line:endpoint.line});
  }
  for (const endpoint of groups.values()) endpoint.server = server.endpoints.filter(e => e.method===endpoint.method && e.path===endpoint.path).map(e=>e.file);
  return { schemaVersion:1, sourceDigest:digest.digest('hex'), endpoints:[...groups.values()].sort((a,b)=>(a.path+a.method).localeCompare(b.path+b.method)), unresolved:app.unresolved, otherFetches:app.otherFetches, unsupportedServer:server.unsupported };
}
if (require.main === module) {
  const out = process.argv[2];
  if (!out) throw new Error('출력 JSON 경로가 필요합니다');
  const report = build();
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(`API ${report.endpoints.length}개 · 미해석 ${report.unresolved.length}개 · 서버 미일치 ${report.endpoints.filter(e=>!e.server.length).length}개`);
}
module.exports = { extractApp, extractServer, canonical, build };
