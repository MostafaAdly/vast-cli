import Foundation

/// One staging backend's health URL. A GET, nothing else, is ever sent to it.
public struct HealthEndpoint: Equatable, Sendable, Identifiable {
    public let name: String
    public let url: URL
    public var id: String { name }
    public init(name: String, url: URL) { self.name = name; self.url = url }
}

public enum HealthState: Equatable, Sendable {
    case unknown
    case up(ms: Int)
    case down(reason: String)

    public var isDown: Bool {
        if case .down = self { return true }
        return false
    }

    /// The chip's tooltip.
    public var help: String {
        switch self {
        case .unknown: return "not checked yet"
        case .up(let ms): return "up · \(ms) ms"
        case .down(let reason): return "down · \(reason)"
        }
    }
}

public enum StagingHealth {
    /// Hosts from Vast-deployments `deployments/helm/staging/{vastpay,vastmenu}-backend/stage.yaml`.
    public static let endpoints: [HealthEndpoint] = [
        HealthEndpoint(name: "VastPay API", url: URL(string: "https://api-staging.vast-pay.com/health")!),
        HealthEndpoint(name: "VastMenu API", url: URL(string: "https://api-staging.vastmenu.com/health")!),
    ]

    /// Up iff a 2xx answered and its body is not JSON with a `status` field,
    /// or that field reads ok/up/healthy (any case). `error` is the request's
    /// own short reason ("timed out", "unreachable").
    public static func classify(statusCode: Int?, body: Data?, error: String?, elapsedMs: Int) -> HealthState {
        if let error { return .down(reason: error) }
        guard let statusCode else { return .down(reason: "unreachable") }
        guard (200..<300).contains(statusCode) else { return .down(reason: "HTTP \(statusCode)") }
        guard let body,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let status = object["status"] else { return .up(ms: elapsedMs) }
        let text = describe(status)
        return ["ok", "up", "healthy"].contains(text.lowercased()) ? .up(ms: elapsedMs) : .down(reason: "status: \(text)")
    }

    private static func describe(_ value: Any) -> String {
        if let s = value as? String { return s }
        if let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
        return "\(value)"
    }
}

/// A GET to the endpoint, never from cache, timed. Not unit-tested against
/// the network: `StagingHealth.classify` carries the rules.
public func checkHealth(_ e: HealthEndpoint, timeout: TimeInterval = 6, session: URLSession = .shared) async -> HealthState {
    var request = URLRequest(url: e.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    request.httpMethod = "GET"
    let started = Date()
    do {
        let (data, response) = try await session.data(for: request)
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        return StagingHealth.classify(statusCode: (response as? HTTPURLResponse)?.statusCode, body: data, error: nil, elapsedMs: ms)
    } catch let error as URLError where error.code == .timedOut {
        return .down(reason: "timed out")
    } catch {
        return .down(reason: "unreachable")
    }
}
