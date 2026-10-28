internal import Expo
import RNCKakaoUser
import react_native_line
import React
import ReactAppDependencyProvider
import AirbridgeReactNative
import FirebaseCore
import FBSDKCoreKit

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // GROMO-2395 Airbridge 앱 이름·SDK 토큰 — 대시보드 「설정 > 토큰 관리」 값. Android 는 MainApplication.kt 의 같은 상수.
  // 비어 있으면 SDK 를 초기화하지 않는다(토큰 발급 전 빌드가 빈 토큰으로 이벤트를 보내지 않게).
  private static let airbridgeAppName = ""
  private static let airbridgeAppToken = ""

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // 이전 실행의 SDK 설정도 끈 채 시작한다. 운영·목업 판정 뒤 JS만 수집을 켠다(GROMO-2544).
    Settings.shared.isAutoLogAppEventsEnabled = false
    Settings.shared.isAdvertiserIDCollectionEnabled = false
    // 콜드 스타트에서는 이전 차단부터 정리하고, 서버 세션을 확인한 JS가 유효한 집중에 재적용한다.
    ScreenTimeModule().stopFocusShield({ _ in }, rejecter: { _, _, _ in })
    // Airbridge 는 앱 시작 시점의 설치·세션 이벤트를 잡아야 하므로 React Native 가 뜨기 전에 초기화한다.
    if !Self.airbridgeAppName.isEmpty && !Self.airbridgeAppToken.isEmpty {
      AirbridgeReactNative.initializeSDK(name: Self.airbridgeAppName, token: Self.airbridgeAppToken)
    } else {
      NSLog("[Airbridge] 앱 이름·SDK 토큰이 비어 있어 초기화를 건너뜁니다 — AppDelegate.swift 의 상수를 채우세요")
    }
    // GROMO-2523 FCM 토큰(FCMTokenModule)용. plist 는 빌드 단계 [Firebase] Copy GoogleService-Info.plist 가 넣고,
    // 없는 Debug 빌드는 Firebase 없이 푸시 등록만 빠진 채 동작한다(브리지가 NOT_CONFIGURED 로 거절).
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }
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
    if RNCKakaoUserUtil.isKakaoTalkLoginUrl(url) {
      return RNCKakaoUserUtil.handleOpen(url)
    }
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
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
