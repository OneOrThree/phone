#!/usr/bin/env node
// k6/scenarios/defs/*.json → dashboard/public/scenarios.json (대시보드 시나리오 목록·상세 표시용).
// 시나리오는 제가(개발자) 저작하는 데이터 파일. 새 시나리오 = defs/ 에 JSON 추가 후 이 스크립트 실행.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFS = join(HERE, '../k6/scenarios/defs');
const OUT = join(HERE, '../dashboard/public/scenarios.json');

const defs = readdirSync(DEFS)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DEFS, f), 'utf8')));

writeFileSync(OUT, JSON.stringify(defs, null, 2));
console.log(`[gen-scenarios] ${defs.length} 시나리오 → dashboard/public/scenarios.json (${defs.map((d) => d.id).join(', ')})`);
