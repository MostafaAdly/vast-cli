import XCTest
@testable import VastBarCore

final class RunSummaryTests: XCTestCase {
    private func summary(_ name: String) throws -> RunSummary {
        summarize(NDJSON.events(from: try fixtureText(name)))
    }

    func testRealReleaseWalksEveryPhaseToReleased() throws {
        let s = try summary("release-real.ndjson")
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.exitCode, 0)
        XCTAssertFalse(s.anyFailed)
        XCTAssertFalse(s.cliFailed)
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2"])
        XCTAssertEqual(s.repos[0].phase, .finished(status: "released"))
        XCTAssertEqual(s.repos[0].runUrl, "https://github.com/example/VastPayPwaV2/actions/runs/42")
        XCTAssertEqual(s.repos[0].version, "2.1.18-rc6")
    }

    func testPartialRunIsStillBuilding() throws {
        let s = try summary("release-partial.ndjson")
        XCTAssertFalse(s.isFinished)
        XCTAssertEqual(s.repos[0].phase, .building(elapsedMs: 0))
    }

    func testDryRunKeepsPlansAndRefusals() throws {
        let s = try summary("release-dry-run.ndjson")
        XCTAssertTrue(s.dryRun)
        XCTAssertEqual(s.plans.map(\.repo), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(s.plans.map(\.ok), [true, false])
        XCTAssertTrue(s.anyFailed)
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2", "VastMenuPwa"])
    }

    func testEndWithoutDoneIsACliFailure() throws {
        let s = try summary("cli-failed.ndjson")
        XCTAssertTrue(s.isFinished)
        XCTAssertTrue(s.cliFailed)
    }

    func testPromotePreviewCarriesThePR() throws {
        let s = try summary("promote-dry-run.ndjson")
        XCTAssertEqual(s.command, "promote")
        XCTAssertEqual(s.prs.first?.version, "2.1.18")
        XCTAssertFalse(s.cliFailed)
    }

    func testRolloutPhaseShowsState() {
        let s = summarize([
            .start(command: "release", args: [], dryRun: false, repos: ["A"]),
            .rollout(repo: "A", state: "OutOfSync/Progressing", reason: nil, elapsedMs: 5000),
        ])
        XCTAssertEqual(s.repos[0].phase, .rollingOut(state: "OutOfSync/Progressing", elapsedMs: 5000))
    }

    func testRunIDsSortByTimeAndRecordsRoundTrip() throws {
        let a = newRunID(now: Date(timeIntervalSince1970: 1_000))
        let b = newRunID(now: Date(timeIntervalSince1970: 2_000))
        XCTAssertLessThan(a, b)
        let r = RunRecord(id: a, pid: 7, args: ["release", "A", "--json"], startedAt: Date(timeIntervalSince1970: 1_000), dismissed: false)
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601
        XCTAssertEqual(try d.decode(RunRecord.self, from: e.encode(r)), r)
    }
}
