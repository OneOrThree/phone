import ActivityKit
import SwiftUI
import WidgetKit

private enum Palette {
    static let paper = Color(red: 1, green: 253/255, blue: 250/255)
    static let pink = Color(red: 1, green: 166/255, blue: 188/255)
    static let sky = Color(red: 173/255, green: 225/255, blue: 248/255)
    static let ink = Color(red: 73/255, green: 59/255, blue: 57/255)
    static let muted = Color(red: 121/255, green: 98/255, blue: 86/255)
}

private extension GromoFocusAttributes.ContentState {
    var isRest: Bool { phase == "rest" }
    var accent: Color { isRest ? Palette.sky : Palette.pink }
    var catImageName: String { "cat-\(catColor)-\(isRest ? "rest" : "focus")" }
    var status: String { NSLocalizedString(isRest ? "rest.status" : "focus.status", comment: "Live Activity status") }
    var title: String { isRest ? NSLocalizedString("rest.title", comment: "Rest title") : subject }
    var countLabel: String? {
        guard let count = isRest ? restCount : focusCount else { return nil }
        return String.localizedStringWithFormat(
            NSLocalizedString(isRest ? "rest.count" : "focus.count", comment: "People in this state"), count
        )
    }
}

private struct CatArt: View {
    let state: GromoFocusAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Group {
            if let path = Bundle.main.path(forResource: state.catImageName, ofType: "png", inDirectory: "CatArt"),
               let image = UIImage(contentsOfFile: path) {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Image(systemName: "cat.fill").resizable().scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct SmallCatBadge: View {
    let color: String

    private var coat: LinearGradient {
        let colors: [Color]
        switch color {
        case "black": colors = [Color(red: 0.50, green: 0.47, blue: 0.48)]
        case "ginger": colors = [Color(red: 1, green: 0.59, blue: 0.26)]
        case "cream": colors = [Color(red: 1, green: 0.88, blue: 0.62)]
        case "gray": colors = [Color(red: 0.68, green: 0.71, blue: 0.73)]
        case "white": colors = [.white]
        case "calico": colors = [.white, Color(red: 1, green: 0.62, blue: 0.31), .black]
        default: colors = [.white]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        Image(systemName: "cat.fill")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(coat)
            .frame(width: 22, height: 22)
            .background(.white.opacity(0.18), in: Circle())
    }
}

private struct TimerLabel: View {
    let state: GromoFocusAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Text(timerInterval: state.anchor...Date.distantFuture, countsDown: false, showsHours: true)
            .font(.system(size: size, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.72)
    }
}

private struct LockScreenActivity: View {
    let state: GromoFocusAttributes.ContentState

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(state.accent).frame(width: 7, height: 7)
                    Text(state.status)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                }
                Text(state.title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                TimerLabel(state: state, size: 30).foregroundStyle(Palette.ink)
                if let count = state.countLabel {
                    Text(count).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
                }
            }
            Spacer(minLength: 0)
            CatArt(state: state, size: 82)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paper)
        .activityBackgroundTint(Palette.paper)
        .activitySystemActionForegroundColor(Palette.ink)
    }
}

private struct ExpandedActivity: View {
    let state: GromoFocusAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            CatArt(state: state, size: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(state.status).font(.system(size: 12, weight: .semibold)).foregroundStyle(state.accent)
                Text(state.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                if let count = state.countLabel {
                    Text(count).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            TimerLabel(state: state, size: 24)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GromoFocusAttributes.self) { context in
            LockScreenActivity(state: context.state)
                .widgetURL(URL(string: "com.oneorthree.focuscat://activity"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) { ExpandedActivity(state: context.state) }
            } compactLeading: {
                HStack(spacing: 3) {
                    SmallCatBadge(color: context.state.catColor)
                    Text(NSLocalizedString(context.state.isRest ? "rest.short" : "focus.short", comment: "Compact status"))
                        .font(.system(size: 11, weight: .semibold))
                }
            } compactTrailing: {
                TimerLabel(state: context.state, size: 13)
            } minimal: {
                SmallCatBadge(color: context.state.catColor)
                    .accessibilityLabel(context.state.status)
            }
            .widgetURL(URL(string: "com.oneorthree.focuscat://activity"))
            .keylineTint(context.state.accent)
        }
    }
}

@main
struct FocusWidgetBundle: WidgetBundle {
    var body: some Widget { FocusWidget() }
}
