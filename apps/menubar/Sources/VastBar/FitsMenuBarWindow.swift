import AppKit
import SwiftUI
import VastBarCore

/// Keeps the menu bar window exactly as tall as its content, top edge under
/// the menu bar. MenuBarExtra only ever grows its window, so without this a
/// short view after a tall one floats centred in the old height (2.9.2).
struct FitsMenuBarWindow: ViewModifier {
    @State private var window: NSWindow?
    @State private var height: CGFloat = 0

    func body(content: Content) -> some View {
        content
            // Rigid height: the measurement below is the content's own, never
            // a stretched window's.
            .fixedSize(horizontal: false, vertical: true)
            .background(GeometryReader { g in Color.clear.preference(key: ContentHeight.self, value: g.size.height) })
            .background(WindowProbe { window = $0; fit() })
            .onPreferenceChange(ContentHeight.self) { height = $0; fit() }
            .onAppear { fit() }
    }

    private func fit() {
        guard let window else { return }
        let chrome = window.frame.height - window.contentRect(forFrameRect: window.frame).height
        guard let frame = fittedWindowFrame(window.frame, contentHeight: height, chrome: chrome) else { return }
        window.setFrame(frame, display: true)
    }
}

private struct ContentHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Reports the window the SwiftUI content lands in.
private struct WindowProbe: NSViewRepresentable {
    let onWindow: (NSWindow?) -> Void

    func makeNSView(context: Context) -> Probe { Probe(onWindow) }
    func updateNSView(_ view: Probe, context: Context) {}

    final class Probe: NSView {
        let onWindow: (NSWindow?) -> Void
        init(_ onWindow: @escaping (NSWindow?) -> Void) {
            self.onWindow = onWindow
            super.init(frame: .zero)
        }
        required init?(coder: NSCoder) { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            // Not during SwiftUI's own update pass.
            DispatchQueue.main.async { [weak self] in self?.onWindow(self?.window) }
        }
    }
}
