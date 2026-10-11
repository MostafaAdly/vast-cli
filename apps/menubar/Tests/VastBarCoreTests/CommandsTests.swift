import XCTest
@testable import VastBarCore

final class CommandsTests: XCTestCase {
    func testSnapshots() {
        XCTAssertEqual(Commands.status.args, ["status", "--all", "--json"])
        XCTAssertEqual(Commands.doctor.args, ["doctor", "--json"])
        XCTAssertEqual(Commands.pending.args, ["pending", "--all", "--short", "--json"])
        XCTAssertEqual(Commands.version.args, ["--version"])
    }

    func testReleaseOneRepoAndATrain() {
        XCTAssertEqual(Commands.release(.repo("VastPayPwa"), dryRun: true, fixVersion: false).args,
                       ["release", "VastPayPwa", "--dry-run", "--json"])
        XCTAssertEqual(Commands.release(.train(.frontend), dryRun: false, fixVersion: true).args,
                       ["release", "--frontend", "--fix-version", "--json"])
    }

    func testPromote() {
        XCTAssertEqual(Commands.promote(repo: "VastPayPwa", hotfix: false, slack: false, dryRun: true).args,
                       ["promote", "VastPayPwa", "--to", "production", "--dry-run", "--json"])
        XCTAssertEqual(Commands.promote(repo: "VastPayPwa", hotfix: true, slack: true, dryRun: false).args,
                       ["promote", "VastPayPwa", "--to", "production", "--as", "hotfix", "--slack", "--json"])
    }

    func testShellLineAndTerminalLine() {
        let c = Commands.release(.repo("VastPayPwa"), dryRun: false, fixVersion: false)
        XCTAssertEqual(c.shellLine, "vast release VastPayPwa --json")
        XCTAssertEqual(c.terminalLine, "vast release VastPayPwa")
    }

    func testShellQuoteNeutralisesSpecialCharacters() {
        XCTAssertEqual(shellQuote("VastPay-BackEnd"), "VastPay-BackEnd")
        XCTAssertEqual(shellQuote("a b"), "'a b'")
        XCTAssertEqual(shellQuote("x; rm -rf ~"), "'x; rm -rf ~'")
        XCTAssertEqual(shellQuote("it's"), "'it'\\''s'")
        XCTAssertEqual(shellQuote(""), "''")
        XCTAssertEqual(VastCommand(args: ["status", "$(whoami)"]).shellLine, "vast status '$(whoami)'")
    }

    func testAppleScriptQuote() {
        XCTAssertEqual(appleScriptQuote(#"vast release "x" \ y"#), #""vast release \"x\" \\ y""#)
    }
}
