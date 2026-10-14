import XCTest
@testable import VastBarCore

final class CommandsTests: XCTestCase {
    func testSnapshots() {
        XCTAssertEqual(Commands.status.args, ["status", "--all", "--json"])
        XCTAssertEqual(Commands.doctor.args, ["doctor", "--json"])
        XCTAssertEqual(Commands.pending.args, ["pending", "--all", "--short", "--json"])
        XCTAssertEqual(Commands.version.args, ["--version"])
        XCTAssertEqual(Commands.statusNoFetch.args, ["status", "--all", "--json", "--no-fetch"])
    }

    func testWithoutDryRunIsThePreviewedCommandForReal() {
        let promote = Commands.promote(repo: "VastPayPwa", hotfix: true, slack: true, dryRun: true)
        XCTAssertEqual(promote.withoutDryRun.args,
                       ["promote", "VastPayPwa", "--to", "production", "--as", "hotfix", "--slack", "--json"])
        XCTAssertEqual(promote.withoutDryRun, Commands.promote(repo: "VastPayPwa", hotfix: true, slack: true, dryRun: false))
        let train = Commands.release(.train(.frontend), dryRun: true, fixVersion: true)
        XCTAssertEqual(train.withoutDryRun, Commands.release(.train(.frontend), dryRun: false, fixVersion: true))
        let real = Commands.release(.repo("VastPayPwa"), dryRun: false, fixVersion: false)
        XCTAssertEqual(real.withoutDryRun, real, "a real command is unchanged")
    }

    func testSafeTerminalLineIsADryRunThatNeverPosts() {
        let promote = Commands.promote(repo: "VastPayPwa", hotfix: true, slack: true, dryRun: false)
        XCTAssertEqual(promote.safeTerminalLine, "vast promote VastPayPwa --to production --as hotfix --dry-run")
        XCTAssertEqual(promote.terminalLine, "vast promote VastPayPwa --to production --as hotfix --slack",
                       "Copy command keeps the full command")
        let release = Commands.release(.repo("VastPayPwa"), dryRun: false, fixVersion: true)
        XCTAssertEqual(release.safeTerminalLine, "vast release VastPayPwa --fix-version --dry-run")
        let dry = Commands.release(.train(.backend), dryRun: true, fixVersion: false)
        XCTAssertEqual(dry.safeTerminalLine, "vast release --backend --dry-run", "--dry-run is not added twice")
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
