/* eslint-disable @typescript-eslint/no-inferrable-types */

// Import necessary Obsidian API components
import {
	App,
	MarkdownView,
	MarkdownFileInfo,
	Editor,
	Notice,
	FileSystemAdapter,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	Platform,
	PluginManifest,
	TextComponent,
	normalizePath,
    ToggleComponent,
    EventRef,
} from "obsidian";

import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS } from "default";
import { RecollSearchLocalSettings, RecollSearchSettings as RecollSearchSettings } from "types";

import { monkeyPatchConsole, unpatchConsole } from "patchConsole";

import { isRecollindexRunning, runRecollIndex, setPluginReference, stopRecollIndex, updateProcessLogging } from "recoll";
import { doesDirectoryExists, doesFileExists, getMACAddress, joinPaths, parseFilePath } from "utils";
import { getMaxListeners } from "process";

// Helper function to check if a node is an Element
function isElement(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

function isHTMLElement(node: Node): node is HTMLElement {
    return node instanceof HTMLElement ;
}

// Main plugin class
export default class RecollSearch extends Plugin {
	settings: RecollSearchSettings = { ...DEFAULT_SETTINGS };
    localSettings: RecollSearchLocalSettings = { ...DEFAULT_LOCAL_SETTINGS };
    
    private settingsTab: RecollSearchSettingTab;
    private createEventRef: EventRef|null = null;
    private modifyEventRef: EventRef|null = null;
    private deleteEventRef: EventRef|null = null;

    private exitListener: NodeJS.ExitListener | null = null;
    private sigintListener: ((...args: any[]) => void) | null = null;
    private sigtermListener: ((...args: any[]) => void) | null = null;
    private uncaughtExceptionListener: NodeJS.UncaughtExceptionListener | null = null;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);

        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error("The vault folder could not be determined.");
        }

		if (process.env.NODE_ENV === "development") {
            monkeyPatchConsole(this);
            console.log("Recoll Search: development mode including extra logging and debug features");
        }
        
        setPluginReference(this);

		this.settingsTab = new RecollSearchSettingTab(this.app, this);        
	}

	// Load plugin settings
	async onload() {
        console.log("DATA!!");

		// Load and add settings tab
		await this.loadSettings();
		this.addSettingTab(this.settingsTab);
        console.log(this.settings);
        console.log("DATA!!");

		// console.log('Loaded plugin Recoll Search');

        this.app.workspace.onLayoutReady(() => {
            const firstStart = true;
            runRecollIndex(firstStart);
        });

        this.registerEvents();
	}

	onunload() {
        stopRecollIndex();
        this.unregisterEvents();
	}

    onquit() {
        stopRecollIndex();
    }

    registerEvents() {
        // Registering the shutdown hooks
        this.exitListener = () => {
            stopRecollIndex(); // Called when the Node.js process exits normally
        };
        this.sigintListener = () => {
            stopRecollIndex();
        }; // Called when Ctrl+C is pressed
        this.sigtermListener = () => {
            stopRecollIndex();
        }; // Called when a termination request is sent to the process
        this.uncaughtExceptionListener = (err: Error) => {
            console.error(`Uncaught exception: ${err.message}`);
            stopRecollIndex();
        }; // Called when an unhandled exception occurs

        process.on('exit', this.exitListener);
        process.on('SIGINT', this.sigintListener);
        process.on('SIGTERM', this.sigtermListener);
        process.on('uncaughtException', this.uncaughtExceptionListener);
    }

    unregisterEvents() {
        // Remove event listeners
        if(this.exitListener) process.off('exit', this.exitListener);
        if(this.sigintListener) process.off('SIGINT', this.sigintListener);
        if(this.sigtermListener) process.off('SIGTERM', this.sigtermListener);
        if(this.uncaughtExceptionListener) process.off('uncaughtException', this.uncaughtExceptionListener);
    }

	async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.localSettings = Object.assign({}, DEFAULT_LOCAL_SETTINGS, this.settings.localSettings[getMACAddress()]);
	}

    async saveSettings() {
        this.settings.localSettings[getMACAddress()] = this.localSettings;
        try {
            await this.saveData(this.settings);
        } catch(error) {
            if(error instanceof Error && 'msg' in error) {
                console.error("Could not save the settings:",error.msg)    
            } else {
                console.error("Could not save the settings:",error)    
            }
        }
    }
}

// Plugin settings tab
class RecollSearchSettingTab extends PluginSettingTab {
	plugin: RecollSearch;

	private saveTimeout: number | null = null;

