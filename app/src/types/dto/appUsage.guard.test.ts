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

const SRC = join(__dirname, '..', '..');

// 이 파일 자신과 DTO 정의는 당연히 예외다.
const ALLOWED = ['types/dto/appUsage.ts', 'types/dto/appUsage.guard.test.ts'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

/**
 * 주석을 걷어낸 소스. 주석 안의 언급은 배선이 아니다(코드리뷰 반영).
 *
 * 이 파일 자신이 "주석에서 이름을 언급하는 건 배선이 아니다"라고 적어 놓고, 정작 원문 전체에
 * 정규식을 돌려 **주석까지 잡고 있었다.** 이 가드를 설명하는 문서 주석 하나로 CI 가 빨개진다.
 *
 * 문자열 리터럴은 걷어내지 않는다 — import 경로 자체가 문자열이라 같이 지우면 검사가 사라진다.
 * 정규식 리터럴(`/.../`)도 건드리지 않는다: 나눗셈과 구분하려면 진짜 파서가 필요한데, 여기서
 * 노리는 건 '실수로 배선하는 것'이지 '적극적으로 숨기는 것'이 아니다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sources(): { rel: string; code: string }[] {
  return walk(SRC)
    .filter((f) => !ALLOWED.some((a) => f.endsWith(a.split('/').join(sep))))
    .map((f) => ({ rel: f.slice(SRC.length + 1), code: stripComments(readFileSync(f, 'utf8')) }));
}

test('앱별 사용 시간 DTO는 아직 어디에서도 쓰이지 않는다 (서버 미전송 고지 보호)', () => {
  const offenders = sources()
    .filter(({ code }) => /from\s+['"][^'"]*dto\/appUsage['"]/.test(code))
    .map(({ rel }) => rel);

  expect(offenders).toEqual([]);
});

// DTO 를 안 가져와도 배선은 된다(코드리뷰 반영). 이 저장소엔 본문 객체를 인라인으로 넘기는
// axios 호출이 이미 많아서, `api.post('/screen-time/app-usage', { entries: [...] })` 한 줄이면
// 위 검사를 그대로 통과한 채 전송이 시작된다. **막으려는 건 타입 사용이 아니라 전송 자체**이므로
// 엔드포인트 경로도 함께 잠근다.
test('앱별 사용 시간 엔드포인트를 호출하는 코드가 없다 (서버 미전송 고지 보호)', () => {
  const offenders = sources()
    .filter(({ code }) => /['"`][^'"`]*screen-time\/app-usage/.test(code))
    .map(({ rel }) => rel);

  expect(offenders).toEqual([]);
});
