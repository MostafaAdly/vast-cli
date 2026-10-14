import XCTest
@testable import VastBarCore

final class StagingHealthTests: XCTestCase {
    private func json(_ s: String) -> Data { Data(s.utf8) }

    func testTheTwoStagingEndpoints() {
        XCTAssertEqual(StagingHealth.endpoints.map(\.name), ["VastPay API", "VastMenu API"])
        XCTAssertEqual(StagingHealth.endpoints.map(\.url.absoluteString),
                       ["https://api-staging.vast-pay.com/health", "https://api-staging.vastmenu.com/health"])
    }

    func testUpIs2xxWithAnOkStatusOrNoStatus() {
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json(#"{"status":"ok","uptime":3}"#), error: nil, elapsedMs: 720), .up(ms: 720))
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json(#"{"status":"UP"}"#), error: nil, elapsedMs: 5), .up(ms: 5))
        XCTAssertEqual(StagingHealth.classify(statusCode: 204, body: json(#"{"status":"Healthy"}"#), error: nil, elapsedMs: 5), .up(ms: 5))
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json("OK"), error: nil, elapsedMs: 9), .up(ms: 9), "not JSON")
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json(#"{"uptime":3}"#), error: nil, elapsedMs: 9), .up(ms: 9), "no status field")
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: nil, error: nil, elapsedMs: 9), .up(ms: 9))
    }

    func testDownReasons() {
        XCTAssertEqual(StagingHealth.classify(statusCode: 503, body: json(#"{"status":"ok"}"#), error: nil, elapsedMs: 9), .down(reason: "HTTP 503"))
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json(#"{"status":"degraded"}"#), error: nil, elapsedMs: 9), .down(reason: "status: degraded"))
        XCTAssertEqual(StagingHealth.classify(statusCode: 200, body: json(#"{"status":false}"#), error: nil, elapsedMs: 9), .down(reason: "status: false"))
        XCTAssertEqual(StagingHealth.classify(statusCode: nil, body: nil, error: "timed out", elapsedMs: 6000), .down(reason: "timed out"))
        XCTAssertEqual(StagingHealth.classify(statusCode: nil, body: nil, error: nil, elapsedMs: 9), .down(reason: "unreachable"))
    }

    func testStateTooltip() {
        XCTAssertEqual(HealthState.up(ms: 720).help, "up · 720 ms")
        XCTAssertEqual(HealthState.down(reason: "HTTP 503").help, "down · HTTP 503")
        XCTAssertEqual(HealthState.unknown.help, "not checked yet")
        XCTAssertTrue(HealthState.down(reason: "x").isDown)
        XCTAssertFalse(HealthState.up(ms: 1).isDown)
    }

    func testADownBackendIsToLookAtButNeverOutranksFailedOrRunning() throws {
        let ok = DoctorSnapshot(generatedAt: Date(), checks: [])
        let down = ["VastPay API": HealthState.down(reason: "HTTP 503"), "VastMenu API": .up(ms: 30)]
        XCTAssertEqual(iconState(doctor: ok, status: nil, runs: []), .ok, "health defaults to none")
        XCTAssertEqual(iconState(doctor: ok, status: nil, runs: [], health: ["VastPay API": .up(ms: 30), "VastMenu API": .unknown]), .ok)
        XCTAssertEqual(iconState(doctor: ok, status: nil, runs: [], health: down), .attention)
        let failingDoctor = try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json"))
        XCTAssertEqual(iconState(doctor: failingDoctor, status: nil, runs: [], health: down), .failed)
        let running = TrackedRun(record: RunRecord(id: "r", pid: 1, args: ["release", "A", "--json"], startedAt: Date(), dismissed: false),
                                 summary: summarize([]), state: .running)
        XCTAssertEqual(iconState(doctor: ok, status: nil, runs: [running], health: down), .running)
    }
}
