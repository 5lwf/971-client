/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ClientRelease {
    name: string;
    tag_name: string;
    assets: { name: string; browser_download_url: string; digest?: string; }[];
}

export function selectClientUpdate(release: ClientRelease, file: string, currentHash: string) {
    const hash = /([a-f0-9]{40})$/i.exec(release.name)?.[1];
    const asset = release.assets.find(a => a.name === file);
    if (!hash || hash === currentHash || !asset) return null;
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")) throw new Error("The update is missing its verification checksum.");
    const url = new URL(asset.browser_download_url);
    if (url.origin !== "https://github.com" || !url.pathname.startsWith("/5lwf/971-client/releases/download/"))
        throw new Error("The update download is outside the 971 Client repository.");
    return { hash, url: url.href, digest: asset.digest?.slice(7), name: release.name };
}
