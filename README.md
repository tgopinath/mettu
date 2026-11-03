# Mettu (மெட்டு)

A ringtone studio, in English and Tamil. Bring in a song you already have (a file, a share from another app, or a mic recording), trim it on a waveform that snaps to quiet points and beats, fade and level it, hear it on a fake incoming call, and set it as your ringtone, alarm or one contact's tone.

Paste a YouTube or Spotify link and Mettu names the song (YouTube oEmbed, Spotify oEmbed, iTunes Search: free and keyless) and shows the licensed places to get it. Instagram links are recognised but cannot be identified. Mettu never downloads audio from any of these services.

Live: https://mettu.vercel.app · Android: https://github.com/tgopinath/mettu/releases/latest/download/mettu.apk

## How it works
- `audio.js` — decode (Web Audio), analysis (smoothed loudness minima = quiet points; high-frequency flux peaks = onsets; onset autocorrelation = tempo and beat grid), "best part" search (loud in the first 10 s, starts on a clean point), BS.1770-style loudness (K-weighting via OfflineAudioContext, gated), look-ahead peak limiter (true peak kept at −1 dBFS), WAV encoder, MP3 via lamejs (jsDelivr, loaded on demand), and the built-in 48-second sample tune (synthesised, no licence questions).
- `app.js` — screens: Make, Editor (Trim / Shape / Ring test), My tones, Find a song, About. The waveform has an overview strip and a zoomed close-up with keyboard-operable handles (`role="slider"`).
- `lookup.js` — link parsing and the keyless song lookups.
- `store.js` — tones in IndexedDB, on the device only. No account, no upload.
- `native.js` — bridge to the Android app's `MettuNative` plugin; every call has a web fallback (download + clear steps for Android and iPhone).
- `sw.js` — offline shell and the Web Share Target (installed PWA on Android can receive audio from the share sheet).

## Android app
A Capacitor shell that loads the live site, plus a small native plugin (source copy in `android/`; the build project is `~/Documents/android-wrappers/mettu`, see `.keep-native`):
share-sheet intake for `audio/*`, `video/*` and `text/plain` links; MediaStore save + `RingtoneManager.setActualDefaultRingtoneUri` (needs "Modify system settings", which the app asks the user to switch on); contact picker + `CUSTOM_RINGTONE`; ring test played on the ring stream (`USAGE_NOTIFICATION_RINGTONE`).

Build: `cd ~/Documents/android-wrappers/mettu && npx cap sync android && (cd android && ./gradlew assembleDebug)`, then upload `app-debug.apk` as `mettu.apk` to release v1.0.0.

## Develop
`python3 -m http.server 5290` in this folder (or the `mettu` launch config). Card screenshots: `node tools/shots.mjs` → `prototype/shots`.

Design system: [Kolam](https://tgopinath.github.io/kolam-design-system/) (Lato, 8-pt grid, WCAG AA); Mettu overrides only the primary colour family (Mettu violet).
