import Foundation

public struct PlanEvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let ok: Bool
    public let version: String
    public let commits: Int?
    /// "will merge", "merged", "nothing to promote", "no develop" or "not run".
    public let promote: String
    public let notice: String?
    /// Why it was refused (ok false), or a note on a prepared repo.
    public let detail: String?
}

public struct SlackPreview: Decodable, Equatable, Sendable {
    public let text: String
    public let posted: Bool
    public let error: String?
}

public struct PREvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let branch: String
    /// Null on a dry run.
    public let url: String?
    public let version: String
    public let slack: SlackPreview?
}

public struct DoneEvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let version: String
    /// "released", "skipped" or "failed".
    public let status: String
    public let detail: String
}

/// One line of `vast release|promote --json`. Unknown types, and known types
/// whose payload no longer decodes, are kept as `.unknown`, not dropped, so a
/// newer CLI never breaks an older app.
public enum VastEvent: Equatable, Sendable {
    case start(command: String, args: [String], dryRun: Bool, repos: [String])
    case plan(PlanEvent)
    case promoted(repo: String, commits: Int)
    case dispatched(repo: String, version: String, runId: Int, runUrl: String)
    case run(repo: String, status: String, conclusion: String?, elapsedMs: Int)
    case rollout(repo: String, state: String, reason: String?, elapsedMs: Int)
    case pr(PREvent)
    case done(DoneEvent)
    case end(exitCode: Int)
    case unknown(type: String)
}

extension VastEvent: Decodable {
    private enum Key: String, CodingKey {
        case type, command, args, dryRun, repos, repo, commits, version, runId, runUrl
        case status, conclusion, elapsedMs, state, reason, exitCode
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let type = try c.decode(String.self, forKey: .type)
        do {
            self = try Self.decode(type: type, c, decoder)
        } catch {
            self = .unknown(type: type)
        }
    }

    private static func decode(type: String, _ c: KeyedDecodingContainer<Key>, _ decoder: Decoder) throws -> VastEvent {
        switch type {
        case "start":
            return .start(
                command: try c.decode(String.self, forKey: .command),
                args: try c.decode([String].self, forKey: .args),
                dryRun: try c.decode(Bool.self, forKey: .dryRun),
                repos: try c.decode([String].self, forKey: .repos))
        case "plan": return .plan(try PlanEvent(from: decoder))
        case "promoted":
            return .promoted(repo: try c.decode(String.self, forKey: .repo), commits: try c.decode(Int.self, forKey: .commits))
        case "dispatched":
            return .dispatched(
                repo: try c.decode(String.self, forKey: .repo),
                version: try c.decode(String.self, forKey: .version),
                runId: try c.decode(Int.self, forKey: .runId),
                runUrl: try c.decode(String.self, forKey: .runUrl))
        case "run":
            return .run(
                repo: try c.decode(String.self, forKey: .repo),
                status: try c.decode(String.self, forKey: .status),
                conclusion: try c.decodeIfPresent(String.self, forKey: .conclusion),
                elapsedMs: try c.decode(Int.self, forKey: .elapsedMs))
        case "rollout":
            return .rollout(
                repo: try c.decode(String.self, forKey: .repo),
                state: try c.decode(String.self, forKey: .state),
                reason: try c.decodeIfPresent(String.self, forKey: .reason),
                elapsedMs: try c.decode(Int.self, forKey: .elapsedMs))
        case "pr": return .pr(try PREvent(from: decoder))
        case "done": return .done(try DoneEvent(from: decoder))
        case "end": return .end(exitCode: try c.decode(Int.self, forKey: .exitCode))
        default: return .unknown(type: type)
        }
    }
}

public enum NDJSON {
    /// Every complete line that parses. A last line without its newline is
    /// still being written by the CLI and is left for the next read. Lines are
    /// split on `\n` bytes, not Characters (Swift reads `\r\n` as one), so
    /// CRLF text splits too; the trailing `\r` is trimmed.
    public static func events(from text: String) -> [VastEvent] {
        let bytes = Array(text.utf8)
        var lines = bytes.split(separator: 0x0A, omittingEmptySubsequences: false)
        if bytes.last != 0x0A, !lines.isEmpty { lines.removeLast() }
        let decoder = VastJSON.decoder()
        return lines.compactMap { line in
            let trimmed = String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return try? decoder.decode(VastEvent.self, from: Data(trimmed.utf8))
        }
    }
}
