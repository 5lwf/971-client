/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import { Button } from "@components/Button";
import { openPrivateChannel } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, type RenderModalProps } from "@utils/modal";
import { ChannelStore, MessageActions, RelationshipStore, SelectedChannelStore, showToast, TextInput, Toasts, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { applyPluginSet, clearSnapshot, type DecodedProfile,decodeProfile, makeProfileMessage, readSnapshot, reportApplied } from "./profile";

interface MessageData {
    id?: string;
    author?: { id?: string; };
    channel_id?: string;
    content?: string;
    state?: string;
}

function ShareModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const { onClose } = modalProps;
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const friends = useMemo(() => RelationshipStore.getFriendIDs()
        .map(id => UserStore.getUser(id))
        .filter(user => user !== undefined)
        .sort((a, b) => (a.globalName || a.username).localeCompare(b.globalName || b.username)), []);
    const filteredFriends = friends.filter(user => `${user.globalName ?? ""} ${user.username}`.toLowerCase().includes(query.trim().toLowerCase()));

    async function send() {
        if (!selectedId || sending) return;
        setSending(true);
        try {
            const message = makeProfileMessage();
            const opened = await openPrivateChannel(selectedId, true);
            const channelId = typeof opened === "string" ? opened : SelectedChannelStore.getChannelId();
            const channel = ChannelStore.getChannel(channelId);
            if (!channel || channel.type !== 1 || !channel.recipients.includes(selectedId)) {
                throw new Error("Could not open the selected friend's direct message.");
            }

            await MessageActions.sendMessage(channelId, { content: message, invalidEmojis: [] }, undefined, {});
            showToast("Plugin profile sent. Your friend can review it in 971 Client.", Toasts.Type.SUCCESS);
            onClose();
        } catch (error) {
            showToast((error as Error).message || "Could not send the plugin profile.", Toasts.Type.FAILURE);
            setSending(false);
        }
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM} className="vc-971-plugin-share-modal">
            <ModalHeader>
                <div className="vc-971-plugin-share-title">
                    <span>Share Plugins</span>
                    <small>Choose a friend to share your enabled plugin setup.</small>
                </div>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-971-plugin-share-search">
                    <span aria-hidden="true">⌕</span>
                    <TextInput value={query} onChange={setQuery} placeholder="Search friends" />
                </div>
                <div className="vc-971-plugin-share-friends" role="radiogroup" aria-label="Choose a friend">
                    {filteredFriends.map(user => {
                        const label = user.globalName || user.username;
                        const selected = selectedId === user.id;
                        return (
                            <button
                                type="button"
                                className={`vc-971-plugin-share-friend${selected ? " selected" : ""}`}
                                key={user.id}
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setSelectedId(user.id)}
                            >
                                <span className="vc-971-plugin-share-avatar">{label.slice(0, 1).toUpperCase()}</span>
                                <span className="vc-971-plugin-share-name">{label}<small>@{user.username}</small></span>
                                <span className="vc-971-plugin-share-radio" aria-hidden="true" />
                            </button>
                        );
                    })}
                    {filteredFriends.length === 0 && <div className="vc-971-plugin-share-empty">{friends.length ? "No friends match your search." : "Your Discord friends will appear here."}</div>}
                </div>
                <div className="vc-971-plugin-share-note">Only plugin on/off states are shared. No tokens, plugin settings, or files are included.</div>
            </ModalContent>
            <ModalFooter>
                <Button variant="primary" disabled={!selectedId || sending} onClick={send}>{sending ? "Sending…" : "Send profile"}</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openSharePluginsModal() {
    if (!isPluginEnabled("Share Plugins")) {
        showToast("Enable Share Plugins in the Plugins settings first.", Toasts.Type.FAILURE);
        return;
    }
    openModal(props => <ShareModal modalProps={props} />);
}

function IncomingProfileModal({ modalProps, senderName, profile }: { modalProps: RenderModalProps; senderName: string; profile: DecodedProfile; }) {
    const [applying, setApplying] = useState(false);
    const enabledCount = profile.compatible ? profile.enabledIds.length : 0;

    async function accept() {
        if (applying || !profile.compatible) return;
        setApplying(true);
        try {
            const result = await applyPluginSet(profile.enabledIds, true);
            reportApplied(result);
            modalProps.onClose();
        } catch (error) {
            showToast((error as Error).message || "Could not apply the plugin profile.", Toasts.Type.FAILURE);
            setApplying(false);
        }
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM} className="vc-971-plugin-share-modal">
            <ModalHeader>
                <div className="vc-971-plugin-share-title">
                    <span>Plugin profile from {senderName}</span>
                    <small>{profile.compatible ? `${enabledCount} plugins enabled in this profile` : "This profile was made with a different plugin set."}</small>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-971-plugin-share-review">
                    <strong>{profile.compatible ? "Replace your current plugin setup?" : "This profile is not compatible."}</strong>
                    <p>{profile.compatible
                        ? "Accepting turns off your current optional plugins and enables the matching setup. Required client components stay on. No plugins are downloaded, and you can restore your previous setup from Share Plugins settings."
                        : "Install the same 971 Client build and plugin set as the sender, then ask them to share again."}</p>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button variant="secondary" onClick={modalProps.onClose}>Decline</Button>
                {profile.compatible && <Button variant="primary" disabled={applying} onClick={accept}>{applying ? "Applying…" : "Accept and apply"}</Button>}
            </ModalFooter>
        </ModalRoot>
    );
}

const handledMessages = new Set<string>();

export function handleIncomingProfile(message: MessageData) {
    const messageId = message.id;
    const senderId = message.author?.id;
    const channelId = message.channel_id;
    if (!messageId || !senderId || !channelId || !message.content || message.state === "SENDING" || handledMessages.has(messageId)) return;
    if (!message.content.includes("||971CLIENT:1:")) return;
    if (senderId === UserStore.getCurrentUser()?.id || !RelationshipStore.isFriend(senderId)) return;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || channel.type !== 1) return;

    const decoded = decodeProfile(message.content);
    if (!decoded) return;
    handledMessages.add(messageId);
    const sender = UserStore.getUser(senderId);
    const senderName = sender?.globalName || sender?.username || "Your friend";
    openModal(modalProps => <IncomingProfileModal modalProps={modalProps} senderName={senderName} profile={decoded} />);
}

export function clearHandledMessages() {
    handledMessages.clear();
}

function SharePluginsSettings() {
    const [hasSnapshot, setHasSnapshot] = useState(false);

    useEffect(() => {
        let mounted = true;
        const update = () => void readSnapshot().then(snapshot => {
            if (mounted) setHasSnapshot(snapshot !== null);
        });
        update();
        window.addEventListener("971-plugin-share-snapshot", update);
        return () => {
            mounted = false;
            window.removeEventListener("971-plugin-share-snapshot", update);
        };
    }, []);

    async function restore() {
        const snapshot = await readSnapshot();
        if (!snapshot) return;
        const result = await applyPluginSet(snapshot, false);
        await clearSnapshot();
        setHasSnapshot(false);
        reportApplied(result);
    }

    return (
        <div className="vc-971-plugin-share-settings">
            <div>
                <strong>Share your plugin setup</strong>
                <p>Send a private profile to a Discord friend. They choose whether to apply it.</p>
            </div>
            <div className="vc-971-plugin-share-actions">
                <Button variant="primary" onClick={openSharePluginsModal}>Share Plugins</Button>
                {hasSnapshot && <Button variant="secondary" onClick={restore}>Restore previous setup</Button>}
            </div>
            <small>Both people need the Share Plugins feature enabled. Profiles include only the plugin on/off states.</small>
        </div>
    );
}

export { SharePluginsSettings };
