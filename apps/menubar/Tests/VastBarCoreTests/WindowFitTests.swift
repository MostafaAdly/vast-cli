import XCTest
import CoreGraphics
@testable import VastBarCore

/// AppKit frames have their origin at the bottom left, so keeping a window's
/// top edge under the menu bar means moving its origin when the height changes.
final class WindowFitTests: XCTestCase {
    // The 2.9.2 screenshot: a 721pt window holding 257pt of content, which
    // SwiftUI centred 232pt below the menu bar.
    func testAShrunkContentShrinksTheWindowAndKeepsItsTopEdge() throws {
        let window = CGRect(x: 902, y: 949 - 721, width: 400, height: 721)
        let fitted = try XCTUnwrap(fittedWindowFrame(window, contentHeight: 257, chrome: 0))
        XCTAssertEqual(fitted.height, 257)
        XCTAssertEqual(fitted.maxY, window.maxY, "the top edge stays under the menu bar")
        XCTAssertEqual(fitted.minX, window.minX)
        XCTAssertEqual(fitted.width, window.width)
    }

    func testAGrownContentGrowsTheWindowDownward() throws {
        let window = CGRect(x: 0, y: 700, width: 400, height: 249)
        let fitted = try XCTUnwrap(fittedWindowFrame(window, contentHeight: 600, chrome: 0))
        XCTAssertEqual(fitted.height, 600)
        XCTAssertEqual(fitted.maxY, window.maxY)
    }

    func testTitleBarOrBorderChromeIsKept() throws {
        let fitted = try XCTUnwrap(fittedWindowFrame(CGRect(x: 0, y: 0, width: 400, height: 500), contentHeight: 300, chrome: 2))
        XCTAssertEqual(fitted.height, 302)
    }

    func testAWindowThatAlreadyFitsIsLeftAlone() {
        XCTAssertNil(fittedWindowFrame(CGRect(x: 0, y: 0, width: 400, height: 300), contentHeight: 300.3, chrome: 0))
    }

    func testNoContentMeasuredYetChangesNothing() {
        XCTAssertNil(fittedWindowFrame(CGRect(x: 0, y: 0, width: 400, height: 300), contentHeight: 0, chrome: 0))
    }
}
