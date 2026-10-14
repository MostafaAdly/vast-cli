/**
 * Installing Vast Bar, the macOS menu bar app, from the release that matches
 * this CLI. Every file and process step goes through BarDeps, so the whole
 * flow is tested without touching the machine (tests/vast-bar.test.ts); the
 * real steps live in src/commands/bar.ts.
 *
 * Why no Gatekeeper prompt: Gatekeeper only assesses files carrying
 * com.apple.quarantine, which browsers add and curl and ditto do not. The
 * install clears it anyway in case something else added it.
 */
export declare const BAR_ASSET = "VastBar.zip";
export declare const BAR_APP = "Vast Bar.app";
export declare const BAR_BUNDLE_ID = "com.vastgroup.vastbar";
/** curl's --max-time for the download; vast upgrade's wait for the app step must exceed it. */
export declare const BAR_DOWNLOAD_MAX_SECONDS = 600;
export declare class BarError extends Error {
}
export interface BarDeps {
    platform: NodeJS.Platform;
    home: string;
    env: Record<string, string | undefined>;
    exists(path: string): boolean;
    writable(dir: string): boolean;
    makeTempDir(): string;
    mkdirp(dir: string): void;
    /** 'not-found' for a release without the asset (HTTP 404); throws on anything else that is not a success. */
    download(url: string, to: string): Promise<'ok' | 'not-found'>;
    unzip(zip: string, into: string): Promise<void>;
    plist(app: string): {
        id: string | null;
        version: string | null;
    };
    verifySignature(app: string): Promise<boolean>;
    isRunning(): Promise<boolean>;
    /** Asks the app to quit, then forces it; true once it is gone. */
    quit(): Promise<boolean>;
    move(from: string, to: string): void;
    remove(path: string): void;
    clearQuarantine(app: string): Promise<void>;
    open(app: string): Promise<void>;
}
export interface BarInstalled {
    path: string;
    version: string;
    opened: boolean;
    /** Something the install could not tidy up, for the command to print. */
    warning?: string;
}
export declare function barUrl(version: string, env: Record<string, string | undefined>): string;
/** Where the app is installed now: /Applications first, then ~/Applications. */
export declare function installedBar(deps: Pick<BarDeps, 'home' | 'exists'>): string | null;
export declare function barStatusLine(deps: BarDeps, cliVersion: string): string;
export declare function installBar(opts: {
    cliVersion: string;
    version?: string;
    ifInstalled?: boolean;
}, deps: BarDeps): Promise<BarInstalled | null>;
export declare function uninstallBar(opts: {
    purge: boolean;
}, deps: BarDeps): Promise<string[]>;
//# sourceMappingURL=vast-bar.d.ts.map