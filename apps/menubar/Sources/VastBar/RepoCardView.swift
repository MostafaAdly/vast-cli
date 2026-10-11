import SwiftUI
import VastBarCore

struct RepoCardView: View {
    @EnvironmentObject var store: Store
    let card: RepoCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.displayName).font(.system(.body, weight: .semibold))
                Spacer()
                if let n = card.waitingPRs, n > 0 {
                    Text("\(n) waiting").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(.blue.opacity(0.15)))
                        .help("PRs on staging that production does not have yet")
                }
            }
            HStack(spacing: 6) {
                Text(card.staging).font(.system(.caption, design: .monospaced))
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.tertiary)
                Text(card.production).font(.system(.caption, design: .monospaced))
                Spacer()
                Text(card.drift).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(card.problems, id: \.self) { p in
                Label(p.text, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            RunProgressSlot(card: card)
            HStack {
                Button("Release") { store.panel = .release(.repo(card.id)) }
                Button("Promote…") { store.panel = .promote(card.id) }
                Spacer()
            }
            .controlSize(.small)
            .disabled(card.isRunning)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
    }
}
