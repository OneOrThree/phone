//
//  WidgetLiveActivity.swift
//  Widget
//
//  Created by Taehwa Kown on 6/27/26.
//

import ActivityKit
import WidgetKit
import SwiftUI
import UIKit

// 집중 세션 Live Activity(GROMO-553) — 세션 중 허용앱을 쓰는 동안
// 다이나믹 아일랜드/잠금화면에 집중 타이머 + 캐릭터를 표시한다.
// ⚠️ GromoFocusAttributes는 메인 앱(ios/gromo/ScreenTimeModule.swift 하단)에도
//    같은 이름·필드로 정의돼 있다 — 반드시 함께 수정할 것(타입명·인코딩으로 매칭됨).
struct GromoFocusAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 타이머 기준 시각 — Text(timerInterval:)가 OS에서 자체 갱신하므로 업데이트 불필요
        var startedAt: Date
    }

    // 세션 과목명
    var subjectName: String
}

private let appGroupId = "group.com.oneorthree.gromo"

// gromo 팔레트 (app/src/v2/constants/theme.ts 의 T.night / T.accent 값과 동일)
private let laBg = Color(red: 0x24 / 255, green: 0x1A / 255, blue: 0x14 / 255) // night.bottom
private let laCream = Color(red: 0xE6 / 255, green: 0xD3 / 255, blue: 0xB4 / 255) // night.cream
private let laMuted = Color(red: 0x9A / 255, green: 0x84 / 255, blue: 0x72 / 255) // night.muted
private let laGold = Color(red: 0xF0 / 255, green: 0xC7 / 255, blue: 0x6A / 255) // night.gold

// 세션 시작 시 메인 앱이 App Group 컨테이너에 저장한 커스텀 캐릭터 스냅샷
private func characterUIImage() -> UIImage? {
    guard
        let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        )
    else { return nil }
    return UIImage(contentsOfFile: container.appendingPathComponent("focusCharacter.png").path)
}

// 캐릭터 이미지 뷰 — 스냅샷 없으면 임시 마스코트 이모지
private struct CharacterView: View {
    let size: CGFloat

    var body: some View {
        if let ui = characterUIImage() {
            Image(uiImage: ui)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            Text("🐹").font(.system(size: size * 0.8))
        }
    }
}

// 경과 타이머 — OS가 매초 자체 갱신(앱 suspend와 무관)
private struct ElapsedTimerText: View {
    let startedAt: Date
    var font: Font = .title2

    var body: some View {
        Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
            .font(font.weight(.bold).monospacedDigit())
            .foregroundStyle(laCream)
            .multilineTextAlignment(.trailing)
    }
}

struct WidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GromoFocusAttributes.self) { context in
            // 잠금화면/배너 UI
            HStack(spacing: 12) {
                CharacterView(size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.subjectName)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(laCream)
                    Text("집중하는 중이야!")
                        .font(.caption)
                        .foregroundStyle(laMuted)
                }
                Spacer()
                ElapsedTimerText(startedAt: context.state.startedAt)
                    .frame(maxWidth: 100)
            }
            .padding(16)
            .activityBackgroundTint(laBg)
            .activitySystemActionForegroundColor(laCream)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    CharacterView(size: 48)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedTimerText(startedAt: context.state.startedAt)
                        .frame(maxWidth: 100)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("\(context.attributes.subjectName) 집중하는 중이야!")
                        .font(.caption)
                        .foregroundStyle(laMuted)
                }
            } compactLeading: {
                CharacterView(size: 22)
            } compactTrailing: {
                ElapsedTimerText(startedAt: context.state.startedAt, font: .caption2)
                    .frame(maxWidth: 60)
            } minimal: {
                CharacterView(size: 22)
            }
            .keylineTint(laGold)
        }
    }
}

extension GromoFocusAttributes {
    fileprivate static var preview: GromoFocusAttributes {
        GromoFocusAttributes(subjectName: "노동법")
    }
}

extension GromoFocusAttributes.ContentState {
    fileprivate static var running: GromoFocusAttributes.ContentState {
        GromoFocusAttributes.ContentState(startedAt: .now)
    }
}

#Preview("Notification", as: .content, using: GromoFocusAttributes.preview) {
    WidgetLiveActivity()
} contentStates: {
    GromoFocusAttributes.ContentState.running
}
