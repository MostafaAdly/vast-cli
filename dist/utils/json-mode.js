/**
 * In --json mode stdout is a data channel. Every human line — log.info, error
 * boxes, the status board, a muted note deep inside promote — is moved to
 * stderr here, once, at the command boundary, rather than threading a flag
 * through every print. Machine output is written with process.stdout.write,
 * which this leaves alone.
 */
import { Console } from 'console';
import { format } from 'util';
export function routeHumanOutputToStderr() {
    const toStderr = (...args) => {
        process.stderr.write(`${format(...args)}\n`);
    };
    console.log = toStderr;
    console.info = toStderr;
    console.warn = toStderr;
    console.debug = toStderr;
    // table and dir format their own output, so they keep their formatting and
    // only change where it goes.
    const onStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
    console.table = onStderr.table.bind(onStderr);
    console.dir = onStderr.dir.bind(onStderr);
}
//# sourceMappingURL=json-mode.js.map