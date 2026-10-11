import SwiftUI
import VastBarCore

struct PopoverView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .task { await store.refresh() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle().fill(Color(nsColor: MenuBarIcon.color(store.icon))).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 1) {
                Text("Vast Bar").font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(store.stale ? .orange : .secondary)
            }
            Spacer()
            if store.refreshing { ProgressView().controlSize(.small) }
            Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless)
                .disabled(store.refreshing)
                .help("Refresh")
        }
        .padding(12)
    }

    private var subtitle: String {
        guard let last = store.lastSuccess else { return store.refreshing ? "Loading…" : "No data yet" }
        let rel = RelativeDateTimeFormatter().localizedString(for: last, relativeTo: Date())
        return store.stale ? "Stale — last good refresh \(rel)" : "Updated \(rel)"
    }

    @ViewBuilder private var content: some View {
        switch store.compat {
        case .missing?:
            CompatCard(title: "vast not found", message: "Vast Bar runs the vast CLI through your login shell and could not find it.", command: "curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh | bash")
        case .tooOld(let v)?:
            CompatCard(title: "vast \(v) is too old", message: "Vast Bar needs vast \(CLICompat.minimum) or newer.", command: "vast upgrade")
        default:
            if let panel = store.panel {
                PanelHost(panel: panel)
            } else {
                // Not a bare ScrollView: the menu bar window sizes itself to the
                // content's ideal height, and a bare ScrollView's is zero.
                CappedScroll(maxHeight: 560) {
                    VStack(spacing: 8) {
                        if let error = store.refreshError {
                            Text(error).font(.caption).foregroundStyle(.orange)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(store.cards) { RepoCardView(card: $0) }
                        trains
                        DoctorFooter(lines: attentionLines(doctor: store.doctor))
                    }
                    .padding(12)
                }
            }
        }
    }

    private var trains: some View {
        HStack {
            ForEach(Train.allCases, id: \.self) { train in
                Button("Release \(train.rawValue)") { store.panel = .release(.train(train)) }
                    .disabled(trainRepos(train, status: store.status).isEmpty
                              || store.cards.contains { $0.isRunning && $0.releaseTeam == train.rawValue })
            }
            Spacer()
        }
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Quit") { NSApplication.shared.terminate(nil) }.buttonStyle(.borderless)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

struct CompatCard: View {
    let title: String, message: String, command: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary)
            HStack {
                Text(command).font(.system(.caption, design: .monospaced)).lineLimit(2).textSelection(.enabled)
                Spacer()
                Button("Copy") { Terminal.copy(command) }
            }
        }
        .padding(12)
    }
}

struct DoctorFooter: View {
    let lines: [DoctorCheck]
    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Doctor").font(.caption).foregroundStyle(.secondary)
                ForEach(Array(lines.enumerated()), id: \.offset) { _, check in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: check.status == .fail ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(check.status == .fail ? .red : .orange)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(check.label).font(.caption.bold())
                            Text(check.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.5)))
        }
    }
}

struct PanelHost: View {
    let panel: Panel
    var body: some View {
        switch panel {
        case .release(let target): ReleasePanel(target: target)
        case .promote(let repo): PromotePanel(repo: repo)
        }
    }
}
