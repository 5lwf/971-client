/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { clearHandledMessages, handleIncomingProfile, SharePluginsSettings } from "./components";

const settings = definePluginSettings({
    share: {
        type: OptionType.COMPONENT,
        description: "",
        component: SharePluginsSettings,
    },
});

export default definePlugin({
    name: "Share Plugins",
    description: "Share an enabled plugin profile with a Discord friend and review incoming profiles before applying them.",
    authors: [Devs.Kbk],
    tags: ["Utility", "Customisation"],
    settings,

    flux: {
        MESSAGE_CREATE({ message }: { message: { id?: string; author?: { id?: string; }; channel_id?: string; content?: string; state?: string; }; }) {
            handleIncomingProfile(message);
        },
    },

    stop() {
        clearHandledMessages();
    },
});
