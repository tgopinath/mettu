package com.gopinath.mettu;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MettuNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
