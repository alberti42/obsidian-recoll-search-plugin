// types.ts

import { Menu, TAbstractFile, WorkspaceLeaf } from "obsidian";

export interface RecollSearchSettings {
    debug: boolean;
    momentjsFormat: string;
    datetimeFormat: string;
    filterType: FilterType;
    createdLabel: string;
    modifiedLabel: string;
    altKeyBehavior: AltKeyBehavior;
    debouncingTime: number; // debouncing time in ms before running recollindex 
    compatibility: "1.0";
    localSettings: {[MACAddress:string]: RecollSearchLocalSettings};
    logs?: Record<string, string[]>; // To include logs on mobile apps
}

export interface RecollSearchLocalSettings {
    virtualEnv: string;
    recollDataDir: string;
    recollConfDir: string;
    pathExtensions: string[];
    libraryPath: string[]; 
    recollindexCmd: string;
    recollqCmd: string;
}

export type FileMenuCallback = (menu: Menu, file: TAbstractFile, source:string, leaf?: WorkspaceLeaf) => void;

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
}

export enum AltKeyBehavior {
    WINDOW = 'window',
    SPLIT = 'split',
    TAB = 'tab',
}
