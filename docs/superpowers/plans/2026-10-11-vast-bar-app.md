# Vast Bar App (Phases 2–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS menu bar app, Vast Bar, that shows the release state of every repo from `vast … --json`, and starts a staging release or a production release PR behind a dry-run preview, following the run live.

**Architecture:** A Swift package in `apps/menubar/` with two targets. `VastBarCore` is a library of pure, tested logic: JSON models, the NDJSON event stream, run summaries, icon/card state, command building, the shell runner and the run store. `VastBar` is a thin SwiftUI `MenuBarExtra` app that renders that state. Every command runs through the user's login shell (`/bin/zsh -lc`); real runs are detached and write NDJSON to `~/Library/Application Support/Vast Bar/runs/`, which the app tails, so quitting the app never stops a run.

**Tech Stack:** Swift 6.2 toolchain (Xcode 26.2), SwiftPM, SwiftUI `MenuBarExtra` (macOS 13+), XCTest. Apple frameworks only.

**Spec:** `docs/superpowers/specs/2026-10-11-vast-bar-design.md` (Phases 2 and 3). Phase 1 (the CLI's `--json`) is on `feat/vast-bar`, PR #44.

## Global Constraints

- Apple frameworks only, no third-party packages; Swift tools 6.0, platform macOS 13 (`MenuBarExtra`).
- `VastBarCore` compiles in Swift 6 language mode. The `VastBar` app target uses `.swiftLanguageMode(.v5)` (ruling: AppKit/SwiftUI main-actor friction is not worth it in a view layer that holds no logic).
- The app never decides anything a release depends on (versions, guards, what to promote, whether to post). It shows what the CLI says and runs what the user confirms.
- Every command runs as `/bin/zsh -lc '<line>'`. Arguments are a fixed list built by `Commands`; a repo name is used only if it came from `status --json`. Never interpolate free text into a command line.
- Every action is preview-then-confirm: a `--dry-run --json` preview first, then the real command only on an explicit click. Nothing runs on a single click.
- Credentials never pass through the app. No ArgoCD login, no Slack setup, no CLI config writes.
- No production deploy button. "Post to Slack" is off by default.
- Minimum CLI: core version ≥ 2.9.0 (a prerelease suffix such as `2.9.0-dev` counts as 2.9.0).
- Tests use recorded fixtures (synthetic data — no real emails or names: the repo is public), never the real `vast`.
- Commit messages carry no AI attribution (no `Co-Authored-By`, no "Generated with").
- The CLI's own build, tests and release are untouched: do not edit `src/`, `tests/`, `dist/`, `package.json`.

## Review Focus

1. A run file whose last line is half-written (the CLI is mid-write when the app reads it) — expected: the partial line is ignored, never a parse error. Pinned in Task 2.
2. A `vast` missing from the login shell's PATH, or an old one — expected: one card saying so with the command to fix it, no crash, no spinning refresh. Pinned in Task 3 (version check) and Task 6 (compat card).
3. A refresh that fails or times out (network down, `gh` logged out) — expected: last good data stays, marked stale. Pinned in Task 5 (`isStale` rule) and Task 6 (store keeps old data).
4. A run whose process died without writing `end` (killed, machine slept, CLI crash) — expected: shown as failed with the stderr tail, never "running" forever. Pinned in Task 4 (`isAlive`) and Task 5 (`runState`).
5. A repo name or command line containing shell-special characters — expected: quoted, never executed as shell. Pinned in Task 3 (`shellQuote`).

---

## File Structure

```
apps/menubar/
  Package.swift
  build.sh                                   Task 6
  Sources/VastBarCore/
    JSON.swift          VastJSON.decoder()                         Task 1
    Models.swift        Status/Doctor/Pending snapshots            Task 1
    Events.swift        VastEvent + NDJSON parsing                 Task 2
    RunSummary.swift    summarize(events) → RunSummary             Task 2
    Version.swift       CLIVersion, CLICompat                      Task 3
    Commands.swift      VastCommand, Commands, quoting             Task 3
    Shell.swift         run / startDetached / isAlive              Task 4
    RunStore.swift      run records + files on disk                Task 4
    AppState.swift      icon state, repo cards, run state          Task 5
  Sources/VastBar/
    VastBarApp.swift    @main, MenuBarExtra                        Task 6
    Store.swift         @MainActor state + refresh + runs          Task 6 (runs: Task 7)
    MenuBarIcon.swift   icon image with state dot                  Task 6
    PopoverView.swift   header, cards, trains, doctor footer       Task 6
    RepoCardView.swift  one repo                                   Task 6 (progress: Task 7)
    Terminal.swift      open Terminal / copy                       Task 6
    ReleasePanel.swift  release preview + confirm                  Task 7
    PromotePanel.swift  promote preview + confirm                  Task 7
    RunRowView.swift    live progress / failure row                Task 7
  Tests/VastBarCoreTests/
    Fixtures/…          synthetic JSON/NDJSON                      Tasks 1–5
    Fixture.swift       fixture loader                             Task 1
    ModelsTests.swift   EventsTests.swift  RunSummaryTests.swift
    VersionTests.swift  CommandsTests.swift  ShellTests.swift
    RunStoreTests.swift AppStateTests.swift
```

Waves: Task 1 alone → Tasks 2 and 3 in parallel → Tasks 4 and 5 in parallel → Task 6 → Task 7 → Task 8 (install + live check).

---

### Task 1: Package, models, fixtures

**Files:**
- Create: `apps/menubar/Package.swift`, `apps/menubar/Sources/VastBarCore/JSON.swift`, `apps/menubar/Sources/VastBarCore/Models.swift`, `apps/menubar/Sources/VastBar/VastBarApp.swift` (placeholder entry point so the package builds; Task 6 replaces it), `apps/menubar/Tests/VastBarCoreTests/Fixture.swift`, `apps/menubar/Tests/VastBarCoreTests/ModelsTests.swift`, fixtures `status.json`, `doctor.json`, `pending.json`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: `VastJSON.decoder() -> JSONDecoder`; `StatusSnapshot`, `StatusRepo`, `StatusCell`, `StatusDrift`; `DoctorSnapshot`, `DoctorCheck`, `CheckStatus`; `PendingSnapshot`, `PendingRepo` (`waitingCount: Int?`); test helper `fixture(_ name: String) throws -> Data`.

- [ ] **Step 1: Package and ignore rules**

`apps/menubar/Package.swift`:

```swift
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
```

`apps/menubar/Sources/VastBar/VastBarApp.swift` (placeholder, replaced in Task 6):

```swift
import SwiftUI

@main
struct VastBarApp: App {
    var body: some Scene {
        MenuBarExtra("Vast Bar", systemImage: "shippingbox") { Text("Vast Bar") }
    }
}
```

Append to the repo root `.gitignore`:

```
# Swift package build output (apps/menubar)
.build/
.swiftpm/
```

- [ ] **Step 2: Fixtures** (synthetic — never paste real CLI output; it carries real emails)

`apps/menubar/Tests/VastBarCoreTests/Fixtures/status.json`:

```json
{
  "generatedAt": "2026-10-11T09:00:00.000Z",
  "repos": [
    {
      "repo": "VastPayPwaV2", "displayName": "Vastpay Pwa V2", "releaseTeam": "frontend",
      "staging": { "tag": "2.1.18-rc5", "problem": null },
      "production": { "tag": "2.1.17", "problem": null },
      "drift": { "text": "develop +5", "ahead": 5, "problem": null }
    },
    {
      "repo": "VastMenuPwa", "displayName": "Vastmenu Pwa", "releaseTeam": "frontend",
      "staging": { "tag": null, "problem": "?" },
      "production": { "tag": "1.6.12", "problem": null },
      "drift": { "text": "in sync", "ahead": 0, "problem": null }
    },
    {
      "repo": "VastPay-BackEnd", "displayName": "Vastpay Backend", "releaseTeam": "backend",
      "staging": { "tag": "3.0.1-rc2", "problem": null },
      "production": { "tag": null, "problem": "not migrated" },
      "drift": { "text": "no develop", "ahead": null, "problem": "no develop" }
    }
  ]
}
```

`apps/menubar/Tests/VastBarCoreTests/Fixtures/doctor.json`:

```json
{
  "generatedAt": "2026-10-11T09:00:01.500Z",
  "checks": [
    { "group": "Tools", "label": "node", "status": "ok", "detail": "v22.0.0" },
    { "group": "vast-cli", "label": "vast-cli", "status": "ok", "detail": "2.9.0, up to date" },
    { "group": "ArgoCD", "label": "ArgoCD staging", "status": "fail", "detail": "token expired — run `vast argocd login`" },
    { "group": "Repos", "label": "VastPayPwaV2", "status": "ok", "detail": "next 2.1.18-rc6" },
    { "group": "Repos", "label": "VastMenuPwa", "status": "warn", "detail": "next 1.6.12-rc1 is not above production 1.6.12 — release it with --fix-version (→ 1.6.13-rc1)" }
  ]
}
```

`apps/menubar/Tests/VastBarCoreTests/Fixtures/pending.json`:

```json
{
  "to": "production",
  "generatedAt": "2026-10-11T09:00:02.000Z",
  "parity": false,
  "repos": [
    {
      "repo": "VastPayPwaV2", "displayName": "Vastpay Pwa V2",
      "repoUrl": "https://github.com/example/VastPayPwaV2",
      "compareUrl": "https://github.com/example/VastPayPwaV2/compare/production...staging",
      "forward": {
        "source": "staging", "target": "production",
        "inFlight": [],
        "waiting": [
          { "number": 11, "title": "Fix a thing", "url": "https://github.com/example/VastPayPwaV2/pull/11", "branch": "fix/thing",
            "contributors": [{ "name": "Dev One", "login": "dev-one", "emails": ["dev@example.com"] }],
            "tickets": [], "phrase": null, "landedAt": "2026-10-01T10:00:00.000Z", "ported": false, "detailsUnavailable": false },
          { "number": 12, "title": "Add a thing", "url": "https://github.com/example/VastPayPwaV2/pull/12", "branch": "feat/thing",
            "contributors": [], "tickets": ["86abc"], "phrase": "adds a thing", "landedAt": "2026-10-02T10:00:00.000Z", "ported": false, "detailsUnavailable": false }
        ],
        "direct": [{ "sha": "abc1234", "subject": "tweak", "landedAt": "2026-10-03T10:00:00.000Z", "ported": false, "inFlight": null }]
      },
      "reverse": null, "notes": [], "problem": null
    },
    {
      "repo": "VastMenuPwa", "displayName": "Vastmenu Pwa",
      "repoUrl": "https://github.com/example/VastMenuPwa",
      "compareUrl": "https://github.com/example/VastMenuPwa/compare/production...staging",
      "forward": null, "reverse": null, "notes": [],
      "problem": { "kind": "error", "message": "fetch failed" }
    }
  ]
}
```

`apps/menubar/Tests/VastBarCoreTests/Fixture.swift`:

```swift
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
```

- [ ] **Step 3: Write the failing tests** — `apps/menubar/Tests/VastBarCoreTests/ModelsTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class ModelsTests: XCTestCase {
    func testStatusDecodesEveryCellShape() throws {
        let s = try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json"))
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2", "VastMenuPwa", "VastPay-BackEnd"])
        XCTAssertEqual(s.repos[0].staging, StatusCell(tag: "2.1.18-rc5", problem: nil))
        XCTAssertEqual(s.repos[1].staging, StatusCell(tag: nil, problem: "?"))
        XCTAssertEqual(s.repos[2].production.problem, "not migrated")
        XCTAssertNil(s.repos[2].drift.ahead)
        XCTAssertEqual(s.repos[0].drift.ahead, 5)
        XCTAssertEqual(s.repos[0].releaseTeam, "frontend")
        XCTAssertEqual(s.generatedAt.timeIntervalSince1970, 1_791_709_200, accuracy: 0.001)
    }

    func testDoctorDecodesStatuses() throws {
        let d = try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json"))
        XCTAssertEqual(d.checks.count, 5)
        XCTAssertEqual(d.checks[2].status, .fail)
        XCTAssertEqual(d.checks[4].status, .warn)
        XCTAssertEqual(d.checks[4].label, "VastMenuPwa")
    }

    func testPendingCountsWaitingPRsAndToleratesAProblemRepo() throws {
        let p = try VastJSON.decoder().decode(PendingSnapshot.self, from: fixture("pending.json"))
        XCTAssertEqual(p.repos[0].waitingCount, 2)
        XCTAssertNil(p.repos[1].waitingCount)
        XCTAssertEqual(p.repos[1].problem?.message, "fetch failed")
    }

    func testDatesWithAndWithoutFractionalSeconds() throws {
        struct Box: Decodable { let at: Date }
        let a = try VastJSON.decoder().decode(Box.self, from: Data(#"{"at":"2026-10-11T09:00:00.250Z"}"#.utf8))
        let b = try VastJSON.decoder().decode(Box.self, from: Data(#"{"at":"2026-10-11T09:00:00Z"}"#.utf8))
        XCTAssertEqual(a.at.timeIntervalSince(b.at), 0.25, accuracy: 0.001)
    }
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd apps/menubar && swift test --filter ModelsTests 2>&1 | tail -5`
Expected: build failure — `cannot find 'VastJSON' in scope`.

- [ ] **Step 5: Implement**

`apps/menubar/Sources/VastBarCore/JSON.swift`:

```swift
import Foundation

public enum VastJSON {
    /// The CLI stamps ISO times with milliseconds; Foundation's `.iso8601` rejects those.
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text) { return date }
            if let date = try? Date.ISO8601FormatStyle().parse(text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "not an ISO 8601 date: \(text)")
        }
        return decoder
    }
}
```

`apps/menubar/Sources/VastBarCore/Models.swift`:

```swift
import Foundation

// `vast status --all --json`

public struct StatusCell: Decodable, Equatable, Sendable {
    public let tag: String?
    /// The table's own wording when the tag is unknown: "not migrated", "n/a" or "?".
    public let problem: String?
    public init(tag: String?, problem: String?) { self.tag = tag; self.problem = problem }
}

public struct StatusDrift: Decodable, Equatable, Sendable {
    public let text: String
    public let ahead: Int?
    public let problem: String?
}

public struct StatusRepo: Decodable, Equatable, Sendable, Identifiable {
    public let repo: String
    public let displayName: String
    public let releaseTeam: String?
    public let staging: StatusCell
    public let production: StatusCell
    public let drift: StatusDrift
    public var id: String { repo }
}

public struct StatusSnapshot: Decodable, Equatable, Sendable {
    public let generatedAt: Date
    public let repos: [StatusRepo]
}

// `vast doctor --json`

public enum CheckStatus: String, Decodable, Sendable { case ok, warn, fail }

public struct DoctorCheck: Decodable, Equatable, Sendable {
    public let group: String
    public let label: String
    public let status: CheckStatus
    public let detail: String
}

public struct DoctorSnapshot: Decodable, Equatable, Sendable {
    public let generatedAt: Date
    public let checks: [DoctorCheck]
}

// `vast pending --all --short --json` — only what the app shows: a count per repo.

public struct PendingItem: Decodable, Equatable, Sendable { public let number: Int }

public struct PendingSide: Decodable, Equatable, Sendable { public let waiting: [PendingItem] }

public struct PendingProblem: Decodable, Equatable, Sendable {
    public let kind: String
    public let message: String
}

public struct PendingRepo: Decodable, Equatable, Sendable {
    public let repo: String
    public let forward: PendingSide?
    public let problem: PendingProblem?
    /// PRs on staging that production lacks; nil when the repo could not be compared.
    public var waitingCount: Int? { forward?.waiting.count }
}

public struct PendingSnapshot: Decodable, Equatable, Sendable {
    public let repos: [PendingRepo]
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/menubar && swift test --filter ModelsTests 2>&1 | tail -3 && swift build 2>&1 | tail -1`
Expected: `Executed 4 tests, with 0 failures`; build succeeds. (If the expected epoch in `testStatusDecodesEveryCellShape` is off, recompute it with `date -u -j -f %Y-%m-%dT%H:%M:%S 2026-10-11T09:00:00 +%s` and fix the test constant — the fixture is the source of truth.)

- [ ] **Step 7: Commit**

```bash
git add .gitignore apps/menubar
git commit -m "feat(vast-bar): Swift package and the status, doctor and pending models"
```

---

### Task 2: Event stream and run summary

**Files:**
- Create: `apps/menubar/Sources/VastBarCore/Events.swift`, `apps/menubar/Sources/VastBarCore/RunSummary.swift`, `apps/menubar/Sources/VastBarCore/RunRecord.swift`, `apps/menubar/Tests/VastBarCoreTests/EventsTests.swift`, `apps/menubar/Tests/VastBarCoreTests/RunSummaryTests.swift`, fixtures `release-dry-run.ndjson`, `release-real.ndjson`, `release-partial.ndjson`, `cli-failed.ndjson`, `promote-dry-run.ndjson`

**Interfaces:**
- Consumes: `VastJSON.decoder()` (Task 1); `fixture`, `fixtureText` test helpers.
- Produces: `VastEvent` (cases `start, plan(PlanEvent), promoted, dispatched, run, rollout, pr(PREvent), done(DoneEvent), end(exitCode:), unknown(type:)`), `PlanEvent`, `PREvent`, `SlackPreview`, `DoneEvent`, `NDJSON.events(from: String) -> [VastEvent]`; `RepoProgress`, `RepoPhase`, `RunSummary`, `summarize(_ events: [VastEvent]) -> RunSummary`; `RunRecord` (`id, pid: Int32, args, startedAt, dismissed`, `Codable`), `newRunID(now: Date = Date()) -> String`.

- [ ] **Step 1: Fixtures**

`Fixtures/release-dry-run.ndjson` (each line one object; file ends with a newline):

```
{"type":"start","command":"release","args":["release","--frontend","--dry-run","--json"],"dryRun":true,"repos":["VastPayPwaV2","VastMenuPwa"],"at":"2026-10-11T09:00:00.000Z"}
{"type":"plan","repo":"VastPayPwaV2","ok":true,"version":"2.1.18-rc6","commits":5,"promote":"will merge","notice":null,"detail":null,"at":"2026-10-11T09:00:01.000Z"}
{"type":"plan","repo":"VastMenuPwa","ok":false,"version":"1.6.12-rc1","commits":null,"promote":"not run","notice":null,"detail":"next 1.6.12-rc1 is not above production 1.6.12 — re-run with --fix-version","at":"2026-10-11T09:00:02.000Z"}
{"type":"done","repo":"VastMenuPwa","version":"1.6.12-rc1","status":"failed","detail":"next 1.6.12-rc1 is not above production 1.6.12 — re-run with --fix-version","at":"2026-10-11T09:00:02.000Z"}
{"type":"done","repo":"VastPayPwaV2","version":"2.1.18-rc6","status":"skipped","detail":"dry run","at":"2026-10-11T09:00:02.100Z"}
{"type":"end","exitCode":1,"at":"2026-10-11T09:00:02.200Z"}
```

`Fixtures/release-real.ndjson`:

```
{"type":"start","command":"release","args":["release","VastPayPwaV2","--json"],"dryRun":false,"repos":["VastPayPwaV2"],"at":"2026-10-11T09:00:00.000Z"}
{"type":"plan","repo":"VastPayPwaV2","ok":true,"version":"2.1.18-rc6","commits":5,"promote":"merged","notice":null,"detail":null,"at":"2026-10-11T09:00:05.000Z"}
{"type":"promoted","repo":"VastPayPwaV2","commits":5,"at":"2026-10-11T09:00:05.000Z"}
{"type":"dispatched","repo":"VastPayPwaV2","version":"2.1.18-rc6","runId":42,"runUrl":"https://github.com/example/VastPayPwaV2/actions/runs/42","at":"2026-10-11T09:00:08.000Z"}
{"type":"run","repo":"VastPayPwaV2","status":"in_progress","conclusion":null,"elapsedMs":30000,"at":"2026-10-11T09:00:38.000Z"}
{"type":"run","repo":"VastPayPwaV2","status":"completed","conclusion":"success","elapsedMs":180000,"at":"2026-10-11T09:03:08.000Z"}
{"type":"rollout","repo":"VastPayPwaV2","state":"waiting for 2.1.18-rc6","reason":null,"elapsedMs":0,"at":"2026-10-11T09:03:09.000Z"}
{"type":"rollout","repo":"VastPayPwaV2","state":"Synced/Healthy","reason":null,"elapsedMs":40000,"at":"2026-10-11T09:03:49.000Z"}
{"type":"done","repo":"VastPayPwaV2","version":"2.1.18-rc6","status":"released","detail":"live","at":"2026-10-11T09:03:49.000Z"}
{"type":"end","exitCode":0,"at":"2026-10-11T09:03:49.100Z"}
```

`Fixtures/release-partial.ndjson` (the CLI is mid-write: the last line has no newline and is cut off — write this file with `printf` so it does NOT end in a newline):

```
{"type":"start","command":"release","args":["release","VastPayPwaV2","--json"],"dryRun":false,"repos":["VastPayPwaV2"],"at":"2026-10-11T09:00:00.000Z"}
{"type":"plan","repo":"VastPayPwaV2","ok":true,"version":"2.1.18-rc6","commits":5,"promote":"merged","notice":null,"detail":null,"at":"2026-10-11T09:00:05.000Z"}
{"type":"dispatched","repo":"VastPayPwaV2","version":"2.1.18-rc6","runId":42,"runUrl":"https://github.com/example/VastPayPwaV2/actions/runs/42","at":"2026-10-11T09:00:08.000Z"}
{"type":"run","repo":"VastPayPwaV2","status":"in_pro
```

`Fixtures/cli-failed.ndjson`:

```
{"type":"start","command":"release","args":["release","VastPayPwaV2","--json"],"dryRun":false,"repos":["VastPayPwaV2"],"at":"2026-10-11T09:00:00.000Z"}
{"type":"end","exitCode":1,"at":"2026-10-11T09:00:00.500Z"}
```

`Fixtures/promote-dry-run.ndjson`:

```
{"type":"start","command":"promote","args":["promote","VastPayPwaV2","--to","production","--slack","--dry-run","--json"],"dryRun":true,"repos":["VastPayPwaV2"],"at":"2026-10-11T09:00:00.000Z"}
{"type":"plan","repo":"VastPayPwaV2","ok":true,"version":"2.1.18","commits":12,"promote":"not run","notice":null,"detail":null,"at":"2026-10-11T09:00:03.000Z"}
{"type":"pr","repo":"VastPayPwaV2","branch":"release/2.1.18","url":null,"version":"2.1.18","slack":{"text":"• Vastpay Pwa V2 - release/2.1.18 - fixes a thing (@dev-one)","posted":false,"error":null},"at":"2026-10-11T09:00:03.000Z"}
{"type":"surprise","repo":"VastPayPwaV2","at":"2026-10-11T09:00:03.000Z"}
{"type":"done","repo":"VastPayPwaV2","version":"2.1.18","status":"skipped","detail":"dry run","at":"2026-10-11T09:00:03.000Z"}
{"type":"end","exitCode":0,"at":"2026-10-11T09:00:03.100Z"}
```

- [ ] **Step 2: Write the failing tests**

`apps/menubar/Tests/VastBarCoreTests/EventsTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class EventsTests: XCTestCase {
    func testEveryEventTypeDecodes() throws {
        let events = NDJSON.events(from: try fixtureText("release-real.ndjson"))
        XCTAssertEqual(events.count, 10)
        guard case .start(let command, _, let dryRun, let repos) = events[0] else { return XCTFail("start") }
        XCTAssertEqual(command, "release"); XCTAssertFalse(dryRun); XCTAssertEqual(repos, ["VastPayPwaV2"])
        guard case .dispatched(_, _, let runId, let runUrl) = events[3] else { return XCTFail("dispatched") }
        XCTAssertEqual(runId, 42); XCTAssertTrue(runUrl.hasSuffix("/42"))
        guard case .rollout(_, let state, _, let elapsed) = events[7] else { return XCTFail("rollout") }
        XCTAssertEqual(state, "Synced/Healthy"); XCTAssertEqual(elapsed, 40000)
        XCTAssertEqual(events.last, .end(exitCode: 0))
    }

    func testUnknownTypeIsKeptAsUnknownNotDropped() throws {
        let events = NDJSON.events(from: try fixtureText("promote-dry-run.ndjson"))
        XCTAssertTrue(events.contains(.unknown(type: "surprise")))
        guard case .pr(let pr) = events[2] else { return XCTFail("pr") }
        XCTAssertNil(pr.url)
        XCTAssertEqual(pr.slack?.posted, false)
        XCTAssertEqual(pr.branch, "release/2.1.18")
    }

    func testAHalfWrittenLastLineIsIgnored() throws {
        let events = NDJSON.events(from: try fixtureText("release-partial.ndjson"))
        XCTAssertEqual(events.count, 3)
    }

    func testGarbageLinesAreSkipped() {
        let text = "not json\n{\"type\":\"end\",\"exitCode\":0}\n\n"
        XCTAssertEqual(NDJSON.events(from: text), [.end(exitCode: 0)])
    }
}
```

`apps/menubar/Tests/VastBarCoreTests/RunSummaryTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class RunSummaryTests: XCTestCase {
    private func summary(_ name: String) throws -> RunSummary {
        summarize(NDJSON.events(from: try fixtureText(name)))
    }

    func testRealReleaseWalksEveryPhaseToReleased() throws {
        let s = try summary("release-real.ndjson")
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.exitCode, 0)
        XCTAssertFalse(s.anyFailed)
        XCTAssertFalse(s.cliFailed)
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2"])
        XCTAssertEqual(s.repos[0].phase, .finished(status: "released"))
        XCTAssertEqual(s.repos[0].runUrl, "https://github.com/example/VastPayPwaV2/actions/runs/42")
        XCTAssertEqual(s.repos[0].version, "2.1.18-rc6")
    }

    func testPartialRunIsStillBuilding() throws {
        let s = try summary("release-partial.ndjson")
        XCTAssertFalse(s.isFinished)
        XCTAssertEqual(s.repos[0].phase, .building(elapsedMs: 0))
    }

    func testDryRunKeepsPlansAndRefusals() throws {
        let s = try summary("release-dry-run.ndjson")
        XCTAssertTrue(s.dryRun)
        XCTAssertEqual(s.plans.map(\.repo), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(s.plans.map(\.ok), [true, false])
        XCTAssertTrue(s.anyFailed)
        XCTAssertEqual(s.repos.map(\.repo), ["VastPayPwaV2", "VastMenuPwa"])
    }

    func testEndWithoutDoneIsACliFailure() throws {
        let s = try summary("cli-failed.ndjson")
        XCTAssertTrue(s.isFinished)
        XCTAssertTrue(s.cliFailed)
    }

    func testPromotePreviewCarriesThePR() throws {
        let s = try summary("promote-dry-run.ndjson")
        XCTAssertEqual(s.command, "promote")
        XCTAssertEqual(s.prs.first?.version, "2.1.18")
        XCTAssertFalse(s.cliFailed)
    }

    func testRolloutPhaseShowsState() {
        let s = summarize([
            .start(command: "release", args: [], dryRun: false, repos: ["A"]),
            .rollout(repo: "A", state: "OutOfSync/Progressing", reason: nil, elapsedMs: 5000),
        ])
        XCTAssertEqual(s.repos[0].phase, .rollingOut(state: "OutOfSync/Progressing", elapsedMs: 5000))
    }

    func testRunIDsSortByTimeAndRecordsRoundTrip() throws {
        let a = newRunID(now: Date(timeIntervalSince1970: 1_000))
        let b = newRunID(now: Date(timeIntervalSince1970: 2_000))
        XCTAssertLessThan(a, b)
        let r = RunRecord(id: a, pid: 7, args: ["release", "A", "--json"], startedAt: Date(timeIntervalSince1970: 1_000), dismissed: false)
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601
        XCTAssertEqual(try d.decode(RunRecord.self, from: e.encode(r)), r)
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/menubar && swift test --filter 'EventsTests|RunSummaryTests' 2>&1 | tail -5`
Expected: build failure — `cannot find 'NDJSON' in scope`.

- [ ] **Step 4: Implement**

`apps/menubar/Sources/VastBarCore/Events.swift`:

```swift
import Foundation

public struct PlanEvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let ok: Bool
    public let version: String
    public let commits: Int?
    /// "will merge", "merged", "nothing to promote", "no develop" or "not run".
    public let promote: String
    public let notice: String?
    /// Why it was refused (ok false), or a note on a prepared repo.
    public let detail: String?
}

public struct SlackPreview: Decodable, Equatable, Sendable {
    public let text: String
    public let posted: Bool
    public let error: String?
}

public struct PREvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let branch: String
    /// Null on a dry run.
    public let url: String?
    public let version: String
    public let slack: SlackPreview?
}

public struct DoneEvent: Decodable, Equatable, Sendable {
    public let repo: String
    public let version: String
    /// "released", "skipped" or "failed".
    public let status: String
    public let detail: String
}

/// One line of `vast release|promote --json`. Unknown types are kept, not
/// dropped, so a newer CLI never breaks an older app.
public enum VastEvent: Equatable, Sendable {
    case start(command: String, args: [String], dryRun: Bool, repos: [String])
    case plan(PlanEvent)
    case promoted(repo: String, commits: Int)
    case dispatched(repo: String, version: String, runId: Int, runUrl: String)
    case run(repo: String, status: String, conclusion: String?, elapsedMs: Int)
    case rollout(repo: String, state: String, reason: String?, elapsedMs: Int)
    case pr(PREvent)
    case done(DoneEvent)
    case end(exitCode: Int)
    case unknown(type: String)
}

extension VastEvent: Decodable {
    private enum Key: String, CodingKey {
        case type, command, args, dryRun, repos, repo, commits, version, runId, runUrl
        case status, conclusion, elapsedMs, state, reason, exitCode
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "start":
            self = .start(
                command: try c.decode(String.self, forKey: .command),
                args: try c.decode([String].self, forKey: .args),
                dryRun: try c.decode(Bool.self, forKey: .dryRun),
                repos: try c.decode([String].self, forKey: .repos))
        case "plan": self = .plan(try PlanEvent(from: decoder))
        case "promoted":
            self = .promoted(repo: try c.decode(String.self, forKey: .repo), commits: try c.decode(Int.self, forKey: .commits))
        case "dispatched":
            self = .dispatched(
                repo: try c.decode(String.self, forKey: .repo),
                version: try c.decode(String.self, forKey: .version),
                runId: try c.decode(Int.self, forKey: .runId),
                runUrl: try c.decode(String.self, forKey: .runUrl))
        case "run":
            self = .run(
                repo: try c.decode(String.self, forKey: .repo),
                status: try c.decode(String.self, forKey: .status),
                conclusion: try c.decodeIfPresent(String.self, forKey: .conclusion),
                elapsedMs: try c.decode(Int.self, forKey: .elapsedMs))
        case "rollout":
            self = .rollout(
                repo: try c.decode(String.self, forKey: .repo),
                state: try c.decode(String.self, forKey: .state),
                reason: try c.decodeIfPresent(String.self, forKey: .reason),
                elapsedMs: try c.decode(Int.self, forKey: .elapsedMs))
        case "pr": self = .pr(try PREvent(from: decoder))
        case "done": self = .done(try DoneEvent(from: decoder))
        case "end": self = .end(exitCode: try c.decode(Int.self, forKey: .exitCode))
        default: self = .unknown(type: type)
        }
    }
}

public enum NDJSON {
    /// Every complete line that parses. A last line without its newline is
    /// still being written by the CLI and is left for the next read.
    public static func events(from text: String) -> [VastEvent] {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        if !text.hasSuffix("\n"), !lines.isEmpty { lines.removeLast() }
        let decoder = VastJSON.decoder()
        return lines.compactMap { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            return try? decoder.decode(VastEvent.self, from: Data(trimmed.utf8))
        }
    }
}
```

`apps/menubar/Sources/VastBarCore/RunSummary.swift`:

```swift
import Foundation

public enum RepoPhase: Equatable, Sendable {
    case preparing
    case building(elapsedMs: Int)
    case rollingOut(state: String, elapsedMs: Int)
    case finished(status: String)
}

public struct RepoProgress: Equatable, Sendable, Identifiable {
    public let repo: String
    public var phase: RepoPhase = .preparing
    public var version: String?
    public var runUrl: String?
    public var prUrl: String?
    public var detail: String?
    public var id: String { repo }
    public init(repo: String) { self.repo = repo }
}

public struct RunSummary: Equatable, Sendable {
    public var command: String?
    public var dryRun = false
    public var repos: [RepoProgress] = []
    public var plans: [PlanEvent] = []
    public var prs: [PREvent] = []
    public var exitCode: Int?

    public var isFinished: Bool { exitCode != nil }
    public var anyFailed: Bool {
        repos.contains { $0.phase == .finished(status: "failed") }
    }
    private var anyDone: Bool {
        repos.contains { if case .finished = $0.phase { return true } else { return false } }
    }
    /// The CLI itself failed: it ended non-zero without finishing any repo.
    public var cliFailed: Bool { (exitCode ?? 0) != 0 && !anyDone }

    public init() {}
}

/// Folds a run's events into what the card shows. Order of repos: as `start`
/// listed them, then any repo first seen later.
public func summarize(_ events: [VastEvent]) -> RunSummary {
    var s = RunSummary()
    func index(_ repo: String) -> Int {
        if let i = s.repos.firstIndex(where: { $0.repo == repo }) { return i }
        s.repos.append(RepoProgress(repo: repo))
        return s.repos.count - 1
    }
    for event in events {
        switch event {
        case .start(let command, _, let dryRun, let repos):
            s.command = command
            s.dryRun = dryRun
            for r in repos { _ = index(r) }
        case .plan(let p):
            s.plans.append(p)
            let i = index(p.repo)
            s.repos[i].version = p.version
            s.repos[i].detail = p.detail
        case .promoted(let repo, _):
            _ = index(repo)
        case .dispatched(let repo, let version, _, let runUrl):
            let i = index(repo)
            s.repos[i].version = version
            s.repos[i].runUrl = runUrl
            s.repos[i].phase = .building(elapsedMs: 0)
        case .run(let repo, _, _, let elapsedMs):
            let i = index(repo)
            s.repos[i].phase = .building(elapsedMs: elapsedMs)
        case .rollout(let repo, let state, let reason, let elapsedMs):
            let i = index(repo)
            s.repos[i].phase = .rollingOut(state: state, elapsedMs: elapsedMs)
            if let reason { s.repos[i].detail = reason }
        case .pr(let pr):
            s.prs.append(pr)
            let i = index(pr.repo)
            s.repos[i].prUrl = pr.url
            s.repos[i].version = pr.version
        case .done(let d):
            let i = index(d.repo)
            s.repos[i].phase = .finished(status: d.status)
            s.repos[i].detail = d.detail
            s.repos[i].version = d.version
        case .end(let code):
            s.exitCode = code
        case .unknown:
            break
        }
    }
    return s
}
```

`apps/menubar/Sources/VastBarCore/RunRecord.swift`:

```swift
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/menubar && swift test --filter 'EventsTests|RunSummaryTests' 2>&1 | tail -3`
Expected: `Executed 11 tests, with 0 failures`.

- [ ] **Step 6: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): parse the NDJSON event stream into a run summary"
```

---

### Task 3: CLI version check and command building

**Files:**
- Create: `apps/menubar/Sources/VastBarCore/Version.swift`, `apps/menubar/Sources/VastBarCore/Commands.swift`, `apps/menubar/Tests/VastBarCoreTests/VersionTests.swift`, `apps/menubar/Tests/VastBarCoreTests/CommandsTests.swift`

**Interfaces:**
- Produces: `CLIVersion` (`init?(_ text: String)`, `Comparable`, `description`), `CLICompat.minimum`, `CLICompat.Result` (`.ok(CLIVersion)`, `.tooOld(CLIVersion)`, `.missing`), `CLICompat.check(versionOutput: String, exitCode: Int32) -> CLICompat.Result`; `Train` (`.frontend`, `.backend`), `ReleaseTarget` (`.repo(String)`, `.train(Train)`), `VastCommand` (`args: [String]`, `shellLine: String`, `terminalLine: String`), `Commands.version/status/doctor/pending`, `Commands.release(_:dryRun:fixVersion:)`, `Commands.promote(repo:hotfix:slack:dryRun:)`, `shellQuote(_:)`, `appleScriptQuote(_:)`.

- [ ] **Step 1: Write the failing tests**

`apps/menubar/Tests/VastBarCoreTests/VersionTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class VersionTests: XCTestCase {
    func testParsesPlainPrereleaseAndPrefixed() {
        XCTAssertEqual(CLIVersion("2.9.0")?.description, "2.9.0")
        XCTAssertEqual(CLIVersion("v2.10.1")?.description, "2.10.1")
        XCTAssertEqual(CLIVersion("2.9.0-dev\n"), CLIVersion("2.9.0"))
        XCTAssertNil(CLIVersion("zsh: command not found: vast"))
    }

    func testOrdersNumericallyNotLexically() {
        XCTAssertLessThan(CLIVersion("2.9.0")!, CLIVersion("2.10.0")!)
    }

    func testCompat() {
        XCTAssertEqual(CLICompat.check(versionOutput: "2.9.0\n", exitCode: 0), .ok(CLIVersion("2.9.0")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "2.9.0-dev\n", exitCode: 0), .ok(CLIVersion("2.9.0")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "2.8.1\n", exitCode: 0), .tooOld(CLIVersion("2.8.1")!))
        XCTAssertEqual(CLICompat.check(versionOutput: "", exitCode: 127), .missing)
        XCTAssertEqual(CLICompat.check(versionOutput: "garbage", exitCode: 0), .missing)
    }
}
```

`apps/menubar/Tests/VastBarCoreTests/CommandsTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class CommandsTests: XCTestCase {
    func testSnapshots() {
        XCTAssertEqual(Commands.status.args, ["status", "--all", "--json"])
        XCTAssertEqual(Commands.doctor.args, ["doctor", "--json"])
        XCTAssertEqual(Commands.pending.args, ["pending", "--all", "--short", "--json"])
        XCTAssertEqual(Commands.version.args, ["--version"])
    }

    func testReleaseOneRepoAndATrain() {
        XCTAssertEqual(Commands.release(.repo("VastPayPwa"), dryRun: true, fixVersion: false).args,
                       ["release", "VastPayPwa", "--dry-run", "--json"])
        XCTAssertEqual(Commands.release(.train(.frontend), dryRun: false, fixVersion: true).args,
                       ["release", "--frontend", "--fix-version", "--json"])
    }

    func testPromote() {
        XCTAssertEqual(Commands.promote(repo: "VastPayPwa", hotfix: false, slack: false, dryRun: true).args,
                       ["promote", "VastPayPwa", "--to", "production", "--dry-run", "--json"])
        XCTAssertEqual(Commands.promote(repo: "VastPayPwa", hotfix: true, slack: true, dryRun: false).args,
                       ["promote", "VastPayPwa", "--to", "production", "--as", "hotfix", "--slack", "--json"])
    }

    func testShellLineAndTerminalLine() {
        let c = Commands.release(.repo("VastPayPwa"), dryRun: false, fixVersion: false)
        XCTAssertEqual(c.shellLine, "vast release VastPayPwa --json")
        XCTAssertEqual(c.terminalLine, "vast release VastPayPwa")
    }

    func testShellQuoteNeutralisesSpecialCharacters() {
        XCTAssertEqual(shellQuote("VastPay-BackEnd"), "VastPay-BackEnd")
        XCTAssertEqual(shellQuote("a b"), "'a b'")
        XCTAssertEqual(shellQuote("x; rm -rf ~"), "'x; rm -rf ~'")
        XCTAssertEqual(shellQuote("it's"), "'it'\\''s'")
        XCTAssertEqual(shellQuote(""), "''")
        XCTAssertEqual(VastCommand(args: ["status", "$(whoami)"]).shellLine, "vast status '$(whoami)'")
    }

    func testAppleScriptQuote() {
        XCTAssertEqual(appleScriptQuote(#"vast release "x" \ y"#), #""vast release \"x\" \\ y""#)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/menubar && swift test --filter 'VersionTests|CommandsTests' 2>&1 | tail -5`
Expected: build failure — `cannot find 'CLIVersion' in scope`.

- [ ] **Step 3: Implement**

`apps/menubar/Sources/VastBarCore/Version.swift`:

```swift
import Foundation

/// major.minor.patch; a prerelease suffix is ignored, so a local `2.9.0-dev`
/// build satisfies a 2.9.0 minimum.
public struct CLIVersion: Comparable, Equatable, Sendable, CustomStringConvertible {
    public let major: Int, minor: Int, patch: Int

    public init(_ major: Int, _ minor: Int, _ patch: Int) {
        self.major = major; self.minor = minor; self.patch = patch
    }

    public init?(_ text: String) {
        let first = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        var core = first.trimmingCharacters(in: .whitespaces)
        if core.hasPrefix("v") { core.removeFirst() }
        core = String(core.prefix { $0 != "-" && $0 != "+" })
        let parts = core.split(separator: ".").map { Int($0) }
        guard parts.count == 3, let a = parts[0], let b = parts[1], let c = parts[2] else { return nil }
        self.init(a, b, c)
    }

    public var description: String { "\(major).\(minor).\(patch)" }

    public static func < (l: CLIVersion, r: CLIVersion) -> Bool {
        (l.major, l.minor, l.patch) < (r.major, r.minor, r.patch)
    }
}

public enum CLICompat {
    /// The first CLI with `--json` (spec: Phase 1 ships as this minor).
    public static let minimum = CLIVersion(2, 9, 0)

    public enum Result: Equatable, Sendable {
        case ok(CLIVersion)
        case tooOld(CLIVersion)
        case missing
    }

    public static func check(versionOutput: String, exitCode: Int32) -> Result {
        guard exitCode == 0, let v = CLIVersion(versionOutput) else { return .missing }
        return v < minimum ? .tooOld(v) : .ok(v)
    }
}
```

`apps/menubar/Sources/VastBarCore/Commands.swift`:

```swift
import Foundation

public enum Train: String, Sendable, CaseIterable { case frontend, backend }

public enum ReleaseTarget: Equatable, Sendable, Hashable {
    case repo(String)
    case train(Train)
}

/// A `vast` invocation as a fixed argument list. The only way the app builds
/// a command line, so nothing typed by a person ever reaches the shell unquoted.
public struct VastCommand: Equatable, Sendable {
    public let args: [String]
    public init(args: [String]) { self.args = args }

    /// What `/bin/zsh -lc` runs.
    public var shellLine: String { (["vast"] + args.map(shellQuote)).joined(separator: " ") }

    /// The same command for a person to run in Terminal: human output, no --json.
    public var terminalLine: String {
        (["vast"] + args.filter { $0 != "--json" }.map(shellQuote)).joined(separator: " ")
    }
}

public enum Commands {
    public static let version = VastCommand(args: ["--version"])
    public static let status = VastCommand(args: ["status", "--all", "--json"])
    public static let doctor = VastCommand(args: ["doctor", "--json"])
    public static let pending = VastCommand(args: ["pending", "--all", "--short", "--json"])

    public static func release(_ target: ReleaseTarget, dryRun: Bool, fixVersion: Bool) -> VastCommand {
        var args = ["release"]
        switch target {
        case .repo(let name): args.append(name)
        case .train(let train): args.append("--\(train.rawValue)")
        }
        if fixVersion { args.append("--fix-version") }
        if dryRun { args.append("--dry-run") }
        args.append("--json")
        return VastCommand(args: args)
    }

    public static func promote(repo: String, hotfix: Bool, slack: Bool, dryRun: Bool) -> VastCommand {
        var args = ["promote", repo, "--to", "production"]
        if hotfix { args += ["--as", "hotfix"] }
        if slack { args.append("--slack") }
        if dryRun { args.append("--dry-run") }
        args.append("--json")
        return VastCommand(args: args)
    }
}

/// POSIX single-quote unless the word is plainly safe.
public func shellQuote(_ word: String) -> String {
    let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/=-")
    if !word.isEmpty, word.unicodeScalars.allSatisfy({ safe.contains($0) }) { return word }
    return "'" + word.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// An AppleScript string literal.
public func appleScriptQuote(_ text: String) -> String {
    "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/menubar && swift test --filter 'VersionTests|CommandsTests' 2>&1 | tail -3`
Expected: `Executed 9 tests, with 0 failures`.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): CLI version check and quoted command building"
```

---

### Task 4: Shell runner and run store

**Files:**
- Create: `apps/menubar/Sources/VastBarCore/Shell.swift`, `apps/menubar/Sources/VastBarCore/RunStore.swift`, `apps/menubar/Tests/VastBarCoreTests/ShellTests.swift`, `apps/menubar/Tests/VastBarCoreTests/RunStoreTests.swift`

**Interfaces:**
- Consumes: `VastCommand.shellLine` and `shellQuote` (Task 3); `NDJSON.events(from:)`, `RunRecord` (Task 2).
- Produces: `ShellResult` (`stdout`, `stderr`, `exitCode: Int32`), `Shell.runLine(_ line: String, timeout: TimeInterval) async -> ShellResult`, `Shell.run(_ command: VastCommand, timeout: TimeInterval = 180) async -> ShellResult`, `Shell.startDetachedLine(_ line: String, stdout: URL, stderr: URL) async throws -> Int32`, `Shell.startDetached(_ command: VastCommand, stdout: URL, stderr: URL) async throws -> Int32`, `Shell.isAlive(_ pid: Int32) -> Bool`; `RunStore` (`init(dir:)`, `static func defaultDir() -> URL`, `ensureDir()`, `recordURL(_:)`, `ndjsonURL(_:)`, `logURL(_:)`, `save(_:)`, `records() -> [RunRecord]`, `events(id:) -> [VastEvent]`, `stderrTail(id:lines:) -> [String]`, `prune(now:isFinished:)`).

- [ ] **Step 1: Write the failing tests**

`apps/menubar/Tests/VastBarCoreTests/ShellTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class ShellTests: XCTestCase {
    func testRunCapturesBothStreamsAndExitCode() async {
        let r = await Shell.runLine("printf 'out\\n'; printf 'err\\n' >&2; exit 3", timeout: 30)
        XCTAssertEqual(r.stdout, "out\n")
        XCTAssertEqual(r.stderr, "err\n")
        XCTAssertEqual(r.exitCode, 3)
    }

    func testLargeOutputDoesNotDeadlock() async {
        let r = await Shell.runLine("head -c 300000 /dev/zero | tr '\\0' a", timeout: 30)
        XCTAssertEqual(r.stdout.count, 300_000)
    }

    func testTimeoutKillsAndReportsFailure() async {
        let started = Date()
        let r = await Shell.runLine("sleep 20", timeout: 1)
        XCTAssertNotEqual(r.exitCode, 0)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testDetachedRunOutlivesTheCallAndWritesItsFiles() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("r.ndjson"), err = dir.appendingPathComponent("r.log")
        let pid = try await Shell.startDetachedLine(
            "sleep 1; echo '{\"type\":\"end\",\"exitCode\":0}'; echo bye >&2", stdout: out, stderr: err)
        XCTAssertGreaterThan(pid, 0)
        XCTAssertTrue(Shell.isAlive(pid))
        try await Task.sleep(nanoseconds: 2_500_000_000)
        XCTAssertFalse(Shell.isAlive(pid))
        XCTAssertEqual(try String(contentsOf: out, encoding: .utf8), "{\"type\":\"end\",\"exitCode\":0}\n")
        XCTAssertEqual(try String(contentsOf: err, encoding: .utf8), "bye\n")
    }

    func testPathsWithSpacesAndQuotes() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Vast Bar 'q' \(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("a b.ndjson"), err = dir.appendingPathComponent("a b.log")
        _ = try await Shell.startDetachedLine("echo hi", stdout: out, stderr: err)
        try await Task.sleep(nanoseconds: 1_000_000_000)
        XCTAssertEqual(try String(contentsOf: out, encoding: .utf8), "hi\n")
    }
}
```

`apps/menubar/Tests/VastBarCoreTests/RunStoreTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class RunStoreTests: XCTestCase {
    private var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testSaveAndListNewestLast() throws {
        let store = RunStore(dir: dir)
        let a = RunRecord(id: "a", pid: 1, args: ["release", "A", "--json"], startedAt: Date(timeIntervalSince1970: 100), dismissed: false)
        let b = RunRecord(id: "b", pid: 2, args: ["release", "B", "--json"], startedAt: Date(timeIntervalSince1970: 200), dismissed: false)
        try store.save(b); try store.save(a)
        XCTAssertEqual(store.records().map(\.id), ["a", "b"])
    }

    func testEventsAndStderrTail() throws {
        let store = RunStore(dir: dir)
        try store.save(RunRecord(id: "x", pid: 1, args: [], startedAt: Date(), dismissed: false))
        try "{\"type\":\"end\",\"exitCode\":1}\n".write(to: store.ndjsonURL("x"), atomically: true, encoding: .utf8)
        try (1...30).map { "line \($0)" }.joined(separator: "\n").appending("\n")
            .write(to: store.logURL("x"), atomically: true, encoding: .utf8)
        XCTAssertEqual(store.events(id: "x"), [.end(exitCode: 1)])
        XCTAssertEqual(store.stderrTail(id: "x", lines: 3), ["line 28", "line 29", "line 30"])
    }

    func testMissingFilesReadAsEmpty() throws {
        let store = RunStore(dir: dir)
        XCTAssertEqual(store.events(id: "nope"), [])
        XCTAssertEqual(store.stderrTail(id: "nope", lines: 5), [])
    }

    func testPruneDeletesOnlyFinishedRunsOlderThanSevenDays() throws {
        let store = RunStore(dir: dir)
        let now = Date(timeIntervalSince1970: 10_000_000)
        let old = now.addingTimeInterval(-8 * 86_400), recent = now.addingTimeInterval(-86_400)
        for (id, at) in [("oldDone", old), ("oldRunning", old), ("recentDone", recent)] {
            try store.save(RunRecord(id: id, pid: 1, args: [], startedAt: at, dismissed: false))
            try "".write(to: store.ndjsonURL(id), atomically: true, encoding: .utf8)
        }
        store.prune(now: now, isFinished: { $0.id != "oldRunning" })
        XCTAssertEqual(store.records().map(\.id).sorted(), ["oldRunning", "recentDone"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.ndjsonURL("oldDone").path))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/menubar && swift test --filter 'ShellTests|RunStoreTests' 2>&1 | tail -5`
Expected: build failure — `cannot find 'Shell' in scope`.

- [ ] **Step 3: Implement**

`apps/menubar/Sources/VastBarCore/Shell.swift`:

```swift
import Foundation

public struct ShellResult: Equatable, Sendable {
    public let stdout: String
    public let stderr: String
    public let exitCode: Int32
}

/// Every command runs through the user's login shell: a GUI app does not
/// inherit the terminal's PATH, and `vast`, `node` and `gh` live on it.
public enum Shell {
    public static let shell = "/bin/zsh"

    public static func run(_ command: VastCommand, timeout: TimeInterval = 180) async -> ShellResult {
        await runLine(command.shellLine, timeout: timeout)
    }

    public static func runLine(_ line: String, timeout: TimeInterval) async -> ShellResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: runBlocking(line, timeout: timeout))
            }
        }
    }

    private static func runBlocking(_ line: String, timeout: TimeInterval) -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = ["-lc", line]
        process.standardInput = FileHandle.nullDevice
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        do { try process.run() } catch {
            return ShellResult(stdout: "", stderr: "\(error)", exitCode: 127)
        }
        // Drain both pipes concurrently, or a chatty child fills one and blocks forever.
        var outData = Data(), errData = Data()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async { outData = out.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        group.enter()
        DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        let timer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
        process.waitUntilExit()
        timer.cancel()
        group.wait()
        let timedOut = process.terminationReason == .uncaughtSignal
        return ShellResult(
            stdout: String(decoding: outData, as: UTF8.self),
            stderr: String(decoding: errData, as: UTF8.self) + (timedOut ? "\n(timed out after \(Int(timeout))s)" : ""),
            exitCode: timedOut ? 124 : process.terminationStatus)
    }

    public static func startDetached(_ command: VastCommand, stdout: URL, stderr: URL) async throws -> Int32 {
        try await startDetachedLine(command.shellLine, stdout: stdout, stderr: stderr)
    }

    /// Starts `line` in the background with `nohup`, its output going to files,
    /// and returns its pid. It is not this app's child once the shell exits, so
    /// quitting the app never stops a release.
    public static func startDetachedLine(_ line: String, stdout: URL, stderr: URL) async throws -> Int32 {
        let wrapped = "nohup /bin/zsh -lc \(shellQuote(line)) > \(shellQuote(stdout.path)) 2> \(shellQuote(stderr.path)) < /dev/null & echo $!"
        let result = await runLine(wrapped, timeout: 30)
        guard result.exitCode == 0, let pid = Int32(result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw ShellError.couldNotStart(result.stderr)
        }
        return pid
    }

    public static func isAlive(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0 || errno == EPERM
    }
}

public enum ShellError: Error, Equatable { case couldNotStart(String) }
```

`apps/menubar/Sources/VastBarCore/RunStore.swift`:

```swift
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/menubar && swift test --filter 'ShellTests|RunStoreTests' 2>&1 | tail -3`
Expected: `Executed 9 tests, with 0 failures`.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): login-shell runner, detached runs and the run store"
```

---

### Task 5: App state rules

**Files:**
- Create: `apps/menubar/Sources/VastBarCore/AppState.swift`, `apps/menubar/Tests/VastBarCoreTests/AppStateTests.swift`

**Interfaces:**
- Consumes: Task 1 models; Task 2 `RunSummary`, `RepoProgress`, `RunRecord`, `summarize`, `NDJSON`; Task 3 `Train`.
- Produces: `IconState` (`.ok, .attention, .running, .failed`), `TrackedRun` (`record: RunRecord`, `summary: RunSummary`, `state: RunState`), `RunState` (`.running, .finished, .died`), `runState(summary:alive:) -> RunState`, `iconState(doctor:status:runs:) -> IconState`, `RepoCard`, `repoCards(status:doctor:pending:runs:) -> [RepoCard]`, `isStale(lastSuccess:now:) -> Bool`, `attentionLines(doctor:) -> [DoctorCheck]`, `trainRepos(_ train: Train, status: StatusSnapshot?) -> [String]`.

- [ ] **Step 1: Write the failing tests** — `apps/menubar/Tests/VastBarCoreTests/AppStateTests.swift`:

```swift
import XCTest
@testable import VastBarCore

final class AppStateTests: XCTestCase {
    private func status() throws -> StatusSnapshot { try VastJSON.decoder().decode(StatusSnapshot.self, from: fixture("status.json")) }
    private func doctor() throws -> DoctorSnapshot { try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json")) }
    private func pending() throws -> PendingSnapshot { try VastJSON.decoder().decode(PendingSnapshot.self, from: fixture("pending.json")) }
    private func tracked(_ fixtureName: String, state: RunState, dismissed: Bool = false) throws -> TrackedRun {
        TrackedRun(
            record: RunRecord(id: fixtureName, pid: 1, args: [], startedAt: Date(), dismissed: dismissed),
            summary: summarize(NDJSON.events(from: try fixtureText(fixtureName))),
            state: state)
    }
    private let allOk = DoctorSnapshot(generatedAt: Date(), checks: [])

    func testRunState() throws {
        let partial = summarize(NDJSON.events(from: try fixtureText("release-partial.ndjson")))
        XCTAssertEqual(runState(summary: partial, alive: true), .running)
        XCTAssertEqual(runState(summary: partial, alive: false), .died)
        let done = summarize(NDJSON.events(from: try fixtureText("release-real.ndjson")))
        XCTAssertEqual(runState(summary: done, alive: false), .finished)
    }

    func testIconPrecedenceFailedRunningAttentionOk() throws {
        // doctor fixture has a fail → failed wins over everything
        XCTAssertEqual(iconState(doctor: try doctor(), status: try status(), runs: []), .failed)
        // a running run beats attention
        let running = try tracked("release-partial.ndjson", state: .running)
        XCTAssertEqual(iconState(doctor: allOk, status: try status(), runs: [running]), .running)
        // status has a "?" cell → attention
        XCTAssertEqual(iconState(doctor: allOk, status: try status(), runs: []), .attention)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: []), .ok)
    }

    func testAFailedOrDeadRunIsRedUntilDismissed() throws {
        let failed = try tracked("cli-failed.ndjson", state: .finished)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [failed]), .failed)
        let died = try tracked("release-partial.ndjson", state: .died)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [died]), .failed)
        let dismissed = try tracked("cli-failed.ndjson", state: .finished, dismissed: true)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [dismissed]), .ok)
        // a dry run that refused a repo is a preview, not a failure
        let preview = try tracked("release-dry-run.ndjson", state: .finished)
        XCTAssertEqual(iconState(doctor: allOk, status: nil, runs: [preview]), .ok)
    }

    func testCardsJoinStatusDoctorPendingAndRuns() throws {
        let running = try tracked("release-partial.ndjson", state: .running)
        let cards = repoCards(status: try status(), doctor: try doctor(), pending: try pending(), runs: [running])
        XCTAssertEqual(cards.map(\.id), ["VastPayPwaV2", "VastMenuPwa", "VastPay-BackEnd"])
        XCTAssertEqual(cards[0].staging, "2.1.18-rc5")
        XCTAssertEqual(cards[0].production, "2.1.17")
        XCTAssertEqual(cards[0].drift, "develop +5")
        XCTAssertEqual(cards[0].waitingPRs, 2)
        XCTAssertTrue(cards[0].isRunning)
        XCTAssertEqual(cards[0].progress?.phase, .building(elapsedMs: 0))
        XCTAssertEqual(cards[1].staging, "?")
        XCTAssertEqual(cards[1].problems, [
            "staging tag could not be read",
            "next 1.6.12-rc1 is not above production 1.6.12 — release it with --fix-version (→ 1.6.13-rc1)",
        ])
        XCTAssertFalse(cards[1].isRunning)
        XCTAssertNil(cards[1].waitingPRs)
        XCTAssertEqual(cards[2].production, "not migrated")
        XCTAssertEqual(cards[2].problems, [])
    }

    func testFinishedRunStillShowsItsProgressAndPRLink() throws {
        let finished = try tracked("promote-dry-run.ndjson", state: .finished)
        let cards = repoCards(status: try status(), doctor: nil, pending: nil, runs: [finished])
        XCTAssertFalse(cards[0].isRunning)
        XCTAssertNil(cards[0].progress, "a dry run is a preview, not a card's progress")
        let real = try tracked("release-real.ndjson", state: .finished)
        let cards2 = repoCards(status: try status(), doctor: nil, pending: nil, runs: [real])
        XCTAssertEqual(cards2[0].progress?.phase, .finished(status: "released"))
    }

    func testStaleAfterTwoMissedRefreshes() {
        let now = Date()
        XCTAssertFalse(isStale(lastSuccess: now.addingTimeInterval(-60), now: now))
        XCTAssertTrue(isStale(lastSuccess: now.addingTimeInterval(-11 * 60), now: now))
        XCTAssertTrue(isStale(lastSuccess: nil, now: now))
    }

    func testAttentionLinesAreWarnsAndFails() throws {
        XCTAssertEqual(attentionLines(doctor: try doctor()).map(\.label), ["ArgoCD staging", "VastMenuPwa"])
    }

    func testTrainRepos() throws {
        XCTAssertEqual(trainRepos(.frontend, status: try status()), ["VastPayPwaV2", "VastMenuPwa"])
        XCTAssertEqual(trainRepos(.backend, status: try status()), ["VastPay-BackEnd"])
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/menubar && swift test --filter AppStateTests 2>&1 | tail -5`
Expected: build failure — `cannot find 'TrackedRun' in scope`.

- [ ] **Step 3: Implement** — `apps/menubar/Sources/VastBarCore/AppState.swift`:

```swift
import Foundation

public enum IconState: Int, Comparable, Sendable {
    case ok, attention, running, failed
    public static func < (l: IconState, r: IconState) -> Bool { l.rawValue < r.rawValue }
}

public enum RunState: Equatable, Sendable { case running, finished, died }

public struct TrackedRun: Equatable, Sendable, Identifiable {
    public var record: RunRecord
    public var summary: RunSummary
    public var state: RunState
    public var id: String { record.id }
    public init(record: RunRecord, summary: RunSummary, state: RunState) {
        self.record = record; self.summary = summary; self.state = state
    }
    /// A finished real run with a failed repo, a CLI that failed, or a process that died.
    public var failed: Bool {
        switch state {
        case .died: return true
        case .running: return false
        case .finished: return summary.cliFailed || (!summary.dryRun && summary.anyFailed)
        }
    }
}

/// No `end` and the process is gone: it was killed, crashed, or the machine
/// restarted. It must never read as running forever.
public func runState(summary: RunSummary, alive: Bool) -> RunState {
    if summary.isFinished { return .finished }
    return alive ? .running : .died
}

/// Red beats blue beats amber beats green.
public func iconState(doctor: DoctorSnapshot?, status: StatusSnapshot?, runs: [TrackedRun]) -> IconState {
    let visible = runs.filter { !$0.record.dismissed }
    if doctor?.checks.contains(where: { $0.status == .fail }) == true || visible.contains(where: \.failed) {
        return .failed
    }
    if visible.contains(where: { $0.state == .running }) { return .running }
    let unreadable = status?.repos.contains { $0.staging.problem == "?" || $0.production.problem == "?" || $0.drift.problem == "?" } ?? false
    if doctor?.checks.contains(where: { $0.status == .warn }) == true || unreadable { return .attention }
    return .ok
}

public struct RepoCard: Equatable, Sendable, Identifiable {
    public let id: String
    public let displayName: String
    public let releaseTeam: String?
    public let staging: String
    public let production: String
    public let drift: String
    public let waitingPRs: Int?
    /// Plain-words problems: unreadable cells and doctor's warn/fail for this repo.
    public let problems: [String]
    public let isRunning: Bool
    /// The latest real (not dry-run) run's progress for this repo.
    public let progress: RepoProgress?
}

public func repoCards(status: StatusSnapshot?, doctor: DoctorSnapshot?, pending: PendingSnapshot?, runs: [TrackedRun]) -> [RepoCard] {
    guard let status else { return [] }
    return status.repos.map { r in
        var problems: [String] = []
        if r.staging.problem == "?" { problems.append("staging tag could not be read") }
        if r.production.problem == "?" { problems.append("production tag could not be read") }
        if r.drift.problem == "?" { problems.append("drift could not be computed") }
        problems += (doctor?.checks ?? [])
            .filter { $0.group == "Repos" && $0.label == r.repo && $0.status != .ok }
            .map(\.detail)
        let mine = runs.filter { run in run.summary.repos.contains { $0.repo == r.repo } }
        let latestReal = mine.last { !$0.summary.dryRun && !$0.record.dismissed }
        return RepoCard(
            id: r.repo,
            displayName: r.displayName,
            releaseTeam: r.releaseTeam,
            staging: r.staging.tag ?? r.staging.problem ?? "—",
            production: r.production.tag ?? r.production.problem ?? "—",
            drift: r.drift.text,
            waitingPRs: pending?.repos.first { $0.repo == r.repo }?.waitingCount,
            problems: problems,
            isRunning: mine.contains { $0.state == .running },
            progress: latestReal?.summary.repos.first { $0.repo == r.repo })
    }
}

/// The app refreshes every 5 minutes; two missed refreshes make the data stale.
public func isStale(lastSuccess: Date?, now: Date = Date()) -> Bool {
    guard let lastSuccess else { return true }
    return now.timeIntervalSince(lastSuccess) > 10 * 60
}

/// Doctor's warnings and failures, for the footer.
public func attentionLines(doctor: DoctorSnapshot?) -> [DoctorCheck] {
    (doctor?.checks ?? []).filter { $0.status != .ok }
}

public func trainRepos(_ train: Train, status: StatusSnapshot?) -> [String] {
    (status?.repos ?? []).filter { $0.releaseTeam == train.rawValue }.map(\.repo)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/menubar && swift test 2>&1 | tail -3`
Expected: every suite passes (`Executed 41 tests, with 0 failures` — the count may differ by a test or two; zero failures is the requirement).

- [ ] **Step 5: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): icon, card and run state rules"
```

---

### Task 6: The app — read-only popover, icon, build script

**Files:**
- Replace: `apps/menubar/Sources/VastBar/VastBarApp.swift`
- Create: `apps/menubar/Sources/VastBar/Store.swift`, `MenuBarIcon.swift`, `PopoverView.swift`, `RepoCardView.swift`, `Terminal.swift`, `apps/menubar/build.sh`

**Interfaces:**
- Consumes: all of `VastBarCore`.
- Produces (Task 7 relies on these exact names): `Store` (`@MainActor final class Store: ObservableObject`) with `@Published var compat: CLICompat.Result?`, `status`, `doctor`, `pending`, `lastSuccess: Date?`, `refreshing: Bool`, `refreshError: String?`, `runs: [TrackedRun]`, `panel: Panel?`; `enum Panel: Equatable { case release(ReleaseTarget), promote(String) }`; methods `refresh() async`, `checkCLI() async`, `cards: [RepoCard]`, `icon: IconState`, `runStore: RunStore`. `RepoCardView(card:)` shows a Release and a Promote… button that set `store.panel`. `Terminal.open(_ line: String)`, `Terminal.copy(_ text: String)`.

No unit tests here (views are thin, state rules are tested in Core). Verification is build + launch + screenshot (Task 8).

- [ ] **Step 1: App entry and icon**

`apps/menubar/Sources/VastBar/VastBarApp.swift`:

```swift
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
        } label: {
            MenuBarIcon(state: store.icon)
        }
        .menuBarExtraStyle(.window)
    }
}
```

`apps/menubar/Sources/VastBar/MenuBarIcon.swift`:

```swift
import AppKit
import SwiftUI
import VastBarCore

