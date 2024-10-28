// settings.ts

import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS } from "default";
import RecollSearch from "main";
import { App, ButtonComponent, Component, DropdownComponent, ExtraButtonComponent, Notice, Platform, PluginSettingTab, Setting, TextComponent, ToggleComponent } from "obsidian";

import * as recoll from "recoll"
import { AltKeyBehavior } from "types";
import { doesDirectoryExists, doesFileExists, momentJsToDatetime, parseFilePath } from "utils";

const RUNNING = 'running';
const NOT_RUNNING = 'not running';

// Plugin settings tab
export class RecollSearchSettingTab extends PluginSettingTab {
    plugin: RecollSearch;

    constructor(app: App, plugin: RecollSearch) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const local_setting_label_factory = ()=>createFragment((frag:DocumentFragment)=> {
            frag.appendText('This setting only applies to this device with UUID ');
            const uuid_el = createEl('code',{text:this.plugin.device_UUID,cls:'recoll-search-selectable'});
            frag.appendChild(uuid_el);
            frag.appendText('.');
        });

        const { containerEl } = this;
        
        containerEl.empty();
        containerEl.classList.add('recoll-search-settings');

        new Setting(containerEl).setName('Status of recoll indexing engine').setHeading();

        let previous_recollindex_status = recoll.isRecollindexRunning();
        
        let status_span: HTMLElement;
        const status_setting = new Setting(containerEl)
            .setName(createFragment((frag:DocumentFragment) => {
                frag.appendText('Status of recollindex daemon service: ');
                status_span = createSpan({text: previous_recollindex_status ? RUNNING : NOT_RUNNING});
                frag.appendChild(status_span);
            }));
        
        let status_button: ButtonComponent;
        status_setting
        .addButton(button => {
            status_button = button;
            button
            .setCta()
            .setDisabled(true)
            .onClick(async (evt:MouseEvent) => {
                if(previous_recollindex_status) {
                    button.setDisabled(true);
                    await recoll.stopRecollIndex();
                    button.setDisabled(false);
                } else {
                    if(this.plugin.isConfigured()) {
                        button.setDisabled(true);
                        await recoll.runRecollIndex();
                        button.setDisabled(false);
                    } else {
                        new Notice("recollindex cannot start until all paths are configured")
                    }
                }
            });

            if(this.plugin.isConfigured()) {
                recoll.queue.then(() => {
                    status_button.setDisabled(false);
                });
            } else {
                status_button.setDisabled(false);
            }
        });

        const debug_setting = new Setting(containerEl)
            .setName('Show debug infos')
            .setDesc('If this option is enabled, debug infos are shown in the development console. \
                In addition, commands are added to Obsidian Command palette to manually stop and restart recollindex. \
                Note that toggling this option will restart recollindex.');

