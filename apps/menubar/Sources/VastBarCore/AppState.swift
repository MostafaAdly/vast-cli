import Foundation

public enum IconState: Int, Comparable, Sendable {
    case ok, attention, running, failed
    public static func < (l: IconState, r: IconState) -> Bool { l.rawValue < r.rawValue }
}

public enum RunState: Equatable, Sendable { case running, finished, died }

public struct TrackedRun: Equatable, Sendable, Identifiable {
    public var record: RunRecord
    public var summary: RunSummary
    public var state: RunState
    public var id: String { record.id }
    public init(record: RunRecord, summary: RunSummary, state: RunState) {
        self.record = record; self.summary = summary; self.state = state
    }
    /// A finished real run with a failed repo, a CLI that failed, or a process that died.
    public var failed: Bool {
        switch state {
        case .died: return true
        case .running: return false
        case .finished: return summary.cliFailed || (!summary.dryRun && summary.anyFailed)
        }
    }
}

/// No `end` and the process is gone: it was killed, crashed, or the machine
/// restarted. It must never read as running forever.
public func runState(summary: RunSummary, alive: Bool) -> RunState {
    if summary.isFinished { return .finished }
    return alive ? .running : .died
}

/// Red beats blue beats amber beats green.
public func iconState(doctor: DoctorSnapshot?, status: StatusSnapshot?, runs: [TrackedRun]) -> IconState {
    let visible = runs.filter { !$0.record.dismissed }
    if doctor?.checks.contains(where: { $0.status == .fail }) == true || visible.contains(where: \.failed) {
        return .failed
    }
    if visible.contains(where: { $0.state == .running }) { return .running }
    let unreadable = status?.repos.contains { $0.staging.problem == "?" || $0.production.problem == "?" || $0.drift.problem == "?" } ?? false
    if doctor?.checks.contains(where: { $0.status == .warn }) == true || unreadable { return .attention }
    return .ok
}

public struct RepoCard: Equatable, Sendable, Identifiable {
    public let id: String
    public let displayName: String
    public let releaseTeam: String?
    public let staging: String
    public let production: String
    public let drift: String
    public let waitingPRs: Int?
    /// Plain-words problems: unreadable cells and doctor's warn/fail for this repo.
    public let problems: [String]
    public let isRunning: Bool
    /// The latest real (not dry-run) run's progress for this repo.
    public let progress: RepoProgress?
}

public func repoCards(status: StatusSnapshot?, doctor: DoctorSnapshot?, pending: PendingSnapshot?, runs: [TrackedRun]) -> [RepoCard] {
    guard let status else { return [] }
    return status.repos.map { r in
        var problems: [String] = []
        if r.staging.problem == "?" { problems.append("staging tag could not be read") }
        if r.production.problem == "?" { problems.append("production tag could not be read") }
        if r.drift.problem == "?" { problems.append("drift could not be computed") }
        problems += (doctor?.checks ?? [])
            .filter { $0.group == "Repos" && $0.label == r.repo && $0.status != .ok }
            .map(\.detail)
        let mine = runs.filter { run in run.summary.repos.contains { $0.repo == r.repo } }
        let latestReal = mine.last { !$0.summary.dryRun && !$0.record.dismissed }
        return RepoCard(
            id: r.repo,
            displayName: r.displayName,
            releaseTeam: r.releaseTeam,
            staging: r.staging.tag ?? r.staging.problem ?? "—",
            production: r.production.tag ?? r.production.problem ?? "—",
            drift: r.drift.text,
            waitingPRs: pending?.repos.first { $0.repo == r.repo }?.waitingCount,
            problems: problems,
            isRunning: mine.contains { $0.state == .running },
            progress: latestReal?.summary.repos.first { $0.repo == r.repo })
    }
}

/// The app refreshes every 5 minutes; two missed refreshes make the data stale.
public func isStale(lastSuccess: Date?, now: Date = Date()) -> Bool {
    guard let lastSuccess else { return true }
    return now.timeIntervalSince(lastSuccess) > 10 * 60
}

/// Doctor's warnings and failures, for the footer.
public func attentionLines(doctor: DoctorSnapshot?) -> [DoctorCheck] {
    (doctor?.checks ?? []).filter { $0.status != .ok }
}

public func trainRepos(_ train: Train, status: StatusSnapshot?) -> [String] {
    (status?.repos ?? []).filter { $0.releaseTeam == train.rawValue }.map(\.repo)
}
