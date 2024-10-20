// obsidian-augment.d.ts

import 'obsidian';

declare module "obsidian" {
    interface App {
        plugins: Plugins;
        commands: Commands;
        setting: Setting;
    }

    interface Setting {
        activeTab: SettingTab;
    }

    interface Commands {
        removeCommand: (cmdId:string)=>void;
    }
    
    interface Plugins {
        manifests: Record<string, PluginManifest>;
        plugins: Record<string, Plugin>;
        getPlugin(id: string): Plugin;
        uninstallPlugin(pluginId: string): Promise<void>;
        getPluginFolder(): string;
    }

    interface Vault {
        writeJson:(dir:string, data:any, { mtime:number }) => Promise<void>;
    }

    interface SuggestModal<T> {
        chooser: Chooser<T>;
        instructionsEl: HTMLElement;
        updateSuggestions(): void;
    }

    interface Chooser<T> {
        values: T[];
        selectedItem: number;
        useSelectedItem: (event?: KeyboardEvent) => void;
        setSuggestions: (items: T[]) => void;
    }
}