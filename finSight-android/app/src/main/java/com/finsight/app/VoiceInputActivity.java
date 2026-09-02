package com.finsight.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;

public class VoiceInputActivity extends Activity {

    private static final int REQUEST_RECORD_AUDIO = 1001;
    private static final int REQUEST_SPEECH_INPUT = 1002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.RECORD_AUDIO
        ) != PackageManager.PERMISSION_GRANTED) {

            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    REQUEST_RECORD_AUDIO
            );

        } else {
            startVoiceRecognition();
        }
    }

    private void startVoiceRecognition() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);

        intent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your expense");

        try {
            startActivityForResult(intent, REQUEST_SPEECH_INPUT);
        } catch (Exception error) {
            Toast.makeText(
                    this,
                    "Speech recognition is not available",
                    Toast.LENGTH_LONG
            ).show();
            finish();
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != REQUEST_RECORD_AUDIO) return;

        if (grantResults.length > 0 &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startVoiceRecognition();
        } else {
            Toast.makeText(
                    this,
                    "Microphone permission is required",
                    Toast.LENGTH_LONG
            ).show();
            finish();
        }
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_SPEECH_INPUT) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> results = data.getStringArrayListExtra(
                        RecognizerIntent.EXTRA_RESULTS
                );

                if (results != null && !results.isEmpty()) {
                    openFinSightWithTranscript(results.get(0));
                    return;
                }
            }

            finish();
        }
    }

    private void openFinSightWithTranscript(String transcript) {
        String encodedTranscript = android.net.Uri.encode(transcript);
        String url = "https://finsight-pwa.netlify.app/expenses?voice="
                + encodedTranscript;

        Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
        intent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
        );

        startActivity(intent);
        finish();
    }
}
