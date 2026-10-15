import SwiftUI
import VastBarCore

@main
struct VastBarApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(store)
                .frame(width: 400)
                .modifier(FitsMenuBarWindow())
        } label: {
            MenuBarIcon(state: store.icon)
        }
        .menuBarExtraStyle(.window)
    }
}
