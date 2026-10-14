import Foundation
import ServiceManagement

/// "Open at login" through macOS's own login items (macOS 13+). Read fresh
/// each time, so a change made in System Settings shows.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("Vast Bar: could not change Open at login: \(error)")
        }
    }
}
