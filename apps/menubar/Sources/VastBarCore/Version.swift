import Foundation

/// major.minor.patch; a prerelease suffix is ignored, so a local `2.9.0-dev`
/// build satisfies a 2.9.0 minimum.
public struct CLIVersion: Comparable, Equatable, Sendable, CustomStringConvertible {
    public let major: Int, minor: Int, patch: Int

    public init(_ major: Int, _ minor: Int, _ patch: Int) {
        self.major = major; self.minor = minor; self.patch = patch
    }

    public init?(_ text: String) {
        let first = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        var core = first.trimmingCharacters(in: .whitespaces)
        if core.hasPrefix("v") { core.removeFirst() }
        core = String(core.prefix { $0 != "-" && $0 != "+" })
        let parts = core.split(separator: ".").map { Int($0) }
        guard parts.count == 3, let a = parts[0], let b = parts[1], let c = parts[2] else { return nil }
        self.init(a, b, c)
    }

    public var description: String { "\(major).\(minor).\(patch)" }

    public static func < (l: CLIVersion, r: CLIVersion) -> Bool {
        (l.major, l.minor, l.patch) < (r.major, r.minor, r.patch)
    }
}

public enum CLICompat {
    /// The first CLI with `--json` (spec: Phase 1 ships as this minor).
    public static let minimum = CLIVersion(2, 9, 0)

    public enum Result: Equatable, Sendable {
        case ok(CLIVersion)
        case tooOld(CLIVersion)
        case missing
    }

    public static func check(versionOutput: String, exitCode: Int32) -> Result {
        guard exitCode == 0, let v = CLIVersion(versionOutput) else { return .missing }
        return v < minimum ? .tooOld(v) : .ok(v)
    }
}
