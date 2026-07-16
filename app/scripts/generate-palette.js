#!/usr/bin/env node
// GROMO-641 팔레트 코드젠 — theme.ts(T)를 단일 소스로 네이티브 Palette.swift를 생성한다.
//
// 사용법 (app/ 에서):
//   npm run gen:palette        # ios/Shared/Palette.swift 재생성
//   npm run gen:palette:check  # 생성물이 theme.ts와 일치하는지 검증 (CI용, 불일치 시 exit 1)
//
// 동작: theme.ts를 TypeScript API로 트랜스파일→평가해 T 객체를 얻고,
// hex 색 토큰(문자열·배열·중첩 객체)만 걸러 Swift enum으로 변환한다.
// text/space 같은 비색상 토큰은 자동 제외된다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const APP_DIR = path.resolve(__dirname, '..');
const THEME_PATH = path.join(APP_DIR, 'src', 'constants', 'theme.ts');
const OUTPUT_PATH = path.join(APP_DIR, 'ios', 'Shared', 'Palette.swift');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// theme.ts를 CommonJS로 트랜스파일해 임시 파일로 저장한 뒤 require해서 T 객체를 얻는다.
function loadTheme(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gromo-palette-'));
  try {
    const tmpFile = path.join(tmpDir, 'theme.cjs');
    fs.writeFileSync(tmpFile, js);
    const { T } = require(tmpFile);
    if (!T) throw new Error('theme.ts에서 T export를 찾지 못했습니다.');
    return T;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// theme.ts 원문에서 `key: '#HEX', // 주석` 형태의 트레일링 주석을 추출한다 (베스트 에포트).
// 키 이름+hex 쌍으로 매칭해서 중첩/중복 hex 간 혼동을 피한다.
function buildCommentMap(source) {
  const map = new Map();
  for (const line of source.split('\n')) {
    const m = line.match(/(\w+):\s*'(#[0-9A-Fa-f]{6})',?\s*\/\/\s*(.+)$/);
    if (m) {
      const key = `${m[1]}:${m[2].toUpperCase()}`;
      if (!map.has(key)) map.set(key, m[3].trim());
    }
  }
  return map;
}

const isHex = (v) => typeof v === 'string' && HEX_RE.test(v);
const isHexArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isHex);

// 색으로만 구성된 값인지 재귀 판정 — text/space처럼 색이 아닌 토큰을 걸러낸다.
function isColorValue(v) {
  if (isHex(v) || isHexArray(v)) return true;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const values = Object.values(v);
    return values.length > 0 && values.every(isColorValue);
  }
  return false;
}

const toSwiftHex = (hex) => `0x${hex.slice(1).toUpperCase()}`;

// T 객체(또는 중첩 객체)를 Swift enum 본문 라인들로 변환한다.
function emitObject(obj, name, indent, comments) {
  const pad = '  '.repeat(indent);
  const lines = [`${pad}enum ${name} {`];
  for (const [key, value] of Object.entries(obj)) {
    if (!isColorValue(value)) continue;
    const inner = '  '.repeat(indent + 1);
    if (isHex(value)) {
      const comment = comments.get(`${key}:${value.toUpperCase()}`);
      const doc = comment ? `${value.toUpperCase()} — ${comment}` : value.toUpperCase();
      lines.push(`${inner}/// ${doc}`);
      lines.push(`${inner}static let ${key} = rgb(${toSwiftHex(value)})`);
    } else if (isHexArray(value)) {
      const items = value.map((hex) => `rgb(${toSwiftHex(hex)})`).join(', ');
      lines.push(`${inner}/// ${value.map((h) => h.toUpperCase()).join(' · ')}`);
      lines.push(`${inner}static let ${key}: [Color] = [${items}]`);
    } else {
      lines.push(...emitObject(value, key, indent + 1, comments));
    }
  }
  lines.push(`${pad}}`);
  return lines;
}

function generateSwift(T, comments) {
  const header = [
    '// ⚠️ 자동 생성 파일 — 직접 수정 금지 (GROMO-641 팔레트 코드젠)',
    '// 단일 소스: app/src/constants/theme.ts 의 T 객체',
    '// 재생성:    app/ 에서 `npm run gen:palette`',
    '// CI 검증:   `npm run gen:palette:check` (불일치 시 실패)',
    '',
    'import SwiftUI',
    '',
    'private func rgb(_ hex: UInt32) -> Color {',
    '  Color(',
    '    red: Double((hex >> 16) & 0xFF) / 255,',
    '    green: Double((hex >> 8) & 0xFF) / 255,',
    '    blue: Double(hex & 0xFF) / 255',
    '  )',
    '}',
    '',
    '// theme.ts의 T와 같은 경로로 참조한다 — 예: T.night.bottom → Palette.night.bottom',
  ];
  return [...header, ...emitObject(T, 'Palette', 0, comments), ''].join('\n');
}

function main() {
  const checkMode = process.argv.includes('--check');
  const source = fs.readFileSync(THEME_PATH, 'utf8');
  const generated = generateSwift(loadTheme(source), buildCommentMap(source));

  if (checkMode) {
    const existing = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
    if (existing !== generated) {
      console.error('✗ ios/Shared/Palette.swift가 theme.ts와 일치하지 않습니다.');
      console.error('  app/ 에서 `npm run gen:palette`를 실행해 재생성 후 커밋하세요.');
      process.exit(1);
    }
    console.log('✓ Palette.swift가 theme.ts와 일치합니다.');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, generated);
  console.log(`✓ 생성 완료: ${path.relative(APP_DIR, OUTPUT_PATH)}`);
}

main();
