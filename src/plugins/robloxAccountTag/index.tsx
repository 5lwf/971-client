/*
 * 971 Client, a modification for Discord's desktop app
 * Copyright (c) 2026 971 Client contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { fetchUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { UserProfileStore, useEffect, useState, useStateFromStores } from "@webpack/common";

const PROFILE_REQUEST_LIMIT = 2;
const PROFILE_QUEUE_LIMIT = 64;
const PROFILE_REQUEST_DELAY_MS = 350;
const PROFILE_FAILURE_COOLDOWN_MS = 2 * 60_000;
const ROBLOX_CACHE_LIMIT = 256;

const settings = definePluginSettings({
    showInMessages: {
        type: OptionType.BOOLEAN,
        description: "Show linked Roblox accounts beside names in chat",
        default: true,
    },
    showInMemberList: {
        type: OptionType.BOOLEAN,
        description: "Show linked Roblox accounts in member and DM lists",
        default: true,
    },
    showInProfiles: {
        type: OptionType.BOOLEAN,
        description: "Show linked Roblox accounts beside names in profiles",
        default: true,
    },
    showAvatar: {
        type: OptionType.BOOLEAN,
        description: "Show the linked Roblox account's public avatar headshot",
        default: true,
    },
});

interface RobloxIdentity {
    id?: string;
    username: string;
}

const profileQueue: string[] = [];
const queuedProfiles = new Set<string>();
const fetchingProfiles = new Set<string>();
const profileFailures = new Map<string, number>();
let activeProfileRequests = 0;
let profileTimer: ReturnType<typeof setTimeout> | undefined;
let pluginStarted = false;

function enqueueProfile(userId: string) {
    if (!pluginStarted || !userId || UserProfileStore.getUserProfile(userId) || UserProfileStore.isFetchingProfile(userId)) return;
    if (queuedProfiles.has(userId) || fetchingProfiles.has(userId)) return;
    if ((profileFailures.get(userId) ?? 0) > Date.now()) return;

    if (profileQueue.length >= PROFILE_QUEUE_LIMIT) {
        const dropped = profileQueue.shift();
        if (dropped) queuedProfiles.delete(dropped);
    }

    profileQueue.push(userId);
    queuedProfiles.add(userId);
    runProfileQueue();
}

function runProfileQueue() {
    if (!pluginStarted || profileTimer || activeProfileRequests >= PROFILE_REQUEST_LIMIT || profileQueue.length === 0) return;

    profileTimer = setTimeout(() => {
        profileTimer = undefined;
        const userId = profileQueue.shift();
        if (!userId) return;
        queuedProfiles.delete(userId);

        if (UserProfileStore.getUserProfile(userId) || UserProfileStore.isFetchingProfile(userId)) {
            runProfileQueue();
            return;
        }

        activeProfileRequests++;
        fetchingProfiles.add(userId);
        void fetchUserProfile(userId)
            .catch(() => {
                if (profileFailures.size >= 256) profileFailures.clear();
                profileFailures.set(userId, Date.now() + PROFILE_FAILURE_COOLDOWN_MS);
            })
            .finally(() => {
                activeProfileRequests--;
                fetchingProfiles.delete(userId);
                runProfileQueue();
            });

        runProfileQueue();
    }, PROFILE_REQUEST_DELAY_MS);
}

function clearProfileQueue() {
    if (profileTimer) clearTimeout(profileTimer);
    profileTimer = undefined;
    profileQueue.length = 0;
    queuedProfiles.clear();
    profileFailures.clear();
}

function normalizeUsername(name?: string | null) {
    return name?.trim().replace(/^@/, "") ?? "";
}

function getRobloxIdentity(profile: ReturnType<typeof UserProfileStore.getUserProfile>): RobloxIdentity | null {
    const linkedAccount = profile?.connectedAccounts?.find(account =>
        account.type === "roblox" && account.verified && !account.revoked
    );

    if (linkedAccount) {
        const username = normalizeUsername(linkedAccount.name);
        if (username) {
            return {
                username,
                id: /^\d{5,20}$/.test(linkedAccount.id) ? linkedAccount.id : undefined,
            };
        }
    }

    // Bloxlink linked-role data is only considered when Discord includes it in
    // the user's visible profile. Nothing is scraped from private profiles.
    const roleConnection = profile?.applicationRoleConnections?.find(connection => {
        const platform = connection.platform_name?.toLowerCase() ?? "";
        const application = connection.application?.name?.toLowerCase() ?? "";
        return platform.includes("roblox") || application.includes("roblox") || application.includes("bloxlink") || application.includes("ropro");
    });
    const username = normalizeUsername(roleConnection?.platform_username);
    return username ? { username } : null;
}

interface RobloxUserLookup {
    data?: Array<{ id: number; name: string; }>;
}

interface RobloxHeadshotResponse {
    data?: Array<{ imageUrl?: string | null; }>;
}

async function fetchRobloxJson<T>(url: string, init?: RequestInit): Promise<T | null> {
    const controller = new AbortController();
    robloxControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch(url, {
            ...init,
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
        });
        if (!response.ok) return null;
        return await response.json() as T;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
        robloxControllers.delete(controller);
    }
}

const avatarCache = new Map<string, { url: string | null; expiresAt: number; }>();
const avatarRequests = new Map<string, Promise<string | null>>();
const robloxControllers = new Set<AbortController>();

function cacheAvatar(key: string, url: string | null) {
    if (avatarCache.size >= ROBLOX_CACHE_LIMIT) {
        const oldest = avatarCache.keys().next().value;
        if (oldest !== undefined) avatarCache.delete(oldest);
    }
    avatarCache.set(key, { url, expiresAt: Date.now() + (url ? 24 * 60 * 60_000 : 10 * 60_000) });
}

function getRobloxHeadshot(identity: RobloxIdentity): Promise<string | null> {
    const usernameKey = identity.username.toLowerCase();
    const cacheKey = identity.id ? `id:${identity.id}` : `name:${usernameKey}`;
    const cached = avatarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);

    const pending = avatarRequests.get(cacheKey);
    if (pending) return pending;

    let request: Promise<string | null>;
    request = (async () => {
        let robloxId = identity.id;
        if (!robloxId) {
            const lookup = await fetchRobloxJson<RobloxUserLookup>("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usernames: [identity.username], excludeBannedUsers: true }),
            });
            const account = lookup?.data?.find(user => user.name.toLowerCase() === usernameKey) ?? lookup?.data?.[0];
            if (account) robloxId = String(account.id);
        }

        if (!robloxId) {
            cacheAvatar(cacheKey, null);
            return null;
        }

        const query = new URLSearchParams({ userIds: robloxId, size: "48x48", format: "Png", isCircular: "false" });
        const response = await fetchRobloxJson<RobloxHeadshotResponse>(`https://thumbnails.roblox.com/v1/users/avatar-headshot?${query}`);
        const imageUrl = response?.data?.[0]?.imageUrl ?? null;
        cacheAvatar(cacheKey, imageUrl);
        if (identity.id) cacheAvatar(`id:${identity.id}`, imageUrl);
        return imageUrl;
    })().finally(() => {
        if (avatarRequests.get(cacheKey) === request) avatarRequests.delete(cacheKey);
    });

    avatarRequests.set(cacheKey, request);
    return request;
}

function RobloxAvatar({ identity }: { identity: RobloxIdentity; }) {
    const [imageUrl, setImageUrl] = useState(() => {
        const key = identity.id ? `id:${identity.id}` : `name:${identity.username.toLowerCase()}`;
        const cached = avatarCache.get(key);
        return cached && cached.expiresAt > Date.now() ? cached.url : null;
    });

    useEffect(() => {
        let cancelled = false;
        void getRobloxHeadshot(identity).then(url => {
            if (!cancelled) setImageUrl(url);
        });
        return () => {
            cancelled = true;
        };
    }, [identity.id, identity.username]);

    return imageUrl
        ? <img className="vc-roblox-tag-avatar" src={imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        : <span className="vc-roblox-tag-avatar vc-roblox-tag-avatar-placeholder" aria-hidden="true">R</span>;
}

function RobloxIdentityTag({ userId, placement }: { userId: string; placement: "message" | "member" | "profile"; }) {
    const { showAvatar } = settings.use(["showAvatar"]);
    const profile = useStateFromStores(
        [UserProfileStore],
        () => UserProfileStore.getUserProfile(userId),
        [userId]
    );

    useEffect(() => {
        if (!profile) enqueueProfile(userId);
    }, [profile, userId]);

    const identity = getRobloxIdentity(profile);
    if (!identity) return null;

    return (
        <span className={`vc-roblox-tag vc-roblox-tag-${placement}`} title={`Roblox: @${identity.username}`}>
            <span className="vc-roblox-tag-separator" aria-hidden="true">-</span>
            <span className="vc-roblox-tag-content">
                <span aria-hidden="true">(</span>
                {showAvatar && <RobloxAvatar key={`${identity.id ?? ""}:${identity.username}`} identity={identity} />}
                <span className="vc-roblox-tag-username">@{identity.username}</span>
                <span aria-hidden="true">)</span>
            </span>
        </span>
    );
}

export default definePlugin({
    name: "RobloxAccountTag",
    description: "Shows a user's publicly linked Roblox username and avatar beside their Discord name",
    tags: ["Appearance", "Chat"],
    authors: [Devs.Kbk],
    dependencies: ["MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],
    settings,

    start() {
        pluginStarted = true;
    },

    stop() {
        pluginStarted = false;
        clearProfileQueue();
        for (const controller of robloxControllers) controller.abort();
        robloxControllers.clear();
        avatarCache.clear();
        avatarRequests.clear();
    },

    renderMessageDecoration({ message }) {
        if (!settings.store.showInMessages || !message?.author || message.author.bot) return null;
        return <RobloxIdentityTag userId={message.author.id} placement="message" />;
    },

    renderMemberListDecorator({ user }) {
        if (!settings.store.showInMemberList || !user || user.bot) return null;
        return <RobloxIdentityTag userId={user.id} placement="member" />;
    },

    renderNicknameIcon({ userId }) {
        if (!settings.store.showInProfiles) return null;
        return <RobloxIdentityTag userId={userId} placement="profile" />;
    },
});
