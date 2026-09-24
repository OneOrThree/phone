internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
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

    let didLaunch = super.application(application, didFinishLaunchingWithOptions: launchOptions)
#if DEBUG
    // QA: --gromo-live-preview=focus,black (또는 rest,calico / end) 인자로 실행한다.
    // 릴리스 빌드에서는 제외하며 일반 실행에서는 샘플 활동을 만들지 않는다.
    if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--gromo-live-preview=") }) {
      let parts = argument.replacingOccurrences(of: "--gromo-live-preview=", with: "").split(separator: ",")
      if parts.count == 1 && parts[0] == "end" {
        LiveActivityModule().endAll({ _ in }, rejecter: { _, _, _ in })
      }
      if parts.count == 2 {
        let phase = String(parts[0])
        let color = String(parts[1])
        if ["focus", "rest"].contains(phase),
           ["black", "ginger", "cream", "gray", "white", "calico"].contains(color) {
          var payload: [String: Any] = [
            "sessionId": "simulator-preview",
            "phase": phase,
            "subject": phase == "rest" ? "" : "영어 공부",
            "catColor": color,
            "anchorMs": Date().addingTimeInterval(phase == "rest" ? -305 : -1042).timeIntervalSince1970 * 1000,
          ]
          payload[phase == "rest" ? "restCount" : "focusCount"] = phase == "rest" ? 3 : 12
          LiveActivityModule().sync(
            payload as NSDictionary,
            resolver: { _ in },
            rejecter: { _, _, _ in }
          )
        }
      }
    }
#endif
    return didLaunch
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
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
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
