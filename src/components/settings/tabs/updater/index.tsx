/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading, HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { useAwaiter } from "@utils/react";
import { getRepo, isNewer, UpdateLogger } from "@utils/updater";
import { React } from "@webpack/common";

import gitHash from "~git-hash";

import { HashLink, Newer, Updatable } from "./Components";

interface CommonProps {
    repo: string;
    repoPending: boolean;
}

function EquibopSection() {
    if (!IS_EQUIBOP) return null;

    const [isEquibopOutdated] = useAwaiter<boolean>(VesktopNative.app.isOutdated, { fallbackValue: false });

    return (
        <Flex className={Margins.bottom20} flexDirection="column" gap="1em">
            <Card variant="brand">
                <HeadingSecondary>Equibop & 971 Client</HeadingSecondary>
                <Paragraph>Equibop and 971 Client are separate applications. This updater is for 971 Client.</Paragraph>
                <Paragraph className={Margins.top8}>
                    Equibop updates are managed separately. This updater only covers 971 Client.
                </Paragraph>
            </Card>

            {isEquibopOutdated && (
                <Card variant="warning">
                    <HeadingSecondary>Equibop Outdated</HeadingSecondary>
                    <Flex flexDirection="column" gap="0.5em">
                        <Paragraph>Your version of Equibop is outdated!</Paragraph>
                        <Button variant="link" onClick={() => VesktopNative.app.openUpdater()}>Open Equibop Updater</Button>
                    </Flex>
                </Card>
            )}
        </Flex>
    );
}

function Updater() {
    const settings = useSettings(["autoUpdate", "autoUpdateNotification", "updaterBranch"]);

    const [repo, err, repoPending] = useAwaiter(getRepo, { fallbackValue: "Loading..." });

    React.useEffect(() => {
        if (err)
            UpdateLogger.error("Failed to retrieve repo", err);
    }, [err]);

    const commonProps: CommonProps = {
        repo,
        repoPending
    };

    if (!repoPending && !repo) {
        return (
            <SettingsTab>
                <Heading>Updates unavailable</Heading>
                <Paragraph>Automatic updates are not configured for this 971 Client build.</Paragraph>
            </SettingsTab>
        );
    }

    return (
        <SettingsTab>
            <EquibopSection />
            <Heading className={Margins.top16}>Update Preferences</Heading>
            <Paragraph className={Margins.bottom20}>
                Updates come from 5lwf/971-client on GitHub. New builds download automatically when Auto update is enabled and take effect after restarting Discord.
            </Paragraph>

            <div className="vc-settings-switches">
                <FormSwitch
                    title="Auto update"
                    description="When enabled, 971 Client will automatically download and install updates in the background without asking for confirmation. You\'ll need to restart Discord to apply the changes."
                    value={settings.autoUpdate}
                    onChange={(v: boolean) => settings.autoUpdate = v}
                    hideBorder
                />
                <FormSwitch
                    title="Get notified when an automatic update completes"
                    description="Receive a notification when 971 Client finishes downloading an update in the background, so you know when to restart Discord."
                    value={settings.autoUpdateNotification}
                    onChange={(v: boolean) => settings.autoUpdateNotification = v}
                    disabled={!settings.autoUpdate}
                    hideBorder
                />
            </div>

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>Repository</Heading>
            <Paragraph className={Margins.bottom8}>
                This is the GitHub repository where 971 Client fetches updates from.
            </Paragraph>
            <Paragraph color="text-subtle">
                {repoPending
                    ? repo
                    : err
                        ? "Failed to retrieve - check console"
                        : (
                            <Link href={repo}>
                                {repo.split("/").slice(-2).join("/")}
                            </Link>
                        )
                }
                {" "}(<HashLink hash={gitHash} repo={repo} disabled={repoPending} />)
            </Paragraph>

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>Updates</Heading>
            {isNewer ? <Newer {...commonProps} /> : <Updatable key={settings.updaterBranch} {...commonProps} />}
        </SettingsTab>
    );
}

export default IS_UPDATER_DISABLED
    ? null
    : wrapTab(Updater, "Updater");
