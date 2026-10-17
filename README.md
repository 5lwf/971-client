# 971 Client

971 Client is a community-built Discord client modification with plugins, custom themes, and tools for tailoring the Discord experience.

**Credits to @kk5a - kbk**

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
