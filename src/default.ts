// defaults.ts

import { FilterType, AltKeyBehavior, RecollSearchLocalSettings, RecollSearchSettings } from 'types'

// Default plugin settings
export const DEFAULT_SETTINGS: RecollSearchSettings = {
    debug: false,
    momentjsFormat: 'YYYY_MM_DDTHH_mm_ss',
    datetimeFormat: '%Y_%m_%dT%H_%M_%S',
    createdLabel: 'created',
    modifiedLabel: 'modified',
    filterType: FilterType.MARKDOWN,
    altKeyBehavior: AltKeyBehavior.TAB,
    localSettings: {},
    debouncingTime: 1000,  // debouncing time in ms before running recollindex 
	logs: {}, // Initialize logs as an empty array
	compatibility: '1.0',
};

export const DEFAULT_LOCAL_SETTINGS: RecollSearchLocalSettings = {
    pythonPath: '',
    recollDataDir: '',
    recollConfDir: '',
    pathExtensions: [''],
    ldLibraryPath: [''],
    recollindexCmd: '',
    recollqCmd: '',    
}