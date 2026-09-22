// RN과 SwiftUI 리포트가 같은 2.0 색상 정본을 사용한다.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/design-system/tokens.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const tokens = { exports: {} };
new Function('exports', 'module', compiled)(tokens.exports, tokens);
const { semanticTokens: semantic, primitiveTokens: primitive } = tokens.exports;
const colors = {
  bg: semantic.color.canvas,
  surface: semantic.color.surface,
  ink: semantic.color.text,
  inkSub: semantic.color.textMuted,
  inkMuted: semantic.color.textMuted,
  border: semantic.color.outline,
  divider: semantic.color.divider,
  track: primitive.color.progressTrack,
  accent: semantic.color.primary,
  accentAlt: semantic.color.danger,
  dangerInk: primitive.color.dangerInk,
};
const lines = Object.entries(colors).map(([name, hex]) => {
  const components = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  return `    static let ${name} = Color(.sRGB, red: ${components[0]}.0 / 255, green: ${components[1]}.0 / 255, blue: ${components[2]}.0 / 255, opacity: ${alpha}.0 / 255)`;
});
const output = `// scripts/generate-report-palette.cjs로 생성. 정본: src/design-system/tokens.ts\nimport SwiftUI\n\nenum Palette {\n${lines.join('\n')}\n}\n`;
const target = path.join(root, 'ios/Shared/ReportPalette.swift');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) {
    console.error('리포트 팔레트가 토큰과 다릅니다. npm run gen:report-palette를 실행하세요.');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(target, output);
}
