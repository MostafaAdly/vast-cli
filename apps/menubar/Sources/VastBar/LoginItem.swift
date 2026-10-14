import Foundation
import ServiceManagement

/// "Open at login" through macOS's own login items (macOS 13+). Read fresh
/// each time, so a change made in System Settings shows.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ on: Bool) {
        do {
            if on {
                try SMAppService.mainApp.register()
                // Registered but switched off in System Settings: only the user can
                // allow it there, so take them to it rather than do nothing visible.
                if SMAppService.mainApp.status == .requiresApproval {
                    SMAppService.openSystemSettingsLoginItems()
                }
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            NSLog("Vast Bar: could not change Open at login: \(error)")
        }
    }
}
