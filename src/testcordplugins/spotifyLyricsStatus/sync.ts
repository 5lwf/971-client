/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LyricLine { time: number; text: string; }

export function parseLyrics(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    for (const raw of lrc.split("\n")) {
        const text = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
        for (const match of raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g))
            lines.push({ time: (Number(match[1]) * 60 + Number(match[2])) * 1000, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

export function currentLyric(lines: LyricLine[], position: number) {
    let text = "";
    for (const line of lines) {
        if (line.time > position) break;
        text = line.text;
    }
    return text;
}

export function retryDelay(error: unknown): number {
    if (typeof error !== "object" || error === null) return 60_000;
    const value = error as { retry_after?: unknown; body?: { retry_after?: unknown; }; response?: { body?: { retry_after?: unknown; }; }; };
    const seconds = Number(value.retry_after ?? value.body?.retry_after ?? value.response?.body?.retry_after);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1000, Math.ceil(seconds * 1000)) : 60_000;
}

interface Status { text: string; }

export class LyricStatusWriter<T extends Status> {
    private desired: string | null = null;
    private original: T | undefined;
    private ownedText: string | undefined;
    private busy = false;
    private nextAt = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private suspended = false;

    constructor(private options: {
        read: () => T;
        write: (value: T) => Promise<void>;
        make: (text: string) => T;
        interval: () => number;
        onError: (error: unknown) => void;
        now?: () => number;
    }) { }

    setText(text: string | null) {
        let clipped = "";
        for (const character of text ?? "") {
            if (clipped.length + character.length > 128) break;
            clipped += character;
        }
        this.desired = text === null ? null : clipped;
        this.pump();
    }

    resume() { this.suspended = false; }

    private pump() {
        if (this.busy || this.timer || this.suspended) return;
        const { read, write, make, interval, onError } = this.options;
        const now = this.options.now?.() ?? Date.now();
        if (this.desired === null && !this.original) return;
        if (this.desired !== null && this.desired === this.ownedText) return;
        if (this.ownedText !== undefined && read().text !== this.ownedText) {
            this.original = undefined;
            this.ownedText = undefined;
            this.suspended = true;
            return;
        }
        if (now < this.nextAt) {
            this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, this.nextAt - now);
            return;
        }
        const restoring = this.desired === null;
        const value = restoring ? this.original : make(this.desired ?? "");
        if (!value) return;
        this.original ??= { ...read() };
        this.busy = true;
        this.nextAt = now + interval();
        void write(value).then(() => {
            this.ownedText = restoring ? undefined : value.text;
            if (restoring) this.original = undefined;
        }, error => {
            this.nextAt = (this.options.now?.() ?? Date.now()) + retryDelay(error);
            if (restoring) {
                this.original = undefined;
                this.ownedText = undefined;
                this.suspended = true;
            }
            onError(error);
        }).finally(() => { this.busy = false; this.pump(); });
    }
}
