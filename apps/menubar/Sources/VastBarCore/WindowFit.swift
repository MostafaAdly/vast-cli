import CoreGraphics

/// The frame that makes the menu bar window exactly as tall as its content,
/// with its top edge where it was, or nil when it already fits.
///
/// MenuBarExtra grows its window with the content but does not shrink it back:
/// after a tall view (several repos), a short one (a one-repo release) sat
/// centred in the old height, floating far below the menu bar (2.9.2).
/// AppKit's origin is the bottom left, so keeping the top means moving the
/// origin. `chrome` is the window's height outside its content view.
public func fittedWindowFrame(_ window: CGRect, contentHeight: CGFloat, chrome: CGFloat) -> CGRect? {
    guard contentHeight > 0 else { return nil }
    let height = contentHeight + chrome
    guard abs(height - window.height) >= 0.5 else { return nil }
    return CGRect(x: window.minX, y: window.maxY - height, width: window.width, height: height)
}
