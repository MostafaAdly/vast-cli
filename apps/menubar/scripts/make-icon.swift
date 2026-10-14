// Draws Resources/AppIcon.icns: the Vast Group "V" in white on the brand's
// black, on the standard macOS icon tile. Run after changing the mark:
//
//   apps/menubar/scripts/make-icon.sh
//
// Compiled together with Sources/VastBar/VastMark.swift, so the icon and the
// menu bar use one drawing.

import AppKit

@main
struct MakeIcon {
    static func main() throws {
        let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        // iconutil's names: icon_<pt>x<pt>[@2x].png
        for points in [16, 32, 128, 256, 512] {
            for scale in [1, 2] {
                let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
                try png(size: points * scale).write(to: out.appendingPathComponent(name))
            }
        }
    }

    static func png(size: Int) throws -> Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        draw(in: CGRect(x: 0, y: 0, width: size, height: size))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])!
    }

    /// Apple's icon grid: an 824/1024 tile with a 185/1024 corner radius,
    /// a soft shadow under it, and the artwork optically centred.
    static func draw(in canvas: CGRect) {
        let u = canvas.width / 1024
        let tile = CGRect(x: 100 * u, y: 100 * u, width: 824 * u, height: 824 * u)
        let shape = NSBezierPath(roundedRect: tile, xRadius: 185 * u, yRadius: 185 * u)

        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
        shadow.shadowOffset = CGSize(width: 0, height: -10 * u)
        shadow.shadowBlurRadius = 24 * u
        shadow.set()
        NSColor(white: 0.04, alpha: 1).setFill()
        shape.fill()
        NSGraphicsContext.restoreGraphicsState()

        // A barely-there lift at the top so the black tile reads as an object.
        NSGraphicsContext.saveGraphicsState()
        shape.addClip()
        NSGradient(starting: NSColor(white: 0.17, alpha: 1), ending: NSColor(white: 0.04, alpha: 1))!
            .draw(in: tile, angle: -90)
        NSGraphicsContext.restoreGraphicsState()

        // The V at 44% of the tile, nudged up a little: its weight sits low.
        let markHeight = tile.height * 0.44
        let markRect = CGRect(x: tile.minX, y: tile.midY - markHeight / 2 + tile.height * 0.015,
                              width: tile.width, height: markHeight)
        NSColor.white.setFill()
        VastMark.path(in: markRect).fill()
    }
}
