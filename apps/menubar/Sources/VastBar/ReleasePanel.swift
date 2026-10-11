import SwiftUI
import VastBarCore

struct ReleasePanel: View {
    @EnvironmentObject var store: Store
    let target: ReleaseTarget
    @State private var fixVersion = false
    @State private var preview: Preview?
    @State private var loading = false
    @State private var error: String?
    /// Set on the Release click, cleared only if the start failed: a second
    /// click while `zsh -lc` starts must not start a second run.
    @State private var starting = false

    private var named: [String] { target.repoName.map { [$0] } ?? [] }

    private var title: String {
        switch target {
        case .repo(let name): return "Release \(name) to staging"
        case .train(let train): return "Release \(train.rawValue) to staging"
        }
    }

    private var offersFixVersion: Bool {
        preview?.summary.plans.contains { ($0.detail ?? "").contains("--fix-version") } ?? false
    }

    private var startable: Bool {
        guard let p = preview else { return false }
        return p.summary.plans.contains(where: \.ok) && !p.summary.cliFailed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: title)
            if loading {
                HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
            } else if let p = preview {
                if p.summary.plans.isEmpty {
                    FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init),
                               command: Commands.release(target, dryRun: true, fixVersion: fixVersion))
                }
                ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0) }
                if offersFixVersion || fixVersion {
                    Toggle("Use the first version above production (--fix-version)", isOn: $fixVersion)
                        .onChange(of: fixVersion) { _ in Task { await load() } }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Release") {
                    starting = true
                    Task {
                        let command = Commands.release(target, dryRun: false, fixVersion: fixVersion)
                        if let failure = await store.start(command, named: named, covers: targetRepos(target, status: store.status)) {
                            error = failure
                            starting = false
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!startable || loading || starting)
            }
        }
        .padding(12)
        .task { await load() }
    }

    private func load() async {
        if let refusal = repoNameRefusal(named) { error = refusal; preview = nil; return }
        loading = true
        preview = await store.preview(Commands.release(target, dryRun: true, fixVersion: fixVersion))
        loading = false
    }
}

struct PanelHeader: View {
    @EnvironmentObject var store: Store
    let title: String
    var body: some View {
        HStack {
            Button { store.panel = nil } label: { Image(systemName: "chevron.left") }.buttonStyle(.borderless)
            Text(title).font(.headline)
            Spacer()
        }
    }
}

struct PlanRow: View {
    let plan: PlanEvent
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Image(systemName: plan.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .foregroundStyle(plan.ok ? .green : .red)
                Text(plan.repo).font(.system(.body, weight: .semibold))
                Spacer()
                Text(plan.version).font(.system(.caption, design: .monospaced))
            }
            Text(promoteLine).font(.caption).foregroundStyle(.secondary)
            if let notice = plan.notice { Text(notice).font(.caption).foregroundStyle(.orange) }
            if let detail = plan.detail {
                Text(detail).font(.caption).foregroundStyle(plan.ok ? Color.secondary : Color.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    private var promoteLine: String {
        switch plan.promote {
        case "will merge": return "develop → staging: \(plan.commits ?? 0) commit(s) to merge"
        case "merged": return "develop merged into staging"
        case "nothing to promote": return "staging already has develop"
        case "no develop": return "no develop branch — deploys staging as it is"
        default: return plan.commits.map { "\($0) commit(s)" } ?? ""
        }
    }
}

struct FailureBox: View {
    let lines: [String]
    let command: VastCommand
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("vast failed").font(.caption.bold()).foregroundStyle(.red)
            Text(lines.isEmpty ? "No output." : lines.joined(separator: "\n"))
                .font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Copy command") { Terminal.copy(command.terminalLine) }
                Button("Open in Terminal") { Terminal.open(command.terminalLine) }
            }
            .controlSize(.small)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(.red.opacity(0.08)))
    }
}