/// The mark with a state dot. The menu bar only shows colour from a
/// non-template image, so the whole thing is drawn into one NSImage.
struct MenuBarIcon: View {
    let state: IconState
    @State private var dim = false
    private let pulse = Timer.publish(every: 0.7, on: .main, in: .common).autoconnect()

    var body: some View {
        Image(nsImage: Self.image(state: state, dim: state == .running && dim))
            .onReceive(pulse) { _ in if state == .running { dim.toggle() } else { dim = false } }
    }

    static func color(_ state: IconState) -> NSColor {
        switch state {
        case .ok: return .systemGreen
        case .running: return .systemBlue
        case .attention: return .systemOrange
        case .failed: return .systemRed
        }
    }

    static func image(state: IconState, dim: Bool) -> NSImage {
        let size = NSSize(width: 22, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            if let mark = NSImage(systemSymbolName: "shippingbox.fill", accessibilityDescription: "Vast Bar")?
                .withSymbolConfiguration(config) {
                let tinted = mark.copy() as! NSImage
                tinted.lockFocus()
                NSColor.labelColor.set()
                NSRect(origin: .zero, size: tinted.size).fill(using: .sourceAtop)
                tinted.unlockFocus()
                tinted.draw(in: NSRect(x: 0, y: 2, width: 16, height: 14))
            }
            let dot = NSBezierPath(ovalIn: NSRect(x: 13, y: 1, width: 8, height: 8))
            color(state).withAlphaComponent(dim ? 0.35 : 1).setFill()
            dot.fill()
            NSColor.windowBackgroundColor.setStroke()
            dot.lineWidth = 1.5
            dot.stroke()
            return true
        }
        image.isTemplate = false
        return image
    }
}
```

- [ ] **Step 2: Store (read-only half; Task 7 adds runs)**

`apps/menubar/Sources/VastBar/Store.swift`:

```swift
import Foundation
import SwiftUI
import VastBarCore

