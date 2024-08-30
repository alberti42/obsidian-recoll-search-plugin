// recoll.ts

import { exec } from 'child_process';
import RecollSearch from 'main';
import { debounceFactory } from 'utils';

let plugin:RecollSearch;

export let runRecollIndexDebounced:()=>void;

export function setPluginReference(p:RecollSearch) {
    plugin = p;
}

export function setDebouncingTime(debouncingTime:number) {
    runRecollIndexDebounced = debounceFactory(runRecollIndex, debouncingTime);
}

export async function runRecollIndex(): Promise<void> {
    const pythonPath = plugin.localSettings.pythonPath; // '/Users/andrea/.local/opt/homebrew/lib/python3.12/site-packages';
    const recollDataDir = plugin.localSettings.recollDataDir; // '/Users/andrea/.local/share/recoll/';
    const pathExtension = plugin.localSettings.pathExtensions.join(':'); // /opt/homebrew/bin

    // Construct the command to include an explicit exit code check
    const recollindex_cmd = plugin.localSettings.recollindexCmd; // /Users/andrea/.local/bin/recollindex
    
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
