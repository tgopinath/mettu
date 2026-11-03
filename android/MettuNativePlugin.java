package com.gopinath.mettu;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Mettu's native side: what a web page cannot do on Android.
 * - receive audio (or a YouTube/Spotify link) from the share sheet
 * - save a tone to MediaStore and set it as the default ringtone, notification or alarm (RingtoneManager)
 * - pick a contact and give them their own ringtone (CUSTOM_RINGTONE)
 * - play the ring test on the ring stream, at the phone's real ring volume
 */
@CapacitorPlugin(
    name = "MettuNative",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS }, alias = "contacts"),
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class MettuNativePlugin extends Plugin {
    private static final int MAX_SHARE_BYTES = 60 * 1024 * 1024;
    private Uri pendingUri;
    private String pendingText;
    private MediaPlayer player;

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        take(intent);
    }

    private void take(Intent i) {
        if (i == null) return;
        String action = i.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) pendingUri = u;
            else if (i.getStringExtra(Intent.EXTRA_TEXT) != null) pendingText = i.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_VIEW.equals(action) && i.getData() != null && !"https".equals(i.getData().getScheme())) {
            pendingUri = i.getData();
        } else return;
        // Consume it so a config change does not deliver it twice.
        i.setAction(Intent.ACTION_MAIN);
        notifyListeners("shared", new JSObject());
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        JSObject r = new JSObject();
        if (pendingText != null) { r.put("text", pendingText); pendingText = null; }
        if (pendingUri != null) {
            Uri u = pendingUri; pendingUri = null;
            ContentResolver cr = getContext().getContentResolver();
            try (InputStream in = cr.openInputStream(u)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536]; int n, total = 0;
                while ((n = in.read(buf)) > 0) { total += n; if (total > MAX_SHARE_BYTES) throw new Exception("File is larger than 60 MB"); out.write(buf, 0, n); }
                r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                r.put("mime", cr.getType(u));
                r.put("name", displayName(u));
            } catch (Exception e) {
                r.put("error", e.getMessage());
            }
        }
        call.resolve(r);
    }

    private String displayName(Uri u) {
        try (Cursor c = getContext().getContentResolver().query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String last = u.getLastPathSegment();
        return last != null ? last : "Shared audio";
    }

    // kind: ringtone | notification | alarm | contact | save
    @PluginMethod
    public void setTone(PluginCall call) {
        String kind = call.getString("kind", "ringtone");
        if ("contact".equals(kind) && getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermission");
            return;
        }
        boolean setsDefault = "ringtone".equals(kind) || "notification".equals(kind) || "alarm".equals(kind);
        if (setsDefault && !Settings.System.canWrite(getContext())) {
            JSObject r = new JSObject(); r.put("status", "needs-permission"); call.resolve(r);
            return;
        }
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermission");
            return;
        }
        doSet(call, kind);
    }

    @PermissionCallback
    private void contactsPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) setTone(call);
        else { JSObject r = new JSObject(); r.put("status", "contacts-denied"); call.resolve(r); }
    }

    @PermissionCallback
    private void storagePermission(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSet(call, call.getString("kind", "ringtone"));
        else call.reject("Storage permission was not given");
    }

    private void doSet(PluginCall call, String kind) {
        Context ctx = getContext();
        ContentResolver cr = ctx.getContentResolver();
        try {
            byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            if (data.length == 0) { call.reject("Empty file"); return; }
            String mime = call.getString("mime", "audio/mpeg");
            String title = call.getString("title", "Mettu tone");
            String fileName = call.getString("fileName", "mettu-tone.mp3");
            String dir = "alarm".equals(kind) ? Environment.DIRECTORY_ALARMS
                : "notification".equals(kind) ? Environment.DIRECTORY_NOTIFICATIONS
                : Environment.DIRECTORY_RINGTONES;

            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            v.put(MediaStore.MediaColumns.TITLE, title);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.Audio.AudioColumns.IS_RINGTONE, dir.equals(Environment.DIRECTORY_RINGTONES));
            v.put(MediaStore.Audio.AudioColumns.IS_NOTIFICATION, dir.equals(Environment.DIRECTORY_NOTIFICATIONS));
            v.put(MediaStore.Audio.AudioColumns.IS_ALARM, dir.equals(Environment.DIRECTORY_ALARMS));
            v.put(MediaStore.Audio.AudioColumns.IS_MUSIC, false);

            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/Mettu");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) { call.reject("Could not save the file"); return; }
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(data); }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } else {
                File folder = new File(Environment.getExternalStoragePublicDirectory(dir), "Mettu");
                if (!folder.exists() && !folder.mkdirs()) { call.reject("Could not create the Mettu folder"); return; }
                File f = new File(folder, fileName);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                v.put(MediaStore.MediaColumns.DATA, f.getAbsolutePath());
                uri = cr.insert(MediaStore.Audio.Media.getContentUriForPath(f.getAbsolutePath()), v);
                if (uri == null) { call.reject("Could not add the file to the media library"); return; }
            }

            switch (kind) {
                case "ringtone": RingtoneManager.setActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE, uri); break;
                case "notification": RingtoneManager.setActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_NOTIFICATION, uri); break;
                case "alarm": RingtoneManager.setActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_ALARM, uri); break;
                case "contact": {
                    String id = contactId(Uri.parse(call.getString("contactUri", "")));
                    if (id == null) { call.reject("Could not find that contact"); return; }
                    ContentValues cv = new ContentValues();
                    cv.put(ContactsContract.Contacts.CUSTOM_RINGTONE, uri.toString());
                    int n = cr.update(ContactsContract.Contacts.CONTENT_URI, cv, ContactsContract.Contacts._ID + "=?", new String[] { id });
                    if (n == 0) cr.update(ContactsContract.RawContacts.CONTENT_URI, cv, ContactsContract.RawContacts.CONTACT_ID + "=?", new String[] { id });
                    break;
                }
                default: break; // "save": it is now in the phone's ringtone list
            }
            JSObject r = new JSObject();
            r.put("status", "set");
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    private String contactId(Uri contactUri) {
        try (Cursor c = getContext().getContentResolver().query(contactUri, new String[] { ContactsContract.Contacts._ID }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String last = contactUri.getLastPathSegment();
        return last != null && last.matches("\\d+") ? last : null;
    }

    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
        startActivityForResult(call, i, "contactPicked");
    }

    @ActivityCallback
    private void contactPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
            Uri u = result.getData().getData();
            r.put("uri", u.toString());
            try (Cursor c = getContext().getContentResolver().query(u, new String[] { ContactsContract.Contacts.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) r.put("name", c.getString(0));
            } catch (Exception ignored) {}
        }
        call.resolve(r);
    }

    @PluginMethod
    public void playRing(PluginCall call) {
        stop();
        try {
            byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            String ext = "audio/mpeg".equals(call.getString("mime")) ? ".mp3" : ".wav";
            File f = new File(getContext().getCacheDir(), "ring-test" + ext);
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(f.getAbsolutePath());
            player.setLooping(true);
            player.prepare();
            player.start();
            call.resolve();
        } catch (Exception e) {
            stop();
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @PluginMethod
    public void stopRing(PluginCall call) { stop(); call.resolve(); }

    private void stop() {
        if (player != null) { try { player.stop(); } catch (Exception ignored) {} player.release(); player = null; }
    }

    @Override
    protected void handleOnPause() { super.handleOnPause(); stop(); }

    @PluginMethod
    public void ringVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject r = new JSObject();
        int max = am.getStreamMaxVolume(AudioManager.STREAM_RING);
        r.put("level", max > 0 ? (double) am.getStreamVolume(AudioManager.STREAM_RING) / max : 0);
        int mode = am.getRingerMode();
        r.put("mode", mode == AudioManager.RINGER_MODE_NORMAL ? "normal" : mode == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "silent");
        r.put("canWriteSettings", Settings.System.canWrite(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void openWriteSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openSoundSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_SOUND_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
