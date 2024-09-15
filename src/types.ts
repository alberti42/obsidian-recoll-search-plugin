// types.ts

import { DEFAULT_SETTINGS } from "default";

export interface RecollSearchSettings {
    debug: boolean;
    dateFormat: string;
    filterType: FilterType;
    altKeyBehavior: AltKeyBehavior;
    debouncingTime: number; // debouncing time in ms before running recollindex 
    compatibility: "1.0";
    localSettings: {[MACAddress:string]: RecollSearchLocalSettings};
    logs?: Record<string, string[]>; // To include logs on mobile apps
}

export interface RecollSearchLocalSettings {
    pythonPath: string;
    recollDataDir: string;
    recollConfDir: string;
    pathExtensions: string[];
    recollindexCmd: string;
    recollqCmd: string;
}

export interface ParsedPath {
    dir: string,
    base: string,
    filename: string,
    ext: string,
    path: string
}

export enum FilterType {
    MARKDOWN = 0,
    ANY_FILE = 1,
    ANY = 2,
}

export enum AltKeyBehavior {
    WINDOW = 'window',
    SPLIT = 'split',
    TAB = 'tab',
}
