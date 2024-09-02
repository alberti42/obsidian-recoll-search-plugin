// recoll.ts

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import RecollSearch from 'main';
import { Notice } from 'obsidian';
import { removeListener } from 'process';

let recollindexProcess: ChildProcessWithoutNullStreams | null = null;
let plugin:RecollSearch;

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0); // Send signal 0 to check if the process is running
        return true;
    } catch (err) {
        return false;
    }
}

function waitForProcessToExit(pid: number, timeout = 1000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        function checkProcess() {
            try {
                process.kill(pid, 0); // Check if the process is still running
                if (Date.now() - start >= timeout) {
                    return reject(new Error('Process did not terminate within the timeout period.'));
                }
                setTimeout(checkProcess, 100); // Check again after 100ms
            } catch (err) {
                // If process.kill throws an error, the process is no longer running
                return resolve();
            }
        }

        checkProcess();
    });
}

export function updateProcessLogging(debug: boolean) {
    if(debug && !stderrListener) {
        plugin.settings.debug = debug;
    } else if(!debug && stderrListener) {
        removeDataListener();
    }
    runRecollIndex();
}

let stderrListener:((data:unknown)=>void) | null = null;
let errorListener:((error:Error)=>void) | null = null;
let closeListener:((code: number | null, signal: NodeJS.Signals | null)=>void) | null = null;

function removeDataListener() {
    if(stderrListener) {
        if(recollindexProcess){
            recollindexProcess.stderr.off('data', stderrListener);    
        }
        stderrListener = null; // Clear the reference
    }
}

function removeErrorListener() {
    if(errorListener) {
        if(recollindexProcess){
            recollindexProcess.off('error',errorListener);
        }
        errorListener = null; // Clear the reference
    }
}

function removeCloseListener() {
    if(closeListener) {
        if(recollindexProcess){
            recollindexProcess.off('close',closeListener);
        }
        closeListener = null; // Clear the reference
    }
}

export function removeListeners():void {
    removeDataListener();
    removeErrorListener();
    removeCloseListener();
}

export async function runRecollIndex(): Promise<void> {
    const recollindex_cmd = plugin.localSettings.recollindexCmd;

    if (recollindex_cmd === "") return;

    const pythonPath = plugin.localSettings.pythonPath;
    const recollDataDir = plugin.localSettings.recollDataDir;
    const pathExtension = plugin.localSettings.pathExtensions.join(':');

    const existingPid = plugin.localSettings.PID;
    if (existingPid) {
        try {
            process.kill(existingPid, 'SIGTERM'); // Try to gracefully terminate the existing process
            await waitForProcessToExit(existingPid,); // Wait until the process terminates
            console.log(`Successfully terminated the existing recollindex process with PID: ${existingPid}.`);
        } catch (err) {
            if(err instanceof Error) {
                console.error(`Failed to terminate existing recollindex process: ${err.message}`);
            } else {
                console.error(`Failed to terminate existing recollindex process: ${err}`);
            }
        }
    }
    plugin.localSettings.PID = undefined;

    let stdErrOption: null | 'pipe';
    if(plugin.settings.debug) {
        stdErrOption = 'pipe';
    } else {
        stdErrOption = null;
    }
    
    // Spawn the recollindex process as a daemon
    recollindexProcess = spawn(recollindex_cmd, ['-m', '-D', '-w0', '-x'], {
        env: {
            ...process.env,
            PATH: `${pathExtension}:${process.env.PATH}`, // Ensure Homebrew Python and binaries are in the PATH
            PYTHONPATH: pythonPath, // Add the path to custom Python packages
            RECOLL_DATADIR: recollDataDir,  // Add the path to recoll's share folder
        },
        detached: true, // Allow the process to run independently of its parent
        stdio: [null, null, stdErrOption], // Ignore stdin, but allow stderr for logging
    });

    // Verify that the process is running before saving the PID
    if(recollindexProcess.pid) {
        plugin.localSettings.PID = recollindexProcess.pid;
    }
    setTimeout(() => {
        if (recollindexProcess && plugin.localSettings.PID && isProcessRunning(plugin.localSettings.PID)) {
            // Preserve the PID of the process
            console.log(`recollindex process started with PID: ${recollindexProcess.pid}`);
        } else {
            console.error('recollindex process failed to start');
            new Notice('recollindex process failed to start')
            recollindexProcess = null;
            plugin.localSettings.PID = undefined;
            plugin.saveSettings();
        }
    }, 1000); // Wait for 1 second to allow the process to start

    // save the PID number
    plugin.saveSettings();

    if(plugin.settings.debug) {
        stderrListener = (data:unknown) => {
            // recoll surprisingly uses stderr for printing ordinary logs
            // thus, we redirect stderr to the ordinary console
            console.log(`recollindex stderr:\n${data}`);
        };
        recollindexProcess.stderr.on('data',stderrListener)
    };
    errorListener =  (error:Error) => {
        console.error(`Error running recollindex:\n${error.message}`);
    };
    recollindexProcess.on('error', errorListener);

    closeListener = (code) => {
        console.log(`recollindex process exited with code ${code}`);
        recollindexProcess = null;
        plugin.localSettings.PID = undefined;
    };
    recollindexProcess.on('close', closeListener);
}

// Call this function when the plugin is unloaded
export function stopRecollIndex(): void {
    if (recollindexProcess) {
        recollindexProcess.kill('SIGTERM'); // Send SIGTERM to gracefully terminate the process
        recollindexProcess = null;
        plugin.localSettings.PID = undefined;
        removeListeners();
    }
}