import SwiftUI
import VastBarCore

/// The card's live row: promoting → building (elapsed) → rolling out → done,
/// or the CLI's own failure with its last stderr lines.
struct RunProgressSlot: View {
    @EnvironmentObject var store: Store
    let card: RepoCard

    private var run: TrackedRun? {
        store.runs.last { !$0.record.dismissed && !$0.summary.dryRun && $0.summary.repos.contains { $0.repo == card.id } }
    }

    var body: some View {
        if let run, let progress = run.summary.repos.first(where: { $0.repo == card.id }) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if run.state == .running { ProgressView().controlSize(.mini) }
                    Text(line(progress, run)).font(.caption).foregroundStyle(color(progress, run))
                    Spacer()
                    if let url = progress.prUrl.flatMap(URL.init(string:)) { Link("PR", destination: url).font(.caption) }
                    if let url = progress.runUrl.flatMap(URL.init(string:)) { Link("Build", destination: url).font(.caption) }
                    if run.state != .running {
                        Button { store.dismiss(run.id) } label: { Image(systemName: "xmark") }
                            .buttonStyle(.borderless).font(.caption2).help("Dismiss")
                    }
                }
                if run.summary.cliFailed || run.state == .died {
                    FailureBox(lines: store.runStore.stderrTail(id: run.id, lines: 8), command: VastCommand(args: run.record.args))
                }
            }
        }
    }

    private func line(_ p: RepoProgress, _ run: TrackedRun) -> String {
        if run.state == .died { return "stopped without finishing" }
        switch p.phase {
        case .preparing: return run.summary.command == "promote" ? "opening the PR…" : "promoting develop → staging…"
        case .building(let ms): return "building \(p.version ?? "") · \(Self.elapsed(ms))"
        case .rollingOut(let state, let ms): return "rolling out · \(state) · \(Self.elapsed(ms))"
        case .finished(let status): return "\(status) \(p.version ?? "")" + (p.detail.map { " — \($0)" } ?? "")
        }
    }

    private func color(_ p: RepoProgress, _ run: TrackedRun) -> Color {
        if run.state == .died { return .red }
        if case .finished(let s) = p.phase { return s == "failed" ? .red : s == "released" ? .green : .secondary }
        return .blue
    }

    static func elapsed(_ ms: Int) -> String {
        let s = ms / 1000
        return s >= 60 ? "\(s / 60)m\(String(format: "%02d", s % 60))s" : "\(s)s"
    }
}
