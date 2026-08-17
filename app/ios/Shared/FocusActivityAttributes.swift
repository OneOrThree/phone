// FocusActivityAttributes.swift
// Shared — gromo · WidgetExtension (+ Shared 그룹이 붙은 다른 타겟)
//
// 집중 세션 Live Activity 속성의 **단일 정의** (GROMO-1597).
// 종전에는 같은 타입이 ios/gromo/ScreenTimeModule.swift 하단과
// ios/Widget/WidgetLiveActivity.swift에 중복 정의돼 있었다(타입명·인코딩으로 매칭되는
// 구조라 한쪽만 고치면 조용히 깨짐). Shared/는 파일시스템 동기화 그룹이라 두 타겟에
// 자동 포함된다 — 앞으로 이 파일만 고친다.
//
// ContentState는 PRD R4 스냅샷 스키마(docs/prd/apple-watch/)와 같은 원리다:
// 「앵커 시각 + 수신자 자체 갱신」. 상태 변화(시작·정지·재개·페이즈 전환) 때만 update하고,
// 그 사이 렌더는 OS의 Text(timerInterval:)가 스스로 튄다. 이 스키마가 페이즈 1 워치
// 스냅샷의 원형이 된다.

import ActivityKit
import Foundation

struct GromoFocusAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 타이머 모드 — "countup" | "countdown" | "pomodoro"
        var mode: String
        // 현 페이즈 — "focus" | "break" (countup·countdown은 항상 focus)
        var phase: String
        // 표시 앵커 — countup: now − 경과초(정지 제외분 반영), countdown·pomodoro: now.
        // 정지·재개 때마다 재계산돼 정지 시간이 표시에서 빠진다(정지 중 증가하던 종전 부정확 해소).
        var anchor: Date
        // countdown·pomodoro 현 페이즈의 종료 시각 — 있으면 카운트다운 렌더, 없으면 카운트업
        var endAt: Date?
        // 일시정지 중이면 그 시점의 표시값(초) — 타이머 대신 이 값을 고정 표시한다
        var frozenSeconds: Int?
        // 상태 순서 보증 — 늦게 도착한 update가 최신 상태를 덮지 않게(워치 스냅샷과 동일 규칙)
        var revision: Int

        var isPaused: Bool { frozenSeconds != nil }
    }

    // 다른 과목의 누적 집중 시간(잠금화면 표시용) — 세션 중엔 현재 과목만 증가하므로
    // 시작 시점 스냅샷으로 고정해도 항상 정확하다.
    struct OtherSubject: Codable, Hashable {
        var name: String
        var seconds: Int
        var color: String // hex 문자열(#RRGGBB)
    }

    // 세션 과목명
    var subjectName: String
    // 현재 과목을 제외한 나머지 과목들의 누적 집중 시간
    var otherSubjects: [OtherSubject]
}
