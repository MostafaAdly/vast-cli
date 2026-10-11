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
    /// Set on the Open PR click, cleared only if the start failed.
    @State private var starting = false

    private var command: VastCommand { Commands.promote(repo: repo, hotfix: hotfix, slack: slack, dryRun: false) }
    private var dryRun: VastCommand { Commands.promote(repo: repo, hotfix: hotfix, slack: slack, dryRun: true) }

    private var openable: Bool {
        guard let p = preview else { return false }
        return p.summary.plans.first?.ok == true && !p.summary.prs.isEmpty && !p.summary.cliFailed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Promote \(repo) to production")
            Picker("Kind", selection: $hotfix) {
                Text("Release").tag(false)
                Text("Hotfix").tag(true)
            }
            .pickerStyle(.segmented)
            Toggle("Post to Slack", isOn: $slack)
            if loading {
                HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
            } else if let p = preview {
                if p.summary.plans.isEmpty {
                    FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init), command: dryRun)
                }
                ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0) }
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
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Open PR") {
                    starting = true
                    Task {
                        if let failure = await store.start(command, named: [repo], covers: [repo]) {
                            error = failure
                            starting = false
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!openable || loading || starting)
            }
        }
        .padding(12)
        .task(id: "\(hotfix)-\(slack)") { await load() }
    }

    private func load() async {
        if let refusal = repoNameRefusal([repo]) { error = refusal; preview = nil; return }
        loading = true
        preview = await store.preview(dryRun)
        loading = false
    }
}
