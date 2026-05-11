# HTC VIVE Focus Testing Notes

These notes cover testing World Labs Boba Trainer on HTC VIVE Focus-class headsets, including VIVE Focus, VIVE Focus 3, and VIVE Focus Vision.

## Local Preview

Start the app from the project root:

```sh
npm run dev
```

Open the URL printed by Vite. It normally starts on:

```text
http://127.0.0.1:5173/
```

If that port is already in use, Vite may choose another port, such as `5174`. Use the actual port Vite prints in all commands below.

For a lightweight rendering smoke test, use:

```text
http://127.0.0.1:5173/?simpleSplat=1
```

For the normal scene, use:

```text
http://127.0.0.1:5173/
```

## USB Debug Path

1. Enable Developer Options and USB Debugging on the headset.
2. Connect the headset to the desktop by USB.
3. Confirm the device is visible:

```sh
adb devices
```

4. Forward the local Vite server to the headset's localhost. Replace `5173` if Vite is using a different port:

```sh
adb reverse tcp:5173 tcp:5173
```

5. In VIVE Browser, open:

```text
http://127.0.0.1:5173/
```

6. On the desktop, open:

```text
chrome://inspect/#devices
```

Then inspect the VIVE Browser tab from the desktop.

## Useful Console Checks

Run these from the remote browser console:

```js
navigator.xr?.isSessionSupported("immersive-vr")
window.__bobaScene
window.__bobaScene?.renderer?.xr
window.__bobaScene?.splat
window.__bobaScene?.spark
```

## Headset Interaction Test

1. Open the app in VIVE Browser.
2. Enter VR from the WebXR button if the browser exposes one.
3. Start a challenge round or free practice.
4. Look at the cashier while `凝視聆聽` is enabled.
5. Confirm the app enters the listening state and shows player speech feedback.
6. Say a simple test order, such as:

```text
我要一杯珍珠奶茶半糖少冰
```

7. Confirm the cashier asks follow-up questions or asks for confirmation.

## Troubleshooting

- If WebXR is unavailable, confirm the page is loaded through a secure context or headset-local `localhost`.
- If the app does not load, confirm the port in `adb reverse` matches the Vite port.
- If speech does not start, check microphone permission in VIVE Browser.
- If the full scene is slow or blank, test `/?simpleSplat=1` first to separate WebXR/browser issues from world asset loading.
- If gaze listening is unreliable, disable `凝視聆聽` and test with the desktop browser first.

## Current XR Scope

- WebXR entry is handled by Three.js `VRButton`.
- Live ordering panels are rendered inside the Three.js scene so they remain visible in headset mode.
- Gaze focus on the cashier can trigger listening when `凝視聆聽` is enabled.
- No locomotion is currently implemented.
- Hand-tracking and pinch-to-speak are not part of the current source implementation.
