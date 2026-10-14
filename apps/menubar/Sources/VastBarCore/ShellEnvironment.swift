import Foundation

/// The environment every command runs with: the app's own, with the PATH the
/// user's terminal has.
///
/// A login shell (`zsh -lc`) is not enough. It never reads ~/.zshrc, which is
/// where the vast installer and nvm put `vast` and `node`, and an app opened
/// from Finder, Spotlight or at login inherits none of the terminal's PATH, so
/// `vast` was "not found" for anyone who had not opened the app from a
/// terminal. An interactive login shell (`zsh -lic`) reads ~/.zshrc: it is
/// asked once for its PATH, which is read between markers because ~/.zshrc may
/// print anything.
public enum ShellEnvironment {
    static let begin = "__VASTBAR_PATH_BEGIN__"
    static let end = "__VASTBAR_PATH_END__"

    /// `base` with PATH replaced by `merged(…)`. If the interactive shell fails
    /// or takes longer than `timeout`, the inherited PATH is kept, plus the
    /// installer's default bin dir.
    public static func resolved(from base: [String: String], timeout: TimeInterval = 10) -> [String: String] {
        var env = base
        let home = base["HOME"] ?? NSHomeDirectory()
        env["PATH"] = merged(resolved: interactivePath(from: base, timeout: timeout), inherited: base["PATH"], home: home)
        return env
    }

    /// The PATH an interactive login zsh ends up with, or nil.
    public static func interactivePath(from base: [String: String], timeout: TimeInterval = 10) -> String? {
        let script = "print -rn -- \"\(begin)${PATH}\(end)\""
        let result = Shell.execute(arguments: ["-lic", script], environment: base, timeout: timeout, handle: ProcessHandle())
        guard result.exitCode == 0 else { return nil }
        return parsePath(result.stdout)
    }

    /// The text between the markers, or nil when they are missing or empty.
    static func parsePath(_ output: String) -> String? {
        guard let start = output.range(of: begin),
              let stop = output.range(of: end, range: start.upperBound..<output.endIndex) else { return nil }
        let path = String(output[start.upperBound..<stop.lowerBound])
        return path.isEmpty ? nil : path
    }

    /// The terminal's PATH first, then anything only the app had, then
    /// ~/.local/bin (the installer's default) as a last resort; each dir once.
    static func merged(resolved: String?, inherited: String?, home: String) -> String {
        var seen = Set<String>()
        let dirs = [resolved, inherited, "\(home)/.local/bin"]
            .compactMap { $0 }
            .flatMap { $0.split(separator: ":").map(String.init) }
        return dirs.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
    }
}
