/* eslint-disable @typescript-eslint/no-inferrable-types */

// Import necessary Obsidian API components
import {
	App,
	FileSystemAdapter,
	Plugin,
	Platform,
	PluginManifest,
    Menu,
    TAbstractFile,
    TFolder,
    WorkspaceLeaf,
    MenuItem,
} from "obsidian";

import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS } from "default";
import { RecollSearchLocalSettings, RecollSearchSettings, FileMenuCallback } from "types";

import { monkeyPatchConsole, unpatchConsole } from "patchConsole";

// import { isRecollindexRunning, runRecollIndex, setPluginReference, stopRecollIndex, updateProcessLogging } from "recoll";
import * as recoll from "recoll"
import { getMACAddress, debounceFactoryWithWaitMechanism } from "utils";

import { sep, posix } from "path"

import { RecollqSearchModal } from "RecollqSearchModal";

import { RecollSearchSettingTab } from "settings";

import { homedir } from "os";

// Main plugin class
export default class RecollSearch extends Plugin {
	settings: RecollSearchSettings = { ...DEFAULT_SETTINGS };
    localSettings: RecollSearchLocalSettings = { ...DEFAULT_LOCAL_SETTINGS };
    platform: "win" | "mac" | "linux" | "mobile" | "unknown";
    device_UUID: string; // unique ID assigned to each device
    
    private exit_cb: NodeJS.ExitListener | null = null;
    private sigint_cb: ((...args: any[]) => void) | null = null;
    private sigterm_cb: ((...args: any[]) => void) | null = null;
    private file_menu_cb: FileMenuCallback | null = null;

    private vaultPath: string;
    private homeDir: string;
    
