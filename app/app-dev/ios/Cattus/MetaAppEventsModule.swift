import AppTrackingTransparency
import FBSDKCoreKit
import Foundation
import React
import UIKit

// GROMO-2544 iOS 앱 이벤트. SDK 초기화는 운영 환경을 확인한 JS 호출에서만 시작한다.
@objc(MetaAppEventsModule)
final class MetaAppEventsModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }
  @objc var methodQueue: DispatchQueue { DispatchQueue.main }
  private var started = false
  private static var isDevelopmentBuild: Bool {
#if DEBUG
    true
#else
    false
#endif
  }

  @objc(syncTracking:resolver:rejecter:)
  func syncTracking(
    _ requestPermission: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard !Self.isDevelopmentBuild, UIApplication.shared.applicationState == .active else {
      resolve(false)
      return
    }
    guard let appID = Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String,
          !appID.isEmpty,
          let token = Bundle.main.object(forInfoDictionaryKey: "FacebookClientToken") as? String,
          !token.isEmpty else {
      reject("NOT_CONFIGURED", "Meta App ID or Client Token is missing", nil)
      return
    }
    if requestPermission && ATTrackingManager.trackingAuthorizationStatus == .notDetermined {
      ATTrackingManager.requestTrackingAuthorization { [weak self] status in
        DispatchQueue.main.async {
          guard let self else { resolve(false); return }
          self.configure(status)
          resolve(true)
        }
      }
    } else {
      configure(ATTrackingManager.trackingAuthorizationStatus)
      resolve(true)
    }
  }

  private func configure(_ status: ATTrackingManager.AuthorizationStatus) {
    let granted = status == .authorized
    Settings.shared.isAdvertiserTrackingEnabled = granted
    Settings.shared.isAdvertiserIDCollectionEnabled = granted
    guard !started else { return }
    started = true
    Settings.shared.isAutoLogAppEventsEnabled = true
    // SDK는 늦은 초기화 때 이미 활성 상태인 앱도 감지해 첫 실행을 기록한다.
    // Expo delegate의 자동 초기화를 사용하지 않아 그 경로가 먼저 소비되지 않는다.
    ApplicationDelegate.shared.initializeSDK()
  }
}
