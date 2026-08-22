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
            // 큐에 들어오기 **전에** activation이 완료돼 콜백이 빈 대기열을 flush했을 수 있다.
            // 그대로 append하면 재활성화도 안 되고(activationRequested=true) 5초 타임아웃만 난다.
            if session.activationState == .activated {
                completion(Self.statusPayload(session), nil)
                return
            }
            self.pendingStatusCalls.append(completion)
            // activation 콜백이 영영 안 오는 경우의 안전망 — 계측 호출자는 실패를 조용히 버린다.
            if self.timeoutWorkItem == nil {
                let item = DispatchWorkItem { [weak self] in
                    // 타임아웃도 실패다 — 플래그를 되돌리지 않으면 이후 조회가 activate를
                    // 재요청하지 못해 프로세스 재시작까지 계측·명령 수신이 복구되지 않는다.
                    self?.activationRequested = false
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
            let version = WatchCommandSchema.intValue(raw["protocolVersion"])
        else {
            return Self.ack(.malformed, commandId: raw["commandId"] as? String)
        }
        // 버전 검사는 양방향이고 **정확히 일치**해야 한다(§4.3) — `<=`로 열어 두면 0·음수처럼
        // 이 바이너리가 모르는 구 스키마까지 accepted로 적재돼, 업데이트 안내로 재수렴하지 못한
        // 채 엔진이 다른 스키마를 현재 버전으로 오해한다.
        guard version == kWatchProtocolVersion else {
            return Self.ack(.unsupportedVersion, commandId: commandId)
        }
        // 명령별 필수 필드 — 여기서 거르지 않으면 워치가 accepted ACK로 아웃박스를 비운 뒤
        // 엔진은 실행에 필요한 값이 없어 요청이 통째로 유실된다.
        guard WatchCommandSchema.isValid(raw) else {
            return Self.ack(.malformed, commandId: commandId)
        }
        // 킬스위치는 **신규 시작만** 막는다(R16 3차 개정). end/pause/resume까지 막으면
        // 아웃박스에 대기 중인 end가 갇혀 폰 세션·실드를 못 닫는 모순이 생긴다.
        if killSwitchEnabled, type == "start" {
            return Self.ack(.killSwitched, commandId: commandId)
        }
        // 적재 실패(대기열 포화)는 **accepted를 주면 안 된다** — 워치가 아웃박스를 비운다.
        guard enqueue(raw) else {
            return Self.ack(.queueFull, commandId: commandId)
        }
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

    /// 적재 성공 여부를 돌려준다.
    ///
    /// **이미 대기열에 있는 명령은 희생시키지 않는다.** 그것들도 수신 당시 accepted로 응답해
    /// 워치가 아웃박스를 비운 뒤라, 버리면 아직 만료도 안 된 사용자 조작이 조용히 사라진다.
    /// 자리를 만들 수 있는 건 **만료가 확정된 항목**뿐이고(그건 어차피 폐기 대상이다),
    /// 그래도 자리가 없으면 새 명령에 queueFull을 돌려줘 워치가 보관·재전송하게 한다.
    private func enqueue(_ raw: [String: Any]) -> Bool {
        guard
            let defaults,
            JSONSerialization.isValidJSONObject(raw),
            let data = try? JSONSerialization.data(withJSONObject: raw),
            let json = String(data: data, encoding: .utf8)
        else { return false }
        let commandId = raw["commandId"] as? String
        return stateQueue.sync {
            // 같은 commandId 재전송은 **중복 적재하지 않는다.** 역방향 ACK가 워치에 닿기 전에
            // 아웃박스가 재전송하는 건 정상 경로(응답 유실)인데, 그대로 쌓으면 한 명령의 복제본
            // 만으로 상한을 채워 이후의 다른 end·pause까지 queueFull로 거절하게 된다.
            // 이미 보관 중이면 「안전하게 적재됨」으로 응답한다(accepted).
            if let commandId,
               Self.contains(commandId: commandId, in: defaults) {
                return true
            }
            var queue = defaults.stringArray(forKey: WatchInboxKeys.inbox) ?? []
            // 상한은 **미확인 명령 전체**(inbox + claimed) 기준이다. inbox만 세면, 버전 스큐로
            // 의도적으로 보존되는 claimed가 드레인마다 쌓여 무한히 커진다(App Group 읽기·쓰기와
            // 부팅 드레인 비용도 함께 커진다).
            let claimedCount = (defaults.stringArray(forKey: WatchInboxKeys.claimed) ?? []).count
            if queue.count + claimedCount >= Self.maxQueued {
                let now = Date()
                queue.removeAll { Self.isExpired($0, now: now) }
            }
            guard queue.count + claimedCount < Self.maxQueued else { return false }
            queue.append(json)
            defaults.set(queue, forKey: WatchInboxKeys.inbox)
            return true
        }
    }

    /// inbox·claimed 어디든 같은 commandId가 이미 있는지.
    private static func contains(commandId: String, in defaults: UserDefaults) -> Bool {
        let stored = (defaults.stringArray(forKey: WatchInboxKeys.inbox) ?? [])
            + (defaults.stringArray(forKey: WatchInboxKeys.claimed) ?? [])
        return stored.contains { json in
            guard
                let data = json.data(using: .utf8),
                let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return false }
            return (raw["commandId"] as? String) == commandId
        }
    }

    /// 만료 확정 여부. `end`는 만료 없이 영속 재생되므로(§4.3) 절대 만료로 보지 않는다.
    private static func isExpired(_ json: String, now: Date) -> Bool {
        guard
            let data = json.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            (raw["type"] as? String) != "end",
            let expiresAt = raw["expiresAt"] as? String,
            let deadline = Self.parseISO8601(expiresAt)
        else { return false }
        return deadline < now
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: value) { return d }
        return ISO8601DateFormatter().date(from: value)
    }

    /// JS가 부르는 드레인 — **지우지 않고 claim한다.** 반환 직후~JS 처리 완료 사이에
    /// 프로세스가 죽거나 브릿지가 무효화되면 명령이 영구 유실되는데, 워치는 이미 accepted
    /// ACK를 받고 아웃박스를 비웠으므로 재전송도 없다. 그래서 확인(ack) 전까지 보관하고,
    /// 미확인분은 다음 드레인에 **재배달**한다(commandId 멱등이라 중복 실행은 엔진이 막는다).
    func drain() -> [String] {
        guard let defaults else { return [] }
        return stateQueue.sync {
            let fresh = defaults.stringArray(forKey: WatchInboxKeys.inbox) ?? []
            var claimed = defaults.stringArray(forKey: WatchInboxKeys.claimed) ?? []
            if !fresh.isEmpty {
                claimed.append(contentsOf: fresh)
                // ⚠️ **순서가 계약이다.** claimed를 먼저 커밋하고 inbox를 지운다 — 반대로 하면
                // 두 쓰기 사이에 프로세스가 죽는 창에서 명령이 두 키 어디에도 없어 영구 유실된다
                // (워치는 이미 accepted로 아웃박스를 비운 뒤라 재전송도 없다). 이 순서면 최악이
                // 중복이고, 중복은 commandId 멱등이 흡수한다.
                defaults.set(claimed, forKey: WatchInboxKeys.claimed)
                defaults.removeObject(forKey: WatchInboxKeys.inbox)
            }
            return claimed
        }
    }

    /// JS가 처리를 확인한 명령만 지운다. 확인되지 않은 것은 남아 다음 드레인에 재배달된다.
    ///
    /// ⚠️ **빈 배열이어도 돈다.** commandId를 못 건지는 깨진 레코드는 JS가 ack 대상으로
    /// 지목할 수 없어, 빈 호출에서 조기 반환하면 claimed에 영구 잔존하며 매 기동마다
    /// 드레인된다. 이 함수의 필터가 그 잔재까지 함께 청소한다.
    func ack(commandIds: [String]) {
        guard let defaults else { return }
        let ids = Set(commandIds)
        stateQueue.sync {
            let claimed = defaults.stringArray(forKey: WatchInboxKeys.claimed) ?? []
            let remaining = claimed.filter { json in
                guard
                    let data = json.data(using: .utf8),
                    let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let id = raw["commandId"] as? String
                else { return false } // 파싱 불가 항목은 재배달해도 소용없으므로 정리한다
                return !ids.contains(id)
            }
            if remaining.isEmpty {
                defaults.removeObject(forKey: WatchInboxKeys.claimed)
            } else {
                defaults.set(remaining, forKey: WatchInboxKeys.claimed)
            }
        }
    }

    // ── WCSessionDelegate ────────────────────────────────────────────────────

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        stateQueue.async {
            if activationState != .activated {
                // 일시적 실패 — 플래그를 되돌려 다음 조회가 activate를 다시 요청할 수 있게 한다.
                // 안 되돌리면 이 프로세스에선 페어링 조회도 명령 수신도 영영 복구되지 않는다.
                self.activationRequested = false
            }
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
    ///
    /// ⚠️ **판정을 버리면 안 된다.** 이 경로엔 replyHandler가 없어서, 결과를 되돌려 주지
    /// 않으면 워치는 폰이 수락했는지 알 수 없다 — 아웃박스의 `end`를 계속 보존한 채
    /// 「종료 대기」에 머물고 재전송을 끝내지 못한다(R3). 같은 영속 채널로 ACK를 돌려보낸다.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let verdict = ingest(userInfo)
        sendAck(verdict, over: session)
    }

    /// 역방향 ACK — `transferUserInfo`는 도달 불가여도 OS가 큐잉했다 배달하므로, 영속 명령의
    /// 짝으로 적절하다. 실패해도 워치가 재전송하면 commandId 멱등이 중복을 흡수한다.
    private func sendAck(_ verdict: [String: Any], over session: WCSession) {
        guard session.activationState == .activated else { return }
        var payload = verdict
        payload["kind"] = "ack" // 명령과 구분되는 표식 — 워치 수신부가 라우팅에 쓴다
        session.transferUserInfo(payload)
    }

    // 페어링 워치 전환 시 iOS가 요구하는 필수 구현 — 재활성화해 delegate를 유지한다.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