enum Panel: Equatable {
    case release(ReleaseTarget)
    case promote(String)
}

@MainActor
final class Store: ObservableObject {
    @Published var compat: CLICompat.Result?
    @Published var status: StatusSnapshot?
    @Published var doctor: DoctorSnapshot?
    @Published var pending: PendingSnapshot?
    @Published var lastSuccess: Date?
    @Published var refreshing = false
    @Published var refreshError: String?
    @Published var runs: [TrackedRun] = []
    @Published var panel: Panel?

    let runStore = RunStore(dir: RunStore.defaultDir())
    private var refreshTimer: Timer?

    init() {
        Task { await start() }
    }

    var icon: IconState { iconState(doctor: doctor, status: status, runs: runs) }
    var cards: [RepoCard] { repoCards(status: status, doctor: doctor, pending: pending, runs: runs) }
    var stale: Bool { isStale(lastSuccess: lastSuccess) }

    func start() async {
        await checkCLI()
        loadRuns()
        await refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    func checkCLI() async {
        let r = await Shell.run(Commands.version, timeout: 30)
        compat = CLICompat.check(versionOutput: r.stdout, exitCode: r.exitCode)
    }

    /// status, doctor and pending at once. A failed read keeps the last good
    /// data; the header says it is stale.
    func refresh() async {
        guard !refreshing else { return }
        if case .ok = compat {} else { await checkCLI() }
        guard case .ok = compat else { return }
        refreshing = true
        defer { refreshing = false }
        async let s = Shell.run(Commands.status, timeout: 120)
        async let d = Shell.run(Commands.doctor, timeout: 120)
        async let p = Shell.run(Commands.pending, timeout: 180)
        let (sr, dr, pr) = await (s, d, p)
        let decoder = VastJSON.decoder()
        var errors: [String] = []
        var statusRead = false
        if let v = try? decoder.decode(StatusSnapshot.self, from: Data(sr.stdout.utf8)) { status = v; statusRead = true }
        else { errors.append("status: \(Self.lastLine(sr.stderr))") }
        // doctor exits 1 when a check fails; its JSON is still the answer.
        if let v = try? decoder.decode(DoctorSnapshot.self, from: Data(dr.stdout.utf8)) { doctor = v }
        else { errors.append("doctor: \(Self.lastLine(dr.stderr))") }
        if let v = try? decoder.decode(PendingSnapshot.self, from: Data(pr.stdout.utf8)) { pending = v }
        else { errors.append("pending: \(Self.lastLine(pr.stderr))") }
        // The cards are status; doctor and pending only decorate them.
        if statusRead { lastSuccess = Date() }
        refreshError = errors.isEmpty ? nil : errors.joined(separator: "\n")
    }

    /// Task 7 replaces this with the run-tracking version.
    func loadRuns() {}

    static func lastLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).last.map(String.init) ?? "no output"
    }
}
```

- [ ] **Step 3: Terminal helper**

`apps/menubar/Sources/VastBar/Terminal.swift`:

```swift
import AppKit
import VastBarCore

