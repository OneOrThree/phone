import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Manifest } from '../contracts';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const buildScript = path.join(repoRoot, 'scripts/assets-cdn/build.mjs');
// build.mjs 는 ESM 이라 jest(CJS) 안에서 import 할 수 없다 — 별도 node 로 돌려 manifest 만 받는다.
const runner = `
const [buildUrl, repo, out] = process.argv.slice(1);
const { buildRelease } = await import(buildUrl);
const { manifest } = await buildRelease({ repo, out, releaseId: 'jest' });
process.stdout.write(JSON.stringify(manifest));
`;

function build(): string {
  if (!existsSync(buildScript))
    throw new Error(
      `발행기를 찾지 못했다 — 저장소가 이동했거나 앱만 체크아웃된 환경이다 (경로: ${buildScript})`,
    );
  const out = mkdtempSync(path.join(tmpdir(), 'publisher-manifest-'));
  try {
    return execFileSync(
      process.execPath,
      ['--input-type=module', '-e', runner, pathToFileURL(buildScript).href, repoRoot, out],
      { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 },
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

let built: string | undefined;

/**
 * 실제 발행기(scripts/assets-cdn/build.mjs)를 실제 팩 정의(assets-cdn/packs)로 돌려 얻은 manifest.
 * 테스트가 manifest 모양을 손으로 만들면 발행기가 바뀌어도 앱 테스트는 그대로 초록이다 — #1437 이 꾸미기 팩과
 * rig JSON 을 같은 manifest 에 넣었을 때 앱의 parseManifest 가 그것을 거부하게 된 것이 그 사례다.
 * 호출마다 새 사본을 돌려주므로 테스트가 마음대로 고쳐도 된다.
 */
export function buildPublisherManifest(): Manifest {
  built ??= build();
  return JSON.parse(built) as Manifest;
}
