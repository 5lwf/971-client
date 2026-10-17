/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { RuntimeInteractions, RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { React, RTCConnectionStore, RunningGameStore, useEffect, useState } from "@webpack/common";

const logger = new Logger("971GameBooster");
const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers["971 Game Booster"] as PluginNative<typeof import("./native")>
    : null;
const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore");

type Preset = "balanced" | "performance" | "ultra";
type Metrics = {
    fps: number | null;
    cpuPercent: number | null;
    ramMb: number | null;
    gpuMemoryMb: number | null;
    pingMs: number | null;
};
type ResourceReading = Pick<Metrics, "cpuPercent" | "ramMb" | "gpuMemoryMb">;
type ProfileAverages = { normal: ResourceReading | null; performance: ResourceReading | null; };

const profileReadings: Record<keyof ProfileAverages, ResourceReading[]> = { normal: [], performance: [] };
const PROFILE_SAMPLE_COUNT = 6;

let gameDetected = false;
let performanceModeActive = false;
let disposeBackgroundRaf: (() => void) | null = null;
let disposeBackgroundCancelRaf: (() => void) | null = null;
const throttledFrames = new Map<number, FrameRequestCallback>();
let backgroundFrameTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundFrameLastTime = 0;
let nextFrameId = 1_000_000_000;

function getFrameInterval(): number {
    const fps = settings.store.preset === "ultra" ? 5 : settings.store.preset === "performance" ? 10 : 15;
    return 1000 / fps;
}

function stopBackgroundFrameLimit() {
    disposeBackgroundRaf?.();
    disposeBackgroundCancelRaf?.();
    disposeBackgroundRaf = null;
    disposeBackgroundCancelRaf = null;
    if (backgroundFrameTimer !== null) clearTimeout(backgroundFrameTimer);
    backgroundFrameTimer = null;
    throttledFrames.clear();
}

function scheduleBackgroundFrameFlush() {
    if (backgroundFrameTimer !== null || throttledFrames.size === 0) return;

    const delay = Math.max(0, getFrameInterval() - (performance.now() - backgroundFrameLastTime));
    backgroundFrameTimer = setTimeout(() => {
        backgroundFrameTimer = null;
        backgroundFrameLastTime = performance.now();
        const callbacks = [...throttledFrames.entries()];

        for (const [id, callback] of callbacks) {
            // Keep queued IDs cancellable until their callback actually begins.
            if (!throttledFrames.delete(id)) continue;
            try {
                callback(backgroundFrameLastTime);
            } catch (error) {
                // Match native animation-frame behavior: report one callback's error without
                // preventing other callbacks scheduled for the same frame from running.
                setTimeout(() => { throw error; });
            }
        }

        scheduleBackgroundFrameFlush();
    }, delay);
}

function updateBackgroundFrameLimit() {
    const shouldLimit = performanceModeActive && (document.hidden || !document.hasFocus());
    if (!shouldLimit) {
        stopBackgroundFrameLimit();
        return;
    }
    if (disposeBackgroundRaf) return;

    disposeBackgroundRaf = RuntimeInterposition.register({
        owner: "971GameBooster",
        hook: "requestAnimationFrame",
        priority: RuntimeInterpositionPriority.BEHAVIOR,
        wrap: next => callback => {
            if (RuntimeInteractions.isActive()) return next(callback);

            const id = ++nextFrameId;
            throttledFrames.set(id, callback);
            scheduleBackgroundFrameFlush();
            return id;
        }
    });
    try {
        disposeBackgroundCancelRaf = RuntimeInterposition.register({
            owner: "971GameBooster",
            hook: "cancelAnimationFrame",
            priority: RuntimeInterpositionPriority.BEHAVIOR,
            wrap: next => id => {
                if (!throttledFrames.has(id)) return next(id);
                throttledFrames.delete(id);
                if (throttledFrames.size === 0 && backgroundFrameTimer !== null) {
                    clearTimeout(backgroundFrameTimer);
                    backgroundFrameTimer = null;
                }
            }
        });
    } catch (error) {
        stopBackgroundFrameLimit();
        logger.warn("Could not enable background frame limiting", error);
    }
}

function syncPerformanceMode() {
    window.dispatchEvent(new Event("971-game-booster-state"));
    const enabled = settings.store.performanceMode || (settings.store.autoDetectGames && gameDetected);
    if (enabled === performanceModeActive) {
        if (enabled) document.documentElement.setAttribute("data-971-game-booster", settings.store.preset);
        return;
    }

    performanceModeActive = enabled;
    if (enabled) {
        document.documentElement.setAttribute("data-971-game-booster", settings.store.preset);
        document.addEventListener("visibilitychange", updateBackgroundFrameLimit);
        window.addEventListener("blur", updateBackgroundFrameLimit);
        window.addEventListener("focus", updateBackgroundFrameLimit);
        updateBackgroundFrameLimit();
    } else {
        document.documentElement.removeAttribute("data-971-game-booster");
        document.removeEventListener("visibilitychange", updateBackgroundFrameLimit);
        window.removeEventListener("blur", updateBackgroundFrameLimit);
        window.removeEventListener("focus", updateBackgroundFrameLimit);
        stopBackgroundFrameLimit();
    }
}

function getPing(): number | null {
    try {
        if (RTCConnectionStore.isConnected?.()) {
            const voicePing = RTCConnectionStore.getLastPing?.();
            if (typeof voicePing === "number" && Number.isFinite(voicePing) && voicePing > 0) return Math.round(voicePing);
        }

        const gateway = GatewayConnectionStore as {
            isConnected?: () => boolean;
            getPing?: () => unknown;
            getSocket?: () => { lastHeartbeatTime?: number; lastHeartbeatAckTime?: number; } | undefined;
        };
        if (!gateway.isConnected?.()) return null;

        const reported = gateway.getPing?.();
        if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) return Math.round(reported);

        const socket = gateway.getSocket?.();
        const sent = socket?.lastHeartbeatTime;
        const acknowledged = socket?.lastHeartbeatAckTime;
        if (typeof sent !== "number" || typeof acknowledged !== "number" || sent <= 0 || acknowledged < sent) return null;
        const elapsed = acknowledged - sent;
        return elapsed > 0 && elapsed < 60_000 && Date.now() - acknowledged < 90_000 ? Math.round(elapsed) : null;
    } catch {
        return null;
    }
}