enum Terminal {
    /// Opens Terminal and types `line` into a new window. `line` is always a
    /// `VastCommand.terminalLine`, never free text.
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
```

- [ ] **Step 4: Views**

`apps/menubar/Sources/VastBar/PopoverView.swift`:

```swift
import SwiftUI
import VastBarCore

struct PopoverView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .task { await store.refresh() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle().fill(Color(nsColor: MenuBarIcon.color(store.icon))).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 1) {
                Text("Vast Bar").font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(store.stale ? .orange : .secondary)
            }
            Spacer()
            if store.refreshing { ProgressView().controlSize(.small) }
            Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless)
                .disabled(store.refreshing)
                .help("Refresh")
        }
        .padding(12)
    }

    private var subtitle: String {
        guard let last = store.lastSuccess else { return store.refreshing ? "Loading…" : "No data yet" }
        let rel = RelativeDateTimeFormatter().localizedString(for: last, relativeTo: Date())
        return store.stale ? "Stale — last good refresh \(rel)" : "Updated \(rel)"
    }

    @ViewBuilder private var content: some View {
        switch store.compat {
        case .missing?:
            CompatCard(title: "vast not found", message: "Vast Bar runs the vast CLI through your login shell and could not find it.", command: "curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh | sh")
        case .tooOld(let v)?:
            CompatCard(title: "vast \(v) is too old", message: "Vast Bar needs vast \(CLICompat.minimum) or newer.", command: "vast upgrade")
        default:
            if let panel = store.panel {
                PanelHost(panel: panel)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        if let error = store.refreshError {
                            Text(error).font(.caption).foregroundStyle(.orange)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(store.cards) { RepoCardView(card: $0) }
                        trains
                        DoctorFooter(lines: attentionLines(doctor: store.doctor))
                    }
                    .padding(12)
                }
                .frame(maxHeight: 560)
            }
        }
    }

    private var trains: some View {
        HStack {
            ForEach(Train.allCases, id: \.self) { train in
                Button("Release \(train.rawValue)") { store.panel = .release(.train(train)) }
                    .disabled(trainRepos(train, status: store.status).isEmpty
                              || store.cards.contains { $0.isRunning && $0.releaseTeam == train.rawValue })
            }
            Spacer()
        }
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Quit") { NSApplication.shared.terminate(nil) }.buttonStyle(.borderless)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

struct CompatCard: View {
    let title: String, message: String, command: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary)
            HStack {
                Text(command).font(.system(.caption, design: .monospaced)).lineLimit(2).textSelection(.enabled)
                Spacer()
                Button("Copy") { Terminal.copy(command) }
            }
        }
        .padding(12)
    }
}

