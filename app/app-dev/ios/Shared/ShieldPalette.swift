// scripts/generate-report-palette.cjs로 생성. 정본: src/design-system/tokens.ts
import UIKit

enum ShieldPalette {
    static let background = UIColor(red: 255.0 / 255, green: 247.0 / 255, blue: 235.0 / 255, alpha: 1)
    static let title = UIColor(red: 73.0 / 255, green: 59.0 / 255, blue: 57.0 / 255, alpha: 1)
    static let subtitle = UIColor(red: 121.0 / 255, green: 98.0 / 255, blue: 86.0 / 255, alpha: 1)
    static let button = UIColor(red: 255.0 / 255, green: 166.0 / 255, blue: 188.0 / 255, alpha: 1)
    static let buttonText = UIColor(red: 73.0 / 255, green: 59.0 / 255, blue: 57.0 / 255, alpha: 1)
    static let iconSize: CGFloat = 96
}
