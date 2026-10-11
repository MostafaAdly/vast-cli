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

    let runStore = RunStore(dir: RunStore.defaultDir())
    private var refreshTimer: Timer?
    var pollTimer: Timer?

    init() {
        Task { await start() }
    }

    var icon: IconState { iconState(doctor: doctor, status: status, runs: runs) }
    var cards: [RepoCard] { repoCards(status: status, doctor: doctor, pending: pending, runs: runs) }
    var stale: Bool { isStale(lastSuccess: lastSuccess) }

    func start() async {
        await checkCLI()
        loadRuns()
        await refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    func checkCLI() async {
        let r = await Shell.run(Commands.version, timeout: 30)
        compat = CLICompat.check(versionOutput: r.stdout, exitCode: r.exitCode)
    }

    /// status, doctor and pending at once. A failed read keeps the last good
    /// data; the header says it is stale.
    func refresh() async {
        guard !refreshing else { return }
        if case .ok = compat {} else { await checkCLI() }
        guard case .ok = compat else { return }
        refreshing = true
        defer { refreshing = false }
        async let s = Shell.run(Commands.status, timeout: 120)
        async let d = Shell.run(Commands.doctor, timeout: 120)
        async let p = Shell.run(Commands.pending, timeout: 180)
        let (sr, dr, pr) = await (s, d, p)
        let decoder = VastJSON.decoder()
        var errors: [String] = []
        var statusRead = false
        if let v = try? decoder.decode(StatusSnapshot.self, from: Data(sr.stdout.utf8)) { status = v; statusRead = true }
        else { errors.append("status: \(Self.lastLine(sr.stderr))") }
        // doctor exits 1 when a check fails; its JSON is still the answer.
        if let v = try? decoder.decode(DoctorSnapshot.self, from: Data(dr.stdout.utf8)) { doctor = v }
        else { errors.append("doctor: \(Self.lastLine(dr.stderr))") }
        if let v = try? decoder.decode(PendingSnapshot.self, from: Data(pr.stdout.utf8)) { pending = v }
        else { errors.append("pending: \(Self.lastLine(pr.stderr))") }
        // The cards are status; doctor and pending only decorate them.
        if statusRead { lastSuccess = Date() }
        refreshError = errors.isEmpty ? nil : errors.joined(separator: "\n")
    }

    static func lastLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).last.map(String.init) ?? "no output"
    }
}

struct Preview: Equatable {
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
            summarize(store.events(id: record.id)).isFinished || !Self.isRunAlive(record)
        })
        reloadRuns()
        if runs.contains(where: { $0.state == .running }) { startPolling() }
    }

    func reloadRuns() {
        runs = runStore.records().map { record in
            let summary = summarize(runStore.events(id: record.id))
            return TrackedRun(record: record, summary: summary,
                              state: runState(summary: summary, alive: Self.isRunAlive(record)))
        }
    }

    /// A run's process is alive only if its pid is, and only for two hours:
    /// after that a pid still answering is most likely a reused one, so a run
    /// with no `end` reads as died instead of running forever.
    nonisolated static func isRunAlive(_ record: RunRecord, now: Date = Date()) -> Bool {
        Shell.isAlive(record.pid) && now.timeIntervalSince(record.startedAt) < 2 * 3600
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
        return Preview(summary: summarize(NDJSON.events(from: r.stdout)), stderr: r.stderr, exitCode: r.exitCode)
    }

    /// The real run, detached. Returns an error message, or nil once started.
    func start(_ command: VastCommand) async -> String? {
        let id = newRunID()
        do {
            try runStore.ensureDir()
            let pid = try await Shell.startDetached(command, stdout: runStore.ndjsonURL(id), stderr: runStore.logURL(id))
            try runStore.save(RunRecord(id: id, pid: pid, args: command.args, startedAt: Date(), dismissed: false))
        } catch {
            return "Could not start: \(error)"
        }
        panel = nil
        reloadRuns()
        startPolling()
        return nil
    }

    func dismiss(_ id: String) {
        guard var record = runs.first(where: { $0.id == id })?.record else { return }
        record.dismissed = true
        try? runStore.save(record)
        reloadRuns()
    }
}
