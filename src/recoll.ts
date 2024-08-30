// recoll.ts

import { exec } from 'child_process';
import RecollSearch from 'main';

let plugin:RecollSearch;
let debouncingTime:number;
let timeout: ReturnType<typeof setTimeout>;

export function runRecollIndexDebounced():void {
    clearTimeout(timeout);
    timeout = setTimeout(runRecollIndex, debouncingTime);
}

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

export function setDebouncingTime(t:number) {
    debouncingTime = t;
}

export async function runRecollIndex(): Promise<void> {
    const recollindex_cmd = plugin.localSettings.recollindexCmd;
    
    if(recollindex_cmd === "") return;

    const pythonPath = plugin.localSettings.pythonPath;
    const recollDataDir = plugin.localSettings.recollDataDir;
    const pathExtension = plugin.localSettings.pathExtensions.join(':');

    exec(recollindex_cmd, {
        env: {
                ...process.env,
                PATH: `${pathExtension}:${process.env.PATH}`, // Ensure Homebrew Python and binaries are in the PATH
                PYTHONPATH: pythonPath, // Add the path to custom Python packages
                RECOLL_DATADIR: recollDataDir,  // Add the path to recoll's share folder
            }
        },
        (error, stdout, stderr) => {
            // Log any error from recoll
            if (error) {
                console.error(`Error running recollindex:\n${error.message}`);
                return;
            }

            if (stderr) {
                // `logfilename` in recoll.conf allows configuring the output other than stderr
                //  However, we keep stderr for the log output as it is the default option
                //  Note that we cannot use `stdout` as a string because it is not recognized by recoll.
                if(error || (plugin && plugin.settings.debug)) {
                    console.log(`recollindex stderr:\n${stderr}`);
                }
            }

            // By default settings, recoll has nothing on stdouts
            // console.log(`recollindex stdout:\n${stdout}`);
        }
    );
}
