const path = require('node:path');

// Gradle 데몬이 제거된 환경 변수를 빈 문자열로 전달할 수 있다.
if (process.env.EXPO_NO_DOTENV === '') delete process.env.EXPO_NO_DOTENV;

// @expo/env는 Expo가 사용하는 .env 우선순위를 적용하고 이미 설정된 CI 환경 변수를 보존한다.
require('@expo/env').load(path.resolve(__dirname, '..'), { silent: true });
const token = process.env.AIRBRIDGE_APP_TOKEN?.trim();
process.stdout.write(JSON.stringify({ appToken: token || '' }));
