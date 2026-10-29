import FirebaseCore
import FirebaseMessaging
import Foundation
import React

// GROMO-2523 FCM 등록 토큰 브리지 — JS 가 expo-notifications 로 받은 APNs 토큰(hex)을 넘기면 FCM 토큰을 돌려준다.
// 이름을 PushTokenModule 로 짓지 않는다 — expo-notifications 에 같은 이름의 Swift 클래스(APNs 토큰 모듈)가 있어 헷갈린다.
@objc(FCMTokenModule)
final class FCMTokenModule: RCTEventEmitter, MessagingDelegate {
    @objc override static func requiresMainQueueSetup() -> Bool { true }
    override var methodQueue: DispatchQueue! { DispatchQueue.main }
    private var hasListeners = false

    override func supportedEvents() -> [String]! { ["FCMTokenRefresh"] }
    override func startObserving() {
        hasListeners = true
        if FirebaseApp.app() != nil { Messaging.messaging().delegate = self }
    }
    override func stopObserving() { hasListeners = false }

    // swizzling 을 꺼서(Info.plist FirebaseAppDelegateProxyEnabled) APNs 토큰은 이 인자로만 들어온다.
    // APNs 토큰 없이 받은 FCM 토큰은 배달되지 않을 수 있어, 토큰을 먼저 넣고 받는 순서를 인자로 묶는다.
    @objc(getToken:resolver:rejecter:)
    func getToken(
        _ apnsTokenHex: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let apnsToken = Self.data(fromHex: apnsTokenHex) else {
            reject("INVALID_APNS_TOKEN", "APNs token must be a non-empty even-length hex string", nil)
            return
        }
        guard let messaging = configuredMessaging(reject) else { return }
        messaging.apnsToken = apnsToken
        // deleteToken 이 꺼 둔 자동 초기화를 되돌린다(계정 전환 rotate 는 delete 직후 get 이라 여기서 복원된다).
        // APNs 토큰을 먼저 넣은 뒤 켜야 켜는 순간 시작되는 토큰 요청에도 APNs 토큰이 실린다.
        messaging.isAutoInitEnabled = true
        messaging.token { token, error in
            if let token, !token.isEmpty {
                resolve(token)
            } else {
                reject("TOKEN_ERROR", error?.localizedDescription ?? "FCM token unavailable", error)
            }
        }
    }

    // 지운 뒤 getToken 은 새 토큰을 받는다(계정 전환·알림 끄기).
    // 지우기 전에 자동 초기화를 끈다 — 켜 둔 채면 앱 시작 때 Firebase 가 등록이 없다고 보고 새 토큰을 만든다.
    // 값은 Firebase 가 앱 재시작 뒤에도 유지하고, 켤 때는 getToken 이 되돌린다. Info.plist 키는 쓰지 않는다(첫 실행 기본 동작 유지).
    @objc(deleteToken:rejecter:)
    func deleteToken(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let messaging = configuredMessaging(reject) else { return }
        messaging.isAutoInitEnabled = false
        messaging.deleteToken { error in
            if let error {
                reject("TOKEN_ERROR", error.localizedDescription, error)
            } else {
                resolve(nil)
            }
        }
    }

    // Firebase 가 메인 스레드에서 부른다. 지운 직후의 nil 은 보내지 않는다.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard hasListeners, let fcmToken, !fcmToken.isEmpty else { return }
        sendEvent(withName: "FCMTokenRefresh", body: ["token": fcmToken])
    }

    // plist 없는 Debug 빌드는 FirebaseApp 이 없고, 그때 Messaging.messaging() 은 쓸 수 없는 값이라 먼저 거절한다.
    private func configuredMessaging(_ reject: RCTPromiseRejectBlock) -> Messaging? {
        guard FirebaseApp.app() != nil else {
            reject("NOT_CONFIGURED", "Firebase is not configured (GoogleService-Info.plist missing)", nil)
            return nil
        }
        return Messaging.messaging()
    }

    private static func data(fromHex hex: String) -> Data? {
        guard !hex.isEmpty, hex.count % 2 == 0, hex.allSatisfy(\.isHexDigit) else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }
}
