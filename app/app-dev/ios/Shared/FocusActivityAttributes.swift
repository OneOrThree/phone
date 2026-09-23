import ActivityKit
import Foundation

/// 앱과 Live Activity 위젯이 공유하는 Codable 계약.
struct GromoFocusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: String // focus | rest
        var subject: String
        var catColor: String
        var anchor: Date
        var focusCount: Int?
        var restCount: Int?
    }

    var sessionId: String
}
