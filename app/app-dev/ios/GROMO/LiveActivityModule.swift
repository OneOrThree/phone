import ActivityKit
import Foundation
import React

@objc(LiveActivityModule)
final class LiveActivityModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

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

        Task {
            for activity in Activity<GromoFocusAttributes>.activities where activity.attributes.sessionId != sessionId {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            if let activity = Activity<GromoFocusAttributes>.activities.first(where: { $0.attributes.sessionId == sessionId }) {
                await activity.update(ActivityContent(state: state, staleDate: nil))
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
                    attributes: GromoFocusAttributes(sessionId: sessionId),
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
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
        Task {
            for activity in Activity<GromoFocusAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            resolve(nil)
        }
    }
}
