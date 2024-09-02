// recoll.ts

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import RecollSearch from 'main';

let recollindexProcess: ChildProcessWithoutNullStreams | null = null;
let plugin:RecollSearch;

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

export async function runRecollIndex(): Promise<void> {
    const recollindex_cmd = plugin.localSettings.recollindexCmd;
    
    if (recollindex_cmd === "") return;

    const pythonPath = plugin.localSettings.pythonPath;
    const recollDataDir = plugin.localSettings.recollDataDir;
    const pathExtension = plugin.localSettings.pathExtensions.join(':');

    // Spawn the recollindex process as a daemon
    recollindexProcess = spawn(recollindex_cmd, ['-m', '-D', '-w0', '-x'], {
        env: {
            ...process.env,
            PATH: `${pathExtension}:${process.env.PATH}`, // Ensure Homebrew Python and binaries are in the PATH
            PYTHONPATH: pythonPath, // Add the path to custom Python packages
            RECOLL_DATADIR: recollDataDir,  // Add the path to recoll's share folder
        },
        detached: true, // Allow the process to run independently of its parent
        stdio: [null, 'pipe', 'pipe'], // Use null for stdin, and allow stdout and stderr for logging
    });

    // Handle stdout and stderr
    recollindexProcess.stdout.on('data', (data) => {
        // discard stdout
        // console.log(`recollindex stdout: ${data}`);
    });

    recollindexProcess.stderr.on('data', (data) => {
        // recoll surprisingly uses stderr for printing ordinary logs
        // thus, we redirect stderr to the ordinary console
        console.log(`recollindex stderr: ${data}`);
    });

    recollindexProcess.on('error', (error) => {
        console.error(`Error running recollindex:\n${error.message}`);
    });

    recollindexProcess.on('close', (code) => {
        console.log(`recollindex process exited with code ${code}`);
        recollindexProcess = null;
    });
}

// Call this function when the plugin is unloaded
export function stopRecollIndex(): void {
    if (recollindexProcess) {
        recollindexProcess.kill('SIGINT'); // Send SIGTERM to gracefully terminate the process
        recollindexProcess = null;
    }
}