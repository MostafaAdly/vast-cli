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
        XCTAssertEqual(cards[1].problems, [
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

    func testTrainRepos() throws {
        XCTAssertEqual(trainRepos(.frontend, status: try status()), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(trainRepos(.backend, status: try status()), ["VastPay-BackEnd"])
    }
}