        let debug_toggle: ToggleComponent;
        debug_setting.addToggle(toggle => {
            debug_toggle = toggle;
            toggle
            .setValue(this.plugin.settings.debug)
            .onChange(async (value: boolean) => {
                this.plugin.settings.debug = value;
                this.plugin.debouncedSaveSettings();
                this.plugin.addDebugCommands(value);
                if(previous_recollindex_status && this.plugin.isConfigured()) {
                    status_button.setDisabled(true);
                    await recoll.runRecollIndex();
                    status_button.setDisabled(false);    
                }
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

        const recoll_engine_paths_heading = new Setting(containerEl).setName('Paths of recoll engine')
            .setHeading()
            .setDesc(createFragment((frag:DocumentFragment) => {
                    frag.appendText("You first need to stop recollindex to be able to change the configurations below. Use the placeholder ");
                    frag.createEl('code',{text:'${vault_path}', cls: 'recoll-search-selectable'});
                    frag.appendText(" if you need to construct a path relative to the vault (e.g., ");
                    frag.createEl('code',{text:'${vault_path}/00 Meta/recoll', cls: 'recoll-search-selectable'});
                    frag.appendText(" for the share/recoll directory).");
                }));

        let recollindex_warning: HTMLElement;
        const recollindex_setting = new Setting(containerEl)
            .setName("Path to recollindex utility")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path to 'recollindex' utility on your computer.");
                frag.appendChild(local_setting_label_factory());
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

                    if (!isEmpty && !await doesFileExists(this.plugin.replacePlaceholders(value))) {
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

        const recollindex_extrabutton = recollindex_setting.addExtraButton((button) => {
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
                frag.appendChild(local_setting_label_factory());
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

                    if (!isEmpty && !await doesFileExists(this.plugin.replacePlaceholders(value))) {
                        recollq_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recollq_warning.style.display = 'none';
                        this.plugin.localSettings.recollqCmd = value;
                        this.plugin.debouncedSaveSettings();
                    }
                })
            });

        const recollq_extrabutton = recollq_setting.addExtraButton((button) => {
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
                frag.appendChild(createEl('code',{text: "/home/your_user/.local/share/recoll/venv", cls: 'recoll-search-selectable'}));
                frag.appendText('). If you followed these instrucitons, you should enter here ');
                frag.appendChild(createEl('code',{text: "YOUR_LOCAL_FOLDER/lib/python3.XYZ/site-packages", cls: 'recoll-search-selectable'}));
                frag.appendText(', where python3.XYZ should be adjusted to the python version your are currenty using.');
                frag.appendChild(local_setting_label_factory());
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

                    if (!isEmpty && !await doesDirectoryExists(this.plugin.replacePlaceholders(value))) {
                        python_path_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        python_path_warning.style.display = 'none';
                        this.plugin.localSettings.pythonPath = value;
                        await this.plugin.debouncedSaveSettings();
                    }
                })
            });

        const python_path_extrabutton = python_path_setting.addExtraButton((button) => {
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
                frag.appendChild(local_setting_label_factory());
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

                    if (!isEmpty && !await doesDirectoryExists(this.plugin.replacePlaceholders(value))) {
                        recoll_datadir_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recoll_datadir_warning.style.display = 'none';
                        this.plugin.localSettings.recollDataDir = value;
                        this.plugin.debouncedSaveSettings();
                    }
                })
            });

        const recoll_datadir_extrabutton = recoll_datadir_setting.addExtraButton((button) => {
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
            .setName("Path to RECOLL_CONFDIR directory")
            .setDesc(createFragment((frag:DocumentFragment) => {
                frag.appendText("Absolute path (RECOLL_CONFDIR) to recoll configuration directory on your computer.");
                frag.appendChild(local_setting_label_factory());
                recoll_confdir_warning = createEl('p',{cls:'mod-warning', text:'Please enter the path of an existing file.'});
                recoll_confdir_warning.style.display = 'none';
                frag.appendChild(recoll_confdir_warning);
            }));

        let recoll_confdir_text:TextComponent;
        recoll_confdir_setting.addText(text => {
                recoll_confdir_text = text;
                text.setPlaceholder('~/.recoll')
                .setValue(this.plugin.localSettings.recollConfDir)
                .onChange(async (value) => {
                    // when the field is empty, we don't consider it as an error,
                    // but simply as no input was provided yet
                    const isEmpty = value === "";

                    if (!isEmpty && !await doesDirectoryExists(this.plugin.replacePlaceholders(value))) {
                        recoll_confdir_warning.style.display = 'block';
                    } else {
                        // Hide the warning and save the valid value
                        recoll_confdir_warning.style.display = 'none';
                        this.plugin.localSettings.recollConfDir = value;
                        this.plugin.debouncedSaveSettings();
                    }
                })
            });

        const recoll_confdir_extrabutton = recoll_confdir_setting.addExtraButton((button) => {
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
                frag.appendChild(local_setting_label_factory());
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
                        
                        // when the field is empty, we don't consider it as an error,
                        // but simply as no input was provided yet
                        const isEmpty = path === "";

                        if (!isEmpty && !await doesDirectoryExists(this.plugin.replacePlaceholders(path))) {
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

        const path_extensions_extrabutton = path_extensions_setting.addExtraButton((button) => {
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

        let LIBRARY_KEYWORD: 'DYLD_LIBRARY_PATH' | 'LD_LIBRARY_PATH' | undefined;
        let LIBNAME: string;
        let LIBPATH_FINDER_COMMAND: string;
        switch(this.plugin.platform) {
        case 'mac':
            LIBRARY_KEYWORD = 'DYLD_LIBRARY_PATH';
            LIBNAME = 'librecoll.XYZ.dylib';
            LIBPATH_FINDER_COMMAND = 'otool -L';
            break;
        case 'linux':
            LIBRARY_KEYWORD = 'LD_LIBRARY_PATH';
            LIBNAME = 'librecoll.XYZ.lib';
            LIBPATH_FINDER_COMMAND = 'ldd'
            break;        
        default:
            LIBRARY_KEYWORD = undefined;
            LIBNAME = 'librecoll.XYZ.dll';
        }

        let library_path_extensions_text:TextComponent;
        let library_path_extensions_extrabutton:Setting;
        if(LIBRARY_KEYWORD) {
            let library_path_extensions_warning:HTMLElement;
            const library_path_extensions_setting = new Setting(containerEl)
                .setName(`Directories to be added to ${LIBRARY_KEYWORD}`)
                .setDesc(createFragment((frag:DocumentFragment) => {
                    frag.appendText(`List of absolute paths to directories separated by ':' that are added to ${LIBRARY_KEYWORD}.`);
                    frag.appendText('Normally, you can leave this field empty. However, if the library');
                    frag.createEl('code', {text:LIBNAME, cls: 'recoll-search-selectable'});
                    frag.appendText(' resides in a nonstandard location, you must provide the path explicitly. \
                        You can find the correct path typing the command in the terminal:');
                    frag.createEl('pre', {text:`${LIBPATH_FINDER_COMMAND} <PATH_TO_RECOLLINDEX>`, cls: 'recoll-search-selectable'});
                    frag.appendChild(local_setting_label_factory());
                    library_path_extensions_warning = createEl('p',{cls:'mod-warning'});
                    library_path_extensions_warning.style.display = 'none';
                    frag.appendChild(library_path_extensions_warning);
                }));
                
            library_path_extensions_setting.addText(text => {
                    library_path_extensions_text = text;
                    text.setPlaceholder('')
                    .setValue(this.plugin.localSettings.libraryPath.join(':'))
                    .onChange(async (value) => {

                        const paths = value.split(':');

                        const errors = (await Promise.all(paths.map(async (path:string):Promise<string|null> => {
                            // Remove any previous warning text
                            library_path_extensions_warning.textContent = '';
                            
                            // when the field is empty, we don't consider it as an error,
                            // but simply as no input was provided yet
                            const isEmpty = path === "";

                            if (!isEmpty && !await doesDirectoryExists(this.plugin.replacePlaceholders(path))) {
                                return `Directory '${path}' does not exist.`;
                            } else return null;
                        }))).filter((error:string|null): error is string => error !==null );

                        if(errors.length>0) {
                            library_path_extensions_warning.innerHTML = errors.join('<br>');
                            library_path_extensions_warning.style.display = 'block';
                        } else {
                            // Hide the warning and save the valid value
                            library_path_extensions_warning.style.display = 'none';
                            this.plugin.localSettings.libraryPath = paths.filter((path:string) => path !== "");
                            this.plugin.debouncedSaveSettings();
                        }
                    })
                });

            library_path_extensions_extrabutton = library_path_extensions_setting.addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip("Reset to default value")
                    .onClick(() => {
                        const values = DEFAULT_LOCAL_SETTINGS.libraryPath;
                        recoll_datadir_text.setValue(values.join(':'));
                        this.plugin.localSettings.libraryPath = values;
                        this.plugin.debouncedSaveSettings();
                    });
            });
        }
        

        const disable_controller = (status:boolean) => {
            recollindex_text.setDisabled(status);
            recollindex_extrabutton.setDisabled(status);

            recollq_text.setDisabled(status);
            recollq_extrabutton.setDisabled(status);

            python_path_text.setDisabled(status);
            python_path_extrabutton.setDisabled(status);

            recoll_datadir_text.setDisabled(status);
            recoll_datadir_extrabutton.setDisabled(status);

            recoll_confdir_text.setDisabled(status);
            recoll_confdir_extrabutton.setDisabled(status);

            path_extensions_text.setDisabled(status);
            path_extensions_extrabutton.setDisabled(status);

            if(LIBRARY_KEYWORD) {
                library_path_extensions_text.setDisabled(status);
                library_path_extensions_extrabutton.setDisabled(status);
            }
            
            if(status) {
                recoll_engine_paths_heading.descEl.classList.add('mod-warning');
            } else {
                recoll_engine_paths_heading.descEl.classList.remove('mod-warning');
            }
        };


        let busy = false;
        // Function to update the status
        const updateStatus = async (force?:boolean) => {
            if(busy) return;
            busy = true;
            let recollindex_status = previous_recollindex_status;
            try{
                recollindex_status = recoll.isRecollindexRunning();
                if(!force && recollindex_status===previous_recollindex_status) return;
                
                if(recollindex_status) {
                    status_span.classList.remove('mod-warning');
                    status_span.classList.add('mod-success')
                    status_span.innerText = RUNNING;
                    status_button.setButtonText("Stop");
                    status_button.setTooltip("Stop recollindex");
                    disable_controller(true);
                } else {
                    status_span.classList.remove('mod-success');
                    status_span.classList.add('mod-warning')
                    status_span.innerText = NOT_RUNNING;
                    status_button.setButtonText("Start");
                    status_button.setTooltip("Start recollindex");
                    disable_controller(false);
                }
            } finally {
                previous_recollindex_status = recollindex_status;
                busy = false;
            }
        }

        // Set an interval to update the status every 300 milliseconds
        setInterval(updateStatus, 200);

        // First call to configure the initial status
        updateStatus(true);

        new Setting(containerEl).setName('Indexing of MarkDown notes').setHeading();

        /*
        const momentjs_format_setting = new Setting(containerEl)
            .setName('Date format used in frontmatter (Javascript momentjs):')
            .setDesc(createFragment((frag) => {
                frag.appendText('Provide the date format that is used in the frontmatter of MarkDown notes. The format is based on ');
                frag.createEl('a', {
                    href: 'https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format',
                    text: 'momentjs',
                });
                frag.appendText(' syntax.');
            }))

        let momentjs_format_text:TextComponent;
        momentjs_format_setting.addText(text => {
            momentjs_format_text = text;
            text.setPlaceholder('Enter date format');
            text.setValue(this.plugin.settings.momentjsFormat);
            text.onChange(async (value: string) => {
                this.plugin.settings.momentjsFormat = value;
                this.plugin.debouncedSaveSettings();
            })
        });

        momentjs_format_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.momentjsFormat;
                    momentjs_format_text.setValue(value);
                    this.plugin.settings.momentjsFormat = value;
                    this.plugin.debouncedSaveSettings();
                });
        });

        const datetime_format_setting = new Setting(containerEl)
            .setName('Date format used in frontmatter (Python datetime):')
            .setDesc(createFragment((frag) => {
                frag.appendText("Provide the date format that is used in the frontmatter of MarkDown notes. The format is based on Python's ");
                frag.createEl('a', {
                    href: 'https://docs.python.org/3/library/datetime.html#format-codes',
                    text: 'datetime',
                });
                frag.appendText(' syntax. If you leave this field empty, an automatic conversion from momentjs to datetime format will be attempted.');
            }))

        let datetime_format_text:TextComponent;
        datetime_format_setting.addText(text => {
            datetime_format_text = text;
            text.setPlaceholder('Enter date format');
            text.setValue(this.plugin.settings.datetimeFormat);
            text.onChange(async (value: string) => {
                if(value.trim()==="") {
                    // attempt automatic conversion
                    value = momentJsToDatetime(momentjs_format_text.getValue());
                    datetime_format_text.setValue(value);
                }
                this.plugin.settings.datetimeFormat = value;
                this.plugin.debouncedSaveSettings();
            })
        });

        datetime_format_setting.addExtraButton((button) => {
            button
                .setIcon("reset")
                .setTooltip("Reset to default value")
                .onClick(() => {
                    const value = DEFAULT_SETTINGS.datetimeFormat;
                    datetime_format_text.setValue(value);
                    this.plugin.settings.datetimeFormat = value;
                    this.plugin.debouncedSaveSettings();
                });
        });

        */

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
