// 그룹 초대 링크 생성·파싱 — 명세 docs/app/group-plan.md §5-5.
// ⚠️ 만드는 곳과 읽는 곳을 한 파일로 묶는다. 양쪽 규격이 어긋나면 초대가 조용히 죽는다.

// 랜딩 페이지(§12, GitHub Pages) — 외부(카톡·문자)로 나가는 링크는 항상 이 https 주소다.
// 커스텀 스킴(gromo://)은 랜딩이 앱을 열 때만 쓴다 — 메신저가 링크로 인식하지 않는 경우가 많다.
const WEB_BASE = 'https://oneorthree.github.io/phone/join.html';

// groupId는 UUID v7 문자열. 버전 자리를 고정하지 않고 UUID 일반 형식만 본다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 앱 커스텀 스킴 링크(app.config.js scheme: 'gromo') — 랜딩이 리다이렉트하는 형태.
// 경로 판정 — 슬래시 수와 끝 슬래시 변형을 함께 받는다.
//   gromo://join?g=… · gromo://join/?g=… · gromo:///join?g=…
// 랜딩(§12)은 정확히 gromo://join?g=<uuid>만 내보내지만, iOS·카톡 인앱 브라우저가 URL을
// 정규화하며 슬래시를 바꾸는 경우가 있어 방어적으로 푼다. 뒤에 ?나 문자열 끝이 와야 하므로
// gromo://joinx 같은 다른 경로는 여전히 걸리지 않는다(league·focus 매핑 침범 없음).
const SCHEME_PATH_RE = /^gromo:\/\/+join\/?(?=\?|$)/i;

// 공유용 초대 링크. Share.share·클립보드 복사 모두 이 함수만 쓴다.
export function buildInviteLink(groupId: string): string {
  return `${WEB_BASE}?g=${groupId}`;
}

// gromo://join?g=<uuid> 또는 웹 랜딩 링크에서 groupId를 뽑는다.
// 우리 링크가 아니거나 g가 UUID 형식이 아니면 null — 호출부는 조용히 무시한다(§11 잘못된 링크).
export function parseInviteLink(url: string): string | null {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  // 스킴·호스트·경로가 우리 것인지부터 확인한다(임의 도메인의 ?g= 를 받아들이지 않는다).
  const isScheme = SCHEME_PATH_RE.test(trimmed);
  const isWeb = lower.startsWith(`${WEB_BASE}?`);
  if (!isScheme && !isWeb) return null;

  const query = trimmed.slice(trimmed.indexOf('?') + 1).split('#')[0];
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) !== 'g') continue;
    const raw = decodeURIComponent(part.slice(eq + 1));
    return UUID_RE.test(raw) ? raw : null;
  }
  return null;
}
