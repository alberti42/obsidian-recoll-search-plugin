// utils.ts

import { ParsedPath } from "types";
import { promises as fs } from 'fs';
import {networkInterfaces, hostname } from "os";


// https://github.com/bevry/getmac/blob/master/source/index.ts
// I could not install it from npm. Decided to copy&paste the code here directly.
function getMAC(iface?: string): string {
    const zeroRegex = /(?:[0]{1,2}[:-]){5}[0]{1,2}/
    const list = networkInterfaces()
    if (iface) {
        const parts = list[iface]
        if (!parts) {
            throw new Error(`interface ${iface} was not found`)
        }
        for (const part of parts) {
            if (zeroRegex.test(part.mac) === false) {
                return part.mac
            }
        }
        throw new Error(`interface ${iface} had no valid mac addresses`)
    } else {
        for (const [key, parts] of Object.entries(list)) {
            // for some reason beyond me, this is needed to satisfy typescript
            // fix https://github.com/bevry/getmac/issues/100
            if (!parts) continue
            for (const part of parts) {
                if (zeroRegex.test(part.mac) === false) {
                    return part.mac
                }
            }
        }
    }
    throw new Error('failed to get the MAC address')
}

export function getHostname():string {
    return hostname();
}

let macAddress:string|undefined = undefined;
export function getMACAddress(): string {
    if(macAddress) return macAddress;
    macAddress = getMAC();
    return macAddress;
}

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
