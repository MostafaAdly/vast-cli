import Foundation

/// What the app remembers about a run it started: enough to find its files
/// and tell whether its process is still alive.
public struct RunRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let pid: Int32
    public let args: [String]
    public let startedAt: Date
    public var dismissed: Bool
    public init(id: String, pid: Int32, args: [String], startedAt: Date, dismissed: Bool) {
        self.id = id; self.pid = pid; self.args = args; self.startedAt = startedAt; self.dismissed = dismissed
    }
}

/// Sortable and unique: the time first, then a random tail.
public func newRunID(now: Date = Date()) -> String {
    String(format: "%013.0f", now.timeIntervalSince1970 * 1000) + "-" + UUID().uuidString.prefix(8).lowercased()
}
