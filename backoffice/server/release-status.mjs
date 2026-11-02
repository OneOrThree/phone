// 앱 출시 전에 "운영 서버에 아직 없는 서버 변경이 main 에 있는가"를 판정한다(GROMO-2684).
// GitHub 공개 API 만 쓴다. 저장소가 공개라 토큰이 없고, 운영자 토큰이 나갈 길도 없다(Upstream.request 를 쓰지 않는다).
const REPO = "OneOrThree/phone";
const API = `https://api.github.com/repos/${REPO}`;
const WEB = `https://github.com/${REPO}/`;
// 서버 실행 코드 정규식. .github/scripts/app-server-gate.py 의 SERVER_RUNTIME 과 같이 고쳐야 한다.
export const SERVER_RUNTIME = /^server\/(business-api|data-api|realtime|notification)\/src\/main\//;
// compare 응답의 files 는 per_page 와 무관하게 최대 300개다(실측: per_page=1·30·100 모두 300).
const FILE_LIMIT = 300;
const TTL = 10 * 60000;
const UNITS = {
  server: ["prod-cd-V2.yml", "catus-v"],
  backoffice: ["backoffice-cd.prod-V2.yml", "backoffice-v"],
  kafka: ["kafka-cd.prod-V2.yml", "kafka-v"],
  redis: ["redis-cd.prod-V2.yml", "redis-v"],
};
const SHA = /^[0-9a-f]{7,40}$/;
const link = url => (typeof url === "string" && url.startsWith(WEB) ? url : null);

// 순수 판정. compare 는 GitHub compare 응답(JSON) 또는 null.
export function releaseVerdict(serverVersion, compare) {
  if (typeof serverVersion !== "string" || !SHA.test(serverVersion)) return { status: "unknown" };
  if (!compare || !Number.isInteger(compare.ahead_by)) return { status: "unknown" };
  const files = Array.isArray(compare.files) ? compare.files : compare.ahead_by === 0 ? [] : null;
  if (!files) return { status: "unknown" };
  const aheadBy = compare.ahead_by;
  const compareUrl = link(compare.html_url) ?? `${WEB}compare/${serverVersion}...main`;
  const changed = files.filter(file => SERVER_RUNTIME.test(String(file?.filename ?? "")));
  if (changed.length) return { status: "server-first", changedFiles: changed.length, aheadBy, compareUrl };
  // 잘린 목록이면 못 본 파일에 서버 코드가 있을 수 있다.
  if (files.length >= FILE_LIMIT) return { status: "unknown" };
  return { status: "ship", changedFiles: 0, aheadBy, compareUrl };
}

// 갱신 한 번의 호출 수 = compare 1 + runs 4 + tags 1 = 6회. 10분 캐시라 시간당 최대 36회로,
// 미인증 한도(IP 당 시간당 60회) 안이다. 실패 결과도 같은 시간 보관해 장애 때 한도를 쓰지 않는다.
export function createReleaseStatus({ fetchImpl = fetch, androidStoreVersion, now = Date.now }) {
  const get = async path => {
    const response = await fetchImpl(API + path, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "catus-backoffice" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const attempt = async work => { try { return await work(); } catch { return null; } };

  async function refresh(serverVersion) {
    const valid = typeof serverVersion === "string" && SHA.test(serverVersion);
    const [compare, tags, android, ...runs] = await Promise.all([
      // 커밋 목록은 쓰지 않으므로 per_page=1 로 응답을 줄인다(files 는 어차피 300개).
      valid ? attempt(() => get(`/compare/${serverVersion}...main?per_page=1`)) : null,
      attempt(() => get("/tags?per_page=100")),
      attempt(() => androidStoreVersion?.()),
      ...Object.values(UNITS).map(([file]) =>
        attempt(() => get(`/actions/workflows/${file}/runs?status=success&per_page=1`))),
    ]);
    const tagOf = (sha, prefix) => Array.isArray(tags) && typeof sha === "string"
      ? tags.find(tag => tag?.name?.startsWith(prefix) && tag.commit?.sha === sha)?.name ?? null : null;
    const units = {};
    Object.entries(UNITS).forEach(([name, [, prefix]], index) => {
      const run = runs[index]?.workflow_runs?.[0];
      if (!run || typeof run.head_sha !== "string") { units[name] = null; return; }
      // 서버는 롤백이면 head_sha 가 실제 실행 커밋이 아니므로 /api 가 알려 준 serverVersion 으로 찾는다.
      // ponytail: backoffice·kafka·redis 는 head_sha 기준이라 롤백 실행 뒤에는 태그가 틀릴 수 있다.
      // 정확한 값은 각 배포의 current 기록(S3)이지만 AWS 권한이 필요하다.
      const commit = name === "server" && valid ? serverVersion : run.head_sha;
      units[name] = {
        commit, tag: tagOf(commit, prefix), runUrl: link(run.html_url),
        deployedAt: run.run_started_at ?? run.created_at ?? null,
      };
    });
    return { local: false, verdict: releaseVerdict(serverVersion, compare), units, androidStore: android };
  }

  const cache = new Map();
  return async serverVersion => {
    const key = serverVersion ?? "";
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL) return hit.result;
    if (cache.size > 8) cache.clear();
    const entry = { at: now(), result: refresh(serverVersion ?? null) };
    cache.set(key, entry);
    entry.result = await entry.result;
    return entry.result;
  };
}
