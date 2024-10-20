// utils.ts

import { ParsedPath } from "types";
import { promises as fs } from 'fs';
import {networkInterfaces, hostname } from "os";


export function getMACAddress(existingMACs:string[]): string {
    const zeroRegex = /(?:[0]{1,2}[:-]){5}[0]{1,2}/
    const list = networkInterfaces()
    let found_mac = null;
    for (const [key, parts] of Object.entries(list)) {
        if (!parts) continue
        for (const part of parts) {
            if (zeroRegex.test(part.mac) === false) {
                if(existingMACs.contains(part.mac)) return part.mac; // if already there, exit
                if(found_mac===null) found_mac = part.mac; // record the first occurrance
            }
        }
    }
    if(found_mac) return found_mac;
    const fallback_MAC = '00-00-00-00-00-00';
    console.warn('Failed to get the MAC address. Using the fallback MAC address: ${fallback_MAC}')
    return fallback_MAC;
}

export function getHostname():string {
    return hostname();
}

// let macAddress:string|undefined = undefined;
// export function getMACAddress(existingMACs:string[]): string {
//     if(macAddress) return macAddress;
//     macAddress = getMAC();
//     return macAddress;
// }

// Joins multiple path segments into a single normalized path.
export function joinPaths(...paths: string[]): string {
    return paths.join('/');
}

export function parseFilePath(filePath: string): ParsedPath {
    const lastSlashIndex = filePath.lastIndexOf('/');

    const dir = lastSlashIndex !== -1 ? filePath.substring(0, lastSlashIndex) : '';
    const base = lastSlashIndex !== -1 ? filePath.substring(lastSlashIndex + 1) : filePath;
    const extIndex = base.lastIndexOf('.');
    const filename = extIndex !== -1 ? base.substring(0, extIndex) : base;
    const ext = extIndex !== -1 ? base.substring(extIndex) : '';

    return { dir, base, filename, ext, path: filePath };
}

export async function doesFileExists(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile();  // Check if the path is a directory
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return false;  // The directory does not exist
        }
        throw error; // Re-throw the error if it's not related to the existence check
    }
}
export async function doesDirectoryExists(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isDirectory();  // Check if the path is a directory
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return false;  // The directory does not exist
        }
        throw error; // Re-throw the error if it's not related to the existence check
    }
}

export function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

export function formatUnixTime(unixTime: number, dateFormat: string): string {
    // Convert Unix time to a moment object and format it
    const formattedDate = window.moment(unixTime).format(dateFormat);
    return formattedDate;
}

export function debounceFactoryWithWaitMechanism<F extends (...args: never[]) => void | Promise<void>>(func: F, wait: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let promise: Promise<void> | null = null;
    let resolvePromise: (() => void) | null = null;

    return {
        // Function to wait for the completion of the current debounced call (if any)
        waitFnc: async (): Promise<void> => {
            while (promise) {
                await promise;  // Await the current promise
            }
        },

        // The debounced function itself
        debouncedFct: (...args: Parameters<F>): void => {
            // Clear the previous timeout to cancel any pending execution
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }

            // Store the previous resolvePromise to reject it after the new promise is created
            const previousResolvePromise = resolvePromise;

            // Create a new promise for the current execution
            promise = new Promise<void>((resolve, reject) => {
                // Set the new resolvePromise function
                resolvePromise = () => {
                    resolve();  // Reference to resolve() used when the previous execution is cancelled
                };

                // Schedule the function to run after the debounce delay
                timeout = setTimeout(async () => {
                    promise = null;
                    resolvePromise = null;
                    timeout = null;
                    try {
                        await func(...args);  // Execute the debounced function
                        // Clear the stored promise and resolve function after execution
                        resolve();  // Resolve the promise once the function is done
                    } catch (error) {
                        reject(error);  // Reject the promise if the function throws an error
                    }
                }, wait);
            });

            // After the new promise is created, resolve the previous one
            if (previousResolvePromise) {
                previousResolvePromise();  // Resolve the previous promise to indicate cancellation
            }
        }
    };
}

