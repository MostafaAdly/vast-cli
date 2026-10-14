import AppKit
import VastBarCore

enum Terminal {
    /// Opens Terminal and runs `line` in a new window at once. `line` is
    /// always a `VastCommand.safeTerminalLine` (a dry run, never --slack),
    /// never free text.
    static func open(_ line: String) {
        let script = "tell application \"Terminal\" to do script \(appleScriptQuote(line))\ntell application \"Terminal\" to activate"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", script]
        try? p.run()
    }

    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
