import AppKit

/// The Vast Group "V", traced from the brand logo (vastgroup-web-v2,
/// public/vastgroup-logo-white.svg). One drawing for the app icon
/// (scripts/make-icon.swift) and the menu bar mark, so the two never drift.
enum VastMark {
    /// The mark's width over its height.
    static let aspect: CGFloat = 0.87436

    /// The V filling `rect`'s height, centred horizontally, in AppKit's y-up space.
    static func path(in rect: CGRect) -> NSBezierPath {
        let h = rect.height
        let x0 = rect.midX - h * aspect / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x0 + x * h, y: rect.minY + y * h) }
        let p = NSBezierPath()
        p.move(to: pt(0.87436, 1.0))
        p.line(to: pt(0.4736, 0.0))
        p.line(to: pt(0.26353, 0.0))
        p.line(to: pt(0.0, 0.65681))
        p.line(to: pt(0.18667, 0.65681))
        p.curve(to: pt(0.23531, 0.64277), controlPoint1: pt(0.20674, 0.65681), controlPoint2: pt(0.2231, 0.65203))
        p.curve(to: pt(0.26353, 0.60672), controlPoint1: pt(0.24755, 0.6335), controlPoint2: pt(0.25709, 0.6214))
        p.line(to: pt(0.31977, 0.41453))
        p.curve(to: pt(0.34655, 0.33806), controlPoint1: pt(0.3289, 0.39123), controlPoint2: pt(0.3378, 0.36575))
        p.curve(to: pt(0.37126, 0.2513), controlPoint1: pt(0.35531, 0.3104), controlPoint2: pt(0.36355, 0.28143))
        p.line(to: pt(0.39288, 0.33806))
        p.curve(to: pt(0.41863, 0.41453), controlPoint1: pt(0.40087, 0.36575), controlPoint2: pt(0.4095, 0.39123))
        p.line(to: pt(0.61083, 0.94991))
        p.curve(to: pt(0.63788, 0.98457), controlPoint1: pt(0.61585, 0.96268), controlPoint2: pt(0.62487, 0.97425))
        p.curve(to: pt(0.68627, 1.0), controlPoint1: pt(0.65087, 0.99486), controlPoint2: pt(0.6671, 1.0))
        p.close()
        return p
    }
}
