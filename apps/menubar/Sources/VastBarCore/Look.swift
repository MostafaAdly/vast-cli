import Foundation

// What the popover says about itself, as plain values the views only lay out.

// MARK: - Fix-version hint

/// Doctor's "next X is not above production Y — release it with
/// --fix-version (→ Z)" in a card's words, or nil when the detail is not
/// that or carries no `(→ Z)` tail (the card then shows the full text).
public func fixVersionHint(_ detail: String) -> String? {
    guard detail.contains("not above production"), detail.contains("--fix-version"),
          let open = detail.range(of: "(→ ", options: .backwards),
          let close = detail.range(of: ")", range: open.upperBound..<detail.endIndex) else { return nil }
    let version = detail[open.upperBound..<close.lowerBound].trimmingCharacters(in: .whitespaces)
    return version.isEmpty ? nil : "Behind production · --fix-version gives \(version)"
}

// MARK: - Summary tiles

public struct SummaryTiles: Equatable, Sendable {
    public let repos: Int
    /// PRs on staging that production lacks, over every repo pending could read.
    public let waiting: Int
    /// Repos whose develop has commits staging lacks.
    public let ready: Int
    public init(repos: Int, waiting: Int, ready: Int) { self.repos = repos; self.waiting = waiting; self.ready = ready }
}

public func summaryTiles(status: StatusSnapshot?, pending: PendingSnapshot?) -> SummaryTiles {
    let repos = status?.repos ?? []
    return SummaryTiles(
        repos: repos.count,
        waiting: (pending?.repos ?? []).reduce(0) { $0 + ($1.waitingCount ?? 0) },
        ready: repos.filter { ($0.drift.ahead ?? 0) > 0 }.count)
}

// MARK: - Headline

public struct Headline: Equatable, Sendable {
    public let title: String
    public let detail: String
}

/// The header's sentence. Counts follow `iconState`'s rules: doctor fails
/// and failed runs are problems; doctor warns, unreadable cells and a
/// staging backend that is down are to look at. `detail` is the first
/// problem's cause, else the first thing to look at; while a run is going,
/// the repos it works on.
public func headline(icon: IconState, doctor: DoctorSnapshot?, status: StatusSnapshot?, runs: [TrackedRun],
                     health: [String: HealthState] = [:]) -> Headline {
    let visible = runs.filter { !$0.record.dismissed }
    let checks = doctor?.checks ?? []
    let problems = checks.filter { $0.status == .fail }.map(checkCause)
        + visible.filter(\.failed).map { failureCause($0, status: status) }
    var lookAt = checks.filter { $0.status == .warn }.map(checkCause)
    for r in status?.repos ?? [] {
        if r.staging.problem == "?" { lookAt.append("\(r.repo): staging tag could not be read") }
        if r.production.problem == "?" { lookAt.append("\(r.repo): production tag could not be read") }
        if r.drift.problem == "?" { lookAt.append("\(r.repo): drift could not be computed") }
    }
    lookAt += StagingHealth.endpoints.compactMap { e in
        if case .down(let reason) = health[e.name] { return "\(e.name) down · \(reason)" }
        return nil
    }
    // A backend outside the known list still counts.
    lookAt += health.keys.sorted().filter { name in !StagingHealth.endpoints.contains { $0.name == name } }
        .compactMap { name in if case .down(let reason) = health[name] { return "\(name) down · \(reason)" } else { return nil } }

    let running = visible.filter { $0.state == .running }
    let isPromote = { (run: TrackedRun) in (run.summary.command ?? run.record.args.first) == "promote" }
    let releasing = unique(running.filter { !isPromote($0) }.flatMap { reposOf($0, status: status) })
    let promoting = unique(running.filter(isPromote).flatMap { reposOf($0, status: status) })

    let title: String
    switch icon {
    case .failed:
        title = count(problems.count, "problem") + (lookAt.isEmpty ? "" : ", \(lookAt.count) to look at")
    case .running:
        if releasing.isEmpty && promoting.isEmpty { title = "Starting a run" }
        else if promoting.isEmpty { title = "Releasing " + count(releasing.count, "repo") }
        else if releasing.isEmpty { title = "Promoting " + count(promoting.count, "repo") }
        else { title = "Releasing \(count(releasing.count, "repo")), promoting \(promoting.count)" }
    case .attention:
        title = "\(lookAt.count) to look at"
    case .ok:
        title = "All good"
    }
    // While running (nothing failed), the repos it works on say more than an amber item.
    let detail = icon == .running && !(releasing + promoting).isEmpty
        ? (releasing + promoting).joined(separator: ", ")
        : problems.first ?? lookAt.first ?? "Nothing needs you"
    return Headline(title: title, detail: detail)
}

private func count(_ n: Int, _ noun: String) -> String { "\(n) \(noun)\(n == 1 ? "" : "s")" }

private func unique(_ names: [String]) -> [String] {
    var seen = Set<String>()
    return names.filter { seen.insert($0).inserted }
}

private func checkCause(_ c: DoctorCheck) -> String {
    "\(c.label): \(fixVersionHint(c.detail) ?? c.detail)"
}

private func failureCause(_ run: TrackedRun, status: StatusSnapshot?) -> String {
    if run.state == .died { return "\(reposOf(run, status: status).joined(separator: ", ")): stopped without finishing" }
    if run.summary.cliFailed { return "vast \(run.summary.command ?? run.record.args.first ?? "") failed" }
    if let p = run.summary.repos.first(where: { $0.phase == .finished(status: "failed") }) {
        return "\(p.repo) failed" + (p.detail.map { " — \($0)" } ?? "")
    }
    return "a run failed"
}

// MARK: - Tracker

public enum TrackerStep: Int, CaseIterable, Sendable {
    case promote, build, rollOut, live
    public var title: String {
        switch self {
        case .promote: return "Promote"
        case .build: return "Build"
        case .rollOut: return "Roll out"
        case .live: return "Live"
        }
    }
}

public enum StepState: Equatable, Sendable { case done, current, future, failed }

/// One state per `TrackerStep` for a release's repo, or nil where the
/// tracker does not apply: a promote (it opens a PR, nothing deploys), a
/// skipped repo, or a repo a finished run never worked on.
public func trackerStates(progress: RepoProgress?, command: String?, state: RunState) -> [StepState]? {
    if command == "promote" { return nil }
    let at: Int
    var failed = state == .died
    switch progress?.phase ?? .preparing {
    case .preparing:
        if state == .finished { return nil }
        at = TrackerStep.promote.rawValue
    case .building: at = TrackerStep.build.rawValue
    case .rollingOut: at = TrackerStep.rollOut.rawValue
    case .finished(let status):
        switch status {
        case "released": return TrackerStep.allCases.map { _ in .done }
        case "failed":
            failed = true
            if progress?.reachedRollout == true { at = TrackerStep.rollOut.rawValue }
            else if progress?.runUrl != nil { at = TrackerStep.build.rawValue }
            else { at = TrackerStep.promote.rawValue }
        default: return nil
        }
    }
    return TrackerStep.allCases.map { step in
        step.rawValue < at ? .done : step.rawValue > at ? .future : (failed ? .failed : .current)
    }
}

/// "45s", "3m05s".
public func formatElapsed(ms: Int) -> String {
    let s = max(0, ms) / 1000
    return s >= 60 ? "\(s / 60)m\(String(format: "%02d", s % 60))s" : "\(s)s"
}
