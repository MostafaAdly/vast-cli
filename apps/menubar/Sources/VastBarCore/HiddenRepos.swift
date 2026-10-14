import Foundation

/// Repos the CLI releases but Vast Bar leaves out, at Mostafa's request
/// (2026-10-14). Hidden at the source, so a hidden repo neither gets a card
/// nor counts toward the header or the icon.
public enum HiddenRepos {
    public static let names: Set<String> = ["vast-menu-payments"]
}

public extension StatusSnapshot {
    func hiding(_ names: Set<String>) -> StatusSnapshot {
        StatusSnapshot(generatedAt: generatedAt, repos: repos.filter { !names.contains($0.repo) })
    }
}

public extension DoctorSnapshot {
    /// Drops the hidden repos' own checks (group "Repos"); machine-wide checks stay.
    func hiding(_ names: Set<String>) -> DoctorSnapshot {
        DoctorSnapshot(generatedAt: generatedAt, checks: checks.filter { !($0.group == "Repos" && names.contains($0.label)) })
    }
}

public extension PendingSnapshot {
    func hiding(_ names: Set<String>) -> PendingSnapshot {
        PendingSnapshot(repos: repos.filter { !names.contains($0.repo) })
    }
}
