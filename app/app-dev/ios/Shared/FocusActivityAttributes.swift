import ActivityKit
import Foundation

/// 앱과 Live Activity 위젯이 공유하는 Codable 계약.
struct GromoFocusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        // 서버 FocusSessionLifecycleService.REST_AUTO_CLOSE_AFTER 와 같은 1시간 정책.
        static let restAutoCloseAfter: TimeInterval = 60 * 60

        var phase: String // focus | rest
        var subject: String
        var catColor: String
        var anchor: Date
        var focusCount: Int?
        var restCount: Int?

        var restExpiresAt: Date? {
            phase == "rest" ? anchor.addingTimeInterval(Self.restAutoCloseAfter) : nil
        }
    }

    var sessionId: String
}