struct DoctorFooter: View {
    let lines: [DoctorCheck]
    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Doctor").font(.caption).foregroundStyle(.secondary)
                ForEach(Array(lines.enumerated()), id: \.offset) { _, check in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: check.status == .fail ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(check.status == .fail ? .red : .orange)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(check.label).font(.caption.bold())
                            Text(check.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.5)))
        }
    }
}

/// Task 7 fills this in with the release and promote panels.
struct PanelHost: View {
    @EnvironmentObject var store: Store
    let panel: Panel
    var body: some View {
        VStack { Button("Back") { store.panel = nil } }.padding(12)
    }
}
```

Before trusting the install command in the "vast not found" card, check the real one in the repo's README (`## Install`) and use exactly that line.

`apps/menubar/Sources/VastBar/RepoCardView.swift`:

```swift
import SwiftUI
import VastBarCore

struct RepoCardView: View {
    @EnvironmentObject var store: Store
    let card: RepoCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.displayName).font(.system(.body, weight: .semibold))
                Spacer()
                if let n = card.waitingPRs, n > 0 {
                    Text("\(n) waiting").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(.blue.opacity(0.15)))
                        .help("PRs on staging that production does not have yet")
                }
            }
            HStack(spacing: 6) {
                Text(card.staging).font(.system(.caption, design: .monospaced))
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.tertiary)
                Text(card.production).font(.system(.caption, design: .monospaced))
                Spacer()
                Text(card.drift).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(card.problems, id: \.self) { p in
                Label(p, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            RunProgressSlot(card: card)
            HStack {
                Button("Release") { store.panel = .release(.repo(card.id)) }
                Button("Promote…") { store.panel = .promote(card.id) }
                Spacer()
            }
            .controlSize(.small)
            .disabled(card.isRunning)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(.background.secondary))
    }
}

/// Task 7 replaces this with the live progress row.
struct RunProgressSlot: View {
    let card: RepoCard
    var body: some View { EmptyView() }
}
```

