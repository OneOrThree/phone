//
//  WidgetLiveActivity.swift
//  Widget
//
//  Created by Taehwa Kown on 6/27/26.
//

import ActivityKit
import WidgetKit
import SwiftUI

// 집중 세션 Live Activity(GROMO-553) — 세션 중 허용앱을 쓰는 동안
// 다이나믹 아일랜드/잠금화면에 집중 타이머 + 캐릭터를 표시한다.
// ⚠️ GromoFocusAttributes는 메인 앱(ios/gromo/ScreenTimeModule.swift 하단)에도
//    같은 이름·필드로 정의돼 있다 — 반드시 함께 수정할 것(타입명·인코딩으로 매칭됨).
struct GromoFocusAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 타이머 기준 시각 — Text(timerInterval:)가 OS에서 자체 갱신하므로 업데이트 불필요
        var startedAt: Date
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

// gromo 팔레트 — theme.ts에서 자동 생성된 Shared/Palette.swift를 참조한다 (GROMO-641)
// 잠금화면 배너는 앱과 같은 라이트 톤(GROMO-868). 다이나믹 아일랜드는 시스템이
// 항상 검은 배경으로 그리므로 밝은 글자(night 톤)를 유지해야 한다.
private let laBg = Palette.paper
private let laInk = Palette.ink
private let laSub = Palette.inkSub
private let laChipBg = Palette.chipBg
private let laChipBorder = Palette.chipBorder
private let laAccent = Palette.accent
private let diCream = Palette.night.cream
private let diMuted = Palette.night.muted
private let diGold = Palette.night.gold

// 캐릭터 이미지 뷰 — 위젯 번들 에셋(character.imageset, 512px 축소본)을 직접 사용.
// App Group 스냅샷(captureRef) 경로는 배경이 불투명해지는 문제가 있어 쓰지 않는다.
private struct CharacterView: View {
    let size: CGFloat

    var body: some View {
        Image("character")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

// 초 → "00:00:00" — 잠금화면 다른 과목 시간 표시용(앱의 hms 포맷과 동일)
private func hmsString(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
}

// "#RRGGBB" hex → Color (파싱 실패 시 앱 포인트색)
private func colorFromHex(_ hex: String) -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return laAccent }
    return Color(
        red: Double((v >> 16) & 0xFF) / 255,
        green: Double((v >> 8) & 0xFF) / 255,
        blue: Double(v & 0xFF) / 255
    )
}

// 경과 타이머 — OS가 매초 자체 갱신(앱 suspend와 무관)
// color: 잠금화면(라이트 배경)은 ink, 다이나믹 아일랜드(검은 배경)는 cream
private struct ElapsedTimerText: View {
    let startedAt: Date
    var font: Font = .title2
    var color: Color = diCream

    var body: some View {
        Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
            .font(font.weight(.bold).monospacedDigit())
            .foregroundStyle(color)
            .multilineTextAlignment(.trailing)
    }
}

struct WidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GromoFocusAttributes.self) { context in
            // 잠금화면/배너 UI — 현재 과목 타이머 + 다른 과목들의 누적 집중 시간.
            // ⚠️ 잠금화면 높이 상한 160pt — 넘치면 OS가 위를 잘라 캐릭터 머리가 잘린다(GROMO-868).
            //    칩 2개 + 아래 여백 기준 최대 ~154pt로 맞춰둔 것이니 늘릴 때 합산 확인.
            VStack(spacing: 8) {
                HStack(spacing: 12) {
                    CharacterView(size: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.subjectName)
                            .font(.headline.weight(.bold))
                            .foregroundStyle(laInk)
                            .lineLimit(1)
                        Text("집중하는 중이에요!")
                            .font(.footnote)
                            .foregroundStyle(laSub)
                    }
                    Spacer()
                    ElapsedTimerText(startedAt: context.state.startedAt, color: laInk)
                        .frame(maxWidth: 100)
                }
                // 다른 과목 누적 시간 — 세션 중 불변이라 정적 표시로도 정확.
                // 한국어 과목명이 길어 반폭 칩에선 시간이 줄바꿈됨 → 한 줄 1과목 풀폭 칩,
                // 시간은 오른쪽 정렬 + 줄바꿈 금지. 현재 과목 외 최대 2개(높이 상한 대응).
                if !context.attributes.otherSubjects.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(Array(context.attributes.otherSubjects.prefix(2)), id: \.self) { sub in
                            HStack(spacing: 7) {
                                Circle()
                                    .fill(colorFromHex(sub.color))
                                    .frame(width: 8, height: 8)
                                Text(sub.name)
                                    .font(.subheadline)
                                    .foregroundStyle(laSub)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                Text(hmsString(sub.seconds))
                                    .font(.subheadline.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(laInk)
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(laChipBg)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .strokeBorder(laChipBorder, lineWidth: 1)
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(laBg)
            .activitySystemActionForegroundColor(laInk)

        } dynamicIsland: { context in
            // 다이나믹 아일랜드 — 캐릭터 + 과목명 + 경과 타이머
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    CharacterView(size: 52)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedTimerText(startedAt: context.state.startedAt)
                        .frame(maxWidth: 100)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.subjectName)
                        .font(.caption)
                        .foregroundStyle(diMuted)
                }
            } compactLeading: {
                CharacterView(size: 26)
            } compactTrailing: {
                ElapsedTimerText(startedAt: context.state.startedAt, font: .caption2)
                    .frame(maxWidth: 60)
            } minimal: {
                CharacterView(size: 26)
            }
            .keylineTint(diGold)
        }
    }
}

// #Preview(활동 프리뷰 매크로)는 iOS 18 SDK 전용이라 배포 타깃(17.0) 컴파일을 위해 제거.
