/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginHealth } from "@api/PluginHealth";
import { isPluginEnabled, pluginRequiresRestart, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { getPluginId } from "@utils/pluginIds";
import type { Plugin } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const SNAPSHOT_KEY = "971Client_SharePlugins_previousEnabled";

interface PluginCatalog {
    plugins: Plugin[];
    ids: string[];
    index: Map<string, number>;
    fingerprint: string;
}

let pluginCatalog: PluginCatalog | undefined;

// Resolve the registry only when a share action is used. SharePlugins is
// itself loaded while the registry is being built, so importing ~plugins here
// creates a circular import that can abort client startup.
function getPluginCatalog(): PluginCatalog {
    if (pluginCatalog) return pluginCatalog;

    const registry = window.Vencord?.Plugins?.plugins;
    if (!registry) throw new Error("The plugin registry is not ready yet. Try again in a moment.");

    const plugins = Object.values(registry)
        .filter((plugin): plugin is Plugin => Boolean(plugin && typeof plugin.name === "string" && !plugin.required && !plugin.name.endsWith("API")))
        .sort((a, b) => getPluginId(a).localeCompare(getPluginId(b)));
    const ids = plugins.map(getPluginId);
    const index = new Map(ids.map((id, position) => [id, position]));

    let hash = 2166136261;
    for (const char of ids.join("\0")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);

    return pluginCatalog = {
        plugins,
        ids,
        index,
        fingerprint: (hash >>> 0).toString(36),
    };
}

export interface DecodedProfile {
    enabledIds: string[];
    compatible: boolean;
}

function toBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function makeProfileMessage() {
    const catalog = getPluginCatalog();
    const bits = new Uint8Array(Math.ceil(catalog.ids.length / 8));
    for (const plugin of catalog.plugins) {
        if (!isPluginEnabled(plugin.name)) continue;
        const index = catalog.index.get(getPluginId(plugin));
        if (index !== undefined) bits[index >> 3] |= 1 << (index & 7);
    }

    const payload = `971CLIENT:1:${catalog.fingerprint}:${toBase64(bits)}`;
    const count = catalog.plugins.filter(plugin => isPluginEnabled(plugin.name)).length;
    const content = `971 Client plugin profile · ${count} enabled\n||${payload}||`;
    if (content.length > 1900) throw new Error("This plugin profile is too large to send in one Discord message.");
    return content;
}

export function decodeProfile(content: string): DecodedProfile | null {
    const match = content.match(/\|\|971CLIENT:1:([a-z0-9]+):([A-Za-z0-9+/=]+)\|\|/);
    if (!match) return null;

    try {
        const catalog = getPluginCatalog();
        const bits = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
        const compatible = match[1] === catalog.fingerprint && bits.length === Math.ceil(catalog.ids.length / 8);
        return {
            compatible,
            enabledIds: compatible ? catalog.ids.filter((_, index) => (bits[index >> 3] & (1 << (index & 7))) !== 0) : [],
        };
    } catch {
        return null;
    }
}

function setEnabled(plugin: Plugin, enabled: boolean) {
    const id = getPluginId(plugin);
    Settings.plugins[id] ??= { enabled: false };
    Settings.plugins[id].enabled = enabled;
    if (id !== plugin.name) {
        Settings.plugins[plugin.name] ??= { enabled: false };
        Settings.plugins[plugin.name].enabled = enabled;
    }
    void PluginHealth.recordPluginChange(id, enabled);
}

export interface ApplyResult {
    changed: number;
    restartNeeded: boolean;
    failed: string[];
}

export async function applyPluginSet(enabledIds: string[], saveUndo: boolean): Promise<ApplyResult> {
    const catalog = getPluginCatalog();
    if (saveUndo) {
        const previous = catalog.plugins.filter(plugin => isPluginEnabled(plugin.name)).map(getPluginId);
        await DataStore.set(SNAPSHOT_KEY, previous);
        window.dispatchEvent(new Event("971-plugin-share-snapshot"));
    }

    const desired = new Set(enabledIds);
    let changed = 0;
    let restartNeeded = false;
    const failed: string[] = [];

    for (const plugin of catalog.plugins) {
        const id = getPluginId(plugin);
        if (!isPluginEnabled(plugin.name) || desired.has(id)) continue;

        if (pluginRequiresRestart(plugin)) {
            setEnabled(plugin, false);
            restartNeeded = true;
        } else if (!plugin.started || stopPlugin(plugin)) {
            setEnabled(plugin, false);
        } else {
            failed.push(plugin.name);
            continue;
        }
        changed++;
    }

    for (const id of desired) {
        const index = catalog.index.get(id);
        const plugin = index === undefined ? undefined : catalog.plugins[index];
        if (!plugin || isPluginEnabled(plugin.name)) continue;

        const dependencies = startDependenciesRecursive(plugin);
        if (dependencies.failures.length) {
            failed.push(`${plugin.name} (dependencies)`);
            continue;
        }

        if (dependencies.restartNeeded || pluginRequiresRestart(plugin)) {
            setEnabled(plugin, true);
            restartNeeded = true;
        } else {
            setEnabled(plugin, true);
            if (!startPlugin(plugin)) {
                setEnabled(plugin, false);
                failed.push(plugin.name);
                continue;
            }
        }
        changed++;
    }

    return { changed, restartNeeded, failed };
}

export async function readSnapshot(): Promise<string[] | null> {
    const value = await DataStore.get<unknown>(SNAPSHOT_KEY);
    return Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : null;
}

export async function clearSnapshot() {
    await DataStore.del(SNAPSHOT_KEY);
    window.dispatchEvent(new Event("971-plugin-share-snapshot"));
}

export function reportApplied(result: ApplyResult) {
    if (result.failed.length) {
        showToast(`Some plugins could not be changed: ${result.failed.slice(0, 3).join(", ")}`, Toasts.Type.FAILURE);
    } else if (result.restartNeeded) {
        showToast(`Plugin profile applied. Restart 971 Client to finish ${result.changed} changes.`, Toasts.Type.SUCCESS);
    } else {
        showToast(`Plugin profile applied. ${result.changed} plugins changed.`, Toasts.Type.SUCCESS);
    }
}
