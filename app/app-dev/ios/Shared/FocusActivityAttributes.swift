import ActivityKit
import Foundation

/// 2.0의 Live Activity/확장 타깃이 같은 Codable 계약을 공유하기 위한 단일 정의다.
struct GromoFocusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var mode: String
        var phase: String
        var anchor: Date
        var endAt: Date?
        var frozenSeconds: Int?
        var revision: Int
    }

    struct OtherSubject: Codable, Hashable {
        var name: String
        var seconds: Int
        var color: String
    }

    var subjectName: String
    var otherSubjects: [OtherSubject]
}
