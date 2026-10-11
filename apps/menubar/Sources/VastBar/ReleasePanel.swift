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
                        HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").font(.system(size: 12)).foregroundStyle(.secondary) }
                    } else if let p = preview {
                        if p.summary.plans.isEmpty {
                            FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init), command: p.command)
                        }
                        ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0, skip: p.summary.willSkip($0.repo)) }
                        if offersFixVersion || fixVersion {
                            Toggle("Use the first version above production (--fix-version)", isOn: $fixVersion)
                                .font(.system(size: 12))
                                .disabled(starting)
                        }
                    }
                }
            }
            if let error { Text(error).font(.system(size: 11)).foregroundStyle(Theme.problem).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Release") { confirm() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
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
        HStack(spacing: 8) {
            Button { store.panel = nil } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless).foregroundStyle(.secondary).help("Back")
            Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            Spacer()
        }
    }
}

/// A scroll view as tall as its content, up to `maxHeight`, so a short
/// preview stays short and a long one never pushes the buttons off screen.
///
/// The height is known on the first layout pass: a hidden copy of the
/// content is measured beside the scroll view. A height fed back through a
/// preference arrives a pass late, so a one-shot measure (the menu bar
/// window's first size, `sizeThatFits`) would see zero.
struct CappedScroll<Content: View>: View {
    let maxHeight: CGFloat
    @ViewBuilder var content: () -> Content

    var body: some View {
        CappedHeight(maxHeight: maxHeight) {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .hidden()
                .accessibilityHidden(true)
            ScrollView {
                content().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// Two subviews: the measured content (hidden), then the scroll view, which
/// gets the content's height up to `maxHeight`.
private struct CappedHeight: Layout {
    let maxHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let measured = subviews.first else { return .zero }
        let size = measured.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: proposal.width ?? size.width, height: min(size.height, maxHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
        subviews[1].place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

struct PlanRow: View {
    let plan: PlanEvent
    /// Why the dry run says this repo will be skipped, if it does.
    var skip: String? = nil
    /// The env the version goes to: staging for a release, production for a promote.
    var env: Color = Theme.staging
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: Theme.rowSpacing) {
                Image(systemName: plan.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(plan.ok ? Theme.done : Theme.problem)
                    .frame(width: Theme.checkWidth)
                Text(plan.repo).font(.system(size: 14, weight: .medium)).lineLimit(1)
                Spacer()
                VersionPill(text: plan.version, dot: env, help: "the version it ships")
            }
            VStack(alignment: .leading, spacing: 3) {
                if !promoteLine.isEmpty { Text(promoteLine).foregroundStyle(.secondary) }
                if let notice = plan.notice { Text(notice).foregroundStyle(Theme.waiting) }
                if let detail = plan.detail {
                    Text(detail).foregroundStyle(plan.ok ? Color.secondary : Theme.problem)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if plan.ok, let skip {
                    Text("will be skipped: \(skip)").foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .font(.system(size: 11))
            .padding(.leading, Theme.indent)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.card))
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
            Label("vast failed", systemImage: "xmark.octagon.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.problem)
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.tint(Theme.problem)))
    }
}
