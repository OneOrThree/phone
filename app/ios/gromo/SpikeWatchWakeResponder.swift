// SpikeWatchWakeResponder.swift
// gromo 메인 앱 타겟 — GROMO-1596 wake SLO 스파이크 (폐기 전제, DEBUG 전용)
//
// 역할: 워치 스파이크(GromoWatch)의 ping을 받아 즉시 응답한다. 응답에 폰 쪽 사실을 실어
// 워치 화면에서 상태별 wake 특성을 읽을 수 있게 한다:
//   wakeToReceiveMs  프로세스 기동(이 클래스 로드 시점) → 메시지 수신까지 ms
//                    — 콜드 스타트로 깨워졌으면 작음(방금 떴으니까), 이미 떠 있었으면 큼.
//                    "이미 떠 있던 프로세스"인지 판별하는 근거로 쓴다.
//   jsLoaded/jsLoadMs RN JS 번들 로드 완료 여부·기동→로드 소요 — 워치 명령을 JS 엔진이
//                    처리할 수 있기까지의 지연(D2-④ 인박스 필요성의 실측 근거)
//   appState         응답 시점의 UIApplication 상태 (fg/bg/inactive)
//
// ⚠️ WCSession.default.delegate는 앱 전역 하나뿐 — 이 스파이크가 잡는다. 페이즈 1의
//    WatchSessionModule(명령 인박스)이 들어올 때 이 파일은 통째로 삭제된다.

#if DEBUG
import Foundation
import UIKit
import WatchConnectivity

@objc(SpikeWatchWakeResponder)
final class SpikeWatchWakeResponder: NSObject, WCSessionDelegate {
    @objc static let shared = SpikeWatchWakeResponder()

    private let processWakeAt = Date()
    private var jsLoadedAt: Date?

    @objc static func start() {
        guard WCSession.isSupported() else { return }
        NotificationCenter.default.addObserver(
            shared,
            selector: #selector(onJsLoaded),
            name: Notification.Name("RCTJavaScriptDidLoadNotification"),
            object: nil
        )
        WCSession.default.delegate = shared
        WCSession.default.activate()
    }

    @objc private func onJsLoaded() {
        if jsLoadedAt == nil { jsLoadedAt = Date() }
    }

    // ── WCSessionDelegate ──
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard message["spike"] as? String == "ping" else {
            replyHandler(["error": "unknown message"])
            return
        }
        let now = Date()
        let wakeToReceiveMs = Int(now.timeIntervalSince(processWakeAt) * 1000)
        let jsLoadMs = jsLoadedAt.map { Int($0.timeIntervalSince(processWakeAt) * 1000) }
        DispatchQueue.main.async {
            let state: String
            switch UIApplication.shared.applicationState {
            case .active: state = "fg"
            case .inactive: state = "inactive"
            case .background: state = "bg"
            @unknown default: state = "?"
            }
            var reply: [String: Any] = [
                "receivedAt": now.timeIntervalSince1970 * 1000,
                "wakeToReceiveMs": wakeToReceiveMs,
                "jsLoaded": self.jsLoadedAt != nil,
                "appState": state,
            ]
            if let jsLoadMs { reply["jsLoadMs"] = jsLoadMs }
            replyHandler(reply)
        }
    }
}
#endif
