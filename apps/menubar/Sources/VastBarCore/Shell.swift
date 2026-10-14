import Foundation

public struct ShellResult: Equatable, Sendable {
    public let stdout: String
    public let stderr: String
    public let exitCode: Int32
}

/// Every command runs through the user's login shell, with the PATH their
/// terminal has (see ShellEnvironment): a GUI app does not inherit it, and
/// `vast`, `node` and `gh` live on it.
public enum Shell {
    public static let shell = "/bin/zsh"

    /// Resolved once, on first use, off the main thread (it runs ~/.zshrc).
    static let environment: [String: String] = ShellEnvironment.resolved(from: ProcessInfo.processInfo.environment)

    public static func run(_ command: VastCommand, timeout: TimeInterval = 180) async -> ShellResult {
        await runLine(command.shellLine, timeout: timeout)
    }

    /// Cancelling the calling task terminates the process, so a superseded
    /// preview never keeps running (and fetching) beside its replacement.
    /// `environment` is for tests; nil is the resolved one.
    public static func runLine(_ line: String, timeout: TimeInterval, environment: [String: String]? = nil) async -> ShellResult {
        let handle = ProcessHandle()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                DispatchQueue.global().async {
                    let env = environment ?? Shell.environment
                    continuation.resume(returning: execute(arguments: ["-lc", line], environment: env, timeout: timeout, handle: handle))
                }
            }
        } onCancel: {
            handle.cancel()
        }
    }

    static func execute(arguments: [String], environment: [String: String], timeout: TimeInterval, handle: ProcessHandle) -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = arguments
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        do { try process.run() } catch {
            return ShellResult(stdout: "", stderr: "\(error)", exitCode: 127)
        }
        handle.attach(process)
        // Drain both pipes as data arrives, or a chatty child fills one and blocks forever.
        let outReader = PipeReader(out.fileHandleForReading), errReader = PipeReader(err.fileHandleForReading)
        let timeoutFlag = FlagBox()
        let timer = DispatchWorkItem { if process.isRunning { timeoutFlag.raise(); process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        process.waitUntilExit()
        timer.cancel()
        let timedOut = timeoutFlag.isRaised
        // The shell is gone (exited, or killed at the timeout). A grandchild
        // that outlives it keeps the pipes open, so wait a short grace for
        // EOF, then stop reading and close them.
        let deadline = DispatchTime.now() + (timedOut ? 2 : 5)
        let outData = outReader.finish(by: deadline), errData = errReader.finish(by: deadline)
        return ShellResult(
            stdout: String(decoding: outData, as: UTF8.self),
            stderr: String(decoding: errData, as: UTF8.self) + (timedOut ? "\n(timed out after \(Int(timeout))s)" : ""),
            exitCode: timedOut ? 124 : process.terminationStatus)
    }

    public static func startDetached(_ command: VastCommand, stdout: URL, stderr: URL, pidFile: URL) async throws -> Int32 {
        try await startDetachedLine(command.shellLine, stdout: stdout, stderr: stderr, pidFile: pidFile)
    }

    /// Starts `line` in the background with `nohup`, its output going to files,
    /// and returns its pid. It is not this app's child once the shell exits, so
    /// quitting the app never stops a release.
    ///
    /// The wrapper writes the pid to `pidFile`, which is read (for up to
    /// `pidWait` seconds) rather than the outer shell's stdout, where a login
    /// shell may print noise. Stdout's last pid-looking line is the fallback.
    /// A throw means the pid is unknown, not that nothing started.
    public static func startDetachedLine(_ line: String, stdout: URL, stderr: URL, pidFile: URL,
                                         pidWait: TimeInterval = 5) async throws -> Int32 {
        let wrapped = "nohup /bin/zsh -lc \(shellQuote(line)) > \(shellQuote(stdout.path)) 2> \(shellQuote(stderr.path)) < /dev/null & "
            + "echo $! > \(shellQuote(pidFile.path)); echo $!"
        let result = await runLine(wrapped, timeout: 30)
        let deadline = Date().addingTimeInterval(pidWait)
        while true {
            if let pid = readPid(pidFile) { return pid }
            if Date() >= deadline { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if let pid = lastPid(in: result.stdout) { return pid }
        throw ShellError.couldNotStart(result.stderr)
    }

    /// The pid in a pid file, once it is fully written.
    public static func readPid(_ url: URL) -> Int32? {
        guard let text = try? String(contentsOf: url, encoding: .utf8), text.hasSuffix("\n") else { return nil }
        return lastPid(in: text)
    }

    /// The last line of `text` that is a positive pid.
    public static func lastPid(in text: String) -> Int32? {
        text.split(whereSeparator: \.isNewline).reversed().lazy
            .compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
            .first { $0 > 0 }
    }

    /// A pid of 0 or below is never alive: `kill` would signal a process
    /// group, or every process.
    public static func isAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }
}

public enum ShellError: Error, Equatable { case couldNotStart(String) }

/// Reads one pipe as data arrives until EOF. `finish(by:)` waits for EOF
/// until a deadline, then stops reading and closes the handle, so a process
/// still holding the write end can never block the caller. Reads and the
/// close share one lock: a read never touches a closed handle.
private final class PipeReader: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: FileHandle
    private let eof = DispatchSemaphore(value: 0)
    private var data = Data()
    private var closed = false

    init(_ handle: FileHandle) {
        self.handle = handle
        handle.readabilityHandler = { [self] h in
            lock.lock(); defer { lock.unlock() }
            guard !closed else { return }
            let chunk = h.availableData
            if chunk.isEmpty { closeLocked(); eof.signal() } else { data.append(chunk) }
        }
    }

    private func closeLocked() {
        closed = true
        handle.readabilityHandler = nil
        try? handle.close()
    }

    func finish(by deadline: DispatchTime) -> Data {
        _ = eof.wait(timeout: deadline)
        lock.lock(); defer { lock.unlock() }
        if !closed { closeLocked() }
        return data
    }
}

/// The running process for a cancellation that may arrive before it starts.
final class ProcessHandle: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false

    func attach(_ p: Process) {
        lock.lock(); process = p; let stop = cancelled; lock.unlock()
        if stop, p.isRunning { p.terminate() }
    }

    func cancel() {
        lock.lock(); cancelled = true; let p = process; lock.unlock()
        if let p, p.isRunning { p.terminate() }
    }
}

private final class FlagBox: @unchecked Sendable {
    private let lock = NSLock()
    private var raised = false
    func raise() { lock.lock(); raised = true; lock.unlock() }
    var isRaised: Bool { lock.lock(); defer { lock.unlock() }; return raised }
}
