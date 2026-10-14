import Foundation
import SwiftUI
import VastBarCore

enum Panel: Equatable {
    case release(ReleaseTarget)
    case promote(String)
}

@MainActor
final class Store: ObservableObject {
    @Published var compat: CLICompat.Result?
    @Published var status: StatusSnapshot?
    @Published var doctor: DoctorSnapshot?
    @Published var pending: PendingSnapshot?
    @Published var lastSuccess: Date?
    @Published var refreshing = false
    @Published var refreshError: String?
    @Published var runs: [TrackedRun] = []
    @Published var panel: Panel?
    /// Repos ticked for one several-repo release. Never a running repo.
    @Published var selection: Set<String> = []
    /// Staging backend health by endpoint name.
    @Published var health: [String: HealthState] = [:]

    let runStore = RunStore(dir: RunStore.defaultDir())
    private var refreshTimer: Timer?
    private var healthTimer: Timer?
    private var checkingHealth = false
    var pollTimer: Timer?

    init() {
        Task { await start() }
    }

    var icon: IconState { iconState(doctor: doctor, status: status, runs: runs, health: health) }
    var headline: Headline { VastBarCore.headline(icon: icon, doctor: doctor, status: status, runs: runs, health: health) }
    var tiles: SummaryTiles { summaryTiles(status: status, pending: pending) }
    var cards: [RepoCard] { repoCards(status: status, doctor: doctor, pending: pending, runs: runs) }
    var stale: Bool { isStale(lastSuccess: lastSuccess) }

    func start() async {
        await checkCLI()
        loadRuns()
        await refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        // Cheap and independent of vast: its own minute.
        healthTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshHealth() }
        }
    }

    /// GETs every staging /health URL at once. Nothing else is sent.
    func refreshHealth() async {
        guard !checkingHealth else { return }
        checkingHealth = true
        defer { checkingHealth = false }
        let results = await withTaskGroup(of: (String, HealthState).self) { group in
            for e in StagingHealth.endpoints { group.addTask { (e.name, await checkHealth(e)) } }
            var all: [String: HealthState] = [:]
            for await (name, state) in group { all[name] = state }
            return all
        }
        if results != health { health = results }
    }

    /// Takes out of the selection any repo that is gone or now running.
    func pruneSelection() {
        let pruned = prunedSelection(selection, cards: cards)
        if pruned != selection { selection = pruned }
    }

    func checkCLI() async {
        let r = await Shell.run(Commands.version, timeout: 30)
        compat = CLICompat.check(versionOutput: r.stdout, exitCode: r.exitCode)
    }

    /// status, doctor and pending at once. A failed read keeps the last good
    /// data; the header says it is stale.
    func refresh() async {
        Task { await refreshHealth() }
        guard !refreshing else { return }
        if case .ok = compat {} else { await checkCLI() }
        guard case .ok = compat else { return }
        refreshing = true
        defer { refreshing = false }
        // No git fetch under a release running in the same checkouts.
        let busy = runs.contains { $0.state == .running }
        async let s = Shell.run(busy ? Commands.statusNoFetch : Commands.status, timeout: 120)
        async let d = Shell.run(Commands.doctor, timeout: 120)
        // pending has no --no-fetch: skip it under a run and keep the last counts.
        async let p: ShellResult? = busy ? nil : await Shell.run(Commands.pending, timeout: 180)
        let (sr, dr, pr) = await (s, d, p)
        let decoder = VastJSON.decoder()
        var errors: [String] = []
        var statusRead = false
        if let v = try? decoder.decode(StatusSnapshot.self, from: Data(sr.stdout.utf8)) { status = v.hiding(HiddenRepos.names); statusRead = true }
        else { errors.append("status: \(Self.lastLine(sr.stderr))") }
        // doctor exits 1 when a check fails; its JSON is still the answer.
        if let v = try? decoder.decode(DoctorSnapshot.self, from: Data(dr.stdout.utf8)) { doctor = v.hiding(HiddenRepos.names) }
        else { errors.append("doctor: \(Self.lastLine(dr.stderr))") }
        if let pr {
            if let v = try? decoder.decode(PendingSnapshot.self, from: Data(pr.stdout.utf8)) { pending = v.hiding(HiddenRepos.names) }
            else { errors.append("pending: \(Self.lastLine(pr.stderr))") }
        }
        // The cards are status; doctor and pending only decorate them.
        if statusRead { lastSuccess = Date(); pruneSelection() }
        refreshError = errors.isEmpty ? nil : errors.joined(separator: "\n")
    }

    static func lastLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).last.map(String.init) ?? "no output"
    }
}

