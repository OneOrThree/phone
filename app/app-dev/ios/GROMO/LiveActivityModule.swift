import ActivityKit
import Foundation
import React
import WidgetKit

@objc(LiveActivityModule)
final class LiveActivityModule: RCTEventEmitter {
    @objc override static func requiresMainQueueSetup() -> Bool { true }
    override var methodQueue: DispatchQueue! { DispatchQueue.main }
    private var work: Task<Void, Never>?
    private var observers: [String: Task<Void, Never>] = [:]
    private var hasListeners = false

    override func supportedEvents() -> [String]! { ["LiveActivityPushToken"] }
    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    @MainActor
    private func tokenPayload(_ activity: Activity<GromoFocusAttributes>, token: Data) -> [String: Any] {
        ["sessionId": activity.attributes.sessionId, "activityId": activity.id,
         "pushToken": token.map { String(format: "%02x", $0) }.joined(),
         "environment": Bundle.main.object(forInfoDictionaryKey: "GromoAPNsEnvironment") as? String ?? "production"]
    }

    @MainActor
    private func observeToken(_ activity: Activity<GromoFocusAttributes>) {
        guard observers[activity.id] == nil else { return }
        observers[activity.id] = Task { @MainActor [weak self] in
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                if let self, self.hasListeners {
                    self.sendEvent(withName: "LiveActivityPushToken", body: self.tokenPayload(activity, token: token))
                }
            }
        }
    }

    @objc(getPushTokens:rejecter:)
    func getPushTokens(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task { @MainActor in
            let activities = Activity<GromoFocusAttributes>.activities.filter {
                $0.activityState != .ended && $0.activityState != .dismissed
            }
            for activity in activities { observeToken(activity) }
            resolve(activities.compactMap { activity -> [String: Any]? in
                guard let token = activity.pushToken else { return nil }
                return tokenPayload(activity, token: token)
            })
        }
    }

    @objc(updateHomeWidget:resolver:rejecter:)
    func updateHomeWidget(
        _ json: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let defaults = UserDefaults(suiteName: "group.com.oneorthree.focuscat") else {
            reject("WIDGET_STORAGE", "위젯 저장소를 열지 못했어요.", nil)
            return
        }
        if let json {
            guard let data = json.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let seconds = payload["totalSeconds"] as? Double, seconds.isFinite, seconds >= 0,
                  payload["owner"] is String, payload["day"] is String else {
                reject("WIDGET_PAYLOAD", "위젯 데이터가 올바르지 않아요.", nil)
                return
            }
            defaults.set(data, forKey: "gromo:widget:home")
        } else {
            defaults.removeObject(forKey: "gromo:widget:home")
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "GromoHomeWidget")
        resolve(nil)
    }

    @objc(sync:resolver:rejecter:)
    func sync(
        _ payload: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let sessionId = payload["sessionId"] as? String, !sessionId.isEmpty,
              let phase = payload["phase"] as? String, ["focus", "rest"].contains(phase),
              let subject = payload["subject"] as? String,
              let color = payload["catColor"] as? String,
              let anchorMs = payload["anchorMs"] as? NSNumber else {
            reject("INVALID_ACTIVITY", "Invalid Live Activity session payload", nil)
            return
        }

        let knownColors = ["black", "ginger", "cream", "gray", "white", "calico"]
        let state = GromoFocusAttributes.ContentState(
            phase: phase,
            subject: subject,
            catColor: knownColors.contains(color) ? color : "gray",
            anchor: Date(timeIntervalSince1970: anchorMs.doubleValue / 1000),
            focusCount: (payload["focusCount"] as? NSNumber)?.intValue,
            restCount: (payload["restCount"] as? NSNumber)?.intValue
        )

        let prior = work
        work = Task { @MainActor in
            await prior?.value
            for activity in Activity<GromoFocusAttributes>.activities where
                activity.attributes.sessionId != sessionId || activity.attributes.pushEnabled != true {
                await activity.end(nil, dismissalPolicy: .immediate)
                observers.removeValue(forKey: activity.id)?.cancel()
            }
            let matches = Activity<GromoFocusAttributes>.activities.filter {
                $0.attributes.sessionId == sessionId && $0.activityState != .ended && $0.activityState != .dismissed
            }
            for duplicate in matches.dropFirst() {
                await duplicate.end(nil, dismissalPolicy: .immediate)
                observers.removeValue(forKey: duplicate.id)?.cancel()
            }
            if let activity = matches.first {
                observeToken(activity)
                await activity.update(ActivityContent(state: state, staleDate: state.restExpiresAt))
#if DEBUG
                NSLog("GROMO Live Activity updated: %@ (%@)", activity.id, phase)
#endif
                resolve(true)
                return
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
#if DEBUG
                NSLog("GROMO Live Activity unavailable: disabled by system settings")
#endif
                resolve(false)
                return
            }
            do {
                let activity = try Activity.request(
                    attributes: GromoFocusAttributes(sessionId: sessionId, pushEnabled: true),
                    content: ActivityContent(state: state, staleDate: state.restExpiresAt),
                    pushType: .token
                )
                observeToken(activity)
#if DEBUG
                NSLog("GROMO Live Activity created: %@ (%@)", activity.id, phase)
#endif
                resolve(true)
            } catch {
#if DEBUG
                NSLog("GROMO Live Activity request failed: %@", error.localizedDescription)
#endif
                reject("ACTIVITY_REQUEST_FAILED", error.localizedDescription, error)
            }
        }
    }

    @objc(endAll:rejecter:)
    func endAll(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
#if DEBUG
        // JS 앱에 로그인 세션이 없어도 네이티브 QA 미리보기는 유지한다.
        if ProcessInfo.processInfo.arguments.contains(where: {
            $0.hasPrefix("--gromo-live-preview=focus,") || $0.hasPrefix("--gromo-live-preview=rest,")
        }) {
            resolve(nil)
            return
        }
#endif
        let prior = work
        work = Task { @MainActor in
            await prior?.value
            for activity in Activity<GromoFocusAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
                observers.removeValue(forKey: activity.id)?.cancel()
            }
            resolve(nil)
        }
    }
}
