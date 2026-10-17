/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { SpotifyStore } from "@webpack/common";

import { currentLyric, LyricLine, LyricStatusWriter, parseLyrics } from "./sync";

const logger = new Logger("SpotifyLyricsStatus");
const settings = definePluginSettings({
    interval: {
        type: OptionType.NUMBER,
        description: "Minimum seconds between status updates. Faster updates may cause Discord rate limits. Short lyric lines may be skipped.",
        default: 5,
        minimum: 2,
        maximum: 60,
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Lyric timing adjustment in milliseconds. Positive values show the next line earlier.",
        default: 0,
        minimum: -10000,
        maximum: 10000,
    },
    prefix: {
        type: OptionType.STRING,
        description: "Text before each lyric line.",
        default: "🎵 ",
    }
});

interface CustomStatus { text: string; emojiId: string; emojiName: string; expiresAtMs?: string; createdAtMs?: string; }
interface PlayerState { track: { id: string; name: string; duration: number; artists: { name: string; }[]; } | null; isPlaying: boolean; position: number; }
const customStatus = getUserSettingLazy<CustomStatus>("status", "customStatus");
const writer = new LyricStatusWriter<CustomStatus>({
    read: () => customStatus?.getSetting() ?? { text: "", emojiId: "0", emojiName: "" },
    write: async value => {
        if (!customStatus) throw new Error("Discord custom status is not available.");
        await customStatus.updateSetting(value);
    },
    make: text => ({ text, emojiId: "0", emojiName: "", expiresAtMs: "0", createdAtMs: String(Date.now()) }),
    interval: () => Math.max(2, settings.store.interval) * 1000,
    onError: error => logger.warn("Status updates paused before retrying. Discord may have rate limited the request.", error)
});

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;
let playback: PlayerState | null = null;
let observedAt = 0;
let trackId = "";
let lines: LyricLine[] = [];
let request: AbortController | undefined;
const cache = new Map<string, LyricLine[]>();

async function loadLyrics(track: NonNullable<PlayerState["track"]>) {
    request?.abort();
    lines = cache.get(track.id) ?? [];
    if (cache.has(track.id)) return;
    const controller = new AbortController();
    request = controller;
    const query = new URLSearchParams({ track_name: track.name, artist_name: track.artists[0]?.name ?? "", duration: String(Math.round(track.duration / 1000)) });
    try {
        const response = await fetch(`https://lrclib.net/api/get?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok && response.status !== 404) throw new Error(`Lyrics service returned ${response.status}.`);
        const data: { syncedLyrics?: string; } = response.ok ? await response.json() : {};
        const parsed = data.syncedLyrics ? parseLyrics(data.syncedLyrics) : [];
        if (!running || controller.signal.aborted || trackId !== track.id) return;
        cache.set(track.id, parsed);
        if (cache.size > 30) cache.delete(cache.keys().next().value ?? "");
        lines = parsed;
    } catch (error) {
        if (!controller.signal.aborted) logger.warn("Timed lyrics are unavailable for this track.", error);
    }
}

function tick() {
    if (!running) return;
    if (isPluginEnabled("LyricsStatus") || isPluginEnabled("AnimatedStatus")) {
        writer.setText(null);
        return;
    }
    const state = playback;
    if (!state?.track || !state.isPlaying) { writer.setText(null); return; }
    const { track } = state;
    if (track.id !== trackId) {
        trackId = track.id;
        lines = [];
        void loadLyrics(track);
    }
    const position = state.position + Date.now() - observedAt + settings.store.delay;
    const line = position < track.duration ? currentLyric(lines, position) : "";
    writer.setText(line ? settings.store.prefix + line : null);
}

export default definePlugin({
    name: "SpotifyLyricsStatus",
    description: "Follows Spotify's current lyric line in your custom status. Frequent updates can trigger Discord rate limits.",
    authors: [Devs.Kbk],
    dependencies: ["UserSettingsAPI"],
    settings,
    settingsAboutComponent: () => <>
        <Paragraph>Connect Spotify to Discord, then play a song. Synced lyrics are provided by LRCLIB; some tracks have no timed lyrics. Your previous status is restored when playback pauses or this plugin stops. A manual status edit pauses lyric updates until you toggle the plugin again.</Paragraph>
        <details><summary>⚠️ API and rate limit warning — click to reveal</summary>
            <Paragraph>Updating your status for every lyric line makes frequent requests to Discord. This may be too much for the API and can cause temporary rate limits. No interval guarantees that you will avoid them. The plugin skips duplicate and short-lived lines, waits after errors, and respects a reported retry delay. Disable LyricsStatus and AnimatedStatus so they do not compete for your status.</Paragraph>
        </details>
    </>,
    flux: {
        SPOTIFY_PLAYER_STATE(event: PlayerState) {
            playback = event;
            observedAt = Date.now();
            tick();
        }
    },
    start() {
        running = true;
        writer.resume();
        const track = SpotifyStore.getTrack();
        const activity = SpotifyStore.getActivity();
        if (track && activity?.timestamps?.start) {
            const start = activity.timestamps.start < 1e12 ? activity.timestamps.start * 1000 : activity.timestamps.start;
            playback = { track, isPlaying: true, position: Math.max(0, Date.now() - start) };
            observedAt = Date.now();
        }
        timer = setInterval(tick, 500);
        tick();
    },
    stop() {
        running = false;
        if (timer) clearInterval(timer);
        timer = undefined;
        request?.abort();
        request = undefined;
        playback = null;
        trackId = "";
        lines = [];
        writer.setText(null);
    }
});
