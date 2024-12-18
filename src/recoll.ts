// recoll.ts

import { spawn } from 'child_process';
import RecollSearch from 'main';
import { Notice } from 'obsidian';
import { RecollSearchLocalSettings, RecollSearchSettings } from 'types';
import { delay } from 'utils';

import * as path from 'path'

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

let recollindexProcess: ReturnType<typeof spawn> | null = null;
let plugin:RecollSearch;
let recollindex_PID:number|undefined = undefined;
let numExecAttemptsMade:number = 0;
const maxNumExecAttemptsMade:number = 3;
export let queue: Promise<void> = Promise.resolve(); // use to avoid running `runRecollIndex` multiple times in parallel; initialized to be a resolved promise

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

export function isRecollindexRunning(): boolean {
    // if (recollindexProcess && recollindexProcess.pid && isProcessRunning(recollindexProcess.pid)) {
    if (recollindex_PID && isProcessRunning(recollindex_PID)) {
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

let stderrListener:((data:Buffer)=>void) | null = null;
let errorListener:((error:Error)=>void) | null = null;
let closeListener:((code: number | null, signal: NodeJS.Signals | null)=>void) | null = null;

function removeDataListener() {
    if(stderrListener) {
        if(recollindexProcess && recollindexProcess.stderr){
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

async function safeProcessTermination(): Promise<void> {
    if(!recollindex_PID) return;
    try {
        // Try to gracefully terminate the existing process
        process.kill(recollindex_PID, 'SIGTERM');
    } catch(error) {
        if(error instanceof Error && 'code' in error && error.code === "ESRCH") {
            // nothing to be done, the process was already
            // dead and we did not need to terminate it
        } else { // something else is happening, propagate the error
            throw error;    
        }
    }
    
    // The process has received notification to quit,
    // but it is not quit yet. It can take some time.
    // Recollindex is configured to react within 2000 ms.
    // To be safe, we take a timeout of 2100 ms.
    // If it has not exited after this timeoutm, something
    // went wrong. Then a kill command is in order.
    try {
        await waitForProcessToExit(recollindex_PID,2100);
        console.log(`Gracefully terminated the existing recollindex process with PID: ${recollindex_PID}.`);
    } catch(errorSigTerm) {
        if(errorSigTerm instanceof TimeoutError) {
            try {
                // TIMEOUT: The process did not terminate before the
                // timeout. We dare to kill the existing process. Otherwise,
                // we cannot launch a new one. They are exclusive.
                process.kill(recollindex_PID, 'SIGKILL');
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
                await waitForProcessToExit(recollindex_PID,1000);
                console.log(`Killed the existing recollindex process with PID: ${recollindex_PID}.`);
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
    // If we reach this point, it means there were no errors thrown
    // and the process recollindex has been successfully terminated.
    recollindex_PID = undefined
}

async function queuedRunRecollIndex(
    settings:Omit<RecollSearchSettings, 'localSettings'>,
    localSettings:RecollSearchLocalSettings,
    recollindex_extra_options:string[]):Promise<void> {

    return new Promise(async (resolve, reject) => {
        // Remove listeners if these were set
        removeListeners();

        const recollindex_cmd = plugin.replacePlaceholders(localSettings.recollindexCmd);
        
        const virtualEnv = plugin.replacePlaceholders(localSettings.virtualEnv);
        const recollDataDir = plugin.replacePlaceholders(localSettings.recollDataDir);

        const virtualEnvBin = virtualEnv ? path.join(virtualEnv,'bin') : undefined;

        const filter_strings = (s:string|undefined):boolean => {
            if(s !== undefined) return true;
            else return false;
        };

        const PATH = [
                virtualEnvBin, 
                ...localSettings.pathExtensions.map((s:string):string => plugin.replacePlaceholders(s)),
                process.env.PATH
            ].filter(filter_strings).join(':');
                
        let LIBRARY_KEYWORD: 'DYLD_LIBRARY_PATH' | 'LD_LIBRARY_PATH' | undefined;
        let LIBRARY_PATH: string|undefined = undefined;

        switch(plugin.platform) {
            case 'mac':
                LIBRARY_KEYWORD = 'DYLD_LIBRARY_PATH';
                break;
            case 'linux':
                LIBRARY_KEYWORD = 'LD_LIBRARY_PATH';
                break;
            default:
                LIBRARY_KEYWORD = undefined;
        }

        if (LIBRARY_KEYWORD) {
            LIBRARY_PATH = [
                    ...localSettings.libraryPath.map((s:string):string => plugin.replacePlaceholders(s)),
                    process.env[LIBRARY_KEYWORD]
                ].filter(filter_strings).join(':');
            if(LIBRARY_PATH==='') LIBRARY_PATH = undefined;
        }
        
        // Stop the recollindex process if this wsa running.
        // We cannot have two sessions of recollindex runnning in parallel.
        await safeProcessTermination();
        
        // Depending on `plugin.settings.debug` we configure or not the pipe of stderr to the console
        let stdErrOption: 'ignore' | 'pipe';
        if(settings.debug) {
            stdErrOption = 'pipe';
        } else {
            stdErrOption = 'ignore';
        }
        
        const env = {
            ...process.env,
            RCLMD_CREATED: settings.createdLabel,
            RCLMD_MODIFIED: settings.modifiedLabel,
            PATH, // Ensure Homebrew Python and binaries are in the PATH
            VIRTUAL_ENV: virtualEnv, // Add the path to custom Python packages
            RECOLL_DATADIR: recollDataDir,  // Add the path to recoll's share folder
            ...(LIBRARY_KEYWORD && LIBRARY_PATH ? { [LIBRARY_KEYWORD]: LIBRARY_PATH } : {}), // Conditionally include LIBRARY_KEYWORD
        };

        if(settings.debug) {
            console.log({'desc':'The environment variables used to spawn recollindex process','env': env});
        }

        // Spawn the recollindex process
        // Option:
        // -m:  real-time indexing
        // -O:  similar to -D but it shutdown the recollindex process if the process gets detached from its parent
        // -w0: start indexing with 0 second delay
        // -x:  process will stay alive even if it cannot connect to the X11 server, which is here not needed
        // -c <configdir> : specify configuration directory, overriding $RECOLL_CONFDIR.
        // -z : reset database before starting indexing
        let options = ['-m', '-w0', '-x', '-c', plugin.replacePlaceholders(localSettings.recollConfDir)];
        if(plugin.platform!=='win') {
            options.push('-O');
        }
        recollindexProcess = spawn(
                recollindex_cmd,
                [
                    ...options,
                    ...recollindex_extra_options
                ], 
                {
                    env,
                    detached: false, // Allow the process to run independently of its parent
                    stdio: ['ignore','ignore', stdErrOption], // Ignore stdin, but allow stderr for logging
                });
        
        errorListener =  (error:Error) => {
            attemptNewStart(`recollindex process unexpectedly exited: ${error.message}`,resolve);
        };
        recollindexProcess.on('error', errorListener);

        // Set up the listeners for the running process
        if(recollindexProcess && recollindexProcess.pid) {
            if(settings.debug) {
                stderrListener = (data:Buffer) => {
                    // recoll surprisingly uses stderr for printing ordinary logs
                    // thus, we redirect stderr to the ordinary console
                    // this property can be changed in recoll.conf, but I'd rather
                    // preserve in recoll.conf the standard behavior, i.e., stderr,
                    // because people are familiar with it.
                    console.log(data.toString('utf8'));
                };
                if(recollindexProcess.stderr) recollindexProcess.stderr.on('data',stderrListener)
            };
            
            closeListener = (code) => {
                if(code!=null) attemptNewStart(`recollindex process exited with code ${code}`,resolve);
            };
            recollindexProcess.on('close', closeListener);
        
            // We now started the process; however, it may quit soon after if some problem occurs
            recollindex_PID = recollindexProcess.pid;
            console.log(`Successfully started the recollindex process with PID: ${recollindex_PID}.`)

            // Resolve the promise when the process is successfully started
            resolve();
        } else {
            // We do not need to handle the error here. Instead, it will be caught by `errorListener``
        }

        // We wait for 30 seconds. If no error is detected, we reset `numExecAttemptsMade`
        setTimeout(()=>{
            numExecAttemptsMade = 0;
        }, 30*1000);
    });
}

async function attemptNewStart(msg:string, resolve_fnc:((value:void | PromiseLike<void>)=>void)) {
    if(numExecAttemptsMade < 3) { // an error occurred
        const pause = 5000;
        numExecAttemptsMade++;
        console.log(`${msg}\n
We now pause for ${Math.round(pause/1000)}s and then proceed with attempt ${numExecAttemptsMade}/${maxNumExecAttemptsMade} to restart recollindex.`);

        // add a delay and restart the process
        await delay(pause);
        // resolve the promise before attempting to run recollindex again; otherwise we are stuck in the queue
        resolve_fnc();
        runRecollIndex();
    } else {
        new Notice('recollindex process terminated unexpectedly');
        console.error(`${msg}\n
No further automatic attempts to restart recollindex will be made. \
If you have not already done so, switch to debug mode, start the process manually with the command \
'Gracefully restart recollindex', and check the error message on the console to find out what caused the problem.`)
    }  
}

export async function runRecollIndex(recollindex_extra_options:string[] = []): Promise<void> {
    if(!plugin.isConfigured()) return;

    // For efficiency remove local settings from the copy
    const { localSettings:_, ...settingsWithoutLocalSettings } = plugin.settings;
    
    // Update the queue to include the current execution
    queue = queue.then(()=>queuedRunRecollIndex(structuredClone(settingsWithoutLocalSettings),structuredClone(plugin.localSettings),recollindex_extra_options));

    // Wait for the current execution to finish before allowing the next one
    await queue;
}

async function queuedStopRecollIndex() {
    if (recollindexProcess) {
        // note: we first remove the listeners, so there will be no
        // attempt from `closeListener` to keep the process alive
        // then we can safely send the sigterm command
        removeListeners();
        await safeProcessTermination()
        recollindexProcess = null;
        recollindex_PID = undefined;
    }
}

// Call this function when the plugin is unloaded
export async function stopRecollIndex(): Promise<void> {
    // Update the queue to include the current execution
    queue = queue.then(()=>queuedStopRecollIndex());

    // Wait for the current execution to finish before allowing the next one
    await queue;
}