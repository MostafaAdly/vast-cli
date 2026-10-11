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
        // zsh expands a word that starts with `=` (`=ls` becomes /bin/ls)
        XCTAssertEqual(shellQuote("=ls"), "'=ls'")
        XCTAssertEqual(shellQuote("a=b"), "a=b")
        XCTAssertEqual(VastCommand(args: ["status", "$(whoami)"]).shellLine, "vast status '$(whoami)'")
    }

    func testSafeRepoNames() {
        XCTAssertTrue(isSafeRepoName("VastPay-BackEnd"))
        XCTAssertTrue(isSafeRepoName("Vast_deployments.v2"))
        XCTAssertFalse(isSafeRepoName(""))
        XCTAssertFalse(isSafeRepoName("-x"), "would parse as an option")
        XCTAssertFalse(isSafeRepoName("--slack"))
        XCTAssertFalse(isSafeRepoName("a b"))
        XCTAssertFalse(isSafeRepoName("a;b"))
        XCTAssertFalse(isSafeRepoName("a/b"))
        XCTAssertFalse(isSafeRepoName("é"))
    }

    func testTargetRepoNameAndCoverage() throws {
        let status = try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json"))
        XCTAssertEqual(ReleaseTarget.repo("A").repoName, "A")
        XCTAssertNil(ReleaseTarget.train(.frontend).repoName)
        XCTAssertEqual(targetRepos(.repo("A"), status: status), ["A"])
        XCTAssertEqual(targetRepos(.train(.frontend), status: status), ["VastPayPwaV2", "VastMenuPwa"])
    }

    func testAppleScriptQuote() {
        XCTAssertEqual(appleScriptQuote(#"vast release "x" \ y"#), #""vast release \"x\" \\ y""#)
    }
}