	constructor(app: App, plugin: RecollSearch) {
		super(app, plugin);
		this.plugin = plugin;
    }

	display(): void {
		const { containerEl } = this;
        
        const MACAddress = getMACAddress();

		containerEl.empty();

        new Setting(containerEl).setName('Recoll status').setHeading();

        const recollindex_status = isRecollindexRunning();
        const status_label = recollindex_status ? "running" : "not running"

        const status_setting = new Setting(containerEl)
            .setName(createFragment((frag:DocumentFragment) => {
                frag.appendText('Status of recollindex daemon service: ');
                const status_span = createSpan({
                    text: status_label, 
                    cls: recollindex_status ? 'mod-success' : 'mod-warning'
                });
                frag.appendChild(status_span);
            }));                

        new Setting(containerEl).setName('Recoll environment paths').setHeading();

        const recollindex_setting = new Setting(containerEl)
            .setName("Path to recollindex utility")
            .setDesc(`Absolute path to 'recollindex' utility. \
                This setting applies to this local host with MAC address '${MACAddress}'.`);

        let recollindex_text:TextComponent;
        recollindex_setting.addText(text => {
                recollindex_text = text;
                const warningEl = containerEl.createDiv({ cls: 'mod-warning' });
                text.setPlaceholder('/usr/local/bin/recollindex')
                .setValue(this.plugin.localSettings.recollindexCmd)
                .onChange(async (value) => {
                    // Remove any previous warning text
                    warningEl.textContent = '';
                    const parsedPath = parseFilePath(value);

                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesFileExists(value)) {
                        warningEl.textContent = "Please enter the path of an existing file.";
                        warningEl.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        warningEl.style.display = 'none';
                        this.plugin.localSettings.recollindexCmd = value;
                        this.plugin.saveSettings();
                    }
                })
            });

