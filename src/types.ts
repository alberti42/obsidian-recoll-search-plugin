// types.ts

import { DEFAULT_SETTINGS } from "default";

export interface RecollSearchSettings {
    debug: boolean;
    debouncingTime: number; // debouncing time in ms before running recollindex 
    compatibility: "1.0";
    logs?: Record<string, string[]>; // To include logs on mobile apps
}

