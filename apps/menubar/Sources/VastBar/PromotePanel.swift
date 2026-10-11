import SwiftUI
import VastBarCore

struct PromotePanel: View {
    @EnvironmentObject var store: Store
    let repo: String
    @State private var hotfix = false
    @State private var slack = false
    @State private var preview: Preview?
    @State private var loading = false
    @State private var error: String?
    /// Set on the Open PR click, cleared only if the start was refused.
    @State private var starting = false
    /// Bumped by every preview request; only the latest request's result is
    /// shown, and only it clears `loading`.
    @State private var generation = 0

    private var dryRun: VastCommand { Commands.promote(repo: repo, hotfix: hotfix, slack: slack, dryRun: true) }

    /// The preview on screen is for the toggles as they are now, and it opens a PR.
    private var openable: Bool {
        guard let p = preview, p.command == dryRun else { return false }
        // With Slack on, the message it would post must be on screen before it can be posted.
        let slackShown = !slack || p.summary.prs.contains { $0.slack != nil }
        return p.summary.plans.first?.ok == true && !p.summary.prs.isEmpty && !p.summary.cliFailed && slackShown
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Promote \(repo) to production")
            Picker("Kind", selection: $hotfix) {
                Text("Release").tag(false)
                Text("Hotfix").tag(true)
            }
            .pickerStyle(.segmented)
            .disabled(starting)
            Toggle("Post to Slack", isOn: $slack)
                .disabled(starting)
            CappedScroll(maxHeight: 400) {
                VStack(alignment: .leading, spacing: 10) {
                    if loading {
                        HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
                    } else if let p = preview {
                        if p.summary.plans.isEmpty {
                            FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init), command: p.command)
                        }
                        ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0, skip: p.summary.willSkip($0.repo)) }
                        ForEach(p.summary.prs, id: \.branch) { pr in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Opens \(pr.branch) → production (\(pr.version))").font(.callout)
                                if let text = pr.slack?.text {
                                    Text("Slack message").font(.caption).foregroundStyle(.secondary)
                                    Text(text).font(.caption).textSelection(.enabled)
                                        .padding(6)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                                }
                            }
                        }
                        Text("The PR is never merged from here, and nothing deploys production.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Open PR") { confirm() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!openable || loading || starting)
            }
        }
        .padding(12)
        .task(id: "\(hotfix)-\(slack)") { await load() }
    }

    /// Runs the previewed command for real — never one rebuilt from the toggles.
    private func confirm() {
        guard openable, !loading, !starting, let p = preview else { return }
        starting = true
        error = nil
        Task {
            switch await store.start(p.command.withoutDryRun, named: [repo], covers: [repo]) {
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
        if let refusal = repoNameRefusal([repo]) { error = refusal; preview = nil; loading = false; return }
        loading = true
        let result = await store.preview(dryRun)
        guard mine == generation, !Task.isCancelled else { return }
        preview = result
        loading = false
    }
}
