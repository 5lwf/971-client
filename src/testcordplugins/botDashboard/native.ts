/*
 * 971 Client bot dashboard
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { app, safeStorage, type IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";

const API_BASE = "https://discord.com/api/v10/";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_SAVED_BOTS = 32;
const MAX_BOT_STORE_BYTES = 512 * 1024;
const BOT_STORE_VERSION = 1;

type BotProfile = {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
};

type BotGuild = {
    id: string;
    name: string;
    icon: string | null;
};

type BotChannel = {
    id: string;
    name: string;
    type: number;
    parentId: string | null;
    position: number;
};

type BotMessage = {
    id: string;
    author: { id: string; username: string; globalName: string | null; avatar: string | null; bot: boolean; };
    content: string;
    timestamp: string;
    attachments: string[];
};

type StoredBotAccount = {
    profile: BotProfile;
    encryptedToken: string;
};

let activeToken: string | null = null;
let activeProfile: BotProfile | null = null;

function getBotStorePath() {
    return join(app.getPath("userData"), "971-client", "bot-dashboard-accounts.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isBotProfile(value: unknown): value is BotProfile {
    if (!isRecord(value)) return false;

    return typeof value.id === "string" && /^\d{15,22}$/.test(value.id) &&
        typeof value.username === "string" && value.username.length > 0 && value.username.length <= 64 &&
        (value.globalName == null || typeof value.globalName === "string" && value.globalName.length <= 64) &&
        (value.avatar == null || typeof value.avatar === "string" && value.avatar.length <= 128);
}

function isStoredBotAccount(value: unknown): value is StoredBotAccount {
    if (!isRecord(value) || !isBotProfile(value.profile)) return false;
    return typeof value.encryptedToken === "string" && value.encryptedToken.length > 0 &&
        value.encryptedToken.length <= 8192 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedToken);
}

async function readBotStore(): Promise<StoredBotAccount[]> {
    let contents: Buffer;
    try {
        contents = await readFile(getBotStorePath());
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new Error("Saved bot accounts could not be read.");
    }

    if (contents.byteLength > MAX_BOT_STORE_BYTES) throw new Error("Saved bot account storage is larger than expected.");

    let parsed: unknown;
    try {
        parsed = JSON.parse(contents.toString("utf8"));
    } catch {
        throw new Error("Saved bot account storage is damaged. Remove the saved-bot file to set it up again.");
    }

    if (!isRecord(parsed) || parsed.version !== BOT_STORE_VERSION || !Array.isArray(parsed.accounts) || parsed.accounts.length > MAX_SAVED_BOTS || !parsed.accounts.every(isStoredBotAccount)) {
        throw new Error("Saved bot account storage has an unsupported or invalid format.");
    }

    return parsed.accounts;
}

async function writeBotStore(accounts: StoredBotAccount[]) {
    if (accounts.length > MAX_SAVED_BOTS) throw new Error(`You can save up to ${MAX_SAVED_BOTS} bot accounts.`);

    const filePath = getBotStorePath();
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });

    try {
        const contents = JSON.stringify({ version: BOT_STORE_VERSION, accounts });
        if (Buffer.byteLength(contents, "utf8") > MAX_BOT_STORE_BYTES) throw new Error("Saved bot account storage is full.");
        await writeFile(tempPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(tempPath, filePath);
    } finally {
        await unlink(tempPath).catch(() => { });
    }
}

function requireToken(): string {
    if (!activeToken) throw new Error("Connect a bot account first.");
    return activeToken;
}

function requireSnowflake(value: unknown, label: string): string {
    if (typeof value !== "string" || !/^\d{15,22}$/.test(value)) {
        throw new Error(`Invalid ${label}.`);
    }
    return value;
}

async function discordRequest<T>(path: string, token = requireToken()): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Discord API path.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(new URL(path.slice(1), API_BASE), {
            method: "GET",
            redirect: "error",
            headers: {
                Authorization: `Bot ${token}`,
                Accept: "application/json",
                "User-Agent": "971-Client-Bot-Dashboard"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error("Discord rejected this bot token. Check it and try again.");
            if (response.status === 403) throw new Error("This bot does not have permission to view that server, channel, or history.");
            if (response.status === 404) throw new Error("That server, channel, or message history is unavailable to this bot.");
            if (response.status === 429) throw new Error("Discord is rate limiting this bot. Wait a moment before refreshing.");
            if (response.status >= 500) throw new Error("Discord is temporarily unavailable. Try again shortly.");
            throw new Error(`Discord API request failed (${response.status}).`);
        }

        return await response.json() as T;
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Discord did not respond in time. Check your connection and try again.");
        }
        if (error instanceof TypeError) throw new Error("Could not reach Discord. Check your connection and try again.");
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function connect(_event: IpcMainInvokeEvent, rawToken: string): Promise<BotProfile> {
    if (typeof rawToken !== "string" || rawToken.length > 512 || /[\r\n\0]/.test(rawToken)) {
        throw new Error("Enter a valid Discord bot token.");
    }

    const token = rawToken.trim();
    if (!token) throw new Error("Paste a bot token to connect.");

    const user = await discordRequest<any>("/users/@me", token);
    if (!user?.bot || typeof user.id !== "string" || typeof user.username !== "string") {
        throw new Error("This is not a bot token. Use the token from your bot application in the Discord Developer Portal.");
    }

    activeProfile = {
        id: user.id,
        username: user.username,
        globalName: typeof user.global_name === "string" ? user.global_name : null,
        avatar: typeof user.avatar === "string" ? user.avatar : null
    };
    activeToken = token;
    return activeProfile;
}

export function getSession(_event: IpcMainInvokeEvent): BotProfile | null {
    return activeProfile;
}

export async function getSavedBots(_event: IpcMainInvokeEvent): Promise<BotProfile[]> {
    return (await readBotStore()).map(account => account.profile);
}

export async function saveBot(_event: IpcMainInvokeEvent): Promise<BotProfile> {
    if (!activeToken || !activeProfile) throw new Error("Connect a bot before saving it.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this device, so the bot token was not saved.");

    const accounts = await readBotStore();
    const existingIndex = accounts.findIndex(account => account.profile.id === activeProfile!.id);
    if (existingIndex === -1 && accounts.length >= MAX_SAVED_BOTS) {
        throw new Error(`You can save up to ${MAX_SAVED_BOTS} bot accounts.`);
    }

    const encryptedToken = safeStorage.encryptString(activeToken).toString("base64");
    const account = { profile: activeProfile, encryptedToken };
    if (existingIndex === -1) accounts.push(account);
    else accounts[existingIndex] = account;

    await writeBotStore(accounts);
    return activeProfile;
}

export async function selectBot(_event: IpcMainInvokeEvent, rawBotId: string): Promise<BotProfile> {
    const botId = requireSnowflake(rawBotId, "bot ID");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable, so saved bot tokens cannot be unlocked.");

    const accounts = await readBotStore();
    const account = accounts.find(candidate => candidate.profile.id === botId);
    if (!account) throw new Error("That saved bot account no longer exists.");

    let token: string;
    try {
        token = safeStorage.decryptString(Buffer.from(account.encryptedToken, "base64"));
    } catch {
        throw new Error("This saved bot token could not be unlocked with this device's secure storage.");
    }

    const user = await discordRequest<any>("/users/@me", token);
    if (user?.bot !== true || user.id !== botId || typeof user.username !== "string") {
        throw new Error("Discord no longer accepts this saved bot token. Reconnect the bot to update it.");
    }

    const profile: BotProfile = {
        id: user.id,
        username: user.username,
        globalName: typeof user.global_name === "string" ? user.global_name : null,
        avatar: typeof user.avatar === "string" ? user.avatar : null
    };
    activeToken = token;
    activeProfile = profile;
    accounts[accounts.indexOf(account)] = { ...account, profile };
    await writeBotStore(accounts);
    return profile;
}

export async function removeBot(_event: IpcMainInvokeEvent, rawBotId: string): Promise<void> {
    const botId = requireSnowflake(rawBotId, "bot ID");
    const accounts = await readBotStore();
    const nextAccounts = accounts.filter(account => account.profile.id !== botId);
    if (nextAccounts.length !== accounts.length) await writeBotStore(nextAccounts);
    if (activeProfile?.id === botId) {
        activeToken = null;
        activeProfile = null;
    }
}

export async function disconnect(_event: IpcMainInvokeEvent): Promise<void> {
    activeToken = null;
    activeProfile = null;
}

export async function getGuilds(_event: IpcMainInvokeEvent): Promise<BotGuild[]> {
    const guilds = await discordRequest<any[]>("/users/@me/guilds?limit=200");
    return guilds
        .filter(guild => typeof guild?.id === "string" && typeof guild?.name === "string")
        .map(guild => ({ id: guild.id, name: guild.name, icon: typeof guild.icon === "string" ? guild.icon : null }));
}

export async function getChannels(_event: IpcMainInvokeEvent, guildId: string): Promise<BotChannel[]> {
    const id = requireSnowflake(guildId, "server ID");
    const channels = await discordRequest<any[]>(`/guilds/${id}/channels`);
    return channels
        .filter(channel => typeof channel?.id === "string" && typeof channel?.name === "string" && Number.isInteger(channel.type))
        .map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: typeof channel.parent_id === "string" ? channel.parent_id : null,
            position: Number.isFinite(channel.position) ? channel.position : 0
        }))
        .filter(channel => [0, 5, 10, 11, 12, 15, 16].includes(channel.type))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export async function getMessages(_event: IpcMainInvokeEvent, channelId: string): Promise<BotMessage[]> {
    const id = requireSnowflake(channelId, "channel ID");
    const messages = await discordRequest<any[]>(`/channels/${id}/messages?limit=30`);
    return messages
        .filter(message => typeof message?.id === "string" && typeof message?.author?.id === "string")
        .map(message => ({
            id: message.id,
            author: {
                id: message.author.id,
                username: typeof message.author.username === "string" ? message.author.username : "Unknown user",
                globalName: typeof message.author.global_name === "string" ? message.author.global_name : null,
                avatar: typeof message.author.avatar === "string" ? message.author.avatar : null,
                bot: message.author.bot === true
            },
            content: typeof message.content === "string" ? message.content : "",
            timestamp: typeof message.timestamp === "string" ? message.timestamp : "",
            attachments: Array.isArray(message.attachments)
                ? message.attachments.filter((attachment: any) => typeof attachment?.filename === "string").map((attachment: any) => attachment.filename).slice(0, 10)
                : []
        }));
}
