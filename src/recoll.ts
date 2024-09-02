// recoll.ts

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { error } from 'console';
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
let numExecAttemptsMade:number = 0;
let keepProcessAlive:boolean = true;
const maxNumExecAttemptsMade:number = 3;
let successTimer:ReturnType<typeof setTimeout>;

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
        if (recollindex_PID) {
            const existingPid = recollindex_PID;    
            
            try {
                // Try to gracefully terminate the existing process
                process.kill(existingPid, 'SIGTERM');
            } catch(error) {
                if(error instanceof Error && 'code' in error && error.code === "ESRCH") {
                    // nothing to be done, the process was already
                    // dead and we did not need to terminate it

                } else { // something else is happening, propagate the error
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
                await waitForProcessToExit(existingPid,1100);
                console.log(`Gracefully terminated the existing recollindex process with PID: ${existingPid}.`);
            } catch(errorSigTerm) {
                if(errorSigTerm instanceof TimeoutError) {
                    try {
                        // TIMEOUT: The process did not terminate before the
                        // timeout. We dare to kill the existing process. Otherwise,
                        // we cannot launch a new one. They are exclusive.
                        process.kill(existingPid, 'SIGKILL');
                    } catch(error) {
                        if(error instanceof Error && 'code' in error && error.code === "ESRCH") {
                            // We did not need to terminate it. It was already dead.
                            // The process just died before sending out the SIGKILL signal.
                            // Nothing to be done,                            
                        } else { // something else is happening, propagate the error
                            throw error;
                        }
                    }
                    // As we reached this point, we will use the kill signal
                    // to terminate the process. This is a strong command
                    // and it should always work.
                    // If the timeout is reached, something very bad
                    // is happening because the process does not even react 
                    // to kill commands.
                    try {
                        // Wait up to 1000 ms for the kill command to get into effect
                        await waitForProcessToExit(existingPid,1000);
                        console.log(`Killed the existing recollindex process with PID: ${existingPid}.`);
                    } catch(errorSigKil) {
                        if(errorSigKil instanceof TimeoutError) {
                            // TIMEOUT: The process did not terminate before the
                            // timeout despite the SIGKILL signal. We give up and return.
                            console.error(`Failed to terminate existing recollindex process: ${errorSigKil.message}`)
                            return;
                        } else { // errorSigKil is not instanceof TimeoutError
                            console.error(`Failed to terminate existing recollindex process: ${errorSigKil}`);
                            throw errorSigKil;
                        }
                    }
                } else { 
                    throw errorSigTerm;
                }
            }
        }
    }
    
    // We either successfully terminated the previous recollindex process
    // or it is very first execution of this function. In both cases,
    // we initialize recollindex_PID to undefined.
    recollindex_PID = undefined;

    // Depending on `plugin.settings.debug` we configure or not the pipe of stderr to the console
    let stdErrOption: null | 'pipe';
    if(plugin.settings.debug) {
        stdErrOption = 'pipe';
    } else {
        stdErrOption = null;
    }
    
    // Spawn the recollindex process as a daemon
    // Option:
    // -m:  real-time indexing
    // -O:  similar to -D but it shutdown the recollindex daemon if the process gets detached from its parent
    // -w0: start indexing with 0 second delay
    // -x:  daemon will stay alive even if it cannot connect to the X11 server, which is here not needed
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

    // Set up the listeners for the running process
    if(recollindexProcess && recollindexProcess.pid) {
        if(plugin.settings.debug) {
            stderrListener = (data:unknown) => {
                // recoll surprisingly uses stderr for printing ordinary logs
                // thus, we redirect stderr to the ordinary console
                // this property can be changed in recoll.conf, but I'd rather
                // preserve in recoll.conf the standard behavior, i.e., stderr,
                // because people are familiar with it.
                console.log(`recollindex stderr:\n${data}`);
            };
            recollindexProcess.stderr.on('data',stderrListener)
        };
        errorListener =  (error:Error) => {
            console.log("STOPPPPPPPPPPQQQQQ");
            new Notice(`Error running recollindex:\n${error.message}`);
            console.error(`Error running recollindex:\n${error.message}`);
        };
        recollindexProcess.on('error', errorListener);

        closeListener = async (code) => {
            if(keepProcessAlive && numExecAttemptsMade < 3) { // an error occurred
                const pause = 3000;
                numExecAttemptsMade++;
                console.log(`recollindex process exited with code ${code}\n
We now pause for ${Math.round(pause/1000)}s and then proceed with attempt ${numExecAttemptsMade}/${maxNumExecAttemptsMade} to restart recollindex`);

                // add a delay and restart the process
                await delay(300);
                const firstRun = false;
                runRecollIndex(firstRun);
            }          
        };
        recollindexProcess.on('close', closeListener);
    
        recollindex_PID = recollindexProcess.pid;
    }

    // We wait for 30 seconds. If no error is detected, we reset `numExecAttemptsMade`
    successTimer = setTimeout(()=>{
        console.log("WE ARE GOOD");
        numExecAttemptsMade = 0;
    }, 30*1000);
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