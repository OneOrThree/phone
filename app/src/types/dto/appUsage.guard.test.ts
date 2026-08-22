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
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(__dirname, '..', '..');

// 이 파일 자신과 DTO 정의는 당연히 예외다.
const ALLOWED = ['types/dto/appUsage.ts', 'types/dto/appUsage.guard.test.ts'];

/** 예정 엔드포인트의 **경로 조각**. 전체 경로가 아니라 조각으로 보는 이유는 아래 참고. */
const ENDPOINT_SEGMENT = 'app-usage';
const DTO_SPECIFIER = /(^|\/)dto\/appUsage$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

/**
 * 파일에서 **문자열로 취급되는 텍스트 조각만** 뽑는다 (코드리뷰 반영).
 *
 * ## 왜 정규식이 아니라 파서인가
 *
 * 처음엔 원문에 정규식을 돌렸다가 주석을 배선으로 오인했고, 다음엔 주석을 문자열 치환으로
 * 걷어냈다가 **문자열 안의 구분자까지 먹었다.** 실제 재현:
 *
 *     const accept = 'image/*';          // 여기서 열린 것으로 오인
 *     api.post('/screen-time/app-usage', body);
 *     \/** JSDoc *\/                       // 여기서 닫힌 것으로 오인 → 사이가 통째로 삭제
 *
 * 정상적인 MIME 문자열 + 문서 주석만으로 가드가 무력화된다. 어휘 분석은 파서가 해야 한다.
 *
 * ## 무엇을 뽑나
 *
 * 문자열 리터럴 · 템플릿 리터럴의 **각 조각** · import/export 의 모듈 지정자.
 * 템플릿 조각을 따로 보는 이유는 경로가 조립되기 때문이다 —
 * `` `${base}/app-usage` `` 의 꼬리 조각이 `/app-usage` 라 그대로 잡힌다.
 * 주석은 AST 노드가 아니므로 자동으로 빠진다.
 */
function stringLiterals(code: string, fileName: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      out.push((node as ts.LiteralLikeNode).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function sources(): { rel: string; literals: string[] }[] {
  return walk(SRC)
    .filter((f) => !ALLOWED.some((a) => f.endsWith(a.split('/').join(sep))))
    .map((f) => ({
      rel: f.slice(SRC.length + 1),
      literals: stringLiterals(readFileSync(f, 'utf8'), f),
    }));
}

test('앱별 사용 시간 DTO는 아직 어디에서도 쓰이지 않는다 (서버 미전송 고지 보호)', () => {
  const offenders = sources()
    .filter(({ literals }) => literals.some((l) => DTO_SPECIFIER.test(l)))
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
// 템플릿 꼬리 조각이 `/app-usage` 라 조각으로 보면 그대로 잡힌다. 적극적 은폐가 아니라
// 평범한 리팩터링으로 뚫리던 구멍이라 이 폭이 맞다.
test('앱별 사용 시간 엔드포인트를 호출하는 코드가 없다 (서버 미전송 고지 보호)', () => {
  const offenders = sources()
    .filter(({ literals }) => literals.some((l) => l.includes(ENDPOINT_SEGMENT)))
    .map(({ rel }) => rel);

  expect(offenders).toEqual([]);
});
