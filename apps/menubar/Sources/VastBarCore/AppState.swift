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

/// A run's process is alive only if its pid is, and only for two hours: after
/// that a pid still answering is most likely a reused one, so a run with no
/// `end` reads as died instead of running forever. A start whose pid is not
/// known (`RunRecord.pendingPID`) reads as alive for ten minutes, then died;
/// its pid is never asked about.
public func isRunAlive(_ record: RunRecord, now: Date = Date(), pidAlive: (Int32) -> Bool = Shell.isAlive) -> Bool {
    let age = now.timeIntervalSince(record.startedAt)
    if record.pid == RunRecord.pendingPID { return age < 10 * 60 }
    return pidAlive(record.pid) && age < 2 * 3600
}

/// The repos a run works on: its events' once they arrive, before that the
/// ones its argument list covers.
public func reposOf(_ run: TrackedRun, status: StatusSnapshot?) -> [String] {
    run.summary.repos.isEmpty ? reposCovered(args: run.record.args, status: status) : run.summary.repos.map(\.repo)
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
        let mine = runs.filter { reposOf($0, status: status).contains(r.repo) }
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

/// The repos a release target works on: its one repo, or the train's.
public func targetRepos(_ target: ReleaseTarget, status: StatusSnapshot?) -> [String] {
    switch target {
    case .repo(let name): return [name]
    case .train(let train): return trainRepos(train, status: status)
    }
}

/// The repos a `vast release|promote` argument list covers: the repo after the
/// subcommand, or a train flag's repos from status. Used for a run whose
/// first event has not arrived yet.
public func reposCovered(args: [String], status: StatusSnapshot?) -> [String] {
    var repos: [String] = []
    if args.count > 1, !args[1].hasPrefix("-") { repos.append(args[1]) }
    for train in Train.allCases where args.contains("--\(train.rawValue)") {
        repos += trainRepos(train, status: status)
    }
    return repos
}

/// The first repo name that must not reach a command line, as a message.
public func repoNameRefusal(_ named: [String]) -> String? {
    named.first { !isSafeRepoName($0) }.map { "Not a repo name vast can be run with: \($0)" }
}

/// Why a real run must not start, or nil. `named` are the repo names the
/// command line carries; `covers` every repo it will work on. A run still
/// going on one of those repos refuses it: a panel opened before that run
/// started could otherwise start a second one.
public func startRefusal(named: [String], covers: [String], runs: [TrackedRun], status: StatusSnapshot?) -> String? {
    if let refusal = repoNameRefusal(named) { return refusal }
    let wanted = Set(covers)
    for run in runs where run.state == .running {
        if let busy = reposOf(run, status: status).first(where: wanted.contains) {
            return "\(busy) already has a run in progress — wait for it to finish."
        }
    }
    return nil
}