- [ ] **Step 5: Build script** — `apps/menubar/build.sh` (`chmod +x`):

```bash
#!/bin/bash
# Builds Vast Bar.app (ad-hoc signed, no Dock icon) and installs it in /Applications.
#   ./build.sh            build and install
#   ./build.sh --no-install
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release --product VastBar
BIN="$(swift build -c release --show-bin-path)/VastBar"

APP="build/Vast Bar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/VastBar"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>VastBar</string>
  <key>CFBundleIdentifier</key><string>com.vastgroup.vastbar</string>
  <key>CFBundleName</key><string>Vast Bar</string>
  <key>CFBundleDisplayName</key><string>Vast Bar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Vast Bar opens Terminal to run a vast command you asked for.</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "built $APP"

if [ "${1:-}" != "--no-install" ]; then
  osascript -e 'quit app "Vast Bar"' 2>/dev/null || true
  rm -rf "/Applications/Vast Bar.app"
  cp -R "$APP" /Applications/
  echo "installed /Applications/Vast Bar.app"
fi
```

- [ ] **Step 6: Verify it builds**

Run: `cd apps/menubar && swift build 2>&1 | tail -3 && swift test 2>&1 | tail -2 && ./build.sh --no-install`
Expected: build succeeds with no errors; tests pass; `built build/Vast Bar.app`. Fix any compiler error at its source (SwiftUI API availability on macOS 13 included — e.g. replace `.background.secondary` with `Color(nsColor: .controlBackgroundColor)` if it does not compile).

