/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ClientRelease, selectClientUpdate } from "../src/shared/clientRelease";

const hash = "a".repeat(40);
const release = (): ClientRelease => ({ name: `971 Client ${hash}`, tag_name: "client-123", assets: [{ name: "desktop.asar", browser_download_url: "https://github.com/5lwf/971-client/releases/download/client-123/desktop.asar", digest: `sha256:${"b".repeat(64)}` }] });

test("uses the built release instead of an unbuilt source commit", () => {
    assert.equal(selectClientUpdate(release(), "desktop.asar", "c".repeat(40))?.hash, hash);
    assert.equal(selectClientUpdate(release(), "desktop.asar", hash), null);
});
test("ignores installer-only releases and missing platform assets", () => {
    assert.equal(selectClientUpdate({ ...release(), assets: [] }, "desktop.asar", "old"), null);
    assert.equal(selectClientUpdate({ ...release(), name: "Windows download" }, "desktop.asar", "old"), null);
});
test("refuses unverified downloads and downloads outside the repository", () => {
    const missing = release();
    delete missing.assets[0].digest;
    assert.throws(() => selectClientUpdate(missing, "desktop.asar", "old"), /checksum/);
    const other = release();
    other.assets[0].browser_download_url = "https://github.com/other/client/releases/download/tag/desktop.asar";
    assert.throws(() => selectClientUpdate(other, "desktop.asar", "old"), /outside/);
});
