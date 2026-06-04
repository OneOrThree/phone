import Foundation
import FamilyControls

@objc(ScreenTimeModule)
class ScreenTimeModule: NSObject {

  @objc
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.0, *) {
      Task {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
          resolve("authorized")
        } catch {
          reject("AUTH_ERROR", error.localizedDescription, error)
        }
      }
    } else {
      reject("VERSION_ERROR", "iOS 16.0 이상이 필요합니다", nil)
    }
  }

  @objc
  func checkAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 16.0, *) {
      switch AuthorizationCenter.shared.authorizationStatus {
      case .approved:
        resolve("approved")
      case .denied:
        resolve("denied")
      case .notDetermined:
        resolve("notDetermined")
      @unknown default:
        resolve("unknown")
      }
    } else {
      reject("VERSION_ERROR", "iOS 16.0 이상이 필요합니다", nil)
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
