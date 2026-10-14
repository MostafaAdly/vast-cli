import SwiftUI
import VastBarCore

struct RepoCardView: View {
    @EnvironmentObject var store: Store
    let card: RepoCard

    private var selected: Bool { store.selection.contains(card.id) }
    private var run: TrackedRun? { cardRun(card.id, runs: store.runs, status: store.status) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: Theme.rowSpacing) {
                leading.frame(width: Theme.checkWidth)
                Text(card.displayName).font(.system(size: 14, weight: .medium)).lineLimit(1)
                Spacer(minLength: 4)
                if card.isRunning, let run {
                    RunClock(run: run, version: card.progress?.version)
                } else if let n = card.waitingPRs, n > 0 {
                    Text("\(n) waiting")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.waiting)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(Theme.tint(Theme.waiting)))
                        .help("PRs on staging that production does not have yet")
                }
                Button { store.panel = .promote(card.id) } label: { Image(systemName: "paperplane") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .help("Promote to production…")
                    .disabled(card.isRunning)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    VersionPill(text: card.staging, dot: Theme.staging, help: "staging")
                    Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary)
                    VersionPill(text: card.production, dot: Theme.production, help: "production")
                    Spacer(minLength: 4)
                    Text(card.drift).font(.system(size: 11))
                        .foregroundStyle((card.driftAhead ?? 0) > 0 ? Theme.drift : Color.secondary)
                        .lineLimit(1)
                }
                ForEach(card.problems, id: \.self) { p in
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9))
                        Text(p.text).fixedSize(horizontal: false, vertical: true)
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(p.failing ? Theme.problem : Theme.waiting)
                    .help(p.detail)
                }
                if let run { RunProgressSlot(card: card, run: run) }
            }
            .padding(.leading, Theme.indent)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: Theme.radius).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.accent, lineWidth: 1.5).opacity(selected ? 1 : 0))
    }

    @ViewBuilder private var leading: some View {
        if card.isRunning {
            Spinner().help("A run is going on this repo")
        } else {
            Button {
                if selected { store.selection.remove(card.id) } else { store.selection.insert(card.id) }
            } label: {
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 14))
                    .foregroundStyle(selected ? Theme.accent : Color.secondary)
            }
            .buttonStyle(.borderless)
            .help(selected ? "Leave out of the release" : "Add to the release")
        }
    }
}

/// A deployed tag: mono, neutral, a hairline border and its env's dot.
struct VersionPill: View {
    let text: String, dot: Color, help: String
    var body: some View {
        HStack(spacing: 5) {
            Dot(color: dot)
            Text(text).font(.system(size: 12, design: .monospaced)).lineLimit(1)
        }
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(Capsule().fill(Theme.card))
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
        .help(help)
    }
}

/// "2.1.18-rc6 · 3m05s", ticking from the run's start.
struct RunClock: View {
    let run: TrackedRun
    let version: String?
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let ms = Int(context.date.timeIntervalSince(run.record.startedAt) * 1000)
            Text([version, formatElapsed(ms: ms)].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}
