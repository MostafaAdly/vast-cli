import AppKit
import SwiftUI
import VastBarCore

/// Every colour and metric the popover uses. The rule: surfaces stay
/// neutral; colour appears only as accents — thin strips, dots, icon and
/// text colour, and tints of that same hue. The one strong fill on a screen
/// is its primary button.
///
/// Meanings are fixed: blue = staging, selection, building; green =
/// production, done, up; orange = waiting PRs, warnings; purple = frontend
/// and drift; teal = backend; red = problems only.
enum Theme {
    static let staging = Color(nsColor: .systemBlue)
    static let production = Color(nsColor: .systemGreen)
    static let waiting = Color(nsColor: .systemOrange)
    static let drift = Color(nsColor: .systemPurple)
    static let problem = Color(nsColor: .systemRed)
    static let frontend = Color(nsColor: .systemPurple)
    static let backend = Color(nsColor: .systemTeal)
    static let other = Color(nsColor: .systemGray)

    /// Selection, building, the primary button: staging blue.
    static let accent = staging
    static let done = production

    /// A tint of one hue behind text or an icon of that same hue.
    static func tint(_ c: Color) -> Color { c.opacity(0.12) }

    /// Cards, tiles, plan rows: a subtle neutral that works in dark and light.
    static let card = Color(nsColor: .quaternaryLabelColor).opacity(0.35)
    static let hairline = Color(nsColor: .separatorColor)

    static let radius: CGFloat = 10
    static let dot: CGFloat = 7
    static let strip: CGFloat = 3
    /// The checkbox column: names, pills and problems line up after it.
    static let checkWidth: CGFloat = 16
    static let rowSpacing: CGFloat = 8
    static var indent: CGFloat { checkWidth + rowSpacing }

    static func state(_ s: IconState) -> NSColor {
        switch s {
        case .ok: return .systemGreen
        case .running: return .systemBlue
        case .attention: return .systemOrange
        case .failed: return .systemRed
        }
    }

    static func stateColor(_ s: IconState) -> Color { Color(nsColor: state(s)) }

    static func stateSymbol(_ s: IconState) -> String {
        switch s {
        case .ok: return "checkmark.circle"
        case .running: return "arrow.triangle.2.circlepath"
        case .attention: return "exclamationmark.triangle"
        case .failed: return "xmark.octagon"
        }
    }

    static func team(_ team: String?) -> Color {
        switch team {
        case Train.frontend.rawValue?: return frontend
        case Train.backend.rawValue?: return backend
        default: return other
        }
    }

    static func health(_ h: HealthState) -> Color {
        switch h {
        case .unknown: return other
        case .up: return production
        // Amber, never red: a staging backend that is down is worth a look,
        // never a failure of ours (the menu bar icon says the same).
        case .down: return waiting
        }
    }
}

/// A 7pt dot in one colour.
struct Dot: View {
    let color: Color
    var body: some View { Circle().fill(color).frame(width: Theme.dot, height: Theme.dot) }
}

/// The blue loader a running card shows where its checkbox was.
struct Spinner: View {
    @State private var turning = false
    var body: some View {
        Image(systemName: "arrow.triangle.2.circlepath")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.staging)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .animation(.linear(duration: 1.2).repeatForever(autoreverses: false), value: turning)
            .onAppear { turning = true }
    }
}
