const fs = require('node:fs');
const path = require('node:path');
const { readAirbridgeBuildConfig } = require('./airbridge-build-config.cjs');

// Xcode에서 직접 빌드할 때도 Debug/Release에 맞는 .env 파일을 선택한다.
const isDebug = process.env.CONFIGURATION === 'Debug';
process.env.NODE_ENV ||= isDebug ? 'development' : 'production';
const config = readAirbridgeBuildConfig();
const output = process.argv[2];
if (!output) throw new Error('Airbridge iOS 빌드 설정 출력 경로가 필요합니다.');
// 실패한 빌드의 이전 토큰 파일이 남지 않게 먼저 제거한다.
fs.rmSync(output, { force: true });
const configured = Boolean(config.appToken && config.appToken !== 'YOUR_APP_TOKEN');
if (!isDebug && !configured) {
  throw new Error('iOS release 차단: catus의 AIRBRIDGE_APP_TOKEN을 설정하세요.');
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify({
    appName: 'catus',
    appToken: config.appToken,
    enabled: configured && !config.demoEnabled && (!isDebug || config.devEnabled),
  }),
);
