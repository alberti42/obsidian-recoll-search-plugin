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
} from "obsidian";

import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS } from "default";
import { RecollSearchLocalSettings, RecollSearchSettings as RecollSearchSettings } from "types";

import { monkeyPatchConsole, unpatchConsole } from "patchConsole";

import { runRecollIndex, runRecollIndexDebounced, setDebouncingTime, setPluginReference } from "recoll";
import { debounceFactory, doesDirectoryExists, doesFileExists, joinPaths, parseFilePath } from "utils";

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
    private localDataPath: string;

    runRecollIndexDebounced:()=>void;

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

        this.runRecollIndexDebounced = debounceFactory(runRecollIndex, DEFAULT_SETTINGS.debouncingTime);

		this.settingsTab = new RecollSearchSettingTab(this.app, this);

        // Path to plugins folder
        const pluginsPath = app.plugins.getPluginFolder();

        // Path to this plugin folder in the vault
        const pluginPath = joinPaths(pluginsPath,manifest.id);

        // Path where local settings are stored
        this.localDataPath = joinPaths(pluginPath,'data.local.json');
	}

	// Load plugin settings
	async onload() {
		// Load and add settings tab
		await this.loadSettings();
		this.addSettingTab(this.settingsTab);

		// console.log('Loaded plugin Recoll Search');

        // Inside your plugin's onload() method
        // this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => this.onFileCreate(file)));
        // this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => this.onFileModify(file)));
        // this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => this.onFileDelete(file)));
        this.registerEvent(this.app.vault.on('create', this.runRecollIndexDebounced));
        this.registerEvent(this.app.vault.on('modify', this.runRecollIndexDebounced));
        this.registerEvent(this.app.vault.on('delete', this.runRecollIndexDebounced));

        this.app.workspace.onLayoutReady(() => {
            
        });
	}

	onunload() {
	}

     // Overriding the default loadData method to specify the filename
    async loadLocalData(): Promise<any> {
        const adapter = this.app.vault.adapter;
        try {
            const data = await adapter.read(this.localDataPath);
            return JSON.parse(data);
        } catch (err) {
            return null; // Return null if the file doesn't exist
        }
    }

	async loadSettings() {
    	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.localSettings = Object.assign({}, DEFAULT_LOCAL_SETTINGS, await this.loadLocalData());
        setDebouncingTime(this.settings.debouncingTime);
	}

    // Overriding the default saveData method to specify the filename
    async saveLocalData(data: any): Promise<void> {
        const lastDataModifiedTime = Date.now();
        await this.app.vault.writeJson(this.localDataPath, data, {
            mtime: lastDataModifiedTime
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Event handler for file creation
    private onFileCreate(file: TAbstractFile): void {
        if(this.settings.debug) console.log(`File created: ${file.path}`);
        runRecollIndexDebounced();
    }

    // Event handler for file modification
    private onFileModify(file: TAbstractFile): void {
        if(this.settings.debug) console.log(`File modified: ${file.path}`);
        runRecollIndexDebounced();
    }

    // Event handler for file deletion
    private onFileDelete(file: TAbstractFile): void {
        if(this.settings.debug) console.log(`File deleted: ${file.path}`);
        runRecollIndexDebounced();
    }

    private updateDebouncingTime() {
        this.runRecollIndexDebounced = debounceFactory(runRecollIndex, this.settings.debouncingTime);
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

		containerEl.empty();

        new Setting(containerEl).setName('Recoll environment paths').setHeading();

        const recollindex_setting = new Setting(containerEl)
            .setName("Path to recollindex utility")
            .setDesc("Absolute path to 'recollindex' utility.");

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
                        this.plugin.saveLocalData(this.plugin.localSettings);
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
                    this.plugin.saveLocalData(this.plugin.localSettings);
                });
        });


        const python_path_setting = new Setting(containerEl)
            .setName("Path to site-packages directory")
            .setDesc("Absolute path (PYTHONPATH) to 'site-packages' directory that contains the python module 'recoll'.");

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
                        await this.plugin.saveLocalData(this.plugin.localSettings);
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
                    this.plugin.saveLocalData(this.plugin.localSettings);
                });
        });

        const recoll_datadir_setting = new Setting(containerEl)
            .setName("Path to share/recoll directory")
            .setDesc("Absolute path (RECOLL_DATADIR) to recoll data directory 'recoll/share'.");

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
                        this.plugin.saveLocalData(this.plugin.localSettings);
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
                    this.plugin.saveLocalData(this.plugin.localSettings);
                });
        });

        const path_extensions_setting = new Setting(containerEl)
            .setName("Directories to be added to $PATH")
            .setDesc("List of absolute paths to directories separated by ':' that are added to $PATH.");

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
                        this.plugin.saveLocalData(this.plugin.localSettings);
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
                    this.plugin.saveLocalData(this.plugin.localSettings);
                });
        });

        new Setting(containerEl).setName('Indexing').setHeading();
        let debouncing_time_warningEl:HTMLElement;
        const debouncing_time_setting = new Setting(containerEl)
            .setName('Debouncing time for recollindex')
            .setDesc('A delay in milliseconds to be waited after any change to the vault before recollindex is executed.');                
        
        let debouncing_time_text:TextComponent;
        debouncing_time_setting.addText(text => {
                debouncing_time_text = text;
                const debouncing_time_warningEl = containerEl.createDiv({ cls: 'mod-warning' });
                debouncing_time_warningEl.style.display = 'none';  // Initially hide the warning
                return text
                    .setPlaceholder('Delay in milliseconds')
                    .setValue(`${this.plugin.settings.debouncingTime}`)
                    .onChange(async (value) => {
                        // Remove any previous warning text
                        debouncing_time_warningEl.textContent = '';

                        // Try to parse the input as an integer
                        const parsedValue = parseInt(value, 10);

                        // Check if the value is a valid number and greater than or equal to 0
                        if (isNaN(parsedValue) || parsedValue < 0) {
                            // Show warning if the input is invalid
                            debouncing_time_warningEl.textContent = 'Please enter a valid number for the delay.';
                            debouncing_time_warningEl.style.display = 'block';
                        } else {
                            // Hide the warning and save the valid value
                            debouncing_time_warningEl.style.display = 'none';
                            this.plugin.settings.debouncingTime = parsedValue;
                            this.plugin.saveSettings();
                        }
                    });
            });

        debouncing_time_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.debouncingTime;
                    debouncing_time_text.setValue(`${value}`);
                    this.plugin.settings.debouncingTime = value;
                    this.plugin.saveSettings();
                });
        });


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
            })
        });

        debug_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.debug;
                    debug_toggle.setValue(value);
                });
        });
	}

	hide(): void {   
    }
}
