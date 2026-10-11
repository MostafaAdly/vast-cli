import Foundation

/// Each run is three files: <id>.json (the record), <id>.ndjson (stdout),
/// <id>.log (stderr). Everything the app knows about a run survives a quit.
public struct RunStore: Sendable {
    public let dir: URL

    public init(dir: URL) { self.dir = dir }

    public static func defaultDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Vast Bar/runs", isDirectory: true)
    }

    public func recordURL(_ id: String) -> URL { dir.appendingPathComponent("\(id).json") }
    public func ndjsonURL(_ id: String) -> URL { dir.appendingPathComponent("\(id).ndjson") }
    public func logURL(_ id: String) -> URL { dir.appendingPathComponent("\(id).log") }

    public func ensureDir() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    public func save(_ record: RunRecord) throws {
        try ensureDir()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(record).write(to: recordURL(record.id), options: .atomic)
    }

    public func records() -> [RunRecord] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(RunRecord.self, from: Data(contentsOf: $0)) }
            .sorted { $0.startedAt < $1.startedAt }
    }

    public func events(id: String) -> [VastEvent] {
        guard let text = try? String(contentsOf: ndjsonURL(id), encoding: .utf8) else { return [] }
        return NDJSON.events(from: text)
    }

    public func stderrTail(id: String, lines: Int) -> [String] {
        guard let text = try? String(contentsOf: logURL(id), encoding: .utf8) else { return [] }
        return Array(text.split(whereSeparator: \.isNewline).map(String.init).suffix(lines))
    }

    /// Deletes finished runs older than seven days; a run still going is kept however old.
    public func prune(now: Date = Date(), isFinished: (RunRecord) -> Bool) {
        for record in records() where now.timeIntervalSince(record.startedAt) > 7 * 86_400 && isFinished(record) {
            for url in [recordURL(record.id), ndjsonURL(record.id), logURL(record.id)] {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}