        recollindex_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_LOCAL_SETTINGS.recollindexCmd;
                    recollindex_text.setValue(value);
                    this.plugin.localSettings.recollindexCmd = value;
                    this.plugin.saveSettings();
                });
        });


        const python_path_setting = new Setting(containerEl)
            .setName("Path to site-packages directory")
            .setDesc(`Absolute path (PYTHONPATH) to 'site-packages' directory that contains the python module 'recoll'. \
                    This setting applies to this local host with MAC address '${MACAddress}'.`);

        let python_path_text:TextComponent;
        python_path_setting.addText(text => {
                python_path_text = text;
                const python_path_warningEl = containerEl.createDiv({ cls: 'mod-warning' });
                text.setPlaceholder('site-packages')
                .setValue(this.plugin.localSettings.pythonPath)
                .onChange(async (value) => {
                    // Remove any previous warning text
                    python_path_warningEl.textContent = '';
                    const parsedPath = parseFilePath(value);

                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(value)) {
                        python_path_warningEl.textContent = "Please enter the path of an existing 'site-packages' directory.";
                        python_path_warningEl.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        python_path_warningEl.style.display = 'none';
                        this.plugin.localSettings.pythonPath = value;
                        await this.plugin.saveSettings();
                    }
                })
            });

        python_path_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_LOCAL_SETTINGS.pythonPath;
                    python_path_text.setValue(value);
                    this.plugin.localSettings.pythonPath = value;
                    this.plugin.saveSettings();
                });
        });

        const recoll_datadir_setting = new Setting(containerEl)
            .setName("Path to share/recoll directory")
            .setDesc(`Absolute path (RECOLL_DATADIR) to recoll data directory 'recoll/share'. \
                This setting applies to this local host with MAC address '${MACAddress}'.`);

        let recoll_datadir_text:TextComponent;
        recoll_datadir_setting.addText(text => {
                recoll_datadir_text = text;
                const warningEl = containerEl.createDiv({ cls: 'mod-warning' });
                text.setPlaceholder('/usr/local/share/recoll')
                .setValue(this.plugin.localSettings.recollDataDir)
                .onChange(async (value) => {
                    // Remove any previous warning text
                    warningEl.textContent = '';
                    const parsedPath = parseFilePath(value);

                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(value)) {
                        warningEl.textContent = "Please enter the path of an existing directory.";
                        warningEl.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        warningEl.style.display = 'none';
                        this.plugin.localSettings.recollDataDir = value;
                        this.plugin.saveSettings();
                    }
                })
            });

        recoll_datadir_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_LOCAL_SETTINGS.recollDataDir;
                    recoll_datadir_text.setValue(value);
                    this.plugin.localSettings.recollDataDir = value;
                    this.plugin.saveSettings();
                });
        });

        const path_extensions_setting = new Setting(containerEl)
            .setName("Directories to be added to $PATH")
            .setDesc(`List of absolute paths to directories separated by ':' that are added to $PATH. \
                This setting applies to this local host with MAC address '${MACAddress}'.`);

        let path_extensions_text:TextComponent;
        path_extensions_setting.addText(text => {
                path_extensions_text = text;
                const warningEl = containerEl.createDiv({ cls: 'mod-warning' });
                text.setPlaceholder('/usr/local/bin')
                .setValue(this.plugin.localSettings.pathExtensions.join(':'))
                .onChange(async (value) => {

                    const paths = value.split(':');

                    const errors = (await Promise.all(paths.map(async (path:string):Promise<string|null> => {
                        // Remove any previous warning text
                        warningEl.textContent = '';
                        const parsedPath = parseFilePath(path);

                        // when the field is empty, we don't consider it as an error,
                        // but simply as no input was provided yet
                        const isEmpty = path === "";

                        if (!isEmpty && !await doesDirectoryExists(path)) {
                            return `Directory '${path}' does not exist.`;
                        } else return null;
                    }))).filter((error:string|null): error is string => error !==null );

                    if(errors.length>0) {
                        warningEl.innerHTML = errors.join('<br>');
                        warningEl.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        warningEl.style.display = 'none';
                        this.plugin.localSettings.pathExtensions = paths.filter((path:string) => path !== "");
                        this.plugin.saveSettings();
                    }
                })
            });

        path_extensions_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const values = DEFAULT_LOCAL_SETTINGS.pathExtensions;
                    recoll_datadir_text.setValue(values.join(':'));
                    this.plugin.localSettings.pathExtensions = values;
                    this.plugin.saveSettings();
                });
        });

        new Setting(containerEl).setName('Indexing').setHeading();

        // let debouncing_time_warningEl:HTMLElement;
        // const debouncing_time_setting = new Setting(containerEl)
        //     .setName('Debouncing time for recollindex')
        //     .setDesc('A delay in milliseconds to be waited after any change to the vault before recollindex is executed.');                
        
        // let debouncing_time_text:TextComponent;
        // debouncing_time_setting.addText(text => {
        //         debouncing_time_text = text;
        //         const debouncing_time_warningEl = containerEl.createDiv({ cls: 'mod-warning' });
        //         debouncing_time_warningEl.style.display = 'none';  // Initially hide the warning
        //         return text
        //             .setPlaceholder('Delay in milliseconds')
        //             .setValue(`${this.plugin.settings.debouncingTime}`)
        //             .onChange(async (value) => {
        //                 // Remove any previous warning text
        //                 debouncing_time_warningEl.textContent = '';

        //                 // Try to parse the input as an integer
        //                 const parsedValue = parseInt(value, 10);

        //                 // Check if the value is a valid number and greater than or equal to 0
        //                 if (isNaN(parsedValue) || parsedValue < 0) {
        //                     // Show warning if the input is invalid
        //                     debouncing_time_warningEl.textContent = 'Please enter a valid number for the delay.';
        //                     debouncing_time_warningEl.style.display = 'block';
        //                 } else {
        //                     // Hide the warning and save the valid value
        //                     debouncing_time_warningEl.style.display = 'none';
        //                     this.plugin.settings.debouncingTime = parsedValue;
        //                     this.plugin.saveSettings();                            
        //                 }
        //             });
        //     });

        // debouncing_time_setting.addExtraButton((button) => {
        //     button
        //         .setIcon("reset")
        //         .setTooltip("Reset to default value")
        //         .onClick(() => {
        //             const value = DEFAULT_SETTINGS.debouncingTime;
        //             debouncing_time_text.setValue(`${value}`);
        //             this.plugin.settings.debouncingTime = value;
        //             this.plugin.saveSettings();
        //         });
        // });


        const debug_setting = new Setting(containerEl)
            .setName('Show debug infos')
            .setDesc('If this option is enabled, debug infos are shown in the development console.');

        let debug_toggle: ToggleComponent;
        debug_setting.addToggle(toggle => {
            debug_toggle = toggle;
            toggle
            .setValue(this.plugin.settings.debug)
            .onChange(async (value: boolean) => {
                this.plugin.settings.debug = value;
                this.plugin.saveSettings();
                updateProcessLogging(value);
            })
        });

        debug_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.debug;                    
                    debug_toggle.setValue(value);
                    updateProcessLogging(value);
                });
        });
	}

	hide(): void {   
    }
}
