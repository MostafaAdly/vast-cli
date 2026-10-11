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

    /// Task 7 replaces this with the run-tracking version.
    func loadRuns() {}

    static func lastLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).last.map(String.init) ?? "no output"
    }
}
