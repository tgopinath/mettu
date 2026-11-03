# Mettu Android shell

Source copy of the native parts of the Capacitor shell that lives in `~/Documents/android-wrappers/mettu` (marked `.keep-native`, so `build-remote.sh` keeps them):

- `MettuNativePlugin.java` — share-sheet intake (audio, video, text links), MediaStore save + `RingtoneManager`, contact picker + `CUSTOM_RINGTONE`, ring test on the ring stream, ring volume / ringer mode.
- `MainActivity.java` — registers the plugin.
- `AndroidManifest.xml` — intent filters and permissions (each one explained inline).
- `capacitor.config.json` — loads https://mettu.vercel.app.

Rebuild: copy these into the wrapper (`app/src/main/java/com/gopinath/mettu/`, `app/src/main/`), then `npx cap sync android && (cd android && ./gradlew assembleDebug)`.
