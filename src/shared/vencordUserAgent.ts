/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

export { gitHash, gitRemote };

export const clientRepository = "5lwf/971-client";
export const gitHashShort = gitHash.slice(0, 9);
export const VENCORD_USER_AGENT = `971 Client/${gitHash}${clientRepository ? ` (https://github.com/${clientRepository})` : ""}`;
export const VENCORD_USER_AGENT_HASHLESS = `971 Client${clientRepository ? ` (https://github.com/${clientRepository})` : ""}`;
