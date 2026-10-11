import AppKit
import SwiftUI
import VastBarCore

/// The mark with a state dot. The menu bar only shows colour from a
/// non-template image, so the whole thing is drawn into one NSImage.
struct MenuBarIcon: View {
    let state: IconState
    @State private var dim = false

    /// The pulse ticks only while running; any other state has no timer.
    var body: some View {
        Image(nsImage: Self.image(state: state, dim: state == .running && dim))
            .task(id: state) {
                dim = false
                guard state == .running else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    if !Task.isCancelled { dim.toggle() }
                }
            }
    }

    static func color(_ state: IconState) -> NSColor {
        switch state {
        case .ok: return .systemGreen
        case .running: return .systemBlue
        case .attention: return .systemOrange
        case .failed: return .systemRed
        }
    }

    static func image(state: IconState, dim: Bool) -> NSImage {
        let size = NSSize(width: 22, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            if let mark = NSImage(systemSymbolName: "shippingbox.fill", accessibilityDescription: "Vast Bar")?
                .withSymbolConfiguration(config) {
                let tinted = mark.copy() as! NSImage
                tinted.lockFocus()
                NSColor.labelColor.set()
                NSRect(origin: .zero, size: tinted.size).fill(using: .sourceAtop)
                tinted.unlockFocus()
                tinted.draw(in: NSRect(x: 0, y: 2, width: 16, height: 14))
            }
            let dot = NSBezierPath(ovalIn: NSRect(x: 13, y: 1, width: 8, height: 8))
            color(state).withAlphaComponent(dim ? 0.35 : 1).setFill()
            dot.fill()
            NSColor.windowBackgroundColor.setStroke()
            dot.lineWidth = 1.5
            dot.stroke()
            return true
        }
        image.isTemplate = false
        return image
    }
}
