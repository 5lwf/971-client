# 971 Client

971 Client is a community-built Discord client modification with plugins, custom themes, and tools for tailoring the Discord experience.

**Credits to @kk5a - kbk**

## Windows download and updates

[Download the latest 971 Client installer](https://github.com/5lwf/971-client/releases/latest). Quit Discord before installing. In **971 Client Settings → Updater**, enable **Auto update** to download new releases in the background. Restart Discord to apply them. Updates are checked at launch and every 30 minutes.

Pushes to this repository's `main` branch run the **Publish 971 Client** workflow. A successful build publishes the client archives and Windows installer. Installed clients update from these verified release files; unfinished or failed builds are not installed.

## Drover

On Windows, open **971 Client Settings → Drover** and press **Direct**. Finish any active call first: Discord will close and reopen while Direct is applied. The client downloads the official Drover v0.9 ZIP, verifies its SHA-256 checksum, and installs its `version.dll`, empty-proxy `drover.ini`, and optional packet beside the active Discord executable. Existing configuration is backed up before it is replaced. An unrelated `version.dll` is not overwritten.

Drover is developed by [hdrover](https://github.com/hdrover/discord-drover). It is downloaded from the upstream release when requested, rather than bundled in 971 Client. Discord host updates may require applying Direct again. Network effectiveness depends on the connection.

This project retains the original open-source licenses and required third-party notices in `LICENSE` and the included notice files.

## Build from source

Requirements: Git, Node.js 22 or newer, and pnpm 12.

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
```

For a development build with additional plugins:

```sh
pnpm dev
```

To build the browser extension:

```sh
pnpm buildWeb
```

After the build, the extension archives are available in `dist`.

To inject a local desktop build into Discord, use `pnpm inject` from the project directory. To create a self-contained Windows CLI installer, build the desktop client and then run `scripts/buildWindowsCliInstaller.ps1` with a verified CLI installer binary. The result is written to `dist/Installer/971Client_installer-rel_cli.exe`.

## Plugins

971 Client includes its existing plugin library and browser and desktop features. Plugins remain individually configurable in the client settings.

## Disclaimer

Discord is a trademark of Discord Inc. 971 Client is an independent project and is not affiliated with or endorsed by Discord Inc. Use of client modifications and plugins is subject to Discord's current terms and policies.
