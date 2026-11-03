# Mettu (மெட்டு) — brief

## Problem
People want a specific 20 seconds of a song as their ringtone: usually the chorus or BGM of a Tamil film song. The Play Store answer is an ad-heavy "ringtone maker" full of dark patterns, or a ripper app that breaks or gets pulled. Even when they manage it, the cut starts mid-word, is too quiet, or the good part arrives after the phone has stopped ringing.

## User
An Android phone owner in Tamil Nadu (English or Tamil), comfortable with WhatsApp and YouTube, not with audio editors. Secondary: anyone on the web who wants a clean, levelled clip file.

## Jobs to be done
1. "Get the part I love out of a song I already have, without it sounding clipped."
2. "Make sure it is loud enough and that the best bit plays before I answer."
3. "Hear it the way it will ring, before I commit."
4. "Set it as my ringtone, alarm or one person's tone without digging through Settings."
5. "I heard it on YouTube / Spotify / Instagram: what is it called and where can I get it properly?"

## v1 screens
1. **Make (bring in)** — choose a file, receive one shared from another app, record from the mic, or try the built-in sample. Recent tones.
2. **Editor: Trim** — overview + zoomed waveform, handles that snap to quiet points and beats, 15/20/30/40 s presets, "Find the best part", 0.1 s nudges, keyboard sliders.
3. **Editor: Shape** — fade in/out, loudness levelling (Soft / Standard / Loud, measured in LUFS before and after), loop preview.
4. **Ring test** — full-screen fake incoming call that plays the clip (at ring volume in the Android app), with the "phones ring for about 25 seconds" marker.
5. **My tones** — saved tones; set as ringtone / notification / alarm / contact (Android app), or download WAV/MP3 with clear steps (web, iPhone).
6. **Find a song** — paste a YouTube or Spotify link → title and artist via free keyless lookups (oEmbed + iTunes Search) → licensed places to get it. Instagram links are recognised and honestly not identified.
7. **About** — how it works, privacy (nothing leaves the phone), why it never downloads from YouTube or Spotify.

## Data / tech
- Web Audio API (decode, analysis), OfflineAudioContext (fades, level, K-weighted loudness), WAV encoder, MP3 via lamejs (jsDelivr, lazy).
- YouTube oEmbed, Spotify oEmbed, iTunes Search API: all keyless and CORS-enabled; nothing is downloaded from them.
- IndexedDB for tones. No accounts: everything stays on the device, so Kolam Auth is not used.
- Android: Capacitor shell loading the live site + a small native plugin (MediaStore save, RingtoneManager, contact picker + CUSTOM_RINGTONE, share-sheet intake, playback on the ring stream).
- Kolam design system (Lato, 8-pt grid, AA), per-app primary: Mettu violet.

## Success criteria
- From a file to a set ringtone in under a minute, under 6 taps after trimming.
- Cuts never start or end mid-sound when snapping is on.
- Output is never clipped (true peak ≤ −1 dBFS) and lands within 1 LU of the chosen target.
- Works offline after first load; nothing uploaded.
- WCAG AA in light, dark and contrast; waveform handles usable by keyboard and screen reader.

## Out of scope (v1)
- Downloading or ripping audio from YouTube, Spotify, Instagram or any site.
- Audio fingerprinting ("listen and identify").
- Multi-track editing, effects beyond fade/level, iOS native ringtone setting (Apple does not allow it; the app explains the GarageBand route).
- Accounts and cloud sync.
