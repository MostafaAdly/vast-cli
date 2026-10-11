import Foundation

public struct ShellResult: Equatable, Sendable {
    public let stdout: String
    public let stderr: String
    public let exitCode: Int32
}

/// Every command runs through the user's login shell: a GUI app does not
/// inherit the terminal's PATH, and `vast`, `node` and `gh` live on it.
public enum Shell {
    public static let shell = "/bin/zsh"

    public static func run(_ command: VastCommand, timeout: TimeInterval = 180) async -> ShellResult {
        await runLine(command.shellLine, timeout: timeout)
    }

    public static func runLine(_ line: String, timeout: TimeInterval) async -> ShellResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: runBlocking(line, timeout: timeout))
            }
        }
    }

    private static func runBlocking(_ line: String, timeout: TimeInterval) -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = ["-lc", line]
        process.standardInput = FileHandle.nullDevice
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        do { try process.run() } catch {
            return ShellResult(stdout: "", stderr: "\(error)", exitCode: 127)
        }
        // Drain both pipes concurrently, or a chatty child fills one and blocks forever.
        let outBox = DataBox(), errBox = DataBox()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async { outBox.set(out.fileHandleForReading.readDataToEndOfFile()); group.leave() }
        group.enter()
        DispatchQueue.global().async { errBox.set(err.fileHandleForReading.readDataToEndOfFile()); group.leave() }
        let timeoutFlag = FlagBox()
        let timer = DispatchWorkItem { if process.isRunning { timeoutFlag.raise(); process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        process.waitUntilExit()
        timer.cancel()
        group.wait()
        let timedOut = timeoutFlag.isRaised
        return ShellResult(
            stdout: String(decoding: outBox.data, as: UTF8.self),
            stderr: String(decoding: errBox.data, as: UTF8.self) + (timedOut ? "\n(timed out after \(Int(timeout))s)" : ""),
            exitCode: timedOut ? 124 : process.terminationStatus)
    }

    public static func startDetached(_ command: VastCommand, stdout: URL, stderr: URL) async throws -> Int32 {
        try await startDetachedLine(command.shellLine, stdout: stdout, stderr: stderr)
    }

    /// Starts `line` in the background with `nohup`, its output going to files,
    /// and returns its pid. It is not this app's child once the shell exits, so
    /// quitting the app never stops a release.
    public static func startDetachedLine(_ line: String, stdout: URL, stderr: URL) async throws -> Int32 {
        let wrapped = "nohup /bin/zsh -lc \(shellQuote(line)) > \(shellQuote(stdout.path)) 2> \(shellQuote(stderr.path)) < /dev/null & echo $!"
        let result = await runLine(wrapped, timeout: 30)
        guard result.exitCode == 0, let pid = Int32(result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw ShellError.couldNotStart(result.stderr)
        }
        return pid
    }

    public static func isAlive(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0 || errno == EPERM
    }
}

public enum ShellError: Error, Equatable { case couldNotStart(String) }

/// Lock-guarded cells for the pipe-draining closures (Swift 6 rejects bare captured vars).
private final class DataBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Data()
    func set(_ data: Data) { lock.lock(); value = data; lock.unlock() }
    var data: Data { lock.lock(); defer { lock.unlock() }; return value }
}

private final class FlagBox: @unchecked Sendable {
    private let lock = NSLock()
    private var raised = false
    func raise() { lock.lock(); raised = true; lock.unlock() }
    var isRaised: Bool { lock.lock(); defer { lock.unlock() }; return raised }
}
