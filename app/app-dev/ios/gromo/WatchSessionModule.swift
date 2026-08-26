// WatchSessionModule.swift
// gromo 메인 앱 타겟
//
// 역할: Apple Watch 페어링 상태(WCSession)를 JS에 노출하는 네이티브 모듈.
//       1차(GROMO-1598)는 보급률 계측용 getPairingStatus 하나만 제공한다.
//       애플워치 컴패니언 페이즈 1에서 이 모듈이 WCSession delegate(명령 인박스)의
//       거점으로 확장된다 — WCSession.default의 delegate는 앱 전역에서 하나뿐이므로
//       워치 관련 네이티브 코드는 전부 이 모듈로 모은다 (docs/prd/apple-watch/ D2-④).
//
// 사용 방법 (JS에서):
//   const { WatchSessionModule } = NativeModules;
//   const status = await WatchSessionModule.getPairingStatus();
//   // → { supported: boolean, paired: boolean, watchAppInstalled: boolean }

import Foundation
import WatchConnectivity

@objc(WatchSessionModule)
class WatchSessionModule: NSObject, WCSessionDelegate {

    @objc static func moduleName() -> String {
        return "WatchSessionModule"
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // isPaired는 activate 완료 전에는 신뢰할 수 없다 — activation을 기다렸다가 응답한다.
    // 동시 호출 대비 resolver를 큐로 보관하고, 완료/타임아웃 시 한 번에 비운다.
    private struct PendingCall {
        let resolve: RCTPromiseResolveBlock
        let reject: RCTPromiseRejectBlock
    }

    private let stateQueue = DispatchQueue(label: "com.oneorthree.gromo.watchsession")
    private var pendingCalls: [PendingCall] = []
    private var timeoutWorkItem: DispatchWorkItem?

    @objc func getPairingStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // 미지원 기기(iPad 등)는 activate 없이 즉시 응답 — WCSession.default 접근 자체가 불가.
        guard WCSession.isSupported() else {
            resolve(["supported": false, "paired": false, "watchAppInstalled": false])
            return
        }

        let session = WCSession.default
        if session.activationState == .activated {
            resolve(Self.statusPayload(session))
            return
        }

        stateQueue.async {
            self.pendingCalls.append(PendingCall(resolve: resolve, reject: reject))
            // activation 콜백이 영영 안 오는 경우의 안전망. 계측 호출자는 실패를 조용히 버린다.
            if self.timeoutWorkItem == nil {
                let item = DispatchWorkItem { [weak self] in
                    self?.flushPending { call in
                        call.reject("watch_session_timeout", "WCSession activation timed out", nil)
                    }
                }
                self.timeoutWorkItem = item
                self.stateQueue.asyncAfter(deadline: .now() + 5, execute: item)
            }
            session.delegate = self
            session.activate()
        }
    }

    private static func statusPayload(_ session: WCSession) -> [String: Any] {
        return [
            "supported": true,
            "paired": session.isPaired,
            "watchAppInstalled": session.isWatchAppInstalled,
        ]
    }

    // stateQueue 위에서만 호출된다는 전제의 내부 헬퍼 — 대기분을 비우고 타임아웃을 해제한다.
    private func flushPending(_ handler: (PendingCall) -> Void) {
        let calls = pendingCalls
        pendingCalls = []
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        calls.forEach(handler)
    }

    // ── WCSessionDelegate ──

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        stateQueue.async {
            self.flushPending { call in
                if activationState == .activated {
                    call.resolve(Self.statusPayload(session))
                } else {
                    call.reject("watch_session_activation_failed",
                                error?.localizedDescription ?? "WCSession activation failed", error)
                }
            }
        }
    }

    // 페어링 워치 전환 시 iOS가 요구하는 필수 구현 — 계측 용도에선 재활성화만 해 둔다.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
