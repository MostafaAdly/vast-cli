import XCTest
@testable import VastBarCore

final class LookTests: XCTestCase {
    private func status() throws -> StatusSnapshot { try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json")) }
    private func doctor() throws -> DoctorSnapshot { try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json")) }
    private func pending() throws -> PendingSnapshot { try VastJSON.decoder().decode(PendingSnapshot.self, from: fixture("pending.json")) }
    private let allOk = DoctorSnapshot(generatedAt: Date(), checks: [])

    private func run(_ args: [String], _ events: [VastEvent], _ state: RunState, dismissed: Bool = false) -> TrackedRun {
        TrackedRun(record: RunRecord(id: UUID().uuidString, pid: 1, args: args, startedAt: Date(), dismissed: dismissed),
                   summary: summarize(events), state: state)
    }

    private func headline(doctor: DoctorSnapshot?, status: StatusSnapshot?, runs: [TrackedRun] = [],
                          health: [String: HealthState] = [:]) -> Headline {
        let icon = iconState(doctor: doctor, status: status, runs: runs, health: health)
        return VastBarCore.headline(icon: icon, doctor: doctor, status: status, runs: runs, health: health)
    }

    // MARK: fix-version hint

    func testFixVersionHint() {
        XCTAssertEqual(fixVersionHint("next 1.6.12-rc1 is not above production 1.6.12 — release it with --fix-version (→ 1.6.13-rc1)"),
                       "Behind production · --fix-version gives 1.6.13-rc1")
        XCTAssertNil(fixVersionHint("next 1.6.12-rc1 is not above production 1.6.12 — re-run with --fix-version"),
                     "no (→ X) tail: the card falls back to the full text")
        XCTAssertNil(fixVersionHint("token expired — run `vast argocd login`"))
    }

    // MARK: cards

    func testCardProblemsCarryTheirWeightAndShortText() throws {
        let failing = DoctorSnapshot(generatedAt: Date(), checks: [
            DoctorCheck(group: "Repos", label: "VastPayPwaV2", status: .fail, detail: "no checkout"),
        ])
        let cards = repoCards(status: try status(), doctor: try doctor(), pending: nil, runs: [])
        XCTAssertEqual(cards[1].problems.map(\.text), [
            "staging tag could not be read",
            "Behind production · --fix-version gives 1.6.13-rc1",
        ])
        XCTAssertEqual(cards[1].problems[1].detail,
                       "next 1.6.12-rc1 is not above production 1.6.12 — release it with --fix-version (→ 1.6.13-rc1)")
        XCTAssertEqual(cards[1].problems.map(\.failing), [false, false])
        let failed = repoCards(status: try status(), doctor: failing, pending: nil, runs: [])
        XCTAssertEqual(failed[0].problems, [CardProblem(text: "no checkout", detail: "no checkout", failing: true)])
        XCTAssertEqual(cards[0].driftAhead, 5)
        XCTAssertNil(cards[2].driftAhead)
    }

    // MARK: summary tiles

    func testSummaryTiles() throws {
        let tiles = summaryTiles(status: try status(), pending: try pending())
        XCTAssertEqual(tiles, SummaryTiles(repos: 3, waiting: 2, ready: 1))
        XCTAssertEqual(summaryTiles(status: nil, pending: nil), SummaryTiles(repos: 0, waiting: 0, ready: 0))
    }

    // MARK: headline

    func testHeadlineAllGood() {
        let h = headline(doctor: allOk, status: nil, health: ["VastPay API": .up(ms: 20)])
        XCTAssertEqual(h.title, "All good")
        XCTAssertEqual(h.detail, "Nothing needs you")
    }

    func testHeadlineCountsProblemsAndThingsToLookAt() throws {
        // doctor: one fail (ArgoCD) and one warn (VastMenuPwa); status: one unreadable cell
        let h = headline(doctor: try doctor(), status: try status())
        XCTAssertEqual(h.title, "1 problem, 2 to look at")
        XCTAssertEqual(h.detail, "ArgoCD staging: token expired — run `vast argocd login`")
        let failedRun = run(["release", "VastPayPwaV2", "--json"], [.start(command: "release", args: [], dryRun: false, repos: ["VastPayPwaV2"]),
                                                                    .end(exitCode: 1)], .finished)
        let two = headline(doctor: try doctor(), status: nil, runs: [failedRun])
        XCTAssertEqual(two.title, "2 problems, 1 to look at")
    }

    func testHeadlineToLookAt() throws {
        let warnOnly = DoctorSnapshot(generatedAt: Date(), checks: try doctor().checks.filter { $0.status != .fail })
        let h = headline(doctor: warnOnly, status: try status(), health: ["VastPay API": .down(reason: "HTTP 503")])
        XCTAssertEqual(h.title, "3 to look at")
        XCTAssertEqual(h.detail, "VastMenuPwa: Behind production · --fix-version gives 1.6.13-rc1")
        let down = headline(doctor: allOk, status: nil, health: ["VastPay API": .down(reason: "HTTP 503"), "VastMenu API": .up(ms: 5)])
        XCTAssertEqual(down.title, "1 to look at")
        XCTAssertEqual(down.detail, "VastPay API down · HTTP 503")
    }

    func testHeadlineWhileRunning() throws {
        let release = run(["release", "VastPayPwaV2", "VastMenuPwa", "--json"], [], .running)
        let h = headline(doctor: allOk, status: try status(), runs: [release])
        XCTAssertEqual(h.title, "Releasing 2 repos")
        XCTAssertEqual(h.detail, "VastPayPwaV2, VastMenuPwa")
        let promote = run(["promote", "VastPay-BackEnd", "--to", "production", "--json"], [], .running)
        XCTAssertEqual(headline(doctor: allOk, status: nil, runs: [promote]).title, "Promoting 1 repo")
        XCTAssertEqual(headline(doctor: allOk, status: try status(), runs: [release, promote]).title, "Releasing 2 repos, promoting 1")
    }

    func testHeadlineFailedRunCauses() {
        let died = run(["release", "A", "--json"], [], .died)
        XCTAssertEqual(headline(doctor: allOk, status: nil, runs: [died]).detail, "A: stopped without finishing")
        let cli = run(["release", "A", "--json"], [.start(command: "release", args: [], dryRun: false, repos: ["A"]), .end(exitCode: 1)], .finished)
        XCTAssertEqual(headline(doctor: allOk, status: nil, runs: [cli]).detail, "vast release failed")
        let repoFailed = run(["release", "A", "--json"], [
            .start(command: "release", args: [], dryRun: false, repos: ["A"]),
            .done(DoneEvent(repo: "A", version: "1.0.1", status: "failed", detail: "build failed")),
            .end(exitCode: 1),
        ], .finished)
        XCTAssertEqual(headline(doctor: allOk, status: nil, runs: [repoFailed]).detail, "A failed — build failed")
        let dismissed = run(["release", "A", "--json"], [], .died, dismissed: true)
        XCTAssertEqual(headline(doctor: allOk, status: nil, runs: [dismissed]).title, "All good")
    }

    // MARK: tracker

    private func progress(_ events: [VastEvent]) -> RepoProgress? { summarize(events).repos.first }
    private let started = VastEvent.start(command: "release", args: [], dryRun: false, repos: ["A"])
    private let dispatched = VastEvent.dispatched(repo: "A", version: "1.0.1", runId: 1, runUrl: "https://x/1")
    private let rollout = VastEvent.rollout(repo: "A", state: "Progressing", reason: nil, elapsedMs: 1000)

    func testTrackerFollowsThePhase() {
        XCTAssertEqual(TrackerStep.allCases.map(\.title), ["Promote", "Build", "Roll out", "Live"])
        XCTAssertEqual(trackerStates(progress: nil, command: "release", state: .running), [.current, .future, .future, .future])
        XCTAssertEqual(trackerStates(progress: progress([started]), command: "release", state: .running),
                       [.current, .future, .future, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched]), command: "release", state: .running),
                       [.done, .current, .future, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched, rollout]), command: "release", state: .running),
                       [.done, .done, .current, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched, rollout,
                                                         .done(DoneEvent(repo: "A", version: "1.0.1", status: "released", detail: "live"))]),
                                     command: "release", state: .finished),
                       [.done, .done, .done, .done])
    }

    func testTrackerMarksTheStepThatFailed() {
        let failedDone = VastEvent.done(DoneEvent(repo: "A", version: "1.0.1", status: "failed", detail: "x"))
        XCTAssertEqual(trackerStates(progress: progress([started, failedDone]), command: "release", state: .finished),
                       [.failed, .future, .future, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched, failedDone]), command: "release", state: .finished),
                       [.done, .failed, .future, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched, rollout, failedDone]), command: "release", state: .finished),
                       [.done, .done, .failed, .future])
        XCTAssertEqual(trackerStates(progress: progress([started, dispatched]), command: "release", state: .died),
                       [.done, .failed, .future, .future], "a died process fails the step it was on")
        XCTAssertEqual(trackerStates(progress: nil, command: "release", state: .died), [.failed, .future, .future, .future])
    }

    func testNoTrackerForAPromoteOrASkip() {
        XCTAssertNil(trackerStates(progress: nil, command: "promote", state: .running), "a promote opens a PR; nothing deploys")
        let skipped = VastEvent.done(DoneEvent(repo: "A", version: "1.0.1", status: "skipped", detail: "nothing to release"))
        XCTAssertNil(trackerStates(progress: progress([started, skipped]), command: "release", state: .finished))
    }

    func testElapsed() {
        XCTAssertEqual(formatElapsed(ms: 0), "0s")
        XCTAssertEqual(formatElapsed(ms: 45_400), "45s")
        XCTAssertEqual(formatElapsed(ms: 185_000), "3m05s")
    }
}
