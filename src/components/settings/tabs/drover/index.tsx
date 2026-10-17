/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { useAwaiter } from "@utils/react";
import { React } from "@webpack/common";

function Drover() {
    const [status, error, loading] = useAwaiter(() => VencordNative.drover.status());
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState("");

    return <SettingsTab>
        <Heading>Drover</Heading>
        <Paragraph>Use Drover Direct mode for Discord voice connections without configuring a proxy.</Paragraph>
        <Paragraph>Direct downloads the official Drover v0.9 files, closes Discord, installs them, then opens Discord again. Finish your call before continuing.</Paragraph>
        <Card><Paragraph>{loading ? "Checking Drover..." : error ? "Could not check Drover." : status?.message}</Paragraph></Card>
        {failure && <Card variant="warning"><Paragraph>{failure}</Paragraph></Card>}
        <Button disabled={busy || loading || !status?.supported} onClick={async () => {
            setBusy(true);
            setFailure("");
            try {
                await VencordNative.drover.direct();
            } catch (e) {
                setFailure(e instanceof Error ? e.message : String(e));
                setBusy(false);
            }
        }}>{busy ? "Preparing Direct..." : "Direct"}</Button>
        <Paragraph>Drover is developed by hdrover. Network results depend on your connection. Discord updates can require applying Direct again.</Paragraph>
        <Link href="https://github.com/hdrover/discord-drover">Drover source and instructions</Link>
    </SettingsTab>;
}

export default wrapTab(Drover, "Drover");
