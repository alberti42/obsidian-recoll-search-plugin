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

import { DEFAULT_SETTINGS } from "default";
import { RecollSearchSettings as RecollSearchSettings } from "types";

import { monkeyPatchConsole, unpatchConsole } from "patchConsole";

import { runRecollIndex, runRecollIndexDebounced, setDebouncingTime, setPluginReference } from "recoll";
import { debounceFactory } from "utils";

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
    settingsTab: RecollSearchSettingTab;
    menu: Element | null = null;

    runRecollIndexDebounced:()=>void;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);

		if (process.env.NODE_ENV === "development") {
            monkeyPatchConsole(this);
            console.log("Recoll Search: development mode including extra logging and debug features");
        }

        setPluginReference(this);

        this.runRecollIndexDebounced = debounceFactory(runRecollIndex, DEFAULT_SETTINGS.debouncingTime);

		this.settingsTab = new RecollSearchSettingTab(this.app, this);
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

	async loadSettings() {
    	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        setDebouncingTime(this.settings.debouncingTime);
	}

	async saveSettings() {
		
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

        new Setting(containerEl).setName('Indexing').setHeading();
        let debouncing_time_warningEl:HTMLDivElement;
        const debouncing_time_setting = new Setting(containerEl)
            .setName('Debouncing time for recollindex')
            .setDesc(createFragment((frag:DocumentFragment)=> {
                frag.createDiv('A delay in milliseconds to be waited after any change to the vault before recollindex is executed.');
                debouncing_time_warningEl = frag.createDiv({ cls: 'mod-warning' });
            }))
        
        let debouncing_time_text:TextComponent;
        debouncing_time_setting.addText(text => {
                debouncing_time_text = text;
                
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
                            await this.plugin.saveSettings();
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