// Helper function to check if a node is an Element
export function isElement(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

export function isHTMLElement(node: Node): node is HTMLElement {
    return node instanceof HTMLElement ;
}

// Mapping dictionary from Moment.js tokens to Python strftime directives
const momentToPythonFormat: { [key: string]: string | undefined } = {
  // Month
  'M': '%-m',
  'Mo': undefined,  // 'Mo' is the ordinal month (e.g., '1st', '2nd'); Python's strftime doesn't support ordinals.
  'MM': '%m',
  'MMM': '%b',
  'MMMM': '%B',

  // Quarter
  'Q': undefined,   // 'Q' represents the quarter of the year; not directly supported in strftime.
  'Qo': undefined,  // 'Qo' is the ordinal quarter; ordinals are not supported in strftime.

  // Day of Month
  'D': '%-d',
  'Do': undefined,  // 'Do' is the ordinal day (e.g., '1st', '2nd'); ordinals are not supported in strftime.
  'DD': '%d',

  // Day of Year
  'DDD': '%-j',
  'DDDo': undefined, // 'DDDo' is the ordinal day of the year; ordinals are not supported.
  'DDDD': '%j',

  // Day of Week
  'd': '%w',
  'do': undefined,  // 'do' is the ordinal weekday; ordinals are not supported.
  'dd': undefined,  // 'dd' is the two-letter weekday abbreviation; no direct equivalent in strftime.
  'ddd': '%a',
  'dddd': '%A',

  // Day of Week (Locale)
  'e': undefined,   // 'e' is the locale-specific day of week; not directly supported in strftime.

  // Day of Week (ISO)
  'E': '%u',

  // Week of Year
  'w': '%-U',
  'wo': undefined,  // 'wo' is the ordinal week number; ordinals are not supported.
  'ww': '%U',

  // Week of Year (ISO)
  'W': '%-V',
  'Wo': undefined,  // 'Wo' is the ordinal ISO week number; ordinals are not supported.
  'WW': '%V',

  // Year
  'YY': '%y',
  'YYYY': '%Y',
  'YYYYYY': undefined, // 'YYYYYY' represents expanded years; strftime doesn't support years beyond 4 digits.
  'Y': '%Y',
  'y': '%Y',

  // Era Year
  'gg': undefined,  // 'gg' is the locale-specific week-year; not supported in strftime.
  'gggg': undefined,// 'gggg' is the locale-specific week-year; not supported in strftime.

  // Era
  'N': undefined,   // 'N' to 'NNNNN' represent era names; strftime doesn't support eras.
  'NN': undefined,
  'NNN': undefined,
  'NNNN': undefined,
  'NNNNN': undefined,

  // Week Year (ISO)
  'GG': undefined,  // 'GG' is ISO week-year without century; no direct equivalent in strftime.
  'GGGG': '%G',

  // AM/PM
  'A': '%p',
  'a': '%p',

  // Hour
  'H': '%-H',
  'HH': '%H',
  'h': '%-I',
  'hh': '%I',
  'k': undefined,   // 'k' is hour in 24-hour clock (1-24); strftime doesn't support hour zero-padded from 1.
  'kk': undefined,  // 'kk' is hour in 24-hour clock (1-24) zero-padded; no direct equivalent.

  // Minute
  'm': '%-M',
  'mm': '%M',

  // Second
  's': '%-S',
  'ss': '%S',

  // Fractional Second
  'S': '%f',        // Maps to microseconds in strftime (6 digits); Moment's 'S' is tenths of a second.
  'SS': undefined,  // 'SS' is hundredths of a second; strftime doesn't support this precision.
  'SSS': undefined, // 'SSS' is milliseconds; strftime doesn't support milliseconds.
  'SSSS': undefined,// 'SSSS' and higher precision fractions are not supported in strftime.

  // Time Zone
  'z': '%Z',
  'zz': '%Z',
  'Z': '%z',
  'ZZ': '%z',

  // Unix Timestamp
  'X': undefined,   // 'X' is Unix timestamp in seconds; strftime doesn't support timestamps.
  'x': undefined,   // 'x' is Unix timestamp in milliseconds; not supported in strftime.

  // Localized formats
  'LT': undefined,    // 'LT' is locale-specific time format; strftime doesn't handle locale-specific tokens.
  'LTS': undefined,   // 'LTS' is locale-specific time with seconds; not supported.
  'L': undefined,     // 'L' is locale-specific date format; not supported.
  'l': undefined,     // 'l' is locale-specific date format; not supported.
  'LL': undefined,    // 'LL' is locale-specific date; not supported.
  'll': undefined,    // 'll' is locale-specific date; not supported.
  'LLL': undefined,   // 'LLL' is locale-specific date and time; not supported.
  'lll': undefined,   // 'lll' is locale-specific date and time; not supported.
  'LLLL': undefined,  // 'LLLL' is locale-specific full date and time; not supported.
  'llll': undefined,  // 'llll' is locale-specific full date and time; not supported.
};

// Function to translate Moment.js format string to Python strftime format
export function momentJsToDatetime(momentFormat: string): string {
  let pythonFormat = '';
  let i = 0;

  while (i < momentFormat.length) {
    let char = momentFormat[i];

    if (char === '[') {
      // Handle literals inside square brackets
      let endIndex = momentFormat.indexOf(']', i);
      if (endIndex === -1) {
        throw new Error('Unmatched [ in format string');
      }
      // Include the literal text directly
      pythonFormat += momentFormat.slice(i + 1, endIndex);
      i = endIndex + 1;
    } else if (char === '\\') {
      // Handle escaped characters; include the next character as a literal
      if (i + 1 < momentFormat.length) {
        pythonFormat += momentFormat[i + 1];
        i += 2;
      } else {
        throw new Error('Escape character at end of format string');
      }
    } else {
      // Try to match tokens (longest match first)
      let tokenFound = false;
      // Possible token lengths in Moment.js are up to 5 characters (e.g., 'SSSSS')
      const maxTokenLength = 5;
      for (let tokenLength = maxTokenLength; tokenLength > 0; tokenLength--) {
        if (i + tokenLength <= momentFormat.length) {
          let token = momentFormat.substr(i, tokenLength);
          if (momentToPythonFormat.hasOwnProperty(token)) {
            let pythonToken = momentToPythonFormat[token];
            if (pythonToken !== undefined) {
              pythonFormat += pythonToken;
            } else {
              // Token not supported in Python
              throw new Error(
                `Moment.js token '${token}' does not have a Python equivalent`
              );
            }
            i += tokenLength;
            tokenFound = true;
            break;
          }
        }
      }
      if (!tokenFound) {
        // If no token matched, include the character as is
        pythonFormat += char;
        i++;
      }
    }
  }

  return pythonFormat;
}
