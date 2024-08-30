// types.ts

import { DEFAULT_SETTINGS } from "default";

export interface RecollSearchSettings {
    debug: boolean;
    debouncingTime: number; // debouncing time in ms before running recollindex 
    compatibility: string;
    logs?: Record<string, string[]>; // To include logs on mobile apps
}

