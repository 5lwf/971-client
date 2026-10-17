# SpotifyLyricsStatus

Enable **SpotifyLyricsStatus** in **971 Client Settings → Plugins**, then play music on your Spotify account connected to Discord. The plugin uses Discord's Spotify playback events and LRCLIB's timestamped lyrics, sending the current line to your custom status.

The settings include a click-to-reveal warning: frequent custom status requests can be too much for Discord's API and cause temporary rate limits. The minimum update interval defaults to five seconds and can be adjusted from two to sixty seconds. This is a throttle, not a guarantee against limits. Fast lines may be skipped. Reported retry delays are respected; other errors trigger a one-minute cooldown.

Disable **LyricsStatus** and **AnimatedStatus** before using this plugin. It pauses while either is enabled to avoid competing status changes. Tracks without synced lyrics leave your original status in place. The previous status is restored when playback pauses or the plugin is disabled, subject to any active request cooldown. Editing your status manually pauses updates until you toggle the plugin again.

Track title, artist, and duration are sent to LRCLIB to find matching lyrics. Spotify access tokens are not sent to the lyrics provider. The plugin is disabled by default.
