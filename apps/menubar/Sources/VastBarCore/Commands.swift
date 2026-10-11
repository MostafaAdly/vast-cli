import Foundation

public enum Train: String, Sendable, CaseIterable { case frontend, backend }

public enum ReleaseTarget: Equatable, Sendable, Hashable {
    case repo(String)
    case train(Train)
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

public enum Commands {
    public static let version = VastCommand(args: ["--version"])
    public static let status = VastCommand(args: ["status", "--all", "--json"])
    public static let doctor = VastCommand(args: ["doctor", "--json"])
    public static let pending = VastCommand(args: ["pending", "--all", "--short", "--json"])

    public static func release(_ target: ReleaseTarget, dryRun: Bool, fixVersion: Bool) -> VastCommand {
        var args = ["release"]
        switch target {
        case .repo(let name): args.append(name)
        case .train(let train): args.append("--\(train.rawValue)")
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

/// POSIX single-quote unless the word is plainly safe.
public func shellQuote(_ word: String) -> String {
    let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/=-")
    if !word.isEmpty, word.unicodeScalars.allSatisfy({ safe.contains($0) }) { return word }
    return "'" + word.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// An AppleScript string literal.
public func appleScriptQuote(_ text: String) -> String {
    "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}
