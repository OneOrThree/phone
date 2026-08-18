// 그룹 초대 링크 파싱 — 규격 정본은 초대 링크 스펙 §4-1.
// ⚠️ 링크를 읽는 곳은 여기 하나다. 서버(발급·랜딩)와 규격이 어긋나면 초대가 조용히 죽는다.
//
// 받아들이는 3형식(§4-1):
//   1) Universal Link : https://link.oneorthree.world/l/{slug}?g={groupId}
//   2) 커스텀 스킴     : gromo://join?g={groupId}&s={slug}   (랜딩이 앱을 열 때)
//   3) 구형 스킴       : gromo://join?g={groupId}            (s 없음 → slug=null)
//
// **만드는 함수는 더 이상 없다.** 공유 링크는 서버 발급 API(POST /groups/{id}/invite-link)가
// 내려주는 url 만 쓴다 — slug 는 서버 DB 원장(어트리뷰션 앵커)이라 앱이 조립할 수 없다.
// (구 랜딩 https://oneorthree.github.io/phone/join.html 은 실제로 404라 규격에서 제거했다.)

// UL 도메인 프리픽스. 경로까지 포함해 접두어로 판정한다 — 호스트만 비교하면
// link.oneorthree.world.evil.com 같은 접두 충돌 도메인을 받아들이게 된다.
const LINK_BASE = 'https://link.oneorthree.world/l/';

// groupId는 UUID v7 문자열. 버전 자리를 고정하지 않고 UUID 일반 형식만 본다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// slug 허용 형식 — 8자 생성(§2-1)이지만 컬럼은 12자 여유라 8~12자를 받는다.
// 혼동 문자(0/1/o/l/i)를 뺀 알파벳이라 대문자·특수문자는 우리 slug가 아니다.
const SLUG_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{8,12}$/;

// 앱 커스텀 스킴 링크(app.config.js scheme: 'gromo').
// 경로 판정 — 슬래시 수와 끝 슬래시 변형을 함께 받는다.
//   gromo://join?g=… · gromo://join/?g=… · gromo:///join?g=…
// 랜딩은 정확히 gromo://join?g=…&s=… 만 내보내지만, iOS·카톡 인앱 브라우저가 URL을
// 정규화하며 슬래시를 바꾸는 경우가 있어 방어적으로 푼다. 뒤에 ?나 문자열 끝이 와야 하므로
// gromo://joinx 같은 다른 경로는 여전히 걸리지 않는다(league·focus 매핑 침범 없음).
const SCHEME_PATH_RE = /^gromo:\/\/+join\/?(?=\?|$)/i;

// 파싱 결과 — groupId 는 초대의 본체, slug 는 어트리뷰션 파라미터다.
export interface ParsedInviteLink {
  groupId: string;
  slug: string | null;
}

// 쿼리스트링에서 키 하나를 꺼낸다. 손상된 percent-encoding('%', '%zz' 등)은
// decodeURIComponent 가 URIError 를 던진다 — 실행 중 링크 수신(Linking 'url' 콜백)엔 예외
// 경계가 없어 그대로 두면 앱이 죽는다. 그 경우 undefined 를 돌려 호출부가 무시하게 한다.
function readParam(query: string, key: string): string | undefined {
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) !== key) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// slug 정규화 — 형식이 어긋나면 **초대를 죽이지 않고 slug 만 버린다**(§4-1).
// slug 는 어트리뷰션용이고, groupId 만 유효하면 초대 시트는 정상적으로 열려야 한다.
function normalizeSlug(raw: string | undefined): string | null {
  if (!raw) return null;
  return SLUG_RE.test(raw) ? raw : null;
}

// 초대 링크에서 groupId·slug 를 뽑는다.
// 우리 링크가 아니거나 g가 UUID 형식이 아니면 null — 호출부는 조용히 무시한다.
export function parseInviteLink(url: string): ParsedInviteLink | null {
  const trimmed = url.trim();

  const isScheme = SCHEME_PATH_RE.test(trimmed);
  // UL 은 대소문자 혼용으로 정규화될 수 있어 프리픽스만 소문자로 비교한다(경로 slug 는 원문 사용).
  const isLink = trimmed.slice(0, LINK_BASE.length).toLowerCase() === LINK_BASE;
  if (!isScheme && !isLink) return null;

  const q = trimmed.indexOf('?');
  if (q < 0) return null; // g 파라미터가 실릴 자리가 없다
  const query = trimmed.slice(q + 1).split('#')[0];

  const groupId = readParam(query, 'g');
  if (!groupId || !UUID_RE.test(groupId)) return null;

  // slug 출처: UL 은 경로 세그먼트(/l/{slug}), 스킴은 s 파라미터.
  const slug = isLink
    ? normalizeSlug(trimmed.slice(LINK_BASE.length, q))
    : normalizeSlug(readParam(query, 's'));

  return { groupId, slug };
}
