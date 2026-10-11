import Foundation

public enum RepoPhase: Equatable, Sendable {
    case preparing
    case building(elapsedMs: Int)
    case rollingOut(state: String, elapsedMs: Int)
    case finished(status: String)
}

public struct RepoProgress: Equatable, Sendable, Identifiable {
    public let repo: String
    public var phase: RepoPhase = .preparing
    public var version: String?
    public var runUrl: String?
    public var prUrl: String?
    public var detail: String?
    /// Failed by the "ended without finishing" synthesis at `end`, not by a
    /// `done`: the reason is only on stderr.
    public var endedUnfinished = false
    public var id: String { repo }
    public init(repo: String) { self.repo = repo }
}

public struct RunSummary: Equatable, Sendable {
    public var command: String?
    public var dryRun = false
    public var repos: [RepoProgress] = []
    public var plans: [PlanEvent] = []
    public var prs: [PREvent] = []
    public var exitCode: Int?
    /// A repo reached `finished` through a real `done` event, not through the
    /// "ended without finishing" synthesis at `end`.
    public internal(set) var anyFinishedByDone = false

    public var isFinished: Bool { exitCode != nil }
    public var anyFailed: Bool {
        repos.contains { $0.phase == .finished(status: "failed") }
    }
    /// The CLI itself failed: it ended non-zero without finishing any repo.
    public var cliFailed: Bool { (exitCode ?? 0) != 0 && !anyFinishedByDone }

    public init() {}

    /// Why a dry run says `repo` will be skipped, or nil. "dry run" is the
    /// preview itself, not a reason.
    public func willSkip(_ repo: String) -> String? {
        guard let p = repos.first(where: { $0.repo == repo }), p.phase == .finished(status: "skipped"),
              let detail = p.detail, detail != "dry run" else { return nil }
        return detail
    }
}

/// Folds a run's events into what the card shows. Order of repos: as `start`
/// listed them, then any repo first seen later.
public func summarize(_ events: [VastEvent]) -> RunSummary {
    var s = RunSummary()
    /// Repos the run got to work on: planned or dispatched.
    var touched: Set<String> = []
    func index(_ repo: String) -> Int {
        if let i = s.repos.firstIndex(where: { $0.repo == repo }) { return i }
        s.repos.append(RepoProgress(repo: repo))
        return s.repos.count - 1
    }
    for event in events {
        switch event {
        case .start(let command, _, let dryRun, let repos):
            s.command = command
            s.dryRun = dryRun
            for r in repos { _ = index(r) }
        case .plan(let p):
            s.plans.append(p)
            touched.insert(p.repo)
            let i = index(p.repo)
            s.repos[i].version = p.version
            s.repos[i].detail = p.detail
        case .promoted(let repo, _):
            _ = index(repo)
        case .dispatched(let repo, let version, _, let runUrl):
            touched.insert(repo)
            let i = index(repo)
            s.repos[i].version = version
            s.repos[i].runUrl = runUrl
            s.repos[i].phase = .building(elapsedMs: 0)
        case .run(let repo, _, _, let elapsedMs):
            let i = index(repo)
            s.repos[i].phase = .building(elapsedMs: elapsedMs)
        case .rollout(let repo, let state, let reason, let elapsedMs):
            let i = index(repo)
            s.repos[i].phase = .rollingOut(state: state, elapsedMs: elapsedMs)
            if let reason { s.repos[i].detail = reason }
        case .pr(let pr):
            s.prs.append(pr)
            let i = index(pr.repo)
            s.repos[i].prUrl = pr.url
            s.repos[i].version = pr.version
        case .done(let d):
            let i = index(d.repo)
            s.repos[i].phase = .finished(status: d.status)
            s.repos[i].detail = d.detail
            s.repos[i].version = d.version
            s.anyFinishedByDone = true
        case .end(let code):
            s.exitCode = code
            // A run that ended with a repo it worked on (or any repo, if it
            // ended non-zero) still unfinished: that repo failed.
            for i in s.repos.indices {
                if case .finished = s.repos[i].phase { continue }
                guard code != 0 || touched.contains(s.repos[i].repo) else { continue }
                s.repos[i].phase = .finished(status: "failed")
                s.repos[i].detail = "ended without finishing"
                s.repos[i].endedUnfinished = true
            }
        case .unknown:
            break
        }
    }
    return s
}
