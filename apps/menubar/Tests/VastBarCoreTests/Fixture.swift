import Foundation

enum FixtureError: Error { case missing(String) }

/// A recorded CLI output from Tests/VastBarCoreTests/Fixtures.
func fixture(_ name: String) throws -> Data {
    guard let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") else {
        throw FixtureError.missing(name)
    }
    return try Data(contentsOf: url)
}

func fixtureText(_ name: String) throws -> String {
    String(decoding: try fixture(name), as: UTF8.self)
}
