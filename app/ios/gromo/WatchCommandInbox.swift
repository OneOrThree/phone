// WatchCommandInbox.swift
// gromo 메인 앱 타겟
//
// **WCSession.default의 유일한 delegate.** (GROMO-1600 / policy D2-④)
//
// 왜 RN 모듈이 아니라 여기인가: RCT 모듈은 브릿지가 **JS를 띄우면서** 늦게 인스턴스화한다.
// 워치 명령은 그보다 먼저 도착할 수 있고(특히 종료 상태에서 WCSession이 앱을 깨우는 경우),
// 그때 delegate가 없으면 명령이 조용히 사라진다 — notificationInbox.ts가 겪은 것과 같은
// 유실이다. 그래서 delegate는 AppDelegate 시점에 붙는 싱글턴이 소유하고, RN 모듈
// (WatchSessionModule)은 이 싱글턴에 **위임만** 한다(delegate는 앱 전역에서 하나뿐이라
// 둘이 서로 덮어쓰면 인박스가 죽는다).
//
// 이 티켓의 범위는 **스켈레톤**이다: 수신 → 킬스위치 평가 → App Group 영속화 → JS 드레인.
// 명령을 실제로 실행하는 라우팅은 페이즈 1(워치 앱)에서 붙는다. 워치 앱이 아직 없으므로
// 실 WCSession 수신 검증도 그때 하고, 지금은 debugEnqueue로 경로를 손으로 태운다.

import Foundation
import WatchConnectivity

@objc(WatchCommandInbox)
final class WatchCommandInbox: NSObject, WCSessionDelegate {

    @objc static let shared = WatchCommandInbox()

    /// 대기열 상한 — 정상 흐름에선 JS가 부팅·복귀마다 비운다. 폭주 방어용.
    private static let maxQueued = 50

    private let stateQueue = DispatchQueue(label: "com.oneorthree.gromo.watchinbox")
    private var pendingStatusCalls: [([String: Any]?, Error?) -> Void] = []
    private var timeoutWorkItem: DispatchWorkItem?
    private var activationRequested = false

    private var defaults: UserDefaults? {
        UserDefaults(suiteName: WatchInboxKeys.suiteName)
    }

    // ── 활성화 ────────────────────────────────────────────────────────────────

    /// AppDelegate에서 1회 호출. 미지원 기기(iPad 등)에서는 아무것도 하지 않는다.
    /// 멱등 — 중복 호출해도 activate는 한 번만 요청한다.
    @objc func activateIfSupported() {
        guard WCSession.isSupported() else { return }
        stateQueue.async {
            guard !self.activationRequested else { return }
            self.activationRequested = true
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }

    /// 페어링 상태 조회(GROMO-1598 계측) — activation 완료를 기다렸다 응답한다.
    /// isPaired는 activate 전에는 신뢰할 수 없다.
    func pairingStatus(completion: @escaping ([String: Any]?, Error?) -> Void) {
        guard WCSession.isSupported() else {
            completion(["supported": false, "paired": false, "watchAppInstalled": false], nil)
            return
        }
        let session = WCSession.default
        if session.activationState == .activated {
            completion(Self.statusPayload(session), nil)
            return
        }
        stateQueue.async {
            self.pendingStatusCalls.append(completion)
            // activation 콜백이 영영 안 오는 경우의 안전망 — 계측 호출자는 실패를 조용히 버린다.
            if self.timeoutWorkItem == nil {
                let item = DispatchWorkItem { [weak self] in
                    self?.flushPendingStatus { call in
                        call(nil, NSError(
                            domain: "WatchCommandInbox",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "WCSession activation timed out"]
                        ))
                    }
                }
                self.timeoutWorkItem = item
                self.stateQueue.asyncAfter(deadline: .now() + 5, execute: item)
            }
            if !self.activationRequested {
                self.activationRequested = true
                session.delegate = self
                session.activate()
            }
        }
    }

    private static func statusPayload(_ session: WCSession) -> [String: Any] {
        [
            "supported": true,
            "paired": session.isPaired,
            "watchAppInstalled": session.isWatchAppInstalled,
        ]
    }

    /// stateQueue 위에서만 호출되는 내부 헬퍼 — 대기분을 비우고 타임아웃을 해제한다.
    private func flushPendingStatus(_ handler: (([String: Any]?, Error?) -> Void) -> Void) {
        let calls = pendingStatusCalls
        pendingStatusCalls = []
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        calls.forEach(handler)
    }

