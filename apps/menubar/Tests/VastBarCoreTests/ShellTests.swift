import XCTest
@testable import VastBarCore

final class ShellTests: XCTestCase {
    func testRunCapturesBothStreamsAndExitCode() async {
        let r = await Shell.runLine("printf 'out\\n'; printf 'err\\n' >&2; exit 3", timeout: 30)
        XCTAssertEqual(r.stdout, "out\n")
        XCTAssertEqual(r.stderr, "err\n")
        XCTAssertEqual(r.exitCode, 3)
    }

    func testLargeOutputDoesNotDeadlock() async {
        let r = await Shell.runLine("head -c 300000 /dev/zero | tr '\\0' a", timeout: 30)
        XCTAssertEqual(r.stdout.count, 300_000)
    }

    func testTimeoutKillsAndReportsFailure() async {
        let started = Date()
        let r = await Shell.runLine("sleep 20", timeout: 1)
        XCTAssertNotEqual(r.exitCode, 0)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testDetachedRunOutlivesTheCallAndWritesItsFiles() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("r.ndjson"), err = dir.appendingPathComponent("r.log")
        let pid = try await Shell.startDetachedLine(
            "sleep 1; echo '{\"type\":\"end\",\"exitCode\":0}'; echo bye >&2", stdout: out, stderr: err)
        XCTAssertGreaterThan(pid, 0)
        XCTAssertTrue(Shell.isAlive(pid))
        try await Task.sleep(nanoseconds: 2_500_000_000)
        XCTAssertFalse(Shell.isAlive(pid))
        XCTAssertEqual(try String(contentsOf: out, encoding: .utf8), "{\"type\":\"end\",\"exitCode\":0}\n")
        XCTAssertEqual(try String(contentsOf: err, encoding: .utf8), "bye\n")
    }

    func testPathsWithSpacesAndQuotes() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Vast Bar 'q' \(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("a b.ndjson"), err = dir.appendingPathComponent("a b.log")
        _ = try await Shell.startDetachedLine("echo hi", stdout: out, stderr: err)
        try await Task.sleep(nanoseconds: 1_000_000_000)
        XCTAssertEqual(try String(contentsOf: out, encoding: .utf8), "hi\n")
    }
}
