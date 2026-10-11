import XCTest
@testable import VastBarCore

final class ModelsTests: XCTestCase {
    func testStatusDecodesEveryCellShape() throws {
        let s = try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json"))
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2", "VastMenuPwa", "VastPay-BackEnd"])
        XCTAssertEqual(s.repos[0].staging, StatusCell(tag: "2.1.18-rc5", problem: nil))
        XCTAssertEqual(s.repos[1].staging, StatusCell(tag: nil, problem: "?"))
        XCTAssertEqual(s.repos[2].production.problem, "not migrated")
        XCTAssertNil(s.repos[2].drift.ahead)
        XCTAssertEqual(s.repos[0].drift.ahead, 5)
        XCTAssertEqual(s.repos[0].releaseTeam, "frontend")
        XCTAssertEqual(s.generatedAt.timeIntervalSince1970, 1_791_709_200, accuracy: 0.001)
    }

    func testDoctorDecodesStatuses() throws {
        let d = try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json"))
        XCTAssertEqual(d.checks.count, 5)
        XCTAssertEqual(d.checks[2].status, .fail)
        XCTAssertEqual(d.checks[4].status, .warn)
        XCTAssertEqual(d.checks[4].label, "VastMenuPwa")
    }

    func testPendingCountsWaitingPRsAndToleratesAProblemRepo() throws {
        let p = try VastJSON.decoder().decode(PendingSnapshot.self, from: fixture("pending.json"))
        XCTAssertEqual(p.repos[0].waitingCount, 2)
        XCTAssertNil(p.repos[1].waitingCount)
        XCTAssertEqual(p.repos[1].problem?.message, "fetch failed")
    }

    func testDatesWithAndWithoutFractionalSeconds() throws {
        struct Box: Decodable { let at: Date }
        let a = try VastJSON.decoder().decode(Box.self, from: Data(#"{"at":"2026-10-11T09:00:00.250Z"}"#.utf8))
        let b = try VastJSON.decoder().decode(Box.self, from: Data(#"{"at":"2026-10-11T09:00:00Z"}"#.utf8))
        XCTAssertEqual(a.at.timeIntervalSince(b.at), 0.25, accuracy: 0.001)
    }
}
