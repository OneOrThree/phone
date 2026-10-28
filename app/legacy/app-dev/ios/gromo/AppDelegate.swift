// SDK 57: 자동 생성 ExpoModulesProvider 가 `internal import Expo` 를 쓰므로
// public 클래스(AppDelegate: ExpoAppDelegate)가 쓰는 이 import 는 접근수준 명시 필요
public import Expo
import FirebaseCore
import RNLine
import RNCKakaoUser
import React
import ReactAppDependencyProvider
import HotUpdater

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Firebase 초기화 (GoogleService-Info.plist 기반). RN 시작 전에 먼저 설정.
    FirebaseApp.configure()

    // 워치 명령 인박스(GROMO-1600) — WCSession delegate를 **RN보다 먼저** 붙인다.
    // RCT 모듈은 브릿지가 JS를 띄우면서 늦게 인스턴스화되는데, 종료 상태에서 WCSession이
    // 앱을 깨우는 경우 명령이 그보다 먼저 도착해 사라진다(docs/prd/apple-watch/ D2-④).
    WatchCommandInbox.shared.activateIfSupported()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
  if(RNCKakaoUserUtil.isKakaoTalkLoginUrl(url)) { return RNCKakaoUserUtil.handleOpen(url) }
    if LineLogin.application(app, open: url, options: options) {
      return true
    }
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    // hot-updater: OTA로 받은 JS 번들이 있으면 그 경로를, 없으면 내장 번들을 반환
    return HotUpdater.bundleURL()
#endif
  }
}
