/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchBuffer } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { app, ipcMain } from "electron";
import { unzipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "original-fs";
import { basename, dirname, join } from "path";

import { SETTINGS_DIR } from "./utils/constants";

const RELEASE_URL = "https://github.com/hdrover/discord-drover/releases/download/v0.9/drover-v0.9.zip";
const RELEASE_HASH = "9bd4f5e27ccd0e195ea0ffc5822d3057d8aad700b44b97067ab91fdb67c861a1";
const resultPath = join(SETTINGS_DIR, "drover-result.txt");
const supported = process.platform === "win32" && IS_DISCORD_DESKTOP && /^discord(?:canary|ptb)?\.exe$/i.test(basename(process.execPath));
let preparing = false;
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

ipcMain.handle(IpcEvents.DROVER_STATUS, () => {
    const ini = join(dirname(process.execPath), "drover.ini");
    const direct = supported && existsSync(ini) && /^proxy\s*=\s*$/mi.test(readFileSync(ini, "utf8")) && existsSync(join(dirname(ini), "version.dll"));
    const result = existsSync(resultPath) ? readFileSync(resultPath, "utf8").trim() : "";
    return { supported, direct, message: !supported ? "Drover Direct is available in Discord desktop on Windows." : result.startsWith("Direct failed:") ? result : direct ? "Direct mode is installed. Restart Discord after applying changes." : "Direct mode is ready to install." };
});

ipcMain.handle(IpcEvents.DROVER_DIRECT, async () => {
    if (!supported) throw new Error("Drover requires Discord desktop on Windows.");
    if (preparing) throw new Error("Drover is already preparing. Please wait.");
    preparing = true;
    try {
        const archive = await fetchBuffer(RELEASE_URL);
        if (sha256(archive) !== RELEASE_HASH) throw new Error("The Drover download failed verification. No files were changed.");
        const files = unzipSync(archive);
        const findFile = (name: string) => {
            const key = Object.keys(files).find(path => path.split("/").pop() === name);
            if (!key) throw new Error(`The official download is missing ${name}.`);
            return files[key];
        };
        const dll = findFile("version.dll");
        const target = join(dirname(process.execPath), "version.dll");
        if (existsSync(target) && sha256(readFileSync(target)) !== sha256(dll))
            throw new Error("Another version.dll is installed. Remove it using its original installer before applying Drover.");
        mkdirSync(SETTINGS_DIR, { recursive: true });
        const stage = mkdtempSync(join(SETTINGS_DIR, "drover-"));
        writeFileSync(join(stage, "version.dll"), dll);
        writeFileSync(join(stage, "drover-packet.bin"), findFile("drover-packet.bin"));
        writeFileSync(join(stage, "drover.ini"), "[drover]\r\nproxy=\r\n");
        const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
        const script = `$ErrorActionPreference='Stop'
$exe=${quote(process.execPath)}
$stage=${quote(stage)}
$log=${quote(resultPath)}
try {
    $deadline=(Get-Date).AddSeconds(60)
    do {
        $running=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe })
        if ($running.Count -eq 0) { break }
        if ((Get-Date) -gt $deadline) { throw 'Discord did not close. No Drover files were changed.' }
        Start-Sleep -Milliseconds 500
    } while ($true)
    $target=Split-Path -LiteralPath $exe
    $backup=Join-Path $stage 'backup'
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in @('version.dll','drover.ini','drover-packet.bin')) {
        $path=Join-Path $target $name
        if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination (Join-Path $backup $name) }
    }
    try {
        foreach ($name in @('version.dll','drover.ini','drover-packet.bin')) {
            Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $target $name) -Force
        }
    } catch {
        foreach ($name in @('version.dll','drover.ini','drover-packet.bin')) {
            $old=Join-Path $backup $name
            $dest=Join-Path $target $name
            if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath $old -Destination $dest -Force }
            elseif (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
        }
        throw
    }
    'Direct mode installed.' | Set-Content -LiteralPath $log
} catch { ('Direct failed: ' + $_.Exception.Message) | Set-Content -LiteralPath $log }
Start-Process -FilePath $exe -WindowStyle Hidden
`;
        const scriptPath = join(stage, "install.ps1");
        writeFileSync(scriptPath, script);
        const child = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { detached: true, windowsHide: true, stdio: "ignore" });
        await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
        child.unref();
        setTimeout(() => app.quit(), 750);
    } catch (error) {
        preparing = false;
        throw error;
    }
});
