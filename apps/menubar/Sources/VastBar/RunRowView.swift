import SwiftUI
import VastBarCore

/// The card's live part: the Promote → Build → Roll out → Live tracker for a
/// release, a line for anything the tracker does not say, and the CLI's own
/// failure with its last stderr lines.
struct RunProgressSlot: View {
    @EnvironmentObject var store: Store
    let card: RepoCard
    let run: TrackedRun

    var body: some View {
        let progress = run.summary.repos.first { $0.repo == card.id }
        let steps = trackerStates(progress: progress, command: run.summary.command ?? run.record.args.first, state: run.state)
        VStack(alignment: .leading, spacing: 6) {
            if let steps { Tracker(states: steps) }
            HStack(spacing: 8) {
                if let text = line(progress, steps: steps) {
                    Text(text).font(.system(size: 11)).foregroundStyle(color(progress))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if let url = progress?.prUrl.flatMap(URL.init(string:)) { Link("PR", destination: url).font(.system(size: 11)) }
                if let url = progress?.runUrl.flatMap(URL.init(string:)) { Link("Build", destination: url).font(.system(size: 11)) }
                if run.state != .running {
                    Button { store.dismiss(run.id) } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless).font(.system(size: 10)).foregroundStyle(.secondary).help("Dismiss")
                }
            }
            // The why is only on stderr: the CLI failed, the process died,
            // or this repo was left unfinished when the run ended.
            if run.summary.cliFailed || run.state == .died || progress?.endedUnfinished == true {
                FailureBox(lines: store.runStore.stderrTail(id: run.id, lines: 8), command: VastCommand(args: run.record.args))
            }
        }
    }

    /// What the tracker does not already say.
    private func line(_ p: RepoProgress?, steps: [StepState]?) -> String? {
        if run.state == .died { return "stopped without finishing" }
        guard let p else { return run.state == .running ? (steps == nil ? "starting…" : nil) : "failed — ended before it began" }
        switch p.phase {
        case .preparing:
            if steps != nil { return nil }
            return run.summary.command == "promote" ? "opening the PR…" : "promoting develop → staging…"
        case .building: return steps == nil ? "building \(p.version ?? "")" : nil
        case .rollingOut(let state, _): return state
        case .finished(let status): return "\(status) \(p.version ?? "")" + (p.detail.map { " — \($0)" } ?? "")
        }
    }

    private func color(_ p: RepoProgress?) -> Color {
        if run.state == .died { return Theme.problem }
        guard let p else { return run.state == .running ? Theme.staging : Theme.problem }
        if case .finished(let s) = p.phase { return s == "failed" ? Theme.problem : s == "released" ? Theme.done : .secondary }
        return .secondary
    }
}

/// Four capsules joined by short lines: done green, current blue, failed
/// red, future muted with no fill.
struct Tracker: View {
    let states: [StepState]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(TrackerStep.allCases, id: \.self) { step in
                if step.rawValue > 0 {
                    Rectangle().fill(Theme.hairline).frame(width: 12, height: 1)
                }
                pill(step, states[step.rawValue])
            }
        }
    }

    private func pill(_ step: TrackerStep, _ state: StepState) -> some View {
        let color: Color? = switch state {
        case .done: Theme.done
        case .current: Theme.staging
        case .failed: Theme.problem
        case .future: nil
        }
        return HStack(spacing: 3) {
            if state == .done { Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)) }
            if state == .failed { Image(systemName: "xmark").font(.system(size: 8, weight: .bold)) }
            Text(step.title)
        }
        .font(.system(size: 11, weight: state == .current ? .medium : .regular))
        .foregroundStyle(color ?? Color(nsColor: .tertiaryLabelColor))
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(Capsule().fill(color.map(Theme.tint) ?? .clear))
        .fixedSize()
    }
}