- [ ] **Step 7: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): menu bar app — icon, repo cards, doctor footer, build script"
```

---

### Task 7: Actions — release and promote with preview, live runs

**Files:**
- Modify: `apps/menubar/Sources/VastBar/Store.swift` (replace `loadRuns`, add run tracking and actions), `apps/menubar/Sources/VastBar/PopoverView.swift` (replace `PanelHost`), `apps/menubar/Sources/VastBar/RepoCardView.swift` (replace `RunProgressSlot`)
- Create: `apps/menubar/Sources/VastBar/ReleasePanel.swift`, `PromotePanel.swift`, `RunRowView.swift`

**Interfaces:**
- Consumes: Task 6 `Store`, `Panel`, `PanelHost`, `RunProgressSlot`, `Terminal`; Core `Commands`, `Shell`, `RunStore`, `summarize`, `runState`, `TrackedRun`.
- Produces: `Store.preview(_ command: VastCommand) async -> Preview` where `struct Preview { let summary: RunSummary; let stderr: String; let exitCode: Int32 }`; `Store.start(_ command: VastCommand) async -> String?` (returns an error message or nil); `Store.dismiss(_ id: String)`.

- [ ] **Step 1: Store — runs, preview, start, tail**

In `Store.swift`, replace `func loadRuns() {}` and add:

```swift
struct Preview: Equatable {
    let summary: RunSummary
    let stderr: String
    let exitCode: Int32
}

extension Store {
    /// Reads every run from disk, works out which are still going, and polls
    /// while any is. Finished runs older than seven days are pruned.
    func loadRuns() {
        let store = runStore
        store.prune(isFinished: { record in
            summarize(store.events(id: record.id)).isFinished || !Shell.isAlive(record.pid)
        })
        reloadRuns()
        if runs.contains(where: { $0.state == .running }) { startPolling() }
    }

    func reloadRuns() {
        runs = runStore.records().map { record in
            let summary = summarize(runStore.events(id: record.id))
            return TrackedRun(record: record, summary: summary,
                              state: runState(summary: summary, alive: Shell.isAlive(record.pid)))
        }
    }

    private func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let wasRunning = Set(self.runs.filter { $0.state == .running }.map(\.id))
                self.reloadRuns()
                let nowRunning = Set(self.runs.filter { $0.state == .running }.map(\.id))
                if nowRunning.isEmpty {
                    self.pollTimer?.invalidate(); self.pollTimer = nil
                }
                // A run just ended: the deployed tags changed, so refresh.
                if !wasRunning.subtracting(nowRunning).isEmpty { Task { await self.refresh() } }
            }
        }
    }

    /// A dry run, synchronously: the preview the user confirms.
    func preview(_ command: VastCommand) async -> Preview {
        let r = await Shell.run(command, timeout: 300)
        return Preview(summary: summarize(NDJSON.events(from: r.stdout)), stderr: r.stderr, exitCode: r.exitCode)
    }

    /// The real run, detached. Returns an error message, or nil once started.
    func start(_ command: VastCommand) async -> String? {
        let id = newRunID()
        do {
            try runStore.ensureDir()
            let pid = try await Shell.startDetached(command, stdout: runStore.ndjsonURL(id), stderr: runStore.logURL(id))
            try runStore.save(RunRecord(id: id, pid: pid, args: command.args, startedAt: Date(), dismissed: false))
        } catch {
            return "Could not start: \(error)"
        }
        panel = nil
        reloadRuns()
        startPolling()
        return nil
    }

    func dismiss(_ id: String) {
        guard var record = runs.first(where: { $0.id == id })?.record else { return }
        record.dismissed = true
        try? runStore.save(record)
        reloadRuns()
    }
}
```

Add the stored property to the class body (extensions cannot hold stored properties):

```swift
    var pollTimer: Timer?