enum StartOutcome: Equatable {
    case started
    /// Nothing was launched; the panel may try again.
    case refused(String)
    /// It may be running: the panel keeps its confirm disabled.
    case unclear(String)
}

struct Preview: Equatable {
    /// The dry run that produced this preview; the confirm runs its
    /// `withoutDryRun`, never a command rebuilt from the panel's toggles.
    let command: VastCommand
    let summary: RunSummary
    let stderr: String
    let exitCode: Int32
}

extension Store {
    /// Reads every run from disk, works out which are still going, and polls
    /// while any is. Finished runs older than seven days are pruned.
    func loadRuns() {
        let store = runStore
        store.prune(isFinished: { record in
            summarize(store.events(id: record.id)).isFinished || !isRunAlive(record)
        })
        reloadRuns()
        if runs.contains(where: { $0.state == .running }) { startPolling() }
    }

    /// Assigns `runs` only when something changed: polling every second must
    /// not re-render the popover and the menu bar label for nothing.
    func reloadRuns() {
        let fresh = runStore.records().map { stored -> TrackedRun in
            let record = resolvePendingPid(stored)
            let summary = summarize(runStore.events(id: record.id))
            return TrackedRun(record: record, summary: summary,
                              state: runState(summary: summary, alive: isRunAlive(record)))
        }
        if fresh != runs { runs = fresh; pruneSelection() }
    }

    /// A start whose pid was not known yet: the wrapper may have written its
    /// pid file since. Once it has, the record keeps the pid.
    private func resolvePendingPid(_ record: RunRecord) -> RunRecord {
        guard record.pid == RunRecord.pendingPID, let pid = Shell.readPid(runStore.pidURL(record.id)) else { return record }
        let known = RunRecord(id: record.id, pid: pid, args: record.args, startedAt: record.startedAt, dismissed: record.dismissed)
        try? runStore.save(known)
        return known
    }

    private func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let wasRunning = Set(self.runs.filter { $0.state == .running }.map(\.id))
                self.reloadRuns()
                let nowRunning = Set(self.runs.filter { $0.state == .running }.map(\.id))
                if nowRunning.isEmpty {
                    self.pollTimer?.invalidate(); self.pollTimer = nil
                }
                // A run just ended: the deployed tags changed, so refresh.
                if !wasRunning.subtracting(nowRunning).isEmpty { Task { await self.refresh() } }
            }
        }
    }

    /// A dry run, synchronously: the preview the user confirms.
    func preview(_ command: VastCommand) async -> Preview {
        let r = await Shell.run(command, timeout: 300)
        return Preview(command: command, summary: summarize(NDJSON.events(from: r.stdout)), stderr: r.stderr, exitCode: r.exitCode)
    }

    /// The real run, detached. `named` are the repo names on the command
    /// line, `covers` every repo the run works on; an unsafe name or a repo
    /// already running refuses it.
    ///
    /// A provisional record (pid unknown) is saved before the launch, so a
    /// start whose outcome is unclear still reads as running and refuses a
    /// second start; it is never forgotten.
    func start(_ command: VastCommand, named: [String], covers: [String]) async -> StartOutcome {
        reloadRuns()
        if let refusal = startRefusal(named: named, covers: covers, runs: runs, status: status) { return .refused(refusal) }
        let provisional = RunRecord(id: newRunID(), pid: RunRecord.pendingPID, args: command.args, startedAt: Date(), dismissed: false)
        let id = provisional.id
        do {
            try runStore.save(provisional)
        } catch {
            return .refused("Could not start: \(error)")  // nothing was launched
        }
        let pid = try? await Shell.startDetached(command, stdout: runStore.ndjsonURL(id), stderr: runStore.logURL(id),
                                                 pidFile: runStore.pidURL(id))
        if let pid {
            try? runStore.save(RunRecord(id: id, pid: pid, args: provisional.args, startedAt: provisional.startedAt, dismissed: false))
        }
        reloadRuns()
        startPolling()
        guard pid != nil else {
            return .unclear("vast may have started, but its pid could not be read. Its card shows it as running for up to 10 minutes — do not start it again.")
        }
        panel = nil
        selection = []
        return .started
    }

    func dismiss(_ id: String) {
        guard var record = runs.first(where: { $0.id == id })?.record else { return }
        record.dismissed = true
        try? runStore.save(record)
        reloadRuns()
    }
}
