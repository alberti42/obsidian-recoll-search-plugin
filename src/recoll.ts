// recoll.ts

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import RecollSearch from 'main';
import { Notice } from 'obsidian';
import { removeListener } from 'process';
import { delay } from 'utils';

class TimeoutError extends Error {
    constructor(message: string = 'Process did not terminate within the timeout period.') {
        // Pass the message to the base Error class
        super(message);
        // Set the name of the error to be more descriptive
        this.name = 'TimeoutError';

        // Ensures the name and stack trace are correctly set in ES5 environments (required for transpiled code)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

let recollindexProcess: ChildProcessWithoutNullStreams | null = null;
let plugin:RecollSearch;
let recollindex_PID:number|undefined = undefined;

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

export function isRecollindexRunning(): boolean {
    if (recollindexProcess && recollindexProcess.pid && isProcessRunning(recollindexProcess.pid)) {
        return true;
    } else {
        return false;
    }
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

        function checkProcessIntFnc() {
            try {
                process.kill(pid, 0); // Check if the process is still running
                if (Date.now() - start >= timeout) {
                    return reject(new TimeoutError());
                }
                setTimeout(checkProcessIntFnc, 100); // Check again each 25ms
            } catch (err) {
                // If process.kill throws an error, the process is no longer running
                return resolve();
            }
        }
        checkProcessIntFnc();
    });
}

export function updateProcessLogging(debug: boolean) {
    plugin.settings.debug = debug;
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

export async function runRecollIndex(firstRun:boolean = false): Promise<void> {
    
    if(!firstRun) removeListeners();

    const recollindex_cmd = plugin.localSettings.recollindexCmd;

    if (recollindex_cmd === "") return;

    const pythonPath = plugin.localSettings.pythonPath;
    const recollDataDir = plugin.localSettings.recollDataDir;
    const pathExtension = plugin.localSettings.pathExtensions.join(':');

    if(!firstRun) {
        console.log("INSIDE");
    
        if (recollindex_PID) {
            const existingPid = recollindex_PID;    
            
            try {
                // Try to gracefully terminate the existing process
                process.kill(existingPid, 'SIGTERM');
            } catch(error) {
                if(error instanceof Error && 'code' in error && error.code === "ESRCH") {
                    // nothing to be done, the process was already
                    // dead and we did not need to terminate it
                } else {
                    throw error;    
                }
            }

            // The process has received notification to quit,
            // but it could take some time. Recollindex is
            // configured to react within 1000 ms.
            // To be safe, we take a timeout of 1100 ms.
            // If it has not exited after this timeoutm, something
            // went wrong. Then a kill command is in order.
            try {
                await waitForProcessToExit(existingPid,1);
            } catch(error) {
                if(error instanceof TimeoutError) {
                    try {
                        console.log("TIMEOUT");
                        await delay(1000);
                        // We jukk the existing process
                        process.kill(existingPid, 'SIGKILL');
                    } catch(error) {
                        if(error instanceof Error && 'code' in error && error.code === "ESRCH") {
                            // nothing to be done, the process was already
                            // dead and we did not need to terminate it
                            console.log("TIMEOUTTT!!!!");
                
                        } else {
                            throw error;
                        }
                    }
                    // At this point, it is quite certain with the kill
                    // signal that we will be able to quit the process.
                    // If the timeout is reached, something serious is
                    // going on, where the process does not react even
                    // to kill commands.
                    await waitForProcessToExit(existingPid,1000);
                } else {
                    throw error;
                }
            }
            await waitForProcessToExit(existingPid,1000);



            
            // process.kill(existingPid, 'SIGTERM');          // Try to gracefully terminate the existing process
            // try {
            //     console.log(`Trying to terminate recollindex process with PID: ${existingPid}.`);
            //     process.kill(existingPid, 'SIGTERM');          // Try to gracefully terminate the existing process
            //     await waitForProcessToExit(existingPid, 1500); // Wait until the process terminates
            //     delay(1500);
            //     console.log(`Successfully terminated the existing recollindex process with PID: ${existingPid}.`);
            // } catch (err) {
            //     if(err instanceof Error) {
            //         console.error(`Failed to terminate existing recollindex process: ${err.message}`);
            //     } else {
            //         console.error(`Failed to terminate existing recollindex process: ${err}`);
            //     }
            // }
        }
    }
    await delay(1200);

    recollindex_PID = undefined;

    let stdErrOption: null | 'pipe';
    if(plugin.settings.debug) {
        stdErrOption = 'pipe';
    } else {
        stdErrOption = null;
    }
    
    // Spawn the recollindex process as a daemon
    recollindexProcess = spawn(recollindex_cmd, ['-m', '-O', '-w0', '-x'], {
        env: {
            ...process.env,
            PATH: `${pathExtension}:${process.env.PATH}`, // Ensure Homebrew Python and binaries are in the PATH
            PYTHONPATH: pythonPath, // Add the path to custom Python packages
            RECOLL_DATADIR: recollDataDir,  // Add the path to recoll's share folder
        },
        detached: true, // Allow the process to run independently of its parent
        stdio: [null, null, stdErrOption], // Ignore stdin, but allow stderr for logging
    });

    if(recollindexProcess && recollindexProcess.pid) {
        // if(plugin.settings.debug) {
        //     stderrListener = (data:unknown) => {
        //         // recoll surprisingly uses stderr for printing ordinary logs
        //         // thus, we redirect stderr to the ordinary console
        //         console.log(`recollindex stderr:\n${data}`);
        //     };
        //     recollindexProcess.stderr.on('data',stderrListener)
        // };
        errorListener =  (error:Error) => {
            new Notice(`Error running recollindex:\n${error.message}`);
            console.error(`Error running recollindex:\n${error.message}`);
        };
        recollindexProcess.on('error', errorListener);

        closeListener = (code) => {
            new Notice(`recollindex process exited with code ${code}`);
            console.log(`recollindex process exited with code ${code}`);
            recollindexProcess = null;
            recollindex_PID = undefined;
        };
        recollindexProcess.on('close', closeListener);
    
        recollindex_PID = recollindexProcess.pid;
    }



    // add a delay to test that the process has effectively started and just attempted
    // but then immediatly exited with some error
    await delay(1000); 

console.log("1",recollindexProcess);
    if(recollindexProcess){
            console.log("2",recollindexProcess.pid);
            if(recollindexProcess.pid) {
                console.log("3",isProcessRunning(recollindexProcess.pid));    
            }
            
            
        }

    if (recollindexProcess && recollindexProcess.pid && isProcessRunning(recollindexProcess.pid)) {
        // Preserve the PID of the process
        recollindex_PID = recollindexProcess.pid;
        console.log(`recollindex process started with PID: ${recollindexProcess.pid}`);
    } else {
        recollindex_PID = undefined;
        console.error('recollindex process failed to start');
        new Notice('recollindex process failed to start')
        recollindexProcess = null;
    }

}

// Call this function when the plugin is unloaded
export function stopRecollIndex(): void {
    if (recollindexProcess) {
        removeListeners();
        recollindexProcess.kill('SIGTERM'); // Send SIGTERM to gracefully terminate the process
        recollindexProcess = null;
        recollindex_PID = undefined;
    }
}