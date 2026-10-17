/*
 * 971 Client bot dashboard
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { Popout, React } from "@webpack/common";

const Native = VencordNative.pluginHelpers.BotDashboard as PluginNative<typeof import("./native")>;

type BotProfile = { id: string; username: string; globalName: string | null; avatar: string | null; };
type BotGuild = { id: string; name: string; icon: string | null; };
type BotChannel = { id: string; name: string; type: number; parentId: string | null; position: number; };
type BotMessage = {
    id: string;
    author: { id: string; username: string; globalName: string | null; avatar: string | null; bot: boolean; };
    content: string;
    timestamp: string;
    attachments: string[];
};

function BotIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" {...props}>
            <path d="M19 7h-1.18A3 3 0 0 0 15 5h-2V3a1 1 0 1 0-2 0v2H9a3 3 0 0 0-2.82 2H5a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3Zm-9 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
    );
}

function avatarUrl(id: string, avatar: string | null, size = 64): string | null {
    return avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=${size}` : null;
}

function guildIconUrl(guild: BotGuild): string | null {
    return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` : null;
}

function DashboardPanel() {
    const [bot, setBot] = React.useState<BotProfile | null>(null);
    const [savedBots, setSavedBots] = React.useState<BotProfile[]>([]);
    const [addingBot, setAddingBot] = React.useState(false);
    const [guilds, setGuilds] = React.useState<BotGuild[]>([]);
    const [channels, setChannels] = React.useState<BotChannel[]>([]);
    const [messages, setMessages] = React.useState<BotMessage[]>([]);
    const [selectedGuild, setSelectedGuild] = React.useState<string | null>(null);
    const [selectedChannel, setSelectedChannel] = React.useState<BotChannel | null>(null);
    const [token, setToken] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [loadingMessages, setLoadingMessages] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const channelRequest = React.useRef(0);
    const messageRequest = React.useRef(0);

    const loadGuilds = React.useCallback(async () => {
        const result = await Native.getGuilds();
        setGuilds(result);
        setSelectedGuild(current => result.some(guild => guild.id === current) ? current : result[0]?.id ?? null);
    }, []);

    const loadSavedBots = React.useCallback(async () => {
        setSavedBots(await Native.getSavedBots());
    }, []);

    React.useEffect(() => {
        let mounted = true;
        Native.getSession().then(async session => {
            if (!mounted || !session) return;
            setBot(session);
            try {
                await loadGuilds();
            } catch (reason) {
                if (mounted) setError(reason instanceof Error ? reason.message : "Could not load the bot's servers.");
            }
        }).catch(() => { });
        return () => { mounted = false; };
    }, [loadGuilds]);

    React.useEffect(() => {
        let mounted = true;
        Native.getSavedBots().then(result => {
            if (mounted) setSavedBots(result);
        }).catch(reason => {
            if (mounted) setError(reason instanceof Error ? reason.message : "Could not load saved bots.");
        });
        return () => { mounted = false; };
    }, []);

    const switchBot = async (botId: string) => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const profile = await Native.selectBot(botId);
            setBot(profile);
            setAddingBot(false);
            setGuilds([]);
            setChannels([]);
            setMessages([]);
            setSelectedGuild(null);
            setSelectedChannel(null);
            await loadGuilds();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not switch to this bot.");
        } finally {
            setBusy(false);
        }
    };

    const removeSavedBot = async (profile: BotProfile) => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await Native.removeBot(profile.id);
            await loadSavedBots();
            if (bot?.id === profile.id) {
                setBot(null);
                setAddingBot(false);
                setGuilds([]);
                setChannels([]);
                setMessages([]);
                setSelectedGuild(null);
                setSelectedChannel(null);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not remove this saved bot.");
        } finally {
            setBusy(false);
        }
    };

    React.useEffect(() => {
        const requestId = ++channelRequest.current;
        setError(null);
        setChannels([]);
        setSelectedChannel(null);
        setMessages([]);
        if (!selectedGuild || !bot) return;

        Native.getChannels(selectedGuild).then(result => {
            if (channelRequest.current !== requestId) return;
            setChannels(result);
            setSelectedChannel(result[0] ?? null);
        }).catch(reason => {
            if (channelRequest.current === requestId) setError(reason instanceof Error ? reason.message : "Could not load channels.");
        });
        return () => { channelRequest.current++; };
    }, [selectedGuild, bot]);

    const refreshMessages = React.useCallback(async (channel: BotChannel | null) => {
        const requestId = ++messageRequest.current;
        if (!channel) {
            setMessages([]);
            return;
        }
        setLoadingMessages(true);
        setError(null);
        try {
            const result = await Native.getMessages(channel.id);
            if (messageRequest.current === requestId) setMessages(result.slice().reverse());
        } catch (reason) {
            if (messageRequest.current === requestId) {
                setMessages([]);
                setError(reason instanceof Error ? reason.message : "Could not load this channel.");
            }
        } finally {
            if (messageRequest.current === requestId) setLoadingMessages(false);
        }
    }, []);

    React.useEffect(() => {
        void refreshMessages(selectedChannel);
        return () => { messageRequest.current++; };
    }, [selectedChannel, refreshMessages]);

    const connect = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || !token.trim()) return;
        const submittedToken = token;
        setToken("");
        setBusy(true);
        setError(null);
        try {
            const profile = await Native.connect(submittedToken);
            setBot(profile);
            setAddingBot(false);
            try {
                await Native.saveBot();
                await loadSavedBots();
            } catch (saveError) {
                setError(saveError instanceof Error ? `Connected, but not saved: ${saveError.message}` : "Connected, but this bot could not be saved securely.");
            }
            await loadGuilds();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not connect this bot.");
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        setBusy(true);
        try {
            await Native.disconnect();
        } finally {
            setBot(null);
            setGuilds([]);
            setChannels([]);
            setMessages([]);
            setSelectedGuild(null);
            setSelectedChannel(null);
            setToken("");
            setAddingBot(false);
            setError(null);
            setBusy(false);
        }
    };

    const currentGuild = guilds.find(guild => guild.id === selectedGuild);

    return (
        <section className="vc-bot-dashboard" aria-label="Bot Dashboard">
            <header className="vc-bot-dashboard-header">
                <div className="vc-bot-dashboard-brand">
                    <span className="vc-bot-dashboard-mark"><BotIcon /></span>
                    <div><strong>Bot Dashboard</strong><span>Read-only view of your bot's servers</span></div>
                </div>
                {bot && (
                    <div className="vc-bot-dashboard-account-controls">
                        {addingBot ? (
                            <button className="vc-bot-dashboard-disconnect" type="button" onClick={() => setAddingBot(false)} disabled={busy}>
                                Cancel
                            </button>
                        ) : (
                            <>
                                <select
                                    aria-label="Switch bot account"
                                    value={bot.id}
                                    disabled={busy}
                                    onChange={event => void switchBot(event.currentTarget.value)}
                                >
                                    {!savedBots.some(account => account.id === bot.id) && <option value={bot.id}>{bot.globalName || bot.username} · current</option>}
                                    {savedBots.map(account => <option key={account.id} value={account.id}>{account.globalName || account.username}</option>)}
                                </select>
                                <button className="vc-bot-dashboard-add" type="button" onClick={() => { setAddingBot(true); setError(null); }} disabled={busy}>
                                    Add bot
                                </button>
                                <button className="vc-bot-dashboard-disconnect" type="button" onClick={disconnect} disabled={busy}>
                                    Disconnect
                                </button>
                            </>
                        )}
                    </div>
                )}
            </header>

            {!bot || addingBot ? (
                <form className="vc-bot-dashboard-login" onSubmit={connect}>
                    <div className="vc-bot-dashboard-login-icon"><BotIcon /></div>
                    <h2>{bot ? "Add another bot" : "Connect a bot"}</h2>
                    <p>Use a bot token from the Discord Developer Portal. Bot accounts only see servers they have joined and do not have regular friend or group DMs.</p>
                    <label htmlFor="vc-bot-dashboard-token">Bot token</label>
                    <input
                        id="vc-bot-dashboard-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={token}
                        onChange={event => setToken(event.currentTarget.value)}
                        placeholder="Paste bot token"
                        disabled={busy}
                    />
                    <button className="vc-bot-dashboard-connect" type="submit" disabled={busy || !token.trim()}>
                        {busy ? "Connecting…" : "Connect bot"}
                    </button>
                    <div className="vc-bot-dashboard-privacy">Connected bot tokens are encrypted with this device's secure storage. Requests go only to Discord.</div>
                    {savedBots.length > 0 && (
                        <div className="vc-bot-dashboard-saved-list">
                            <div className="vc-bot-dashboard-saved-title">Saved bots <span>{savedBots.length}</span></div>
                            {savedBots.map(account => {
                                const avatar = avatarUrl(account.id, account.avatar, 64);
                                return (
                                    <div className="vc-bot-dashboard-saved-row" key={account.id}>
                                        <button className="vc-bot-dashboard-saved-account" type="button" onClick={() => void switchBot(account.id)} disabled={busy}>
                                            {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="vc-bot-dashboard-saved-fallback">{(account.globalName || account.username).slice(0, 1).toUpperCase()}</span>}
                                            <span>{account.globalName || account.username}</span>
                                            <span className="vc-bot-dashboard-saved-connect">Connect</span>
                                        </button>
                                        <button className="vc-bot-dashboard-saved-remove" type="button" onClick={() => void removeSavedBot(account)} disabled={busy} aria-label={`Remove ${account.username}`} title="Remove saved bot">×</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {error && <div className="vc-bot-dashboard-error" role="alert">{error}</div>}
                </form>
            ) : (
                <div className="vc-bot-dashboard-body">
                    <aside className="vc-bot-dashboard-servers" aria-label="Servers">
                        <div className="vc-bot-dashboard-section-label">SERVERS <span>{guilds.length}</span></div>
                        {guilds.map(guild => {
                            const icon = guildIconUrl(guild);
                            return (
                                <button
                                    className={`vc-bot-dashboard-server${selectedGuild === guild.id ? " is-selected" : ""}`}
                                    type="button"
                                    key={guild.id}
                                    title={guild.name}
                                    aria-label={guild.name}
                                    onClick={() => setSelectedGuild(guild.id)}
                                >
                                    {icon ? <img src={icon} alt="" loading="lazy" /> : <span>{guild.name.slice(0, 2).toUpperCase()}</span>}
                                </button>
                            );
                        })}
                        {guilds.length === 0 && <div className="vc-bot-dashboard-empty-small">No servers found</div>}
                    </aside>

                    <aside className="vc-bot-dashboard-channels" aria-label="Channels">
                        <div className="vc-bot-dashboard-guild-name" title={currentGuild?.name}>{currentGuild?.name ?? "Choose a server"}</div>
                        <div className="vc-bot-dashboard-section-label">TEXT CHANNELS</div>
                        {channels.map(channel => (
                            <button
                                className={`vc-bot-dashboard-channel${selectedChannel?.id === channel.id ? " is-selected" : ""}`}
                                type="button"
                                key={channel.id}
                                onClick={() => setSelectedChannel(channel)}
                                title={`#${channel.name}`}
                            >
                                <span aria-hidden="true">#</span>{channel.name}
                            </button>
                        ))}
                        {selectedGuild && channels.length === 0 && <div className="vc-bot-dashboard-empty-small">No readable text channels</div>}
                    </aside>

                    <main className="vc-bot-dashboard-chat">
                        <div className="vc-bot-dashboard-chat-header">
                            <div><span aria-hidden="true">#</span><strong>{selectedChannel?.name ?? "Select a channel"}</strong></div>
                            <button type="button" onClick={() => void refreshMessages(selectedChannel)} disabled={!selectedChannel || loadingMessages} title="Refresh recent messages" aria-label="Refresh recent messages">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" /></svg>
                            </button>
                        </div>
                        <div className="vc-bot-dashboard-message-list" aria-live="polite">
                            {loadingMessages && <div className="vc-bot-dashboard-message-state">Loading recent messages…</div>}
                            {!loadingMessages && error && <div className="vc-bot-dashboard-message-state is-error">{error}</div>}
                            {!loadingMessages && !error && !selectedChannel && <div className="vc-bot-dashboard-message-state">Choose a server and channel to view messages.</div>}
                            {!loadingMessages && !error && selectedChannel && messages.length === 0 && <div className="vc-bot-dashboard-message-state">No recent messages, or this bot cannot read message history.</div>}
                            {!loadingMessages && messages.map(message => {
                                const displayName = message.author.globalName || message.author.username;
                                const avatar = avatarUrl(message.author.id, message.author.avatar, 64);
                                return (
                                    <article className="vc-bot-dashboard-message" key={message.id}>
                                        {avatar ? <img className="vc-bot-dashboard-avatar" src={avatar} alt="" loading="lazy" /> : <span className="vc-bot-dashboard-avatar vc-bot-dashboard-avatar-fallback">{displayName.slice(0, 1).toUpperCase()}</span>}
                                        <div className="vc-bot-dashboard-message-copy">
                                            <div className="vc-bot-dashboard-message-meta"><strong>{displayName}</strong>{message.author.bot && <span className="vc-bot-dashboard-bot-badge">BOT</span>}{message.timestamp && <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}</div>
                                            <div className="vc-bot-dashboard-message-content">{message.content || (message.attachments.length ? "[Attachment]" : "Message content is unavailable to this bot.")}</div>
                                            {message.attachments.length > 0 && <div className="vc-bot-dashboard-attachments">{message.attachments.map((name, index) => <span key={`${message.id}-${index}`}>{name}</span>)}</div>}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                        <footer className="vc-bot-dashboard-footer">
                            <span className="vc-bot-dashboard-session-dot" />{bot.globalName || bot.username} <span>· read-only · latest 30 · permissions and message intent apply</span>
                        </footer>
                    </main>
                </div>
            )}
            {bot && error && <div className="vc-bot-dashboard-toast" role="alert">{error}</div>}
        </section>
    );
}

function BotDashboardButton() {
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLDivElement>(null);

    return (
        <div ref={buttonRef} className="vc-bot-dashboard-anchor">
            <Popout
                position="bottom"
                align="right"
                spacing={8}
                animation={Popout.Animation.NONE}
                shouldShow={open}
                onRequestClose={() => setOpen(false)}
                targetElementRef={buttonRef}
                renderPopout={() => <DashboardPanel />}
            >
                {(_, { isShown }) => (
                    <HeaderBarButton
                        icon={BotIcon}
                        tooltip={isShown ? null : "Bot Dashboard"}
                        aria-label="Bot Dashboard"
                        selected={isShown}
                        onClick={() => setOpen(value => !value)}
                    />
                )}
            </Popout>
        </div>
    );
}

export default definePlugin({
    name: "BotDashboard",
    description: "Read-only dashboard for a bot you own. Views servers, channels, and recent messages permitted to that bot.",
    tags: ["Utility", "Developers"],
    authors: [Devs.Kbk],
    dependencies: ["HeaderBarAPI"],
    headerBarButton: {
        icon: BotIcon,
        render: BotDashboardButton,
        priority: 850
    },
    stop() {
        void Native.disconnect();
    }
});
