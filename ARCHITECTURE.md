# Mettu (மெட்டு)

Mettu is a ringtone studio in English and Tamil. You bring in a song you already have (a file, a share from another app, or a microphone recording), trim the part you love on a waveform that snaps to quiet points and beats, fade and level it, hear it on a pretend incoming call, and set it as your ringtone, alarm, notification or one contact's tone. All audio work happens on the device with the Web Audio API; nothing is uploaded and there is no account. The engineering idea is "one web app, three honest endings": the Android app sets the tone through a small native plugin, the iPhone app exports a real `.m4r` ringtone file (Apple lets no app set the ringtone), and the website downloads a levelled MP3 or WAV with clear steps.

| Platforms | Stack | Data | Hosting |
|---|---|---|---|
| Web PWA (share target), Android app (Capacitor shell + native plugin), iPhone app (SwiftUI shell + ringtone exporter) | Plain HTML, CSS and classic scripts; Web Audio and OfflineAudioContext; Kolam design system | The user's own audio in IndexedDB; YouTube and Spotify oEmbed and iTunes Search for naming songs | Vercel (mettu.vercel.app), APK on GitHub Releases |

## System architecture

`index.html` loads six classic scripts in order: `i18n.js`, `audio.js`, `lookup.js`, `store.js`, `native.js` and `app.js`. Each exposes one object (`I18N`, `Audio2`, `Lookup`, `Store`, `Native`) that `app.js` uses. There is no server code at all. The native shells add the platform abilities a browser lacks: on Android a Capacitor plugin called `MettuNative`, on iPhone a `ringtone` script-message handler.

```mermaid
flowchart TB
  subgraph Shells["Native shells"]
    And["Android: Capacitor 8 shell<br>+ MettuNative plugin"]
    IOS["iPhone: SwiftUI WKWebView shell<br>+ RingtoneExporter"]
  end
  subgraph Client["Browser or app web view"]
    UI["app.js<br>screens, waveform editor, ring test"]
    AU["audio.js<br>decode, analyse, render, encode"]
    LK["lookup.js<br>link parsing and song lookup"]
    NB["native.js<br>bridge with web fallbacks"]
    Kits["Kolam M3 and iOS kits<br>active only inside the apps"]
  end
  subgraph State["On the device"]
    IDB["IndexedDB mettu / tones<br>finished tones as WAV, MP3 copy"]
    LS["localStorage mettu.*<br>settings and language"]
    SW["Service worker<br>offline shell, share target"]
  end
  subgraph APIs["Public services, no keys"]
    YT["YouTube oEmbed"]
    SP["Spotify oEmbed"]
    IT["iTunes Search"]
    CDN["jsDelivr<br>lamejs MP3 encoder"]
  end
  Shells -->|"load the live site"| Client
  UI --> AU
  UI --> LK
  UI --> NB
  UI --> Kits
  UI <--> IDB
  UI <--> LS
  SW -->|"shared audio file"| UI
  LK --> YT
  LK --> SP
  LK --> IT
  AU -->|"on demand"| CDN
  NB -->|"Capacitor plugin calls"| And
  NB -.->|"webkit message"| IOS
```

*Static site on Vercel with no functions. Song lookups only fetch titles and artists; Mettu never downloads audio from any service.*

## Main user flow

The core job is "make the best 20 to 30 seconds of a song my ringtone". A stepper walks the user through Trim, Shape and Ring test, then the tone is saved to My tones and set.

```mermaid
flowchart TD
  S(["Open Mettu"]) --> M["Make: choose a file, record,<br>try the sample, or receive a share"]
  M --> Dec["Decode and analyse<br>quiet points, onsets, beats"]
  Dec --> Tr["Trim: overview + zoomed waveform,<br>15, 20, 30 or 40 s, Find the best part"]
  Tr --> Sh["Shape: fade in and out,<br>level Off, Soft, Standard or Loud"]
  Sh --> RT["Ring test: full-screen fake call,<br>25-second ring marker"]
  RT --> Save["Save to My tones"]
  Save --> Where{"Where is it running?"}
  Where -->|"Android app"| A1["Set as ringtone, notification,<br>alarm or a contact's tone"]
  Where -->|"iPhone app"| I1["Export .m4r or .m4a<br>through the share sheet"]
  Where -->|"Browser"| W1["Download MP3 or WAV<br>with Android and iPhone steps"]
  M -->|"Paste a YouTube or Spotify link"| F["Find a song: title, artist,<br>licensed places to get it"]
```

*Instagram links are recognised but honestly reported as not identifiable.*

## Data flow and state

### From a song to a levelled tone

