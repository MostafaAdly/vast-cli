import XCTest
@testable import VastBarCore

/// A sandboxed zsh setup like a teammate's: `vast` is on PATH only through a
/// line in ~/.zshrc (where the installer and nvm put it), and the app was
/// opened from Finder, so it has none of the terminal's PATH.
private struct ZshrcOnlyUser {
    let root: URL
    let bin: URL
    /// What a Finder-launched app inherits: a bare PATH and no terminal.
    var finderEnvironment: [String: String] {
        ["HOME": root.path, "ZDOTDIR": root.path, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "USER": NSUserName()]
    }

    init(zshrcNoise: String = "") throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("vastbar-env-\(UUID().uuidString)")
        bin = root.appendingPathComponent("tools bin")
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        let vast = bin.appendingPathComponent("vast")
        try "#!/bin/sh\necho fake vast \"$@\"\n".write(to: vast, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: vast.path)
        try "\(zshrcNoise)export PATH=\"\(bin.path):$PATH\"\n"
            .write(to: root.appendingPathComponent(".zshrc"), atomically: true, encoding: .utf8)
    }
}

final class ShellEnvironmentTests: XCTestCase {
    // The bug, as a teammate hit it: the login shell alone never reads ~/.zshrc.
    func testALoginShellAloneCannotSeeAZshrcPath() async throws {
        let user = try ZshrcOnlyUser()
        let r = await Shell.runLine("vast --version", timeout: 30, environment: user.finderEnvironment)
        XCTAssertEqual(r.exitCode, 127)
    }

    func testCommandsRunWithTheInteractiveShellsPath() async throws {
        let user = try ZshrcOnlyUser()
        let env = ShellEnvironment.resolved(from: user.finderEnvironment)
        let r = await Shell.runLine("vast --version", timeout: 30, environment: env)
        XCTAssertEqual(r.exitCode, 0, r.stderr)
        XCTAssertEqual(r.stdout, "fake vast --version\n")
    }

    // ~/.zshrc can print anything (banners, fortune, nvm notices): only the
    // text between the markers is the PATH.
    func testZshrcNoiseOnStdoutDoesNotLeakIntoThePath() throws {
        let user = try ZshrcOnlyUser(zshrcNoise: "echo 'Welcome back!'\nprint -n 'no newline'\n")
        let path = try XCTUnwrap(ShellEnvironment.interactivePath(from: user.finderEnvironment))
        XCTAssertTrue(path.split(separator: ":").contains(Substring(user.bin.path)), path)
        XCTAssertFalse(path.contains("Welcome"))
    }

    func testAZshrcThatHangsFallsBackInsteadOfBlocking() throws {
        let user = try ZshrcOnlyUser(zshrcNoise: "sleep 30\n")
        let started = Date()
        XCTAssertNil(ShellEnvironment.interactivePath(from: user.finderEnvironment, timeout: 1))
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
        // The fallback still finds an installer's default bin dir.
        let path = ShellEnvironment.resolved(from: user.finderEnvironment, timeout: 1)["PATH"] ?? ""
        XCTAssertTrue(path.hasSuffix(":\(user.root.path)/.local/bin"), path)
    }

    func testParsePathTakesOnlyWhatIsBetweenTheMarkers() {
        let m = ShellEnvironment.self
        XCTAssertEqual(m.parsePath("noise\(m.begin)/a:/b\(m.end)more"), "/a:/b")
        XCTAssertNil(m.parsePath("/a:/b"))
        XCTAssertNil(m.parsePath("\(m.begin)\(m.end)"), "an empty PATH is no answer")
    }

    func testMergedPutsTheTerminalsPathFirstWithoutDuplicates() {
        XCTAssertEqual(
            ShellEnvironment.merged(resolved: "/n/bin:/usr/bin", inherited: "/usr/bin:/bin", home: "/Users/eng"),
            "/n/bin:/usr/bin:/bin:/Users/eng/.local/bin"
        )
        XCTAssertEqual(
            ShellEnvironment.merged(resolved: nil, inherited: "/usr/bin:/Users/eng/.local/bin", home: "/Users/eng"),
            "/usr/bin:/Users/eng/.local/bin"
        )
    }
}