function getAverage(readings: ResourceReading[]): ResourceReading | null {
    if (readings.length < PROFILE_SAMPLE_COUNT) return null;

    const average = (key: keyof ResourceReading) => {
        const values = readings.map(reading => reading[key]).filter((value): value is number => value !== null && Number.isFinite(value));
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    };

    return { cpuPercent: average("cpuPercent"), ramMb: average("ramMb"), gpuMemoryMb: average("gpuMemoryMb") };
}

function formatMeasuredChange(normal: number | null, performance: number | null, unit: string) {
    if (normal === null || performance === null) return "Not available on this platform";
    const difference = normal - performance;
    const direction = difference > 0 ? "lower" : difference < 0 ? "higher" : "unchanged";
    return difference === 0 ? direction : `${Math.abs(difference).toFixed(1)} ${unit} ${direction}`;
}

function PerformanceDashboard() {
    const { autoDetectGames, performanceMode, preset, showMonitor } = settings.use(["autoDetectGames", "performanceMode", "preset", "showMonitor"]);
    const [, setRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setRevision(revision => revision + 1);
        window.addEventListener("971-game-booster-state", refresh);
        return () => window.removeEventListener("971-game-booster-state", refresh);
    }, []);
    const active = performanceModeActive;
    const presetName = preset === "ultra" ? "Ultra Performance" : preset === "performance" ? "Performance" : "Balanced";

    return (
        <section className="vc-971-game-booster-dashboard">
            <header className="vc-971-game-booster-dashboard-header">
                <div>
                    <span className="vc-971-game-booster-kicker">971 CLIENT PERFORMANCE</span>
                    <h3>Gaming dashboard</h3>
                </div>
                <span className={`vc-971-game-booster-status ${active ? "is-active" : ""}`}>{active ? "Performance Mode on" : "Normal mode"}</span>
            </header>
            <div className="vc-971-game-booster-summary">
                <div><span>Profile</span><strong>{presetName}</strong></div>
                <div><span>Mode source</span><strong>{performanceMode ? "Manual" : active ? "Automatic" : "Off"}</strong></div>
                <div><span>Game detection</span><strong>{autoDetectGames ? gameDetected ? "Game detected" : "Waiting for a game" : "Off"}</strong></div>
                <div><span>Live monitor</span><strong>{showMonitor ? "On while settings are focused" : "Off"}</strong></div>
            </div>
            <p>Changes apply inside 971 Client only and restore when Performance Mode turns off. No Windows, game, or anti-cheat settings are changed. Enable the optional monitor below to compare measured client usage; it does not estimate game FPS.</p>
        </section>
    );
}