```mermaid
sequenceDiagram
  participant U as User
  participant A as app.js
  participant W as audio.js
  participant O as OfflineAudioContext
  participant D as IndexedDB
  U->>A: Choose a song file
  A->>W: decode the file
  W-->>A: AudioBuffer
  A->>W: analyse the buffer
  W-->>A: Loudness curve, quiet points, onsets, tempo and beat grid
  U->>A: Tap Find the best part
  A->>W: bestPart for the chosen length
  W-->>A: Start and end snapped to clean points
  U->>A: Pick fades and the Standard level
  A->>W: render with start, end, fades, target minus 14 LUFS
  W->>O: Apply fades offline
  O-->>W: Faded audio
  loop Up to 6 passes
    W->>W: Gain, look-ahead limiter at minus 1 dBFS, measure LUFS
  end
  W-->>A: Tone, loudness before and after, peak
  U->>A: Save
  A->>W: Encode WAV
  A->>D: Store the tone
```

*Level targets are Soft minus 18, Standard minus 14 and Loud minus 10 LUFS. The render stops when it is within 0.4 LU of the target or the gain reaches 16 times.*

### How the audio engine decides

| Step | Method in `audio.js` |
|---|---|
| Quiet points | Loudness in frames of about 11.6 ms, smoothed over about 60 ms; local minima become snap targets |
| Onsets | Rectified rise in high-frequency log energy |
| Tempo and beats | Autocorrelation of onset strength between 60 and 180 BPM, with a mild preference near 110, plus a confidence score |
| Snapping | Nearest quiet point, beat or onset within range; quiet points win ties for starts and ends |
| Best part | Scores every candidate start: 55 percent loudness in the first 10 seconds (calls are answered quickly), 45 percent loudness over the whole clip, a penalty for starting in the intro |
| Loudness | BS.1770-style K-weighting through an OfflineAudioContext, gated; an approximation, as the code says |
| Limiter | 5 ms look-ahead peak limiter, so "Loud" gets loud without clipping |
| Encoding | WAV written in the page; MP3 through lamejs 1.2.1, loaded from jsDelivr only when first needed |
| Sample tune | A 48-second piece synthesised in the page, so there are no licence questions |
| Recording | `MediaRecorder` from the microphone |

### Setting the tone on each platform

```mermaid
flowchart LR
  T["Saved tone<br>WAV in IndexedDB"] --> Q{"native.js:<br>which platform?"}
  Q -->|"Android app"| MP3["Encode MP3,<br>WAV if that fails"]
  MP3 --> P["MettuNative.setTone"]
  P --> MS["MediaStore:<br>Ringtones, Notifications<br>or Alarms / Mettu"]
  MS --> RM["RingtoneManager default,<br>or contact CUSTOM_RINGTONE"]
  P -->|"needs-permission"| WS["Open Modify system settings"]
  Q -->|"iPhone app"| B64["WAV as base64"]
  B64 --> RE["RingtoneExporter:<br>AVAssetExportSession to AAC,<br>40 s maximum"]
  RE --> SH["Share sheet:<br>Files, AirDrop to Finder,<br>GarageBand"]
  Q -->|"Browser"| DL["Download MP3 or WAV<br>+ step-by-step help"]
```

### Where state lives

| Store | Key or name | What it holds |
|---|---|---|
| IndexedDB | database `mettu`, store `tones` | Each saved tone: id, name, created time, duration, LUFS, source file name, WAV blob and, once made, an MP3 copy |
| localStorage | `mettu.lang`, `mettu.len`, `mettu.snap`, `mettu.fadeIn`, `mettu.fadeOut`, `mettu.level` | Language and the last editor settings |
| Cache Storage | `mettu-shell-v4-ios` | App files, fonts, lamejs and the Kolam kits |
| Cache Storage | `mettu-share` | One file shared to the installed PWA, held until the page picks it up |
| Memory only | `S` in `app.js` | The open song's buffer, analysis and selection |

## Key modules

| File / module | Responsibility |
|---|---|
| `index.html` | Header, navigation, live region, dialog and call layers; loads the Kolam CSS, the M3 and iOS kits and the six scripts |
| `app.js` | About 850 lines: screens Make, Editor (Trim, Shape, Ring test), My tones, Find a song, About; waveform drawing with keyboard-operable handles (`role="slider"`); share intake; Android and iOS app modes |
| `audio.js` | The audio engine described above |
| `lookup.js` | Parses YouTube, YouTube Music, Spotify and Instagram links; names the song through oEmbed and iTunes Search; lists licensed stores (YouTube Music, Spotify, JioSaavn, Apple Music, Amazon Music) |
| `store.js` | Tiny IndexedDB wrapper: all, get, put, remove |
| `native.js` | Bridge to `MettuNative`: setTone, pickContact, playRing, stopRing, ringVolume, getShared, open settings |
| `i18n.js` | English and Tamil interface text, including iOS-specific wording |
| `sw.js` | Offline shell and the Web Share Target handler |
| `android/` | Source copy of the native plugin, manifest and Capacitor config; the build project is `android-wrappers/mettu` |
| `tools/shots.mjs` | Portfolio screenshots |

## Platforms

