/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { ClientRelease, selectClientUpdate } from "@shared/clientRelease";
import { IpcEvents } from "@shared/IpcEvents";
import { clientRepository, VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { createHash } from "crypto";
import { ipcMain } from "electron";
import { renameSync, writeFileSync } from "original-fs";

import gitHash from "~git-hash";

import { ASAR_FILE, serializeErrors, UpdateOutcome } from "./common";

let pending: ReturnType<typeof selectClientUpdate> = null;
let applying: Promise<boolean> | undefined;
let appliedHash = gitHash;

async function fetchUpdates() {
    const release = await fetchJson<ClientRelease>(`https://api.github.com/repos/${clientRepository}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": VENCORD_USER_AGENT }
    });
    pending = selectClientUpdate(release, ASAR_FILE, appliedHash);
    return pending !== null;
}

async function calculateGitChanges() {
    await fetchUpdates();
    return {
        diverged: false,
        changes: pending ? [{ hash: pending.hash, author: "5lwf", message: pending.name }] : []
    };
}

async function applyUpdates() {
    if (applying) return applying;
    const update = pending;
    if (!update) return true;
    applying = (async () => {
        const data = await fetchBuffer(update.url);
        if (createHash("sha256").update(data).digest("hex") !== update.digest)
            throw new Error("The update failed verification. Your installed client was not changed.");
        const temp = `${__dirname}.pending`;
        writeFileSync(temp, data, { flush: true });
        renameSync(temp, __dirname);
        appliedHash = update.hash;
        pending = null;
        return true;
    })();
    try { return await applying; }
    finally { applying = undefined; }
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${clientRepository}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(async (): Promise<UpdateOutcome> => (await fetchUpdates() ? "updated" : "upToDate")));
ipcMain.handle(IpcEvents.FORCE_UPDATE, serializeErrors(async (): Promise<UpdateOutcome> => (await fetchUpdates() ? "updated" : "upToDate")));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