function MonitorPanel() {
    const { showMonitor } = settings.use(["showMonitor"]);
    const [metrics, setMetrics] = useState<Metrics>({ fps: null, cpuPercent: null, ramMb: null, gpuMemoryMb: null, pingMs: null });
    const [profileAverages, setProfileAverages] = useState<ProfileAverages>({ normal: null, performance: null });
    const [profileCounts, setProfileCounts] = useState({ normal: 0, performance: 0 });

    useEffect(() => {
        if (!showMonitor) return;

        let frame = 0;
        let sampleTimer: ReturnType<typeof setInterval> | null = null;
        let fpsStart = 0;
        let frameCount = 0;
        profileReadings.normal.length = 0;
        profileReadings.performance.length = 0;
        setProfileAverages({ normal: null, performance: null });
        setProfileCounts({ normal: 0, performance: 0 });

        const sampleMetrics = async () => {
            const pingMs = getPing();
            if (!Native) {
                const { memory } = performance as Performance & { memory?: { usedJSHeapSize?: number; }; };
                const ramMb = memory?.usedJSHeapSize ? memory.usedJSHeapSize / 1_048_576 : null;
                setMetrics(current => ({
                    ...current,
                    cpuPercent: null,
                    ramMb,
                    gpuMemoryMb: null,
                    pingMs,
                }));
                const mode = performanceModeActive ? "performance" : "normal";
                const readings = profileReadings[mode];
                readings.push({ cpuPercent: null, ramMb, gpuMemoryMb: null });
                if (readings.length > PROFILE_SAMPLE_COUNT) readings.shift();
                setProfileCounts(current => ({ ...current, [mode]: Math.min(PROFILE_SAMPLE_COUNT, readings.length) }));
                setProfileAverages(current => ({ ...current, [mode]: getAverage(readings) }));
                return;
            }

            try {
                const nativeMetrics = await Native.getMetrics();
                setMetrics(current => ({ ...current, ...nativeMetrics, pingMs }));
                const mode = performanceModeActive ? "performance" : "normal";
                const readings = profileReadings[mode];
                readings.push({ cpuPercent: nativeMetrics.cpuPercent, ramMb: nativeMetrics.ramMb, gpuMemoryMb: nativeMetrics.gpuMemoryMb });
                if (readings.length > PROFILE_SAMPLE_COUNT) readings.shift();
                setProfileCounts(current => ({ ...current, [mode]: Math.min(PROFILE_SAMPLE_COUNT, readings.length) }));
                setProfileAverages(current => ({ ...current, [mode]: getAverage(readings) }));
            } catch (error) {
                logger.warn("Could not read client performance metrics", error);
                setMetrics(current => ({ ...current, pingMs }));
            }
        };

        const onFrame = (now: number) => {
            if (!fpsStart) fpsStart = now;
            frameCount++;
            const elapsed = now - fpsStart;
            if (elapsed >= 1000) {
                setMetrics(current => ({ ...current, fps: Math.round(frameCount * 1000 / elapsed) }));
                fpsStart = now;
                frameCount = 0;
            }
            frame = requestAnimationFrame(onFrame);
        };

        const stopSampling = () => {
            if (sampleTimer !== null) {
                clearInterval(sampleTimer);
                sampleTimer = null;
            }
            if (frame) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
        };

        const startSampling = () => {
            if (document.hidden || !document.hasFocus() || sampleTimer !== null) return;
            void sampleMetrics();
            sampleTimer = setInterval(() => void sampleMetrics(), 2000);
            frame = requestAnimationFrame(onFrame);
        };

        document.addEventListener("visibilitychange", startSampling);
        window.addEventListener("focus", startSampling);
        window.addEventListener("blur", stopSampling);
        startSampling();

        return () => {
            stopSampling();
            document.removeEventListener("visibilitychange", startSampling);
            window.removeEventListener("focus", startSampling);
            window.removeEventListener("blur", stopSampling);
        };
    }, [showMonitor]);

    if (!showMonitor) return null;

    const value = (number: number | null, unit: string) => number === null ? "—" : `${number}${unit}`;
    const hasComparison = profileAverages.normal !== null && profileAverages.performance !== null;
    return (
        <div className="vc-971-game-booster-monitor">
            <h3>Live performance</h3>
            <div className="vc-971-game-booster-metric"><span>Client FPS</span><strong>{value(metrics.fps, "")}</strong></div>
            <div className="vc-971-game-booster-metric"><span>971 Client CPU</span><strong>{value(metrics.cpuPercent === null ? null : Math.round(metrics.cpuPercent), "%")}</strong></div>
            <div className="vc-971-game-booster-metric"><span>Client RAM</span><strong>{value(metrics.ramMb === null ? null : Math.round(metrics.ramMb), " MB")}</strong></div>
            <div className="vc-971-game-booster-metric"><span>GPU process memory</span><strong>{value(metrics.gpuMemoryMb === null ? null : Math.round(metrics.gpuMemoryMb), " MB")}</strong></div>
            <div className="vc-971-game-booster-metric"><span>Ping</span><strong>{value(metrics.pingMs, " ms")}</strong></div>
            <div className="vc-971-game-booster-comparison">
                <h4>Measured change: normal vs active profile</h4>
                {hasComparison ? (
                    <div className="vc-971-game-booster-summary">
                        <div><span>Client CPU</span><strong>{formatMeasuredChange(profileAverages.normal?.cpuPercent ?? null, profileAverages.performance?.cpuPercent ?? null, "points")}</strong></div>
                        <div><span>Client RAM</span><strong>{formatMeasuredChange(profileAverages.normal?.ramMb ?? null, profileAverages.performance?.ramMb ?? null, "MB")}</strong></div>
                        <div><span>GPU-process memory</span><strong>{formatMeasuredChange(profileAverages.normal?.gpuMemoryMb ?? null, profileAverages.performance?.gpuMemoryMb ?? null, "MB")}</strong></div>
                    </div>
                ) : (
                    <p>Keep this panel open and focused for at least {PROFILE_SAMPLE_COUNT * 2} seconds in normal mode and Performance Mode to collect a comparison ({profileCounts.normal}/{PROFILE_SAMPLE_COUNT} normal, {profileCounts.performance}/{PROFILE_SAMPLE_COUNT} performance readings).</p>
                )}
            </div>
            <p>Client FPS measures 971 Client rendering, not game FPS. GPU memory is the client’s GPU process RAM; Electron does not expose GPU utilization.</p>
        </div>
    );
}

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "",
        component: PerformanceDashboard,
    },
    performanceMode: {
        type: OptionType.BOOLEAN,
        description: "Turn Performance Mode on manually. Automatic game detection can also activate it temporarily.",
        default: false,
        onChange: syncPerformanceMode,
    },
    autoDetectGames: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable Performance Mode while a game detected by Discord is running, then restore your normal UI when it closes.",
        default: false,
        onChange: syncPerformanceMode,
    },
    preset: {
        type: OptionType.SELECT,
        description: "Choose how much visual work to reduce while Performance Mode is active.",
        options: [
            { label: "Balanced", value: "balanced", default: true },
            { label: "Performance", value: "performance" },
            { label: "Ultra Performance", value: "ultra" },
        ],
        onChange: syncPerformanceMode,
    },
    showMonitor: {
        type: OptionType.BOOLEAN,
        description: "Show an optional live monitor. It samples only while this settings panel is open and focused.",
        default: false,
    },
    monitorPanel: {
        type: OptionType.COMPONENT,
        description: "",
        component: MonitorPanel,
    },
});

export default definePlugin({
    name: "971 Game Booster",
    description: "An optional, reversible gaming profile that reduces visual effects and background rendering while keeping Discord and all other plugins active.",
    authors: [Devs.Kbk],
    tags: ["Utility", "Performance"],
    settings,

    flux: {
        RUNNING_GAMES_CHANGE({ games }: { games: { id: string; }[]; }) {
            gameDetected = games.length > 0;
            syncPerformanceMode();
        },
    },

    start() {
        gameDetected = RunningGameStore.getRunningGames().length > 0;
        syncPerformanceMode();
    },

    stop() {
        gameDetected = false;
        if (performanceModeActive) {
            performanceModeActive = false;
            document.documentElement.removeAttribute("data-971-game-booster");
            document.removeEventListener("visibilitychange", updateBackgroundFrameLimit);
            window.removeEventListener("blur", updateBackgroundFrameLimit);
            window.removeEventListener("focus", updateBackgroundFrameLimit);
        }
        stopBackgroundFrameLimit();
    },
});
