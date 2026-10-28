import Darwin
import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private func focusShield() -> ShieldConfiguration {
        // 재부팅 전 차단은 서버 세션을 확인할 앱이 다시 적용할 때까지 해제한다.
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.focuscat")
        var boot = timeval()
        var size = MemoryLayout<timeval>.size
        if sysctlbyname("kern.boottime", &boot, &size, nil, 0) == 0,
           defaults?.integer(forKey: "gromo:focus:shieldBoot") != Int(boot.tv_sec) {
            ManagedSettingsStore(named: .init("gromoFocus")).clearAllSettings()
            defaults?.set(false, forKey: "gromo:focus:shieldActive")
        }
        let subject = defaults?.string(forKey: "gromo:focus:shieldSubject")?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let subtitle = subject.isEmpty || subject == "집중"
            ? "집중이 끝날 때까지 이 앱은 잠시 쉬어가요."
            : "지금은 ‘\(subject)’에 집중하고 있어요.\n이 앱은 잠시 쉬어가요."
        let color = defaults?.string(forKey: "gromo:focus:shieldCatColor") ?? "black"
        return ShieldConfiguration(
            backgroundBlurStyle: nil,
            backgroundColor: ShieldPalette.background,
            icon: catIcon(color: color),
            title: .init(text: "지금은 집중 시간이에요", color: ShieldPalette.title),
            subtitle: .init(
                text: subtitle,
                color: ShieldPalette.subtitle
            ),
            primaryButtonLabel: .init(text: "닫기", color: ShieldPalette.buttonText),
            primaryButtonBackgroundColor: ShieldPalette.button
        )
    }

    private func catIcon(color: String) -> UIImage? {
        let colors = ["black", "ginger", "cream", "gray", "white", "calico"]
        let coat = colors.contains(color) ? color : "black"
        guard let image = UIImage(named: "cat-\(coat)-focus", in: Bundle(for: Self.self), compatibleWith: nil) else {
            return UIImage(systemName: "cat.fill")?.withTintColor(ShieldPalette.title, renderingMode: .alwaysOriginal)
        }
        // 원본 PNG를 재사용하고 시스템 아이콘 영역에 맞춰 비율을 유지한다.
        let ratio = ShieldPalette.iconSize / max(image.size.width, image.size.height)
        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
        return UIGraphicsImageRenderer(size: size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }.withRenderingMode(.alwaysOriginal)
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding application: Application,
        in category: ActivityCategory
    ) -> ShieldConfiguration { focusShield() }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding webDomain: WebDomain,
        in category: ActivityCategory
    ) -> ShieldConfiguration { focusShield() }
}
