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

function runRecollIndex(): void {
    const brewPath = '/opt/homebrew/bin'; // Homebrew bin path
    const pythonPath = '/Users/andrea/.local/opt/homebrew/lib/python3.12/site-packages';
    const recollDataDir = '/Users/andrea/.local/share/recoll/';

    // Construct the command to include an explicit exit code check
    const command = `
        RECOLL_DATADIR='${recollDataDir}' PYTHONPATH='${pythonPath}' \
            /Users/andrea/.local/bin/recollindex`;

    exec(command, {
        env: {
                ...process.env,
                PATH: `${brewPath}:${process.env.PATH}`, // Ensure Homebrew Python and binaries are in the PATH
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
                    console.log(`recollindex stderr: ${stderr}`);
                }
            }

            // By default settings, recoll has nothing on stdouts
            // console.log(`recollindex stdout: ${stdout}`);
        }
    );
}

