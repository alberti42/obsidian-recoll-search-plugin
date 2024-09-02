// defaults.ts

import { RecollSearchLocalSettings, RecollSearchSettings } from 'types'

// Default plugin settings
export const DEFAULT_SETTINGS: RecollSearchSettings = {
    debug: false,
    localSettings: {},
    debouncingTime: 1000,  // debouncing time in ms before running recollindex 
	logs: {}, // Initialize logs as an empty array
	compatibility: '1.0',
};

export const DEFAULT_LOCAL_SETTINGS: RecollSearchLocalSettings = {
    pythonPath: '',
    recollDataDir: '',
    pathExtensions: [''],
    recollindexCmd: '',
    PID: undefined,
}