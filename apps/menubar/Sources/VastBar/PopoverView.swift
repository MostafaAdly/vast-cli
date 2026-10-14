import SwiftUI
import VastBarCore

struct PopoverView: View {
    @EnvironmentObject var store: Store
    /// Held here, not read in the menu's binding: nothing observable changes when
    /// it is toggled, so the checkmark would otherwise go stale.
    @State private var openAtLogin = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderView(openAtLogin: Binding(get: { openAtLogin }, set: { on in
                LoginItem.set(on)
                openAtLogin = LoginItem.isEnabled
            }))
            Divider()
            content
            if store.panel == nil, !store.selection.isEmpty, case .ok? = store.compat {
                SelectionBar()
            }
        }
        // Not .task: closing the popover would cancel the refresh and kill its vast commands.
        .onAppear {
            openAtLogin = LoginItem.isEnabled // a change made in System Settings shows
            Task { await store.refresh() }
        }
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
                    VStack(alignment: .leading, spacing: 14) {
                        if let error = store.refreshError {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 11)).foregroundStyle(Theme.waiting)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if store.status != nil { SummaryTilesView(tiles: store.tiles) }
                        ForEach(teamSections(store.cards)) { TeamSectionView(section: $0) }
                        DoctorSection(lines: footerLines(doctor: store.doctor))
                    }
                    .padding(12)
                }
            }
        }
    }
}

// MARK: - Header

struct HeaderView: View {
    @EnvironmentObject var store: Store
    @Binding var openAtLogin: Bool

    var body: some View {
        let state = store.icon
        let color = Theme.stateColor(state)
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(color).frame(height: Theme.strip)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    ZStack {
                        Circle().fill(Theme.tint(color))
                        Image(systemName: Theme.stateSymbol(state))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(color)
                    }
                    .frame(width: 32, height: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        subtitle.font(.system(size: 11))
                    }
                    Spacer(minLength: 4)
                    Group {
                        if store.refreshing {
                            ProgressView().controlSize(.small)
                        } else {
                            Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                                .foregroundStyle(.secondary)
                                .help("Refresh")
                        }
                    }
                    .frame(width: 18, height: 18)
                    Menu {
                        Toggle("Open at login", isOn: $openAtLogin)
                        Divider()
                        Button("Quit Vast Bar") { NSApplication.shared.terminate(nil) }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .foregroundStyle(.secondary)
                    .help("More")
                }
                .buttonStyle(.borderless)
                HStack(spacing: 6) {
                    ForEach(StagingHealth.endpoints) { HealthChip(name: $0.name, state: store.health[$0.name] ?? .unknown) }
                    Spacer()
                }
            }
            .padding(12)
        }
    }

    private var loaded: Bool { store.lastSuccess != nil }
    private var title: String { loaded ? store.headline.title : "Vast Bar" }

    /// The cause gets its own lines so it is read, not cut; when it was updated sits under it.
    @ViewBuilder private var subtitle: some View {
        if let last = store.lastSuccess {
            let rel = RelativeDateTimeFormatter().localizedString(for: last, relativeTo: Date())
            VStack(alignment: .leading, spacing: 1) {
                Text(store.headline.detail).help(store.headline.detail).foregroundStyle(.secondary)
                    .lineLimit(2).truncationMode(.tail).fixedSize(horizontal: false, vertical: true)
                Text(store.stale ? "stale, last good refresh \(rel)" : "updated \(rel)")
                    .foregroundStyle(store.stale ? Theme.waiting : Color(nsColor: .tertiaryLabelColor))
                    .lineLimit(1)
            }
        } else {
            Text(store.refreshing ? "Loading…" : "No data yet").foregroundStyle(.secondary)
        }
    }
}

struct HealthChip: View {
    let name: String
    let state: HealthState

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "server.rack").font(.system(size: 9)).foregroundStyle(.secondary)
            Text(name).font(.system(size: 11))
                .foregroundStyle(state.isDown ? Theme.problem : Color.secondary)
            Dot(color: Theme.health(state))
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Capsule().fill(Theme.card))
        .help("\(name) staging: \(state.help)")
    }
}

// MARK: - Summary tiles

struct SummaryTilesView: View {
    let tiles: SummaryTiles
    var body: some View {
        HStack(spacing: 8) {
            Tile(symbol: "square.stack.3d.up", color: Theme.frontend, value: tiles.repos, label: "Repos")
            Tile(symbol: "arrow.triangle.pull", color: Theme.waiting, value: tiles.waiting, label: "PRs waiting")
            Tile(symbol: "arrow.up.circle", color: Theme.staging, value: tiles.ready, label: "Ready to release")
        }
    }
}

private struct Tile: View {
    let symbol: String, color: Color, value: Int, label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Image(systemName: symbol).font(.system(size: 12, weight: .medium)).foregroundStyle(color)
            Text("\(value)").font(.system(size: 18, weight: .medium)).monospacedDigit()
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.card))
    }
}

// MARK: - Team sections

struct TeamSectionView: View {
    @EnvironmentObject var store: Store
    let section: TeamSection

    private var selectable: Set<String> { Set(selectableRepos(section.cards)) }
    private var allTicked: Bool { !selectable.isEmpty && selectable.isSubset(of: store.selection) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Dot(color: Theme.team(section.team))
                Text(section.title).font(.system(size: 13, weight: .medium))
                Text("\(section.cards.count)").font(.system(size: 12)).foregroundStyle(.tertiary)
                Spacer()
                Button(allTicked ? "Clear" : "Select all") {
                    if allTicked { store.selection.subtract(section.cards.map(\.id)) }
                    else { store.selection.formUnion(selectable) }
                }
                .buttonStyle(.borderless)
                .font(.system(size: 12))
                .foregroundStyle(Theme.accent)
                .disabled(selectable.isEmpty)
            }
            ForEach(section.cards) { RepoCardView(card: $0) }
        }
    }
}

// MARK: - Selection bar

struct SelectionBar: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Text("\(store.selection.count) selected").font(.system(size: 12, weight: .medium))
                Button("Clear") { store.selection = [] }
                    .buttonStyle(.borderless).font(.system(size: 12)).foregroundStyle(Theme.accent)
                Spacer()
                Button {
                    store.panel = .release(.repos(orderedSelection(store.selection, cards: store.cards)))
                } label: {
                    Label("Preview release", systemImage: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.card)
        }
    }
}

// MARK: - Doctor

struct DoctorSection: View {
    let lines: [DoctorCheck]
    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Doctor").font(.system(size: 13, weight: .medium))
                ForEach(Array(lines.enumerated()), id: \.offset) { _, check in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: check.status == .fail ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(check.status == .fail ? Theme.problem : Theme.waiting)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(check.label).font(.system(size: 12, weight: .medium))
                            Text(check.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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

struct PanelHost: View {
    let panel: Panel
    var body: some View {
        switch panel {
        case .release(let target): ReleasePanel(target: target)
        case .promote(let repo): PromotePanel(repo: repo)
        }
    }
}
