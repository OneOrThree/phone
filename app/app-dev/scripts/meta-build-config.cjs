const path = require('node:path');
const metaApp = require('../src/config/metaApp.json');

if (process.env.EXPO_NO_DOTENV === '') delete process.env.EXPO_NO_DOTENV;
require('@expo/env').load(path.resolve(__dirname, '..'), { silent: true });
process.stdout.write(
  JSON.stringify({
    // CI 변수가 비어 있어도 iOS와 같은 앱의 공개 Client Token을 사용한다.
    clientToken: process.env.META_CLIENT_TOKEN?.trim() || metaApp.clientToken,
    devEnabled: process.env.META_DEV_ENABLED === '1',
  }),
);