     // Declare class methods that will be initialized in the constructor
    debouncedSaveSettings: (callback?: () => void) => void;
    waitForSaveToComplete: () => Promise<void>;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);

        this.vaultPath = this.getVaultPath();
        this.homeDir = homedir();

        // Set up debounced saving functions
        const timeout_debounced_saving_ms = 100;
        const { debouncedFct, waitFnc } = debounceFactoryWithWaitMechanism(
            async (callback: () => void = (): void => {}) => {
                await this.saveSettings();
                if(callback) callback();
            }, timeout_debounced_saving_ms);
        this.debouncedSaveSettings = debouncedFct;
        this.waitForSaveToComplete = waitFnc;

        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error("The vault folder could not be determined.");
        }

        // Load the UUID of the current device running Obsidian session
        let device_UUID:string|null = localStorage.getItem(this.manifest.id);
        if (!device_UUID) {
            device_UUID = crypto.randomUUID();
            localStorage.setItem(this.manifest.id, device_UUID);
        }
        this.device_UUID = device_UUID;

        // Check what is the current platform
        if(Platform.isMacOS) { 
            this.platform = 'mac';
        } else if(Platform.isWin) {
            this.platform = 'win';
        } else if(Platform.isLinux) {
            this.platform = 'linux';
        } else if(Platform.isMobile) {
            this.platform = 'mobile';
        } else {
            this.platform = 'unknown';
        }
        
        recoll.setPluginReference(this);	
	}

    // Store the path to the vault
    getVaultPath():string {
        if(this.vaultPath) return this.vaultPath;

        if (Platform.isDesktopApp) {
            // store the vault path
            const adapter = this.app.vault.adapter;
            if (!(adapter instanceof FileSystemAdapter)) {
                throw new Error("The vault folder could not be determined.");
            }
            // Normalize to POSIX-style path
            this.vaultPath = adapter.getBasePath().split(posix.sep).join(sep);
            
            return this.vaultPath;
        } else return "";
    }

	// Load plugin settings
	async onload() {
        // Load settings and set `this.registered_MAC_addresses`
        await this.loadSettings(); 

        // add setting tab
        this.addSettingTab(new RecollSearchSettingTab(this.app, this));

       if (process.env.NODE_ENV === "development") {
            monkeyPatchConsole(this);
            console.log("Recoll Search: development mode including extra logging and debug features");
        }
        
        this.app.workspace.onLayoutReady(() => {
            recoll.runRecollIndex();
        });

        this.addCommand({
            id: 'recollq-search',
            name: 'Search files',
            callback: () => {
                const modal = new RecollqSearchModal(this.app,this);
                modal.open();
            }
        });

        this.addDebugCommands(this.settings.debug);

        this.registerEvents();

        // console.log('Loaded plugin Recoll Search');
	}

    addDebugCommands(status:boolean) {
        if(status) {
            this.addCommand({
                id: 'recollindex-restart',
                name: 'Gracefully restart recollindex',
                callback: async () => {
                    recoll.runRecollIndex();
                }
            });

            this.addCommand({
                id: 'recollindex-stop',
                name: 'Gracefully stop recollindex',
                callback: async () => {
                    recoll.stopRecollIndex();
                }
            });

            this.addCommand({
                id: 'recollindex-reindex',
                name: 'Force reindex (recollindex -z option)',
                callback: async () => {
                    recoll.runRecollIndex(["-z"]);
                }
            });
        } else {
            // Safely remove debug commands
            this.app.commands.removeCommand(`${this.manifest.id}:recollindex-restart`);
            this.app.commands.removeCommand(`${this.manifest.id}:recollindex-stop`);
            this.app.commands.removeCommand(`${this.manifest.id}:recollindex-reindex`);
        }
    }

	onunload() {
        // stop recollindex
        recoll.stopRecollIndex();

        // remove registered listeners
        this.unregisterEvents();

        // unpatch console
        unpatchConsole();        
	}

    onquit() {
        recoll.stopRecollIndex();
    }

    registerEvents() {
        this.exit_cb = () => {
            recoll.stopRecollIndex(); // Called when the Node.js process exits normally
        };
        this.sigint_cb = () => {
            recoll.stopRecollIndex();
        }; // Called when Ctrl+C is pressed
        
        this.sigterm_cb = () => {
            recoll.stopRecollIndex();
        }; // Called when a termination request is sent to the process

        this.file_menu_cb = (menu: Menu, file: TAbstractFile, source:string, leaf?: WorkspaceLeaf) => {
            if (file instanceof TFolder) {
                menu.addItem((cb:MenuItem) => 
                    cb.setTitle("Search in folder using recoll")
                        .setIcon("lucide-folder-search")
                        .onClick((evt:MouseEvent | KeyboardEvent) => {
                            const initialQuery = `dir:"${file.path}" `
                            const modal = new RecollqSearchModal(this.app,this,initialQuery);
                            modal.open();
                        })
                );
            }
        }; // Call when the user right-click on some folder in the file navigation pane 

        process.on('exit', this.exit_cb);
        process.on('SIGINT', this.sigint_cb);
        process.on('SIGTERM', this.sigterm_cb);
        this.app.workspace.on("file-menu", this.file_menu_cb);
    }

    unregisterEvents() {
        // Remove event listeners
        if(this.exit_cb) {
            process.off('exit', this.exit_cb);
            this.exit_cb = null;
        }
        if(this.sigint_cb) {
            process.off('SIGINT', this.sigint_cb);
            this.sigint_cb = null;              
        } 
        if(this.sigterm_cb) {
            process.off('SIGTERM', this.sigterm_cb);
            this.sigterm_cb = null;
        }
        if(this.file_menu_cb) {
            this.app.workspace.off("file-menu", this.file_menu_cb);
            this.file_menu_cb = null;
        }
    }

    async onExternalSettingsChange() {
        // Load settings
        await this.loadSettings();

        const activeTab = this.app.setting.activeTab;
        if(activeTab && activeTab instanceof RecollSearchSettingTab) activeTab.display();
    }

	async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.localSettings = Object.assign({}, DEFAULT_LOCAL_SETTINGS, this.settings.localSettings[this.device_UUID]);
	}

    async saveSettings() {
        if(!this.device_UUID) return;
        this.settings.localSettings[this.device_UUID] = this.localSettings;
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

    isConfigured():boolean {
        return this.localSettings.recollindexCmd !== ""
            && this.localSettings.recollqCmd !== ""
            && this.localSettings.recollDataDir !== "";
    }

    // util function replacing placeholders in paths
    replacePlaceholders(path:string):string {
        return path.replace(/\$\{vault_path\}/g,this.vaultPath).replace(/\~/,this.homeDir);
    }
}
