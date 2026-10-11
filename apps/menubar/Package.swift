// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VastBar",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "VastBar", targets: ["VastBar"]),
        .library(name: "VastBarCore", targets: ["VastBarCore"]),
    ],
    targets: [
        .target(name: "VastBarCore"),
        .executableTarget(
            name: "VastBar",
            dependencies: ["VastBarCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "VastBarCoreTests",
            dependencies: ["VastBarCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
