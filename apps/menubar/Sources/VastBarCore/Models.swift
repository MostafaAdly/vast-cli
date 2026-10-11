import Foundation

// `vast status --all --json`

public struct StatusCell: Decodable, Equatable, Sendable {
    public let tag: String?
    /// The table's own wording when the tag is unknown: "not migrated", "n/a" or "?".
    public let problem: String?
    public init(tag: String?, problem: String?) { self.tag = tag; self.problem = problem }
}

public struct StatusDrift: Decodable, Equatable, Sendable {
    public let text: String
    public let ahead: Int?
    public let problem: String?
}

public struct StatusRepo: Decodable, Equatable, Sendable, Identifiable {
    public let repo: String
    public let displayName: String
    public let releaseTeam: String?
    public let staging: StatusCell
    public let production: StatusCell
    public let drift: StatusDrift
    public var id: String { repo }
}

public struct StatusSnapshot: Decodable, Equatable, Sendable {
    public let generatedAt: Date
    public let repos: [StatusRepo]
}

// `vast doctor --json`

public enum CheckStatus: String, Decodable, Sendable { case ok, warn, fail }

public struct DoctorCheck: Decodable, Equatable, Sendable {
    public let group: String
    public let label: String
    public let status: CheckStatus
    public let detail: String
}

public struct DoctorSnapshot: Decodable, Equatable, Sendable {
    public let generatedAt: Date
    public let checks: [DoctorCheck]
}

// `vast pending --all --short --json` — only what the app shows: a count per repo.

public struct PendingItem: Decodable, Equatable, Sendable { public let number: Int }

public struct PendingSide: Decodable, Equatable, Sendable { public let waiting: [PendingItem] }

public struct PendingProblem: Decodable, Equatable, Sendable {
    public let kind: String
    public let message: String
}

public struct PendingRepo: Decodable, Equatable, Sendable {
    public let repo: String
    public let forward: PendingSide?
    public let problem: PendingProblem?
    /// PRs on staging that production lacks; nil when the repo could not be compared.
    public var waitingCount: Int? { forward?.waiting.count }
}

public struct PendingSnapshot: Decodable, Equatable, Sendable {
    public let repos: [PendingRepo]
}
