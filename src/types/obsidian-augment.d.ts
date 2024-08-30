// obsidian-augment.d.ts

import 'obsidian';

declare module "obsidian" {
    interface App {
        plugins: Plugins;
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
}