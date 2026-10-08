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
    var body: some Widget {
        FocusWidget()
        GromoHomeWidget()
    }
}


private struct HomeSnapshot: Decodable {
    let owner: String
    let day: String
    let totalSeconds: Double
    let catColor: String
    let observedAt: Double
}

private struct HomeEntry: TimelineEntry {
    let date: Date
    let snapshot: HomeSnapshot?
    var pose: String {
        ["idle", "loaf", "reading", "tilt"][Int(date.timeIntervalSince1970 / 3600) % 4]
    }
    var seconds: Int? {
        guard let snapshot, !snapshot.owner.isEmpty,
              snapshot.day == HomeProvider.day(date),
              snapshot.totalSeconds.isFinite, snapshot.totalSeconds >= 0,
              snapshot.totalSeconds <= 86400,
              snapshot.observedAt <= date.timeIntervalSince1970 * 1000 + 60000 else { return nil }
        return Int(snapshot.totalSeconds)
    }
}

private struct HomeProvider: TimelineProvider {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar
    }
    static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    func placeholder(in context: Context) -> HomeEntry {
        HomeEntry(date: Date(), snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (HomeEntry) -> Void) {
        completion(HomeEntry(date: Date(), snapshot: read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeEntry>) -> Void) {
        let now = Date()
        let snapshot = read()
        // 자정 항목을 반드시 포함해 OS가 앱을 깨우지 않아도 어제 값을 오늘로 표시하지 않는다.
        let midnight = Self.calendar.startOfDay(for: now).addingTimeInterval(86400)
        var dates = [now, midnight]
        for hour in 1...6 { dates.append(now.addingTimeInterval(Double(hour) * 3600)) }
        let entries = Set(dates).sorted().map { HomeEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(6 * 3600))))
    }
    private func read() -> HomeSnapshot? {
        guard let data = UserDefaults(suiteName: "group.com.oneorthree.focuscat")?.data(forKey: "gromo:widget:home") else { return nil }
        return try? JSONDecoder().decode(HomeSnapshot.self, from: data)
    }
}

private struct HomeWidgetView: View {
    let entry: HomeEntry
    @Environment(\.widgetFamily) private var family
    @ScaledMetric(relativeTo: .title2) private var numberSize: CGFloat = 26
    private var color: String {
        let candidate = entry.snapshot?.catColor ?? "black"
        return ["black", "ginger", "cream", "gray", "white", "calico"].contains(candidate) ? candidate : "black"
    }
    private var duration: String {
        guard let seconds = entry.seconds else { return "—" }
        return String.localizedStringWithFormat(NSLocalizedString("widget.duration", comment: "집중시간"), seconds / 3600, (seconds / 60) % 60)
    }
    private var cat: some View {
        Group {
            if let path = Bundle.main.path(forResource: "cat-\(color)-\(entry.pose)", ofType: "png", inDirectory: "CatArt"),
               let image = UIImage(contentsOfFile: path) {
                Image(uiImage: image).resizable().scaledToFit()
            }
        }.frame(maxWidth: 100, maxHeight: 82).accessibilityHidden(true)
    }
    private var value: some View {
        VStack(spacing: 4) {
            Text("widget.today").font(.caption).foregroundStyle(Palette.inkSub)
            Text(duration).font(.system(size: numberSize, weight: .bold)).monospacedDigit()
                .foregroundStyle(Palette.ink).minimumScaleFactor(0.7).lineLimit(1)
        }
    }
    private var content: some View {
        Group {
            if family == .systemMedium { HStack(spacing: 20) { cat; value } }
            else { VStack(spacing: 8) { cat; value } }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .widgetURL(URL(string: "com.oneorthree.focuscat://widget"))
            .accessibilityElement(children: .combine)
    }
    var body: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(Palette.bg, for: .widget)
        } else {
            content.padding(16).background(Palette.bg)
        }
    }
}

private struct GromoHomeWidget: Widget {
    let kind = "GromoHomeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HomeProvider()) { HomeWidgetView(entry: $0) }
            .configurationDisplayName("widget.name")
            .description("widget.description")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