```

and in `start()` the existing `loadRuns()` call now does the real work.

- [ ] **Step 2: Release panel** — `apps/menubar/Sources/VastBar/ReleasePanel.swift`:

```swift
import SwiftUI
import VastBarCore

struct ReleasePanel: View {
    @EnvironmentObject var store: Store
    let target: ReleaseTarget
    @State private var fixVersion = false
    @State private var preview: Preview?
    @State private var loading = false
    @State private var error: String?

    private var title: String {
        switch target {
        case .repo(let name): return "Release \(name) to staging"
        case .train(let train): return "Release \(train.rawValue) to staging"
        }
    }

    private var offersFixVersion: Bool {
        preview?.summary.plans.contains { ($0.detail ?? "").contains("--fix-version") } ?? false
    }

    private var startable: Bool {
        guard let p = preview else { return false }
        return p.summary.plans.contains(where: \.ok) && !p.summary.cliFailed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: title)
            if loading {
                HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
            } else if let p = preview {
                if p.summary.plans.isEmpty {
                    FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init),
                               command: Commands.release(target, dryRun: true, fixVersion: fixVersion))
                }
                ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0) }
                if offersFixVersion || fixVersion {
                    Toggle("Use the first version above production (--fix-version)", isOn: $fixVersion)
                        .onChange(of: fixVersion) { _ in Task { await load() } }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Release") {
                    Task { error = await store.start(Commands.release(target, dryRun: false, fixVersion: fixVersion)) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!startable || loading)
            }
        }
        .padding(12)
        .task { await load() }
    }

    private func load() async {
        loading = true
        preview = await store.preview(Commands.release(target, dryRun: true, fixVersion: fixVersion))
        loading = false
    }
}

struct PanelHeader: View {
    @EnvironmentObject var store: Store
    let title: String
    var body: some View {
        HStack {
            Button { store.panel = nil } label: { Image(systemName: "chevron.left") }.buttonStyle(.borderless)
            Text(title).font(.headline)
            Spacer()
        }
    }
}

struct PlanRow: View {
    let plan: PlanEvent
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Image(systemName: plan.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .foregroundStyle(plan.ok ? .green : .red)
                Text(plan.repo).font(.system(.body, weight: .semibold))
                Spacer()
                Text(plan.version).font(.system(.caption, design: .monospaced))
            }
            Text(promoteLine).font(.caption).foregroundStyle(.secondary)
            if let notice = plan.notice { Text(notice).font(.caption).foregroundStyle(.orange) }
            if let detail = plan.detail {
                Text(detail).font(.caption).foregroundStyle(plan.ok ? Color.secondary : Color.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
    }

    private var promoteLine: String {
        switch plan.promote {
        case "will merge": return "develop → staging: \(plan.commits ?? 0) commit(s) to merge"
        case "merged": return "develop merged into staging"
        case "nothing to promote": return "staging already has develop"
        case "no develop": return "no develop branch — deploys staging as it is"
        default: return plan.commits.map { "\($0) commit(s)" } ?? ""
        }
    }
}

struct FailureBox: View {
    let lines: [String]
    let command: VastCommand
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("vast failed").font(.caption.bold()).foregroundStyle(.red)
            Text(lines.isEmpty ? "No output." : lines.joined(separator: "\n"))
                .font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Copy command") { Terminal.copy(command.terminalLine) }
                Button("Open in Terminal") { Terminal.open(command.terminalLine) }
            }
            .controlSize(.small)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(.red.opacity(0.08)))
    }
}
```

- [ ] **Step 3: Promote panel** — `apps/menubar/Sources/VastBar/PromotePanel.swift`:

```swift
import SwiftUI
import VastBarCore

struct PromotePanel: View {
    @EnvironmentObject var store: Store
    let repo: String
    @State private var hotfix = false
    @State private var slack = false
    @State private var preview: Preview?
    @State private var loading = false
    @State private var error: String?

    private var command: VastCommand { Commands.promote(repo: repo, hotfix: hotfix, slack: slack, dryRun: false) }
    private var dryRun: VastCommand { Commands.promote(repo: repo, hotfix: hotfix, slack: slack, dryRun: true) }

    private var openable: Bool {
        guard let p = preview else { return false }
        return p.summary.plans.first?.ok == true && !p.summary.prs.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Promote \(repo) to production")
            Picker("Kind", selection: $hotfix) {
                Text("Release").tag(false)
                Text("Hotfix").tag(true)
            }
            .pickerStyle(.segmented)
            Toggle("Post to Slack", isOn: $slack)
            if loading {
                HStack { ProgressView().controlSize(.small); Text("Preparing a dry run…").foregroundStyle(.secondary) }
            } else if let p = preview {
                if p.summary.plans.isEmpty {
                    FailureBox(lines: p.stderr.split(whereSeparator: \.isNewline).suffix(8).map(String.init), command: dryRun)
                }
                ForEach(p.summary.plans, id: \.repo) { PlanRow(plan: $0) }
                ForEach(p.summary.prs, id: \.branch) { pr in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Opens \(pr.branch) → production (\(pr.version))").font(.callout)
                        if let text = pr.slack?.text {
                            Text("Slack message").font(.caption).foregroundStyle(.secondary)
                            Text(text).font(.caption).textSelection(.enabled)
                                .padding(6)
                                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                        }
                    }
                }
                Text("The PR is never merged from here, and nothing deploys production.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { store.panel = nil }
                Spacer()
                Button("Open PR") { Task { error = await store.start(command) } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!openable || loading)
            }
        }
        .padding(12)
        .task(id: "\(hotfix)-\(slack)") { await load() }
    }

    private func load() async {
        loading = true
        preview = await store.preview(dryRun)
        loading = false
    }
}
```

- [ ] **Step 4: Panel host and progress row**

Replace `PanelHost` in `PopoverView.swift`:

```swift
struct PanelHost: View {
    let panel: Panel
    var body: some View {
        switch panel {
        case .release(let target): ReleasePanel(target: target)
        case .promote(let repo): PromotePanel(repo: repo)
        }
    }
}
```

Create `apps/menubar/Sources/VastBar/RunRowView.swift` and replace `RunProgressSlot` in `RepoCardView.swift` with it (delete the old struct there):

```swift
import SwiftUI
import VastBarCore

/// The card's live row: promoting → building (elapsed) → rolling out → done,
/// or the CLI's own failure with its last stderr lines.
struct RunProgressSlot: View {
    @EnvironmentObject var store: Store
    let card: RepoCard

    private var run: TrackedRun? {
        store.runs.last { !$0.record.dismissed && !$0.summary.dryRun && $0.summary.repos.contains { $0.repo == card.id } }
    }

    var body: some View {
        if let run, let progress = run.summary.repos.first(where: { $0.repo == card.id }) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if run.state == .running { ProgressView().controlSize(.mini) }
                    Text(line(progress, run)).font(.caption).foregroundStyle(color(progress, run))
                    Spacer()
                    if let url = progress.prUrl.flatMap(URL.init(string:)) { Link("PR", destination: url).font(.caption) }
                    if let url = progress.runUrl.flatMap(URL.init(string:)) { Link("Build", destination: url).font(.caption) }
                    if run.state != .running {
                        Button { store.dismiss(run.id) } label: { Image(systemName: "xmark") }
                            .buttonStyle(.borderless).font(.caption2).help("Dismiss")
                    }
                }
                if run.summary.cliFailed || run.state == .died {
                    FailureBox(lines: store.runStore.stderrTail(id: run.id, lines: 8), command: VastCommand(args: run.record.args))
                }
            }
        }
    }

    private func line(_ p: RepoProgress, _ run: TrackedRun) -> String {
        if run.state == .died { return "stopped without finishing" }
        switch p.phase {
        case .preparing: return run.summary.command == "promote" ? "opening the PR…" : "promoting develop → staging…"
        case .building(let ms): return "building \(p.version ?? "") · \(Self.elapsed(ms))"
        case .rollingOut(let state, let ms): return "rolling out · \(state) · \(Self.elapsed(ms))"
        case .finished(let status): return "\(status) \(p.version ?? "")" + (p.detail.map { " — \($0)" } ?? "")
        }
    }

    private func color(_ p: RepoProgress, _ run: TrackedRun) -> Color {
        if run.state == .died { return .red }
        if case .finished(let s) = p.phase { return s == "failed" ? .red : s == "released" ? .green : .secondary }
        return .blue
    }

    static func elapsed(_ ms: Int) -> String {
        let s = ms / 1000
        return s >= 60 ? "\(s / 60)m\(String(format: "%02d", s % 60))s" : "\(s)s"
    }
}
```

- [ ] **Step 5: Verify**

Run: `cd apps/menubar && swift build 2>&1 | tail -3 && swift test 2>&1 | tail -2 && ./build.sh --no-install`
Expected: no compiler errors; all tests pass; app bundle built. Fix compile errors at their source (macOS 13 API availability: `onChange(of:)` with a one-argument closure is the macOS 13 form; keep it).

- [ ] **Step 6: Commit**

```bash
git add apps/menubar
git commit -m "feat(vast-bar): release and promote behind a dry-run preview, live run rows"
```

---

### Task 8: Install on this machine and check it live (controller)

Run by the controller, not a subagent: it touches the user's machine.

- [ ] **Step 1: Put a `--json` CLI on the PATH.** The installed `vast` is 2.8.1, below the app's minimum. Install this branch's bundle as `2.9.0-dev`, keeping the old file:

```bash
npm run bundle
cp ~/.vast-cli/vast.mjs ~/.vast-cli/vast.mjs.2.8.1.bak
sed 's/^var VERSION = "2\.8\.1";$/var VERSION = "2.9.0-dev";/' build/vast.mjs > ~/.vast-cli/vast.mjs
zsh -lc 'vast --version && vast status --all --json | head -c 80'
```

Expected: `2.9.0-dev`, then JSON. Gotcha: the CLI's `isNewer` ignores prerelease suffixes, so after 2.9.0 ships `vast upgrade` will think 2.9.0-dev is current — install the release with `vast upgrade --version 2.9.0`.

- [ ] **Step 2: Build, install, launch**

```bash
apps/menubar/build.sh && open "/Applications/Vast Bar.app"
```

- [ ] **Step 3: Live check (previews only — no real release, no PR, no Slack post unless Mostafa asks)**

Screenshot the menu bar and the open popover: icon colour matches doctor (red while the ArgoCD token is expired), one card per repo with tags, drift and waiting-PR counts, doctor footer. Open Release on one repo and on a train: the dry-run plan appears and Release is enabled only when a plan is ok. Open Promote… on one repo with Slack off: the plan and the PR branch appear. Cancel each. Quit and relaunch: no ghost runs.

- [ ] **Step 4: Docs, commit, PR**

README: a short "Vast Bar (menu bar app)" section — what it shows, `apps/menubar/build.sh` to build and install, that it needs vast 2.9.0+, and that actions are preview-then-confirm. CLAUDE.md: one bullet under a new `## Vast Bar (apps/menubar)` heading — Core holds every rule and is tested with synthetic fixtures; views stay thin; the app never decides what a release depends on. Commit, push the branch, open a PR stacked on PR #44.
