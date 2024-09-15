/* eslint-disable @typescript-eslint/no-inferrable-types */

// Import necessary Obsidian API components
import {
	App,
	FileSystemAdapter,
	Plugin,
	PluginSettingTab,
	Setting,
	Platform,
	PluginManifest,
	TextComponent,
	ToggleComponent,
    EventRef,
    DropdownComponent,
} from "obsidian";

import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS } from "default";
import { RecollSearchLocalSettings, RecollSearchSettings, AltKeyBehavior } from "types";

import { monkeyPatchConsole, unpatchConsole } from "patchConsole";

// import { isRecollindexRunning, runRecollIndex, setPluginReference, stopRecollIndex, updateProcessLogging } from "recoll";
import * as recoll from "recoll"
import { doesDirectoryExists, doesFileExists, getMACAddress, joinPaths, parseFilePath, debounceFactoryWithWaitMechanism } from "utils";

import { sep, posix } from "path"

import { RecollqSearchModal } from "RecollqSearchModal";

// Main plugin class
export default class RecollSearch extends Plugin {
	settings: RecollSearchSettings = { ...DEFAULT_SETTINGS };
    localSettings: RecollSearchLocalSettings = { ...DEFAULT_LOCAL_SETTINGS };
    MACaddress!: string; // initialized by `this.loadSettings()`
    
    private exitListener: NodeJS.ExitListener | null = null;
    private sigintListener: ((...args: any[]) => void) | null = null;
    private sigtermListener: ((...args: any[]) => void) | null = null;

    private vaultPath: string = "";

