import XCTest
@testable import VastBarCore

final class EventsTests: XCTestCase {
    func testEveryEventTypeDecodes() throws {
        let events = NDJSON.events(from: try fixtureText("release-real.ndjson"))
        XCTAssertEqual(events.count, 10)
        guard case .start(let command, _, let dryRun, let repos) = events[0] else { return XCTFail("start") }
        XCTAssertEqual(command, "release"); XCTAssertFalse(dryRun); XCTAssertEqual(repos, ["VastPayPwaV2"])
        guard case .dispatched(_, _, let runId, let runUrl) = events[3] else { return XCTFail("dispatched") }
        XCTAssertEqual(runId, 42); XCTAssertTrue(runUrl.hasSuffix("/42"))
        guard case .rollout(_, let state, _, let elapsed) = events[7] else { return XCTFail("rollout") }
        XCTAssertEqual(state, "Synced/Healthy"); XCTAssertEqual(elapsed, 40000)
        XCTAssertEqual(events.last, .end(exitCode: 0))
    }

    func testUnknownTypeIsKeptAsUnknownNotDropped() throws {
        let events = NDJSON.events(from: try fixtureText("promote-dry-run.ndjson"))
        XCTAssertTrue(events.contains(.unknown(type: "surprise")))
        guard case .pr(let pr) = events[2] else { return XCTFail("pr") }
        XCTAssertNil(pr.url)
        XCTAssertEqual(pr.slack?.posted, false)
        XCTAssertEqual(pr.branch, "release/2.1.18")
    }

    func testAHalfWrittenLastLineIsIgnored() throws {
        let events = NDJSON.events(from: try fixtureText("release-partial.ndjson"))
        XCTAssertEqual(events.count, 3)
    }

    func testGarbageLinesAreSkipped() {
        let text = "not json\n{\"type\":\"end\",\"exitCode\":0}\n\n"
        XCTAssertEqual(NDJSON.events(from: text), [.end(exitCode: 0)])
    }
}
