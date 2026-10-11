import XCTest
@testable import VastBarCore

final class RunStoreTests: XCTestCase {
    private var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testSaveAndListNewestLast() throws {
        let store = RunStore(dir: dir)
        let a = RunRecord(id: "a", pid: 1, args: ["release", "A", "--json"], startedAt: Date(timeIntervalSince1970: 100), dismissed: false)
        let b = RunRecord(id: "b", pid: 2, args: ["release", "B", "--json"], startedAt: Date(timeIntervalSince1970: 200), dismissed: false)
        try store.save(b); try store.save(a)
        XCTAssertEqual(store.records().map(\.id), ["a", "b"])
    }

    func testEventsAndStderrTail() throws {
        let store = RunStore(dir: dir)
        try store.save(RunRecord(id: "x", pid: 1, args: [], startedAt: Date(), dismissed: false))
        try "{\"type\":\"end\",\"exitCode\":1}\n".write(to: store.ndjsonURL("x"), atomically: true, encoding: .utf8)
        try (1...30).map { "line \($0)" }.joined(separator: "\n").appending("\n")
            .write(to: store.logURL("x"), atomically: true, encoding: .utf8)
        XCTAssertEqual(store.events(id: "x"), [.end(exitCode: 1)])
        XCTAssertEqual(store.stderrTail(id: "x", lines: 3), ["line 28", "line 29", "line 30"])
    }

    func testMissingFilesReadAsEmpty() throws {
        let store = RunStore(dir: dir)
        XCTAssertEqual(store.events(id: "nope"), [])
        XCTAssertEqual(store.stderrTail(id: "nope", lines: 5), [])
    }

    func testPruneDeletesOnlyFinishedRunsOlderThanSevenDays() throws {
        let store = RunStore(dir: dir)
        let now = Date(timeIntervalSince1970: 10_000_000)
        let old = now.addingTimeInterval(-8 * 86_400), recent = now.addingTimeInterval(-86_400)
        for (id, at) in [("oldDone", old), ("oldRunning", old), ("recentDone", recent)] {
            try store.save(RunRecord(id: id, pid: 1, args: [], startedAt: at, dismissed: false))
            try "".write(to: store.ndjsonURL(id), atomically: true, encoding: .utf8)
        }
        store.prune(now: now, isFinished: { $0.id != "oldRunning" })
        XCTAssertEqual(store.records().map(\.id).sorted(), ["oldRunning", "recentDone"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.ndjsonURL("oldDone").path))
    }
}
