import Foundation

public enum Train: String, Sendable, CaseIterable { case frontend, backend }

public enum ReleaseTarget: Equatable, Sendable, Hashable {
    case repo(String)
    case train(Train)
    /// Several repos named on one command line, in the given order.
    case repos([String])

    /// The repo name this target puts on the command line; nil for a train
    /// or several repos.
    public var repoName: String? {
        if case .repo(let name) = self { return name }
        return nil
    }

    /// Every repo name this target puts on the command line; none for a train.
    public var repoNames: [String] {
        switch self {
        case .repo(let name): return [name]
        case .train: return []
        case .repos(let names): return names
        }
    }

    /// The release panel's title.
    public var title: String {
        switch self {
        case .repo(let name): return "Release \(name) to staging"
        case .train(let train): return "Release \(train.rawValue) to staging"
        case .repos(let names):
            return names.count == 1 ? "Release \(names[0]) to staging" : "Release \(names.count) repos to staging"
        }
    }
}

/// A repo name the app will put on a command line: non-empty, no leading `-`
/// (it would parse as an option), and only `[A-Za-z0-9._-]`.
public func isSafeRepoName(_ name: String) -> Bool {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    return !name.isEmpty && !name.hasPrefix("-") && name.unicodeScalars.allSatisfy { allowed.contains($0) }
}

/// A `vast` invocation as a fixed argument list. The only way the app builds
/// a command line, so nothing typed by a person ever reaches the shell unquoted.
public struct VastCommand: Equatable, Sendable {
    public let args: [String]
    public init(args: [String]) { self.args = args }

    /// What `/bin/zsh -lc` runs.
    public var shellLine: String { (["vast"] + args.map(shellQuote)).joined(separator: " ") }

    /// The same command for a person to run in Terminal: human output, no --json.
    public var terminalLine: String {
        (["vast"] + args.filter { $0 != "--json" }.map(shellQuote)).joined(separator: " ")
    }
}

public extension VastCommand {
    /// The real command a preview stands for: the same arguments, in the same
    /// order, without `--dry-run`. The confirm runs exactly what was shown.
    var withoutDryRun: VastCommand { VastCommand(args: args.filter { $0 != "--dry-run" }) }

    /// What "Open dry run in Terminal" types: the human command, never posting
    /// to Slack and always a dry run, because Terminal runs it at once.
    var safeTerminalLine: String {
        var safe = args.filter { $0 != "--json" && $0 != "--slack" }
        if !safe.contains("--dry-run") { safe.append("--dry-run") }
        return (["vast"] + safe.map(shellQuote)).joined(separator: " ")
    }
}

public enum Commands {
    public static let version = VastCommand(args: ["--version"])
    public static let status = VastCommand(args: ["status", "--all", "--json"])
    /// Status while a run is going: no git fetch under a release in the same checkouts.
    public static let statusNoFetch = VastCommand(args: ["status", "--all", "--json", "--no-fetch"])
    public static let doctor = VastCommand(args: ["doctor", "--json"])
    public static let pending = VastCommand(args: ["pending", "--all", "--short", "--json"])

    public static func release(_ target: ReleaseTarget, dryRun: Bool, fixVersion: Bool) -> VastCommand {
        var args = ["release"]
        switch target {
        case .repo(let name): args.append(name)
        case .train(let train): args.append("--\(train.rawValue)")
        case .repos(let names): args += names
        }
        if fixVersion { args.append("--fix-version") }
        if dryRun { args.append("--dry-run") }
        args.append("--json")
        return VastCommand(args: args)
    }

    public static func promote(repo: String, hotfix: Bool, slack: Bool, dryRun: Bool) -> VastCommand {
        var args = ["promote", repo, "--to", "production"]
        if hotfix { args += ["--as", "hotfix"] }
        if slack { args.append("--slack") }
        if dryRun { args.append("--dry-run") }
        args.append("--json")
        return VastCommand(args: args)
    }
}

/// POSIX single-quote unless the word is plainly safe. A leading `=` is not
/// safe: zsh expands `=ls` to the path of `ls`.
public func shellQuote(_ word: String) -> String {
    let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/=-")
    if !word.isEmpty, !word.hasPrefix("="), word.unicodeScalars.allSatisfy({ safe.contains($0) }) { return word }
    return "'" + word.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// An AppleScript string literal.
public func appleScriptQuote(_ text: String) -> String {
    "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}
