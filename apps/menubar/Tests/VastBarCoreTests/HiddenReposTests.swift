import XCTest
@testable import VastBarCore

final class HiddenReposTests: XCTestCase {
    func testTheAppHidesVastMenuPayments() {
        XCTAssertEqual(HiddenRepos.names, ["vast-menu-payments"])
    }

    // A hidden repo leaves the cards AND everything that counts toward the header.
    func testHidingDropsTheRepoFromStatusDoctorAndPending() throws {
        let d = VastJSON.decoder()
        let status = try d.decode(StatusSnapshot.self, from: fixture("status.json")).hiding(["VastMenuPwa"])
        let doctor = try d.decode(DoctorSnapshot.self, from: fixture("doctor.json")).hiding(["VastMenuPwa"])
        let pending = try d.decode(PendingSnapshot.self, from: fixture("pending.json")).hiding(["VastMenuPwa"])
        XCTAssertEqual(status.repos.map(\.repo), ["VastPayPwaV2", "VastPay-BackEnd"])
        XCTAssertEqual(doctor.checks.map(\.label), ["node", "vast-cli", "ArgoCD staging", "VastPayPwaV2"])
        XCTAssertEqual(pending.repos.map(\.repo), ["VastPayPwaV2"])
    }

    // Only a repo's own check goes: a machine-wide check that merely mentions it stays.
    func testOnlyRepoGroupChecksAreHidden() throws {
        let doctor = try VastJSON.decoder().decode(DoctorSnapshot.self, from: fixture("doctor.json")).hiding(["node"])
        XCTAssertTrue(doctor.checks.contains { $0.label == "node" })
    }
}
