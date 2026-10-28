const { withInfoPlist } = require('expo/config-plugins');
const metaApp = require('./src/config/metaApp.json');

// Android Meta SDK는 별도 네이티브 연결(2545)이 담당한다. iOS 설정만 생성한다.
function withIosMeta(config) {
  return withInfoPlist(config, (next) => {
    Object.assign(next.modResults, {
      FacebookAppID: metaApp.appId,
      FacebookClientToken: metaApp.clientToken,
      FacebookDisplayName: metaApp.displayName,
      FacebookAutoInitEnabled: false,
      FacebookAutoLogAppEventsEnabled: false,
      FacebookAdvertiserIDCollectionEnabled: false,
      NSUserTrackingUsageDescription:
        '광고를 통해 앱을 설치한 경로와 광고 효과를 측정하는 데 사용해요.',
    });
    const items = next.modResults.SKAdNetworkItems || [];
    for (const id of ['v9wttpbfk9.skadnetwork', 'n38lu8286q.skadnetwork']) {
      if (!items.some((item) => item.SKAdNetworkIdentifier === id)) {
        items.push({ SKAdNetworkIdentifier: id });
      }
    }
    next.modResults.SKAdNetworkItems = items;
    return next;
  });
}

module.exports = { withIosMeta };
