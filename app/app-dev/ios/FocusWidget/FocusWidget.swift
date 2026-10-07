import ActivityKit
import SwiftUI
import WidgetKit

private extension GromoFocusAttributes.ContentState {
    var isRest: Bool { phase == "rest" }
    var accent: Color { isRest ? Palette.secondary : Palette.accent }
    var catImageName: String { "cat-\(catColor)-\(isRest ? "rest" : "focus")" }
    func status(isStale: Bool) -> String {
        let key = isRest ? (isStale ? "rest.expired.status" : "rest.status") : "focus.status"
        return NSLocalizedString(key, comment: "Live Activity status")
    }
    func title(isStale: Bool) -> String {
        guard isRest else { return subject }
        return NSLocalizedString(isStale ? "rest.expired.title" : "rest.title", comment: "Rest title")
    }
    func countLabel(isStale: Bool) -> String? {
        if isRest && isStale { return nil }
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
    @ScaledMetric(relativeTo: .caption) private var badgeSize: CGFloat = 22

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
            .font(.caption.weight(.medium))
            .foregroundStyle(coat)
            .frame(width: badgeSize, height: badgeSize)
            .background(.white.opacity(0.18), in: Circle())
    }
}

private struct TimerLabel: View {
    let state: GromoFocusAttributes.ContentState
    let size: CGFloat
    @ScaledMetric(relativeTo: .body) private var textScale: CGFloat = 1

    var body: some View {
        Text(
            timerInterval: state.anchor...(state.restExpiresAt ?? Date.distantFuture),
            pauseTime: state.restExpiresAt,
            countsDown: false,
            showsHours: true
        )
            .font(.system(size: size * textScale, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.72)
    }
}

private struct LockScreenActivity: View {
    let state: GromoFocusAttributes.ContentState
    let isStale: Bool
    @ScaledMetric(relativeTo: .caption) private var statusSize: CGFloat = 12
    @ScaledMetric(relativeTo: .headline) private var titleSize: CGFloat = 17
    @ScaledMetric(relativeTo: .caption) private var countSize: CGFloat = 12

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(state.accent).frame(width: 7, height: 7)
                    Text(state.status(isStale: isStale))
                        .font(.system(size: statusSize, weight: .semibold))
                        .foregroundStyle(Palette.inkSub)
                }
                Text(state.title(isStale: isStale))
                    .font(.system(size: titleSize, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                TimerLabel(state: state, size: 30).foregroundStyle(Palette.ink)
                if let count = state.countLabel(isStale: isStale) {
                    Text(count).font(.system(size: countSize, weight: .medium)).foregroundStyle(Palette.inkSub)
                }
            }
            Spacer(minLength: 0)
            CatArt(state: state, size: 82)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface)
        .activityBackgroundTint(Palette.surface)
        .activitySystemActionForegroundColor(Palette.ink)
    }
}

private struct ExpandedActivity: View {
    let state: GromoFocusAttributes.ContentState
    let isStale: Bool
    @ScaledMetric(relativeTo: .caption) private var statusSize: CGFloat = 12
    @ScaledMetric(relativeTo: .headline) private var titleSize: CGFloat = 16
    @ScaledMetric(relativeTo: .caption2) private var countSize: CGFloat = 11

    var body: some View {
        HStack(spacing: 12) {
            CatArt(state: state, size: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(state.status(isStale: isStale)).font(.system(size: statusSize, weight: .semibold)).foregroundStyle(state.accent)
                Text(state.title(isStale: isStale)).font(.system(size: titleSize, weight: .semibold)).lineLimit(1)
                if let count = state.countLabel(isStale: isStale) {
                    Text(count).font(.system(size: countSize)).foregroundStyle(.secondary)
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
            LockScreenActivity(state: context.state, isStale: context.isStale)
                .widgetURL(URL(string: "com.oneorthree.focuscat://activity"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedActivity(state: context.state, isStale: context.isStale)
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    SmallCatBadge(color: context.state.catColor)
                    Text(NSLocalizedString(
                        context.state.isRest
                            ? (context.isStale ? "rest.expired.short" : "rest.short")
                            : "focus.short",
                        comment: "Compact status"
                    ))
                        .font(.caption2.weight(.semibold))
                }
            } compactTrailing: {
                TimerLabel(state: context.state, size: 13)
            } minimal: {
                SmallCatBadge(color: context.state.catColor)
                    .accessibilityLabel(context.state.status(isStale: context.isStale))
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
