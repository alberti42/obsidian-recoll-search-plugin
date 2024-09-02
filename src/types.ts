// types.ts

import { DEFAULT_SETTINGS } from "default";

export interface RecollSearchSettings {
    debug: boolean;
    debouncingTime: number; // debouncing time in ms before running recollindex 
    compatibility: "1.0";
    localSettings: {[MACAddress:string]: RecollSearchLocalSettings};
    logs?: Record<string, string[]>; // To include logs on mobile apps
}

export interface RecollSearchLocalSettings {
    pythonPath: string;
    recollDataDir: string;
    pathExtensions: string[];
    recollindexCmd: string;
}

export interface ParsedPath {
    dir: string,
    base: string,
    filename: string,
    ext: string,
    path: string
}
