const path = require('node:path');

if (process.env.EXPO_NO_DOTENV === '') delete process.env.EXPO_NO_DOTENV;
require('@expo/env').load(path.resolve(__dirname, '..'), { silent: true });
process.stdout.write(
  JSON.stringify({
    clientToken: process.env.META_CLIENT_TOKEN?.trim() || '',
    devEnabled: process.env.META_DEV_ENABLED === '1',
  }),
);
