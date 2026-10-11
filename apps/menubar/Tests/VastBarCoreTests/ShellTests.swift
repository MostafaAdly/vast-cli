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
            "sleep 1; echo '{\"type\":\"end\",\"exitCode\":0}'; echo bye >&2", stdout: out, stderr: err,
            pidFile: dir.appendingPathComponent("r.pid"))
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
        let pidFile = dir.appendingPathComponent("a b.pid")
        let pid = try await Shell.startDetachedLine("echo hi", stdout: out, stderr: err, pidFile: pidFile)
        try await Task.sleep(nanoseconds: 1_000_000_000)
        XCTAssertEqual(try String(contentsOf: out, encoding: .utf8), "hi\n")
        XCTAssertEqual(Shell.readPid(pidFile), pid)
    }

    func testTimeoutReturnsEvenIfAGrandchildHoldsThePipe() async {
        let started = Date()
        // zsh HUPs its jobs when it exits; a nohup'd one survives and keeps
        // stdout open after the shell is killed
        let r = await Shell.runLine("(trap '' HUP TERM; sleep 15) & sleep 20", timeout: 1)
        XCTAssertEqual(r.exitCode, 124)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testDetachedStartReadsItsPidFromThePidFile() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let pidFile = dir.appendingPathComponent("x.pid")
        let pid = try await Shell.startDetachedLine("sleep 2", stdout: dir.appendingPathComponent("x.ndjson"),
                                                    stderr: dir.appendingPathComponent("x.log"), pidFile: pidFile)
        XCTAssertGreaterThan(pid, 0)
        XCTAssertEqual(Shell.readPid(pidFile), pid)
        XCTAssertTrue(Shell.isAlive(pid))
    }

    func testDetachedStartFallsBackToStdoutWhenThePidFileIsMissing() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // a pid file in a directory that does not exist is never written
        let pidFile = dir.appendingPathComponent("missing/x.pid")
        let pid = try await Shell.startDetachedLine("sleep 2", stdout: dir.appendingPathComponent("x.ndjson"),
                                                    stderr: dir.appendingPathComponent("x.log"),
                                                    pidFile: pidFile, pidWait: 0.5)
        XCTAssertGreaterThan(pid, 0)
        XCTAssertTrue(Shell.isAlive(pid))
    }

    func testLastPidLineSkipsLoginShellNoise() {
        XCTAssertEqual(Shell.lastPid(in: "Welcome to zsh\n12345\n"), 12345)
        XCTAssertEqual(Shell.lastPid(in: "12345\nbye from .zlogout\n"), 12345)
        XCTAssertEqual(Shell.lastPid(in: "1\n 2345 \n"), 2345, "the last line that parses wins")
        XCTAssertNil(Shell.lastPid(in: ""))
        XCTAssertNil(Shell.lastPid(in: "0\n-1\nnope"), "only a positive pid counts")
    }

    func testIsAliveNeverSignalsAGroupOrEveryProcess() {
        XCTAssertFalse(Shell.isAlive(0))
        XCTAssertFalse(Shell.isAlive(-1))
        XCTAssertTrue(Shell.isAlive(getpid()))
    }
}
