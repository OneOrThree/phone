// 앱 출시 전에 "운영 서버에 아직 없는 서버 변경이 main 에 있는가"를 판정한다(GROMO-2684).
// GitHub 공개 API 만 쓴다. 저장소가 공개라 토큰이 없고, 운영자 토큰이 나갈 길도 없다(Upstream.request 를 쓰지 않는다).
const REPO = "OneOrThree/phone";
const API = `https://api.github.com/repos/${REPO}`;
const WEB = `https://github.com/${REPO}/`;
// 서버 실행 코드 정규식. .github/scripts/app-server-gate.py 의 SERVER_RUNTIME 과 같이 고쳐야 한다.
export const SERVER_RUNTIME = /^server\/(business-api|data-api|realtime|notification)\/src\/main\//;
// compare 응답의 files 는 per_page 와 무관하게 최대 300개다(실측: per_page=1·30·100 모두 300). per_page 는 커밋 목록만 나눈다.
const FILE_LIMIT = 300;
const TTL = 10 * 60000;
const UNITS = {
  server: ["prod-cd-V2.yml", "catus-v"],
  backoffice: ["backoffice-cd.prod-V2.yml", "backoffice-v"],
  kafka: ["kafka-cd.prod-V2.yml", "kafka-v"],
  redis: ["redis-cd.prod-V2.yml", "redis-v"],
};
const SHA = /^[0-9a-f]{7,40}$/;
// CD 의 record 단계가 성공 배포마다 이 브랜치에 배포 태그를 message 로 기록한다(정본). raw 주소는 API 한도에 잡히지 않는다.
const RECORD = role => `https://raw.githubusercontent.com/${REPO}/deployment-status/prod-V2/${role}.json`;
const ROLE = { server: "app", backoffice: "backoffice", kafka: "kafka", redis: "redis" };
// github.com 의 이 저장소 경로만 통과시킨다. ".." 등은 URL 파싱이 정규화하므로 접두사 검사에서 걸러진다.
const link = url => {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://github.com" && parsed.pathname.startsWith(`/${REPO}/`) ? parsed.href : null;
  } catch { return null; }
};

// 순수 판정. compare 는 GitHub compare 응답(JSON) 또는 null.
export function releaseVerdict(serverVersion, compare) {
  if (typeof serverVersion !== "string" || !SHA.test(serverVersion)) return { status: "unknown" };
  if (!compare || !Number.isInteger(compare.ahead_by)) return { status: "unknown" };
  const files = Array.isArray(compare.files) ? compare.files : compare.ahead_by === 0 ? [] : null;
  if (!files) return { status: "unknown" };
  const aheadBy = compare.ahead_by;
  const compareUrl = link(compare.html_url) ?? `${WEB}compare/${serverVersion}...main`;
  // 이름이 바뀐 파일은 옛 경로(previous_filename)도 본다 — 서버 밖으로 옮겨진 서버 코드도 운영과 다르다.
  const touches = name => typeof name === "string" && SERVER_RUNTIME.test(name);
  const changed = files.filter(file => touches(file?.filename) || touches(file?.previous_filename));
  if (changed.length) return { status: "server-first", changedFiles: changed.length, aheadBy, compareUrl };
  // 잘린 목록이면 못 본 파일에 서버 코드가 있을 수 있다.
  if (files.length >= FILE_LIMIT) return { status: "unknown" };
  return { status: "ship", changedFiles: 0, aheadBy, compareUrl };
}

// 갱신 한 번의 호출 수(GitHub API 기준) = compare 1 + runs 4 + tags 1 = 6회. 배포 기록 4건은 raw.githubusercontent.com 이라 이 한도에 잡히지 않는다. serverVersion 키가 하나일 때 10분 캐시라 시간당 최대 36회로,
// 미인증 한도(IP 당 시간당 60회) 안이다(키가 바뀌면 그만큼 다시 부른다). 실패 결과도 같은 시간 보관해 장애 때 한도를 쓰지 않는다.
export function createReleaseStatus({ fetchImpl = fetch, androidStoreVersion, now = Date.now }) {
  const get = async path => {
    const response = await fetchImpl(API + path, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "catus-backoffice" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const getRecord = async role => {
    const response = await fetchImpl(RECORD(role), { headers: { "User-Agent": "catus-backoffice" }, redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()).message;
  };
  const attempt = async work => { try { return await work(); } catch { return null; } };

  async function refresh(serverVersion) {
    const valid = typeof serverVersion === "string" && SHA.test(serverVersion);
    const [compare, tags, android, ...rest] = await Promise.all([
      valid ? attempt(() => get(`/compare/${serverVersion}...main`)) : null,
      attempt(() => get("/tags?per_page=100")),
      attempt(() => androidStoreVersion?.()),
      ...Object.values(UNITS).map(([file]) =>
        attempt(() => get(`/actions/workflows/${file}/runs?status=success&per_page=1`))),
      ...Object.keys(UNITS).map(name => attempt(() => getRecord(ROLE[name]))),
    ]);
    const runs = rest.slice(0, 4), records = rest.slice(4);
    const commitOf = tag => Array.isArray(tags) && typeof tag === "string"
      ? tags.find(item => item?.name === tag && typeof item.commit?.sha === "string")?.commit.sha ?? null : null;
    const units = {};
    Object.entries(UNITS).forEach(([name, [, prefix]], index) => {
      const run = runs[index]?.workflow_runs?.[0];
      // 태그는 deployment-status 기록이 정본이다. 형식이 다르거나 못 읽으면 null 이고 head_sha 로 대신하지 않는다.
      const recorded = records[index];
      const tag = typeof recorded === "string" && new RegExp(`^${prefix}\\d+\\.\\d+\\.\\d+-V2$`).test(recorded) ? recorded : null;
      // 서버는 /api 가 알려 준 실행 커밋(serverVersion)을 우선한다.
      const commit = name === "server" && valid ? serverVersion : commitOf(tag);
      if (!tag && !commit && !run) { units[name] = null; return; }
      // 시각·링크는 「마지막 성공 배포 실행」의 값이다(롤백이면 그 실행이 가리키는 커밋과 다를 수 있다).
      units[name] = {
        commit, tag, runUrl: link(run?.html_url),
        deployedAt: run?.run_started_at ?? run?.created_at ?? null,
      };
    });
    return { local: false, checkedAt: new Date(now()).toISOString(), verdict: releaseVerdict(serverVersion, compare), units, androidStore: android };
  }

  const cache = new Map();
  return async serverVersion => {
    const key = serverVersion ?? "";
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL) return hit.result;
    if (cache.size > 8) cache.clear();
    const entry = { at: now(), result: refresh(serverVersion ?? null) };
    cache.set(key, entry);
    // 거부된 promise 가 캐시에 남아 10분간 같은 실패를 돌려주지 않게 한다.
    try { entry.result = await entry.result; } catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }
    return entry.result;
  };
}
