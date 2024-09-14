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
                if(existingMACs.contains(part.mac)) return part.mac;
                if(found_mac===null) found_mac = part.mac; // record the first occurrance
            }
        }
    }
    if(found_mac) return found_mac;
    const fallback_MAC = '00-00-00-00-00-00';
    console.error('Failed to get the MAC address. Using the fallback MAC address: ${fallback_MAC}')
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
    const formattedDate = window.moment(unixTime * 1000).format(dateFormat);
    return formattedDate;
}
