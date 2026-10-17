/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { currentLyric, LyricStatusWriter, parseLyrics, retryDelay } from "../src/testcordplugins/spotifyLyricsStatus/sync";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("lyrics follow timestamps, repeated timestamps, seeks, and instrumental gaps", () => {
    const lines = parseLyrics("[ar:artist]\n[00:01.20][00:04.00]first\n[00:02.00]second\n[00:03.00]\n");
    assert.equal(lines.length, 4);
    assert.equal(currentLyric(lines, 1000), "");
    assert.equal(currentLyric(lines, 1200), "first");
    assert.equal(currentLyric(lines, 2500), "second");
    assert.equal(currentLyric(lines, 3500), "");
    assert.equal(currentLyric(lines, 4100), "first");
    assert.equal(currentLyric(lines, 2100), "second");
});

test("writer skips duplicates, coalesces fast lines, and restores the previous status", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let status = { text: "original" };
    const writes: string[] = [];
    const writer = new LyricStatusWriter({ read: () => status, write: async value => { status = value; writes.push(value.text); }, make: text => ({ text }), interval: () => 5000, onError: () => assert.fail("unexpected error") });
    writer.setText("line one"); await flush();
    writer.setText("line one"); writer.setText("line two"); writer.setText("line three");
    assert.deepEqual(writes, ["line one"]);
    t.mock.timers.tick(5000); await flush();
    assert.deepEqual(writes, ["line one", "line three"]);
    writer.setText(null);
    t.mock.timers.tick(5000); await flush();
    assert.equal(status.text, "original");
});

test("writer waits for retry_after and discards stale lyrics during the cooldown", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let attempts = 0;
    let status = { text: "original" };
    const writer = new LyricStatusWriter({ read: () => status, write: async value => { if (++attempts === 1) throw { body: { retry_after: 30 } }; status = value; }, make: text => ({ text }), interval: () => 2000, onError: () => {} });
    writer.setText("old lyric"); await flush();
    writer.setText("latest lyric");
    t.mock.timers.tick(29999); await flush(); assert.equal(attempts, 1);
    t.mock.timers.tick(1); await flush(); assert.equal(status.text, "latest lyric");
    writer.setText(null); t.mock.timers.tick(2000); await flush();
    assert.equal(status.text, "original");
    assert.equal(retryDelay(new Error("network")), 60000);
});

test("manual status changes are preserved and long Unicode lyrics fit the status", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let status = { text: "original" };
    const writer = new LyricStatusWriter({ read: () => status, write: async value => { status = value; }, make: text => ({ text }), interval: () => 2000, onError: () => {} });
    writer.setText("🎵".repeat(150)); await flush(); assert.equal(status.text.length, 128); assert.equal([...status.text].length, 64);
    status = { text: "manually edited" };
    writer.setText("next line"); t.mock.timers.tick(5000); await flush();
    writer.setText(null); await flush(); assert.equal(status.text, "manually edited");
});

test("a short retry delay does not override the configured minimum interval", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let attempts = 0;
    let status = { text: "original" };
    const writer = new LyricStatusWriter({ read: () => status, write: async value => { if (++attempts === 1) throw { retry_after: 0 }; status = value; }, make: text => ({ text }), interval: () => 5000, onError: () => {} });
    writer.setText("lyric"); await flush();
    t.mock.timers.tick(4999); await flush(); assert.equal(attempts, 1);
    t.mock.timers.tick(1); await flush(); assert.equal(attempts, 2);
    writer.setText(null); t.mock.timers.tick(5000); await flush();
});

test("stopping during an in-flight status write restores instead of publishing the queued line", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    let complete: (() => void) | undefined;
    let status = { text: "original" };
    const writer = new LyricStatusWriter({ read: () => status, write: async value => { if (!complete) await new Promise<void>(resolve => complete = resolve); status = value; }, make: text => ({ text }), interval: () => 2000, onError: () => {} });
    writer.setText("lyric"); writer.setText("queued"); writer.setText(null);
    complete?.(); await flush();
    t.mock.timers.tick(2000); await flush(); assert.equal(status.text, "original");
});
