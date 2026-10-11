import XCTest
@testable import VastBarCore

final class AppStateTests: XCTestCase {
    private func status() throws -> StatusSnapshot { try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json")) }
    private func doctor() throws -> DoctorSnapshot { try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json")) }
    private func pending() throws -> PendingSnapshot { try VastJSON.decoder().decode(PendingSnapshot.self, from: fixture("pending.json")) }
    private func tracked(_ fixtureName: String, state: RunState, dismissed: Bool = false) throws -> TrackedRun {
        TrackedRun(
            record: RunRecord(id: fixtureName, pid: 1, args: [], startedAt: Date(), dismissed: dismissed),
            summary: summarize(NDJSON.events(from: try fixtureText(fixtureName))),
            state: state)
    }
    private let allOk = DoctorSnapshot(generatedAt: Date(), checks: [])

    func testRunState() throws {
        let partial = summarize(NDJSON.events(from: try fixtureText("release-partial.ndjson")))
        XCTAssertEqual(runState(summary: partial, alive: true), .running)
        XCTAssertEqual(runState(summary: partial, alive: false), .died)
        let done = summarize(NDJSON.events(from: try fixtureText("release-real.ndjson")))
        XCTAssertEqual(runState(summary: done, alive: false), .finished)
    }

    func testIsRunAliveNeedsALivePidAndAYoungRun() {
        let now = Date()
        let young = RunRecord(id: "a", pid: 42, args: [], startedAt: now.addingTimeInterval(-60), dismissed: false)
        let old = RunRecord(id: "b", pid: 42, args: [], startedAt: now.addingTimeInterval(-3 * 3600), dismissed: false)
        XCTAssertTrue(isRunAlive(young, now: now, pidAlive: { _ in true }))
        XCTAssertFalse(isRunAlive(old, now: now, pidAlive: { _ in true }), "a pid answering after 2h is most likely reused")
        XCTAssertFalse(isRunAlive(young, now: now, pidAlive: { _ in false }))
        XCTAssertFalse(isRunAlive(young, now: now, pidAlive: { $0 != 42 }), "asks about the record's own pid")
    }

    func testAStartWhosePidIsUnknownReadsAliveForTenMinutes() {
        let now = Date()
        let pending = { (age: TimeInterval) in
            RunRecord(id: "p", pid: RunRecord.pendingPID, args: [], startedAt: now.addingTimeInterval(-age), dismissed: false)
        }
        var asked = false
        XCTAssertTrue(isRunAlive(pending(60), now: now, pidAlive: { _ in asked = true; return false }))
        XCTAssertFalse(asked, "pid -1 is never passed to kill: kill(-1, 0) reaches every process")
        XCTAssertTrue(isRunAlive(pending(9 * 60), now: now, pidAlive: { _ in false }))
        XCTAssertFalse(isRunAlive(pending(11 * 60), now: now, pidAlive: { _ in true }))
        // its NDJSON still decides once `end` is there
        let ended = summarize([.end(exitCode: 0)])
        XCTAssertEqual(runState(summary: ended, alive: isRunAlive(pending(60), now: now)), .finished)
    }

    func testAStartWithNoEventsYetCoversItsArgsRepos() throws {
        let status = try status()
        let fresh = run(args: ["release", "--frontend", "--json"], events: [], state: .running)
        XCTAssertEqual(reposOf(fresh, status: status), ["VastPayPwaV2", "VastMenuPwa"])
        let started = run(args: ["release", "--frontend", "--json"],
                          events: [.start(command: "release", args: [], dryRun: false, repos: ["VastMenuPwa"])],
                          state: .running)
        XCTAssertEqual(reposOf(started, status: status), ["VastMenuPwa"], "events win once they arrive")
        let cards = repoCards(status: status, doctor: nil, pending: nil, runs: [fresh])
        XCTAssertEqual(cards.map(\.isRunning), [true, true, false])
        XCTAssertNil(cards[0].progress, "no progress yet: the row reads starting…")
    }

    private func run(args: [String], events: [VastEvent], state: RunState) -> TrackedRun {
        TrackedRun(record: RunRecord(id: UUID().uuidString, pid: 1, args: args, startedAt: Date(), dismissed: false),
                   summary: summarize(events), state: state)
    }

    func testReposCoveredByArgs() throws {
        let status = try status()
        XCTAssertEqual(reposCovered(args: ["release", "VastPayPwaV2", "--json"], status: status), ["VastPayPwaV2"])
        XCTAssertEqual(reposCovered(args: ["promote", "VastMenuPwa", "--to", "production", "--json"], status: status), ["VastMenuPwa"])
        XCTAssertEqual(reposCovered(args: ["release", "--frontend", "--json"], status: status), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(reposCovered(args: ["release", "--backend", "--fix-version", "--json"], status: status), ["VastPay-BackEnd"])
        XCTAssertEqual(reposCovered(args: [], status: status), [])
    }

    func testStartRefusesAnUnsafeName() {
        XCTAssertEqual(repoNameRefusal(["A", "--slack"]), "Not a repo name vast can be run with: --slack")
        XCTAssertNil(repoNameRefusal(["A"]))
        XCTAssertNotNil(startRefusal(named: ["-x"], covers: ["-x"], runs: [], status: nil))
        XCTAssertNil(startRefusal(named: ["A"], covers: ["A"], runs: [], status: nil))
        XCTAssertNil(startRefusal(named: [], covers: ["A", "B"], runs: [], status: nil), "a train names no repo on the command line")
    }

    func testStartRefusesARepoARunningRunCovers() throws {
        let status = try status()
        // after its start event: the summary's repos
        let started = run(args: ["release", "--frontend", "--json"],
                          events: [.start(command: "release", args: [], dryRun: false, repos: ["VastPayPwaV2", "VastMenuPwa"])],
                          state: .running)
        XCTAssertNotNil(startRefusal(named: ["VastMenuPwa"], covers: ["VastMenuPwa"], runs: [started], status: status))
        XCTAssertNil(startRefusal(named: ["VastPay-BackEnd"], covers: ["VastPay-BackEnd"], runs: [started], status: status))
        // before its first event: the record's args, a train mapped through status
        let fresh = run(args: ["release", "--frontend", "--json"], events: [], state: .running)
        XCTAssertNotNil(startRefusal(named: ["VastPayPwaV2"], covers: ["VastPayPwaV2"], runs: [fresh], status: status))
        let freshOne = run(args: ["promote", "VastPay-BackEnd", "--to", "production", "--json"], events: [], state: .running)
        XCTAssertNotNil(startRefusal(named: [], covers: ["VastPayPwaV2", "VastPay-BackEnd"], runs: [freshOne], status: status))
        // a finished or died run does not block
        let finished = run(args: ["release", "VastMenuPwa", "--json"], events: [], state: .finished)
        let died = run(args: ["release", "VastMenuPwa", "--json"], events: [], state: .died)
        XCTAssertNil(startRefusal(named: ["VastMenuPwa"], covers: ["VastMenuPwa"], runs: [finished, died], status: status))
    }

    func testIconPrecedenceFailedRunningAttentionOk() throws {
        // doctor fixture has a fail → failed wins over everything
        XCTAssertEqual(iconState(doctor: try doctor(), status: try status(), runs: []), .failed)
        // a running run beats attention
        let running = try tracked("release-partial.ndjson", state: .running)
        XCTAssertEqual(iconState(doctor: allOk, status: try status(), runs: [running]), .running)
        // status has a "?" cell → attention
        XCTAssertEqual(iconState(doctor: allOk, status: try status(), runs: []), .attention)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: []), .ok)
    }

    func testAFailedOrDeadRunIsRedUntilDismissed() throws {
        let failed = try tracked("cli-failed.ndjson", state: .finished)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [failed]), .failed)
        let died = try tracked("release-partial.ndjson", state: .died)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [died]), .failed)
        let dismissed = try tracked("cli-failed.ndjson", state: .finished, dismissed: true)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [dismissed]), .ok)
        // a dry run that refused a repo is a preview, not a failure
        let preview = try tracked("release-dry-run.ndjson", state: .finished)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [preview]), .ok)
    }

    func testCardsJoinStatusDoctorPendingAndRuns() throws {
        let running = try tracked("release-partial.ndjson", state: .running)
        let cards = repoCards(status: try status(), doctor: try doctor(), pending: try pending(), runs: [running])
        XCTAssertEqual(cards.map(\.id), ["VastPayPwaV2", "VastMenuPwa", "VastPay-BackEnd"])
        XCTAssertEqual(cards[0].staging, "2.1.18-rc5")
        XCTAssertEqual(cards[0].production, "2.1.17")
        XCTAssertEqual(cards[0].drift, "develop +5")
        XCTAssertEqual(cards[0].waitingPRs, 2)
        XCTAssertTrue(cards[0].isRunning)
        XCTAssertEqual(cards[0].progress?.phase, .building(elapsedMs: 0))
        XCTAssertEqual(cards[1].staging, "?")
        XCTAssertEqual(cards[1].problems.map(\.detail), [
            "staging tag could not be read",
            "next 1.6.12-rc1 is not above production 1.6.12 — release it with --fix-version (→ 1.6.13-rc1)",
        ])
        XCTAssertFalse(cards[1].isRunning)
        XCTAssertNil(cards[1].waitingPRs)
        XCTAssertEqual(cards[2].production, "not migrated")
        XCTAssertEqual(cards[2].problems, [])
    }

    func testFinishedRunStillShowsItsProgressAndPRLink() throws {
        let finished = try tracked("promote-dry-run.ndjson", state: .finished)
        let cards = repoCards(status: try status(), doctor: nil, pending: nil, runs: [finished])
        XCTAssertFalse(cards[0].isRunning)
        XCTAssertNil(cards[0].progress, "a dry run is a preview, not a card's progress")
        let real = try tracked("release-real.ndjson", state: .finished)
        let cards2 = repoCards(status: try status(), doctor: nil, pending: nil, runs: [real])
        XCTAssertEqual(cards2[0].progress?.phase, .finished(status: "released"))
    }

    func testStaleAfterTwoMissedRefreshes() {
        let now = Date()
        XCTAssertFalse(isStale(lastSuccess: now.addingTimeInterval(-60), now: now))
        XCTAssertTrue(isStale(lastSuccess: now.addingTimeInterval(-11 * 60), now: now))
        XCTAssertTrue(isStale(lastSuccess: nil, now: now))
    }

    func testAttentionLinesAreWarnsAndFails() throws {
        XCTAssertEqual(attentionLines(doctor: try doctor()).map(\.label), ["ArgoCD staging", "VastMenuPwa"])
    }

    // A repo's own warnings already sit on its card; the footer only lists the rest.
    func testFooterLinesLeaveRepoChecksToTheirCards() throws {
        XCTAssertEqual(footerLines(doctor: try doctor()).map(\.label), ["ArgoCD staging"])
    }

    func testTrainRepos() throws {
        XCTAssertEqual(trainRepos(.frontend, status: try status()), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(trainRepos(.backend, status: try status()), ["VastPay-BackEnd"])
    }
}