### Web and PWA

Built on the Kolam design system (`kolam/tokens.css` and `kolam/kolam.css`, Lato, 8-point grid), overriding only the primary colour family with Mettu violet `#5a3ec8`. The manifest declares a share target, so on Android the installed PWA appears in the share sheet for audio and video files and links.

### Android app

A Capacitor 8 shell in `android-wrappers/mettu` (app id `com.gopinath.mettu`) that loads `https://mettu.vercel.app`, plus the hand-written `MettuNativePlugin.java`:

- **Share intake:** intent filters for `audio/*` and `video/*` ("Make a ringtone") and `text/plain` links ("Name this song"), and opening audio files.
- **Set the tone:** saves the file to MediaStore in Ringtones, Notifications or Alarms under a `Mettu` folder, then makes it the default through `RingtoneManager` (`setActualDefaultRingtoneUri`). This needs the "Modify system settings" permission, which the app explains and opens for the user.
- **One contact's tone:** contact picker, then `CUSTOM_RINGTONE` on that contact (needs contacts permission).
- **Ring test:** plays on the ring stream (`USAGE_NOTIFICATION_RINGTONE`) at ring volume.

Inside the app the Kolam M3 kit sets `html.k-android` and `app.js` builds the Material 3 app bar and navigation bar (Make, Find a song, My tones, About).

### iPhone app

A SwiftUI `WKWebView` shell in `Mettu-iOS` from the Kolam iOS template, plus `RingtoneExporter`: the page posts the finished WAV, the shell converts it to AAC with `AVAssetExportSession` (cut to 40 seconds, the iPhone ringtone limit), names it `.m4r` (or `.m4a` for GarageBand) and opens the share sheet. The page then shows the Finder and GarageBand steps in an iOS sheet. The Kolam iOS kit sets `html.k-ios` for large titles, a tab bar and iOS buttons.

## Data sources and APIs

| Source | Used for | Licence / key |
|---|---|---|
| The user's own audio | Everything the app edits | Stays on the device |
| YouTube oEmbed | Title and channel of a pasted YouTube link | Free, no key, CORS-enabled |
| Spotify oEmbed | Title of a pasted Spotify link | Free, no key, CORS-enabled |
| iTunes Search API | Best catalogue match (country IN) for the title | Free, no key |
| jsDelivr | `lamejs@1.2.1` MP3 encoder | Free CDN |

## Offline, performance, privacy and accessibility

- **Offline:** after the first visit the whole studio works offline; only song naming needs the network. The service worker fetches app files from the network first and falls back to the cache.
- **Speed:** decoding, analysis and rendering run in the page; the MP3 encoder loads only when someone first needs an MP3, and the MP3 copy is cached on the tone.
- **Privacy:** no account, no upload, no analytics. `vercel.json` sends a `Permissions-Policy` allowing only the microphone (camera and location off), plus `nosniff` and a strict referrer policy.
- **Honesty:** Mettu never downloads or rips audio from YouTube, Spotify or Instagram; it only names the song and links to licensed stores.
- **Accessibility:** the waveform handles are keyboard sliders with labels, announcements go through a live region, the ring test is a labelled modal dialog, and Kolam keeps WCAG AA contrast in light, dark and contrast themes.

## Build and deploy

```mermaid
flowchart LR
  Dev["All pets/mettu"] --> GH["git push to main<br>tgopinath/mettu"]
  GH --> V["Vercel: static files,<br>no build step"]
  V --> Live["mettu.vercel.app"]
  Dev -->|"copy plugin source"| AW["android-wrappers/mettu<br>.keep-native"]
  AW --> Sync["npx cap sync android"]
  Sync --> Gr["gradlew assembleDebug"]
  Gr --> Rel["mettu.apk on GitHub release v1.0.0"]
  Live --> AW
  Live --> IOSS["Mettu-iOS shell<br>xcodebuild"]
```

*The web part of both apps updates with every push; only native changes (the plugin or the exporter) need a new APK or iOS build.*

## Known limits and next steps

- Loudness is an approximation of BS.1770 written in the page, not a certified meter.
- The original brief left iPhone ringtone support out of scope; the iOS exporter was added later, and the user still has to finish in Finder or GarageBand because iOS allows nothing more.
- The APK is a debug build, installed by side-loading; the "Modify system settings" step is an extra screen some users will find confusing.
- `android/` in this repo is a copy of the plugin; the build happens in a separate folder, so the two must be kept in step by hand.
- Tones are stored as WAV, which uses more space than needed; storing only the MP3 or AAC would be lighter.
- There is no audio fingerprinting ("listen and identify"), by design for v1.

---

Written from the source code on 17 November 2026. Source: [github.com/tgopinath/mettu](https://github.com/tgopinath/mettu) (web app and plugin source) and [github.com/tgopinath/Mettu-iOS](https://github.com/tgopinath/Mettu-iOS) (iPhone shell).