    // ── 킬스위치 (policy D13) ─────────────────────────────────────────────────

    /// 정본은 이 네이티브 영속 플래그다 — **수신 시점**에 평가하므로 JS가 어떤 번들로
    /// 부팅하든, 심지어 부팅 전이라도 차단된다. JS 엔진도 처리 직전 같은 값을 재평가한다(이중 평가).
    @objc var killSwitchEnabled: Bool {
        get { defaults?.bool(forKey: WatchInboxKeys.killSwitch) ?? false }
        set { defaults?.set(newValue, forKey: WatchInboxKeys.killSwitch) }
    }

    // ── 수신·영속화 ──────────────────────────────────────────────────────────

    /// 수신 명령 1건 처리 — 판정 후 accepted만 대기열에 넣는다. 반환값은 워치로 갈 ACK.
    @discardableResult
    func ingest(_ raw: [String: Any]) -> [String: Any] {
        guard
            let commandId = raw["commandId"] as? String, !commandId.isEmpty,
            let type = raw["type"] as? String, !type.isEmpty,
            let version = raw["protocolVersion"] as? Int
        else {
            return Self.ack(.malformed, commandId: raw["commandId"] as? String)
        }
        // 버전 검사는 양방향이다(§4.3) — 미지원 명령은 실행하지 않고 재수렴시킨다.
        guard version <= kWatchProtocolVersion else {
            return Self.ack(.unsupportedVersion, commandId: commandId)
        }
        // 킬스위치는 **신규 시작만** 막는다(R16 3차 개정). end/pause/resume까지 막으면
        // 아웃박스에 대기 중인 end가 갇혀 폰 세션·실드를 못 닫는 모순이 생긴다.
        if killSwitchEnabled, type == "start" {
            return Self.ack(.killSwitched, commandId: commandId)
        }
        enqueue(raw)
        return Self.ack(.accepted, commandId: commandId)
    }

    private static func ack(_ verdict: WatchCommandVerdict, commandId: String?) -> [String: Any] {
        var payload: [String: Any] = [
            "verdict": verdict.rawValue,
            "protocolVersion": kWatchProtocolVersion,
        ]
        if let commandId { payload["commandId"] = commandId }
        return payload
    }

    private func enqueue(_ raw: [String: Any]) {
        guard
            let defaults,
            JSONSerialization.isValidJSONObject(raw),
            let data = try? JSONSerialization.data(withJSONObject: raw),
            let json = String(data: data, encoding: .utf8)
        else { return }
        stateQueue.sync {
            var queue = defaults.stringArray(forKey: WatchInboxKeys.inbox) ?? []
            queue.append(json)
            if queue.count > Self.maxQueued {
                queue = Array(queue.suffix(Self.maxQueued))
            }
            defaults.set(queue, forKey: WatchInboxKeys.inbox)
        }
    }

    /// JS가 부르는 드레인 — 읽고 비운다. 같은 명령을 두 번 실행하지 않도록 원자적으로 처리한다.
    func drain() -> [String] {
        guard let defaults else { return [] }
        return stateQueue.sync {
            let queue = defaults.stringArray(forKey: WatchInboxKeys.inbox) ?? []
            if !queue.isEmpty { defaults.removeObject(forKey: WatchInboxKeys.inbox) }
            return queue
        }
    }

    // ── WCSessionDelegate ────────────────────────────────────────────────────

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        stateQueue.async {
            self.flushPendingStatus { call in
                if activationState == .activated {
                    call(Self.statusPayload(session), nil)
                } else {
                    call(nil, error ?? NSError(
                        domain: "WatchCommandInbox",
                        code: -2,
                        userInfo: [NSLocalizedDescriptionKey: "WCSession activation failed"]
                    ))
                }
            }
        }
    }

    /// 즉시 전달(도달 가능할 때) — 워치가 ACK를 기다리는 경로.
    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        replyHandler(ingest(message))
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        ingest(message)
    }

    /// 영속 전달(도달 불가 시 OS가 큐잉했다가 배달) — 워치 아웃박스의 `end`가 오는 경로.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        ingest(userInfo)
    }

    // 페어링 워치 전환 시 iOS가 요구하는 필수 구현 — 재활성화해 delegate를 유지한다.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
