/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

async function loadUpdater(digest) {
    const dir = fs.mkdtempSync(join(tmpdir(), "971-update-test-"));
    const archive = join(dir, "desktop.asar");
    fs.writeFileSync(archive, "old client");
    const bytes = Buffer.from("new client");
    const handlers = new Map();
    const release = { name: `971 Client ${"b".repeat(40)}`, tag_name: "new", assets: [{ name: "desktop.asar", browser_download_url: "https://github.com/5lwf/971-client/releases/download/new/desktop.asar", digest: digest ?? `sha256:${createHash("sha256").update(bytes).digest("hex")}` }] };
    const mocks = {
        electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) } },
        "original-fs": fs,
        "@main/utils/http": { fetchJson: async () => release, fetchBuffer: async () => bytes },
        "@shared/vencordUserAgent": { clientRepository: "5lwf/971-client", VENCORD_USER_AGENT: "test" },
        "~git-hash": { default: "a".repeat(40) }
    };
    const result = await build({ entryPoints: ["src/main/updater/http.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: Object.keys(mocks), define: { IS_VESKTOP: "false", IS_EQUIBOP: "false" } });
    vm.runInNewContext(result.outputFiles[0].text, { require: id => id in mocks ? mocks[id] : require(id), __dirname: archive, Buffer, console, URL });
    return { handlers, archive, dir };
}

test("installs a verified archive and does not download it repeatedly before restart", async () => {
    const { handlers, archive, dir } = await loadUpdater();
    try {
        assert.equal((await handlers.get("VencordGetUpdates")()).value.changes.length, 1);
        assert.equal((await handlers.get("VencordBuild")()).ok, true);
        assert.equal(fs.readFileSync(archive, "utf8"), "new client");
        assert.equal((await handlers.get("VencordGetUpdates")()).value.changes.length, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("keeps the installed client unchanged when verification fails", async () => {
    const { handlers, archive, dir } = await loadUpdater(`sha256:${"0".repeat(64)}`);
    try {
        await handlers.get("VencordGetUpdates")();
        assert.equal((await handlers.get("VencordBuild")()).ok, false);
        assert.equal(fs.readFileSync(archive, "utf8"), "old client");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
