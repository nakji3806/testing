package com.ewnwe.b50pocket;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://testing-orcin-theta-70.vercel.app/b50-pocket/";
    private static final String APP_HOST = "testing-orcin-theta-70.vercel.app";
    private static final String RESULT_API = "https://testing-orcin-theta-70.vercel.app/api/result-import";
    private static final int FILE_CHOOSER_REQUEST = 41;

    private WebView webView;
    private Uri pendingSharedImage;
    private boolean pageReady = false;
    private boolean shareBusy = false;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(9, 11, 15));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 15));
        getWindow().getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 11, 15));
        setContentView(webView);

        configureWebView();

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        captureShareIntent(getIntent());
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " B50PocketAndroid/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (APP_HOST.equalsIgnoreCase(host)) return false;

                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageReady = true;
                processPendingShare();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;

                Intent intent;
                try {
                    intent = params.createIntent();
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "파일 선택기를 열 수 없습니다.", Toast.LENGTH_SHORT).show();
                    return false;
                }

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "파일 선택기를 열 수 없습니다.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureShareIntent(intent);
    }

    private void captureShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        Uri uri = firstSharedUri(intent);
        if (uri == null) {
            notifyWebError("공유된 이미지를 찾지 못했습니다.");
            return;
        }

        pendingSharedImage = uri;

        // Avoid re-processing the same share after activity recreation.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);

        if (pageReady) processPendingShare();
    }

    @SuppressWarnings("deprecation")
    private Uri firstSharedUri(Intent intent) {
        ClipData clipData = intent.getClipData();
        if (clipData != null && clipData.getItemCount() > 0) {
            Uri uri = clipData.getItemAt(0).getUri();
            if (uri != null) return uri;
        }

        try {
            Object one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one instanceof Uri) return (Uri) one;
        } catch (Exception ignored) {}

        try {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null && !many.isEmpty()) return many.get(0);
        } catch (Exception ignored) {}

        return null;
    }

    private void processPendingShare() {
        if (!pageReady || shareBusy || pendingSharedImage == null) return;

        final Uri uri = pendingSharedImage;
        pendingSharedImage = null;
        shareBusy = true;

        Toast.makeText(this, "결과 화면 분석 중…", Toast.LENGTH_SHORT).show();

        new Thread(() -> {
            try {
                String responseJson = uploadResultImage(uri);
                runOnUiThread(() -> {
                    shareBusy = false;
                    String js = "window.b50HandleNativeResult&&window.b50HandleNativeResult(" + responseJson + ");";
                    webView.evaluateJavascript(js, null);
                    if (pendingSharedImage != null) processPendingShare();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    shareBusy = false;
                    notifyWebError(error.getMessage() == null ? "결과 화면 분석에 실패했습니다." : error.getMessage());
                    if (pendingSharedImage != null) processPendingShare();
                });
            }
        }, "B50PocketShare").start();
    }

    private String uploadResultImage(Uri uri) throws Exception {
        String mime = getContentResolver().getType(uri);
        if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";

        String boundary = "----B50Pocket" + System.currentTimeMillis();
        HttpURLConnection connection = (HttpURLConnection) new URL(RESULT_API).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        try (DataOutputStream output = new DataOutputStream(connection.getOutputStream());
             InputStream input = getContentResolver().openInputStream(uri)) {

            if (input == null) throw new Exception("공유 이미지를 열 수 없습니다.");

            output.writeBytes("--" + boundary + "\r\n");
            output.writeBytes("Content-Disposition: form-data; name=\"image\"; filename=\"arcaea-result.jpg\"\r\n");
            output.writeBytes("Content-Type: " + mime + "\r\n\r\n");

            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);

            output.writeBytes("\r\n--" + boundary + "--\r\n");
            output.flush();
        }

        int status = connection.getResponseCode();
        InputStream responseStream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();

        String body = readText(responseStream);
        connection.disconnect();

        if (status < 200 || status >= 300) {
            try {
                JSONObject json = new JSONObject(body);
                String message = json.optString("error", "서버 오류 " + status);
                throw new Exception(message);
            } catch (org.json.JSONException ignored) {
                throw new Exception("서버 오류 " + status);
            }
        }

        new JSONObject(body); // Validate that the server returned JSON.
        return body;
    }

    private static String readText(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }

    private void notifyWebError(String message) {
        if (webView == null || !pageReady) {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            return;
        }
        String quoted = JSONObject.quote(message);
        webView.evaluateJavascript(
                "window.b50HandleNativeError&&window.b50HandleNativeError(" + quoted + ");",
                null
        );
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
