# B50 Pocket Android

A thin Android shell around the public B50 Pocket web app.

## What stays automatic

The UI, B50 logic, recommendations, chart data handling and image import UI are loaded from:

https://testing-orcin-theta-70.vercel.app/b50-pocket/

So ordinary web updates appear in the Android app without reinstalling the APK.

## Native-only features

- Appears in Android's image share sheet as **B50 Pocket**
- Receives an Arcaea result image
- Sends it to the existing `/api/result-import` endpoint
- Opens the same confirmation UI used by the web app
- Supports file inputs inside the WebView

Changes to this native shell itself require a new APK.

## Build

```bash
gradle -p android-app :app:assembleDebug
```

The repository's Android workflow builds a debug APK and publishes the latest test APK to the fixed GitHub release tag `b50-pocket-android-test`.
