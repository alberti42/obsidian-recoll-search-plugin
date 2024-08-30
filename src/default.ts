// defaults.ts

import { RecollSearchSettings } from 'types'

// Default plugin settings
export const DEFAULT_SETTINGS: RecollSearchSettings = {
    debug: true,
    debouncingTime: 1000,  // debouncing time in ms before running recollindex 
	logs: {}, // Initialize logs as an empty array
	compatibility: '1.0'
};
