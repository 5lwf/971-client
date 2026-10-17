/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, type IpcMainInvokeEvent } from "electron";

export function getMetrics(_event: IpcMainInvokeEvent) {
    const metrics = app.getAppMetrics();
    const gpuMetrics = metrics.filter(metric => metric.type === "GPU");

    return {
        cpuPercent: metrics.reduce((total, metric) => total + (Number.isFinite(metric.cpu.percentCPUUsage) ? metric.cpu.percentCPUUsage : 0), 0),
        ramMb: metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024,
        gpuMemoryMb: gpuMetrics.length ? gpuMetrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024 : null,
    };
}
