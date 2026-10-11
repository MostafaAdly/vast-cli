import XCTest
@testable import VastBarCore

final class VersionTests: XCTestCase {
    func testParsesPlainPrereleaseAndPrefixed() {
        XCTAssertEqual(CLIVersion("2.9.0")?.description, "2.9.0")
        XCTAssertEqual(CLIVersion("v2.10.1")?.description, "2.10.1")
        XCTAssertEqual(CLIVersion("2.9.0-dev\n"), CLIVersion("2.9.0"))
        XCTAssertNil(CLIVersion("zsh: command not found: vast"))
    }

    func testOrdersNumericallyNotLexically() {
        XCTAssertLessThan(CLIVersion("2.9.0")!, CLIVersion("2.10.0")!)
    }

    func testCompat() {
        XCTAssertEqual(CLICompat.check(versionOutput: "2.9.0\n", exitCode: 0), .ok(CLIVersion("2.9.0")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "2.9.0-dev\n", exitCode: 0), .ok(CLIVersion("2.9.0")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "2.8.1\n", exitCode: 0), .tooOld(CLIVersion("2.8.1")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "", exitCode: 127), .missing)
        XCTAssertEqual(CLICompat.check(versionOutput: "garbage", exitCode: 0), .missing)
    }
}
