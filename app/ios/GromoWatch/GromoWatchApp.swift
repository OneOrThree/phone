// GromoWatchApp.swift
// GromoWatch — GROMO-1596 wake SLO 스파이크 (폐기 전제)
//
// 목적: 워치→폰 WCSession 깨우기의 성립 여부·지연을 폰 앱 상태별로 실측한다.
// 이 타겟은 측정 도구다 — 페이즈 1 워치 앱의 코드베이스가 아니다(policy D3-ⓐ).

import SwiftUI

@main
struct GromoWatchApp: App {
    var body: some Scene {
        WindowGroup {
            SpikeView()
        }
    }
}
