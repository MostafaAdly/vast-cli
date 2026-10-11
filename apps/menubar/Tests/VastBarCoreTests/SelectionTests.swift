import XCTest
@testable import VastBarCore

final class SelectionTests: XCTestCase {
    private func status() throws -> StatusSnapshot { try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json")) }

    private func running(_ args: [String]) -> TrackedRun {
        TrackedRun(record: RunRecord(id: UUID().uuidString, pid: 1, args: args, startedAt: Date(), dismissed: false),
                   summary: summarize([]), state: .running)
    }

    func testReleaseSeveralReposNamesThemInOrder() {
        XCTAssertEqual(Commands.release(.repos(["VastMenuPwa", "VastPayPwaV2"]), dryRun: true, fixVersion: false).args,
                       ["release", "VastMenuPwa", "VastPayPwaV2", "--dry-run", "--json"])
        XCTAssertEqual(Commands.release(.repos(["A", "B"]), dryRun: false, fixVersion: true).args,
                       ["release", "A", "B", "--fix-version", "--json"])
        let dry = Commands.release(.repos(["A", "B"]), dryRun: true, fixVersion: true)
        XCTAssertEqual(dry.withoutDryRun, Commands.release(.repos(["A", "B"]), dryRun: false, fixVersion: true))
        XCTAssertEqual(dry.safeTerminalLine, "vast release A B --fix-version --dry-run")
    }

    func testTargetNamesAndCoverage() throws {
        XCTAssertEqual(ReleaseTarget.repos(["A", "B"]).repoNames, ["A", "B"])
        XCTAssertEqual(ReleaseTarget.repo("A").repoNames, ["A"])
        XCTAssertEqual(ReleaseTarget.train(.frontend).repoNames, [], "a train names no repo on the command line")
        XCTAssertNil(ReleaseTarget.repos(["A"]).repoName)
        XCTAssertEqual(targetRepos(.repos(["B", "A"]), status: try status()), ["B", "A"])
    }

    func testTitles() {
        XCTAssertEqual(ReleaseTarget.repo("A").title, "Release A to staging")
        XCTAssertEqual(ReleaseTarget.train(.backend).title, "Release backend to staging")
        XCTAssertEqual(ReleaseTarget.repos(["A", "B", "C"]).title, "Release 3 repos to staging")
        XCTAssertEqual(ReleaseTarget.repos(["A"]).title, "Release A to staging")
    }

    func testEveryNameMustBeSafe() {
        XCTAssertEqual(repoNameRefusal(ReleaseTarget.repos(["A", "--slack"]).repoNames),
                       "Not a repo name vast can be run with: --slack")
        XCTAssertNotNil(startRefusal(named: ["A", "b;c"], covers: ["A", "b;c"], runs: [], status: nil))
        XCTAssertNil(startRefusal(named: ["A", "B"], covers: ["A", "B"], runs: [], status: nil))
    }

    func testSeveralReposAreCoveredByTheirArgs() throws {
        let status = try status()
        XCTAssertEqual(reposCovered(args: ["release", "VastMenuPwa", "VastPayPwaV2", "--fix-version", "--json"], status: status),
                       ["VastMenuPwa", "VastPayPwaV2"])
        XCTAssertEqual(reposCovered(args: ["promote", "VastMenuPwa", "--to", "production", "--json"], status: status), ["VastMenuPwa"])
        let fresh = running(Commands.release(.repos(["VastMenuPwa", "VastPay-BackEnd"]), dryRun: false, fixVersion: false).args)
        XCTAssertEqual(reposOf(fresh, status: status), ["VastMenuPwa", "VastPay-BackEnd"])
        XCTAssertNotNil(startRefusal(named: ["VastPay-BackEnd"], covers: ["VastPay-BackEnd"], runs: [fresh], status: status),
                        "a several-repo run in flight refuses each repo it covers")
        XCTAssertNil(startRefusal(named: ["VastPayPwaV2"], covers: ["VastPayPwaV2"], runs: [fresh], status: status))
        let cards = repoCards(status: status, doctor: nil, pending: nil, runs: [fresh])
        XCTAssertEqual(cards.map(\.isRunning), [false, true, true])
    }

    func testSelectionDropsRunningAndUnknownRepos() throws {
        let status = try status()
        let fresh = running(["release", "VastMenuPwa", "--json"])
        let cards = repoCards(status: status, doctor: nil, pending: nil, runs: [fresh])
        XCTAssertEqual(prunedSelection(["VastMenuPwa", "VastPayPwaV2", "Gone"], cards: cards), ["VastPayPwaV2"])
        XCTAssertEqual(selectableRepos(cards), ["VastPayPwaV2", "VastPay-BackEnd"])
    }

    func testSelectionInCardOrder() throws {
        let cards = repoCards(status: try status(), doctor: nil, pending: nil, runs: [])
        XCTAssertEqual(orderedSelection(["VastPay-BackEnd", "VastPayPwaV2"], cards: cards), ["VastPayPwaV2", "VastPay-BackEnd"])
        XCTAssertEqual(orderedSelection([], cards: cards), [])
    }

    func testTeamSectionsFrontendBackendThenOther() throws {
        let cards = repoCards(status: try status(), doctor: nil, pending: nil, runs: [])
        let extra = RepoCard(id: "Lone", displayName: "Lone", releaseTeam: nil, staging: "1", production: "1",
                             drift: "in sync", driftAhead: 0, waitingPRs: nil, problems: [], isRunning: false, progress: nil)
        let sections = teamSections([extra] + cards)
        XCTAssertEqual(sections.map(\.team), ["frontend", "backend", nil])
        XCTAssertEqual(sections.map(\.title), ["Frontend", "Backend", "Other"])
        XCTAssertEqual(sections[0].cards.map(\.id), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(sections[2].cards.map(\.id), ["Lone"])
    }
}
