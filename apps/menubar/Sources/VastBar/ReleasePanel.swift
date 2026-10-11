import SwiftUI
import VastBarCore

struct ReleasePanel: View {
    @EnvironmentObject var store: Store
    let target: ReleaseTarget
    @State private var fixVersion = false
    @State private var preview: Preview?
    @State private var loading = false
    @State private var error: String?
    /// Set on the Release click, cleared only if the start was refused: a
    /// second click while `zsh -lc` starts must not start a second run.
    @State private var starting = false
    /// Bumped by every preview request; only the latest request's result is
    /// shown, and only it clears `loading`.
    @State private var generation = 0

    private var named: [String] { target.repoNames }
    private var dryRun: VastCommand { Commands.release(target, dryRun: true, fixVersion: fixVersion) }

    private var offersFixVersion: Bool {
        preview?.summary.plans.contains { ($0.detail ?? "").contains("--fix-version") } ?? false
    }

    private var startable: Bool {
        guard let p = preview, p.command == dryRun else { return false }
        return p.summary.plans.contains(where: \.ok) && !p.summary.cliFailed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: target.title)
            CappedScroll(maxHeight: 460) {
                VStack(alignment: .leading, spacing: 10) {
                    if loading {
                        HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
                    } else if let p = preview {
                        if p.summary.plans.isEmpty {
                            FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init), command: p.command)
                        }
                        ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0, skip: p.summary.willSkip($0.repo)) }
                        if offersFixVersion || fixVersion {
                            Toggle("Use the first version above production (--fix-version)", isOn: $fixVersion)
                                .disabled(starting)
                        }
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Release") { confirm() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!startable || loading || starting)
            }
        }
        .padding(12)
        .task(id: fixVersion) { await load() }
    }

    /// Runs the previewed command for real — never one rebuilt from the toggles.
    private func confirm() {
        guard startable, !loading, !starting, let p = preview else { return }
        starting = true
        error = nil
        Task {
            switch await store.start(p.command.withoutDryRun, named: named, covers: targetRepos(target, status: store.status)) {
            case .started: break
            case .refused(let message): error = message; starting = false
            case .unclear(let message): error = message
            }
        }
    }

    private func load() async {
        // A start in flight owns the panel: no new dry run beside it, and its warning stays.
        guard !starting else { return }
        generation += 1
        let mine = generation
        error = nil
        if let refusal = repoNameRefusal(named) { error = refusal; preview = nil; loading = false; return }
        loading = true
        let result = await store.preview(dryRun)
        guard mine == generation, !Task.isCancelled else { return }
        preview = result
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

/// A scroll view as tall as its content, up to `maxHeight`, so a short
/// preview stays short and a long one never pushes the buttons off screen.
struct CappedScroll<Content: View>: View {
    let maxHeight: CGFloat
    @ViewBuilder var content: () -> Content
    @State private var height: CGFloat = 0

    var body: some View {
        ScrollView {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(GeometryReader { g in Color.clear.preference(key: ContentHeightKey.self, value: g.size.height) })
        }
        .frame(height: min(height, maxHeight))
        .onPreferenceChange(ContentHeightKey.self) { height = $0 }
    }
}

private struct ContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct PlanRow: View {
    let plan: PlanEvent
    /// Why the dry run says this repo will be skipped, if it does.
    var skip: String? = nil
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
            if plan.ok, let skip {
                Text("will be skipped: \(skip)").font(.caption).foregroundStyle(.secondary)
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
                // Pasting is a deliberate act: the full command.
                Button("Copy command") { Terminal.copy(command.terminalLine) }
                // Terminal runs it at once: only ever a dry run, never --slack.
                Button("Open dry run in Terminal") { Terminal.open(command.safeTerminalLine) }
            }
            .controlSize(.small)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(.red.opacity(0.08)))
    }
}