     // Declare class methods that will be initialized in the constructor
    debouncedSaveSettings: (callback?: () => void) => void;
    waitForSaveToComplete: () => Promise<void>;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);

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

        // For example, triggering the worker when a command is run:
        this.addCommand({
            id: 'recollindex-restart',
            name: 'Gracefully restart recollindex',
            callback: async () => {
                recoll.runRecollIndex();
            }
        });

        this.addCommand({
            id: 'recollq-search',
            name: 'Search files',
            callback: () => {
                const modal = new RecollqSearchModal(this.app,this);
                modal.open();
            }
        });

        this.registerEvents();

        // console.log('Loaded plugin Recoll Search');
	}

	onunload() {
        recoll.stopRecollIndex();
        this.unregisterEvents();

        // unpatch console
        unpatchConsole();
	}

    onquit() {
        recoll.stopRecollIndex();
    }

    registerEvents() {
        // Registering the shutdown hooks
        this.exitListener = () => {
            recoll.stopRecollIndex(); // Called when the Node.js process exits normally
        };
        this.sigintListener = () => {
            recoll.stopRecollIndex();
        }; // Called when Ctrl+C is pressed
        this.sigtermListener = () => {
            recoll.stopRecollIndex();
        }; // Called when a termination request is sent to the process

        process.on('exit', this.exitListener);
        process.on('SIGINT', this.sigintListener);
        process.on('SIGTERM', this.sigtermListener);
    }

    unregisterEvents() {
        // Remove event listeners
        if(this.exitListener) process.off('exit', this.exitListener);
        if(this.sigintListener) process.off('SIGINT', this.sigintListener);
        if(this.sigtermListener) process.off('SIGTERM', this.sigtermListener);
    }

	async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        const registered_MAC_addresses = Object.keys(this.settings.localSettings);
        this.MACaddress = getMACAddress(registered_MAC_addresses);
        this.localSettings = Object.assign({}, DEFAULT_LOCAL_SETTINGS, this.settings.localSettings[this.MACaddress]);
	}

    async saveSettings() {
        if(!this.MACaddress) return;
        this.settings.localSettings[this.MACaddress] = this.localSettings;
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
        const LOCALHOST_SETTING = `This setting applies to this local host with MAC address ${this.plugin.MACaddress}.`;

		const { containerEl } = this;
        
		containerEl.empty();
        containerEl.classList.add('recoll-search-settings');

        new Setting(containerEl).setName('Status of recoll indexing engine').setHeading();

        const recollindex_status = recoll.isRecollindexRunning();
        const status_label = recollindex_status ? "running" : "not running"

        let status_span: HTMLElement;
        const status_setting = new Setting(containerEl)
            .setName(createFragment((frag:DocumentFragment) => {
                frag.appendText('Status of recollindex daemon service: ');
                status_span = createSpan();
                frag.appendChild(status_span);
            }));   

        let busy = false;
        // Function to update the status
        const updateStatus = async () => {
            if(busy) return;
            busy = true;
            const recollindex_status = recoll.isRecollindexRunning();
            const status_label = recollindex_status ? "running" : "not running"
            status_span.innerText = status_label;
            if(recollindex_status) {
                status_span.classList.remove('mod-warning');
                status_span.classList.add('mod-success')
            } else {
                status_span.classList.remove('mod-success');
                status_span.classList.add('mod-warning')
            }
            busy = false;
        }

        // Set an interval to update the status every 300 milliseconds
        setInterval(updateStatus, 200);

        // First call to configure the initial status
        updateStatus();

        const debug_setting = new Setting(containerEl)
            .setName('Show debug infos')
            .setDesc('If this option is enabled, debug infos are shown in the development console. Note that toggling this option will restart recollindex.');

        let debug_toggle: ToggleComponent;
        debug_setting.addToggle(toggle => {
            debug_toggle = toggle;
            toggle
            .setValue(this.plugin.settings.debug)
            .onChange(async (value: boolean) => {
                this.plugin.settings.debug = value;
                this.plugin.debouncedSaveSettings();
                recoll.runRecollIndex();
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

        new Setting(containerEl).setName('Paths of recoll engine').setHeading();

        let recollindex_warning: HTMLElement;
        const recollindex_setting = new Setting(containerEl)
            .setName("Path to recollindex utility")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path to 'recollindex' utility on your computer.");
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                recollindex_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                recollindex_warning.style.display = 'none';
                frag.appendChild(recollindex_warning);
            }));

        let recollindex_text:TextComponent;
        recollindex_setting.addText(text => {
                recollindex_text = text;
                text.setPlaceholder('/usr/local/bin/recollindex')
                .setValue(this.plugin.localSettings.recollindexCmd)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesFileExists(value)) {
                        recollindex_warning.textContent = "Please enter the path of an existing file.";
                        recollindex_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recollindex_warning.style.display = 'none';
                        this.plugin.localSettings.recollindexCmd = value;
                        this.plugin.debouncedSaveSettings();
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
                    this.plugin.debouncedSaveSettings();
                });
        });

        let recollq_warning: HTMLElement;
        const recollq_setting = new Setting(containerEl)
            .setName("Path to recollq utility")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path to 'recollq' utility on your computer.");
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                recollq_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                recollq_warning.style.display = 'none';
                frag.appendChild(recollq_warning);
            }));

        let recollq_text:TextComponent;
        recollq_setting.addText(text => {
                recollq_text = text;
                text.setPlaceholder('/usr/local/bin/recollq')
                .setValue(this.plugin.localSettings.recollqCmd)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesFileExists(value)) {
                        recollq_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recollq_warning.style.display = 'none';
                        this.plugin.localSettings.recollqCmd = value;
                        this.plugin.debouncedSaveSettings();
                    }
                })
            });

        recollq_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_LOCAL_SETTINGS.recollqCmd;
                    recollq_text.setValue(value);
                    this.plugin.localSettings.recollqCmd = value;
                    this.plugin.debouncedSaveSettings();
                });
        });

        let python_path_warning: HTMLElement;
        const python_path_setting = new Setting(containerEl)
            .setName("Path to site-packages directory")
            .setDesc(createFragment((frag) => {
                frag.appendText("Absolute path (PYTHONPATH) to 'site-packages' directory on your computer, which contains the python module 'recoll'. \
                It is highly recommend to install Python's recoll module in a virtual environment, where all other Python's modules, which \
                are needed to index your documents, are also installed. You can create a virtual environment by typing on your terminal:");
                frag.appendChild(createEl('pre',{text: "python3 -m venv YOUR_LOCAL_FOLDER", cls: 'recoll-search-selectable'}));
                frag.appendText('where YOUR_LOCAL_FOLDER must be replaced with the intended location on your computer (e.g., ');
                frag.appendChild(createEl('em',{text: "/home/your_user/.local/share/recoll/venv", cls: 'recoll-search-selectable'}));
                frag.appendText('). If you followed these instrucitons, you should enter here ');
                frag.appendChild(createEl('em',{text: "YOUR_LOCAL_FOLDER/lib/python3.XYZ/site-packages", cls: 'recoll-search-selectable'}));
                frag.appendText(', where python3.XYZ should be adjusted to the python version your are currenty using.');
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                python_path_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                python_path_warning.style.display = 'none';
                frag.appendChild(python_path_warning);
            }));

        let python_path_text:TextComponent;
        python_path_setting.addText(text => {
                python_path_text = text;
                text.setPlaceholder('site-packages')
                .setValue(this.plugin.localSettings.pythonPath)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(value)) {
                        python_path_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        python_path_warning.style.display = 'none';
                        this.plugin.localSettings.pythonPath = value;
                        await this.plugin.debouncedSaveSettings();
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
                    this.plugin.debouncedSaveSettings();
                });
        });

        let recoll_datadir_warning:HTMLElement;
        const recoll_datadir_setting = new Setting(containerEl)
            .setName("Path to share/recoll directory")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path (RECOLL_DATADIR) to recoll data directory 'share/recoll' on your computer.");
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                recoll_datadir_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                recoll_datadir_warning.style.display = 'none';
                frag.appendChild(recoll_datadir_warning);
            }));

        let recoll_datadir_text:TextComponent;
        recoll_datadir_setting.addText(text => {
                recoll_datadir_text = text;
                text.setPlaceholder('/usr/local/share/recoll')
                .setValue(this.plugin.localSettings.recollDataDir)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(value)) {
                        recoll_datadir_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recoll_datadir_warning.style.display = 'none';
                        this.plugin.localSettings.recollDataDir = value;
                        this.plugin.debouncedSaveSettings();
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
                    this.plugin.debouncedSaveSettings();
                });
        });

        let recoll_confdir_warning:HTMLElement;
        const recoll_confdir_setting = new Setting(containerEl)
            .setName("Path to share/recoll directory")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path (RECOLL_CONFDIR) to recoll configuration directory on your computer.");
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                recoll_confdir_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                recoll_confdir_warning.style.display = 'none';
                frag.appendChild(recoll_confdir_warning);
            }));

        let recoll_confdir_text:TextComponent;
        recoll_confdir_setting.addText(text => {
                recoll_confdir_text = text;
                text.setPlaceholder('/usr/local/share/recoll')
                .setValue(this.plugin.localSettings.recollConfDir)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(value)) {
                        recoll_confdir_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recoll_confdir_warning.style.display = 'none';
                        this.plugin.localSettings.recollConfDir = value;
                        this.plugin.debouncedSaveSettings();
                    }
                })
            });

        recoll_confdir_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_LOCAL_SETTINGS.recollConfDir;
                    recoll_confdir_text.setValue(value);
                    this.plugin.localSettings.recollConfDir = value;
                    this.plugin.debouncedSaveSettings();
                });
        });

        let path_extensions_warning:HTMLElement;
        const path_extensions_setting = new Setting(containerEl)
            .setName("Directories to be added to $PATH")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("List of absolute paths to directories separated by ':' that are added to $PATH.");
                frag.appendChild(createEl('p',{text:LOCALHOST_SETTING}));
                path_extensions_warning = createEl('p',{cls:'mod-warning'});
                path_extensions_warning.style.display = 'none';
                frag.appendChild(path_extensions_warning);
            }));
            
        let path_extensions_text:TextComponent;
        path_extensions_setting.addText(text => {
                path_extensions_text = text;
                text.setPlaceholder('/usr/local/bin')
                .setValue(this.plugin.localSettings.pathExtensions.join(':'))
                .onChange(async (value) => {

                    const paths = value.split(':');

                    const errors = (await Promise.all(paths.map(async (path:string):Promise<string|null> => {
                        // Remove any previous warning text
                        path_extensions_warning.textContent = '';
                        const parsedPath = parseFilePath(path);

                        // when the field is empty, we don't consider it as an error,
                        // but simply as no input was provided yet
                        const isEmpty = path === "";

                        if (!isEmpty && !await doesDirectoryExists(path)) {
                            return `Directory '${path}' does not exist.`;
                        } else return null;
                    }))).filter((error:string|null): error is string => error !==null );

                    if(errors.length>0) {
                        path_extensions_warning.innerHTML = errors.join('<br>');
                        path_extensions_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        path_extensions_warning.style.display = 'none';
                        this.plugin.localSettings.pathExtensions = paths.filter((path:string) => path !== "");
                        this.plugin.debouncedSaveSettings();
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
                    this.plugin.debouncedSaveSettings();
                });
        });

        new Setting(containerEl).setName('Indexing of MarkDown notes').setHeading();

        const date_format_setting = new Setting(containerEl)
            .setName('Date format used in frontmatter:')
            .setDesc(createFragment((frag) => {
                frag.appendText('Choose the date format that is used in the frontmatter of MarkDown notes. The format is based on ');
                frag.createEl('a', {
                    href: 'https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format',
                    text: 'momentjs',
                });
                frag.appendText(' syntax.');
            }))

        let date_format_text:TextComponent;
        date_format_setting.addText(text => {
            date_format_text = text;
            text.setPlaceholder('Enter date format');
            text.setValue(this.plugin.settings.dateFormat);
            text.onChange(async (value: string) => {
                this.plugin.settings.dateFormat = value;
                this.plugin.debouncedSaveSettings();
            })
        });

        date_format_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.dateFormat;
                    date_format_text.setValue(value);
                    this.plugin.settings.dateFormat = value;
                    this.plugin.debouncedSaveSettings();
                });
        });


        const create_label_setting = new Setting(containerEl)
            .setName("Creation date label")
            .setDesc("Enter the name of the property used in the frontmatter of your MarkDown notes to store the creation date. \
                If this field is left empty, the file's creation date is used instead, regardless of the date provided in the frontmatter of your note.");

        let create_label_text:TextComponent;
        create_label_setting.addText(text => {
                create_label_text = text;
                text.setPlaceholder('created')
                .setValue(this.plugin.settings.createdLabel)
                .onChange(async (value) => {
                    if(value.trim()==="") value = "";
                    this.plugin.settings.createdLabel = value;
                    await this.plugin.debouncedSaveSettings();
                })
            });

        create_label_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.createdLabel;
                    create_label_text.setValue(value);
                    this.plugin.settings.createdLabel = value;
                    this.plugin.debouncedSaveSettings();
                });
        });


        const modify_label_setting = new Setting(containerEl)
            .setName("Modification date label")
            .setDesc("Enter the name of the property used in the frontmatter of your MarkDown notes to store the modification date. \
                If this field is left empty, the file's modification date is used instead, regardless of the date provided in the frontmatter of your note.");

        let modify_label_text:TextComponent;
        modify_label_setting.addText(text => {
                modify_label_text = text;
                text.setPlaceholder('modified')
                .setValue(this.plugin.settings.modifiedLabel)
                .onChange(async (value) => {
                    if(value.trim()==="") value = "";
                    this.plugin.settings.modifiedLabel = value;
                    await this.plugin.debouncedSaveSettings();
                })
            });

        modify_label_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.modifiedLabel;
                    modify_label_text.setValue(value);
                    this.plugin.settings.modifiedLabel = value;
                    this.plugin.debouncedSaveSettings();
                });
        });


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

        new Setting(containerEl).setName('Obsidian integration').setHeading();

        let altSymbol;
        if (Platform.isMacOS) {
            altSymbol = '⌥';
        } else { // Default to Windows/Linux bindings
            altSymbol = 'Alt';
        }
        const alt_key_behavior = new Setting(containerEl)
            .setName(`Modifier key ${altSymbol}:`)
            .setDesc(`Choose how notes should be opened when the modifier key ${altSymbol} is pressed.`);

        let alt_key_dropdown:DropdownComponent;
        alt_key_behavior.addDropdown(dropdown => {
            alt_key_dropdown = dropdown; 
            dropdown.addOption(AltKeyBehavior.TAB, 'In a new tab');
            dropdown.addOption(AltKeyBehavior.SPLIT, 'In a split pane');
            dropdown.addOption(AltKeyBehavior.WINDOW, 'In a new window');
            dropdown.setValue(this.plugin.settings.altKeyBehavior)
            .onChange(async (value: string) => {
                if (Object.values(AltKeyBehavior).includes(value as AltKeyBehavior)) {
                this.plugin.settings.altKeyBehavior = value as AltKeyBehavior;
                    await this.plugin.debouncedSaveSettings();
                } else {
                    console.error('Invalid option selection:', value);
                }
        })});

        alt_key_behavior.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.altKeyBehavior;
                    alt_key_dropdown.setValue(value);
                    this.plugin.settings.altKeyBehavior = value;
                    this.plugin.debouncedSaveSettings();
                });
        });



	}

	hide(): void {   
    }
}
