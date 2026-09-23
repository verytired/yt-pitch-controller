# YT Pitch Changer

A Chrome extension that overlays a **turntable / CDJ-style pitch fader** on the YouTube player.
Change the playback speed within a ±8% / ±10% / ±16% range, with the pitch change (%) and BPM shown in real time.

## Installation

1. Open `chrome://extensions` in Chrome
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`yt-pitch-changer`)
5. Open a YouTube video page (reload any page that was already open)

## Usage

The panel appears in the top-right corner of the screen.

| Action | Result |
| --- | --- |
| Drag the fader | Change pitch (up = minus, down = plus — same direction as Technics / CDJ) |
| Click the track | Jump to that position. Snaps to 0.00% near the center |
| Double-click | Reset to 0.00% |
| Mouse wheel | Fine-tune by 0.10% (0.05% with Shift) |
| ↑ / ↓ keys | Fine-tune by 0.10% (0.05% with Shift) — while the fader is focused (click it first) |
| `±8` `±10` `±16` | Switch range. Narrowing the range automatically clamps the current value |
| `MASTER TEMPO` | ON = change speed only, keeping the key / **OFF (default) = pitch moves with speed, like a turntable** |
| `TAP` | Tap along with the beat a few times to detect BPM. Long-press to clear |
| Click the BPM display | Enter the original BPM manually (when you want to set an exact value) |
| `RESET` | Reset to 0.00% |
| Drag the header (`PITCH`) | Move the panel (position is saved) |
| `–` button | Minimize |
| `Alt + P` | Show / hide the panel |

### Display

- The large number is the current pitch (e.g. `-2.50%`). It lights up blue when not at 0%, and glows brighter while you are adjusting it
- Below it is the current BPM. Once you provide the original BPM via `TAP` or manual input, the effective BPM is shown as `original BPM × playback rate`
- Taps are measured against what you are hearing right now, so the original BPM is correctly back-calculated even if you tap while the pitch is shifted

## Implementation Notes

- Speed changes use `video.playbackRate`, and pitch linking uses `video.preservesPitch = false` (verified on real YouTube)
- When the pitch is 0.00%, YouTube's own playback speed menu is respected. When the pitch is non-zero and YouTube overrides it, the extension restores its own value
- Switching videos (SPA navigation) resets the pitch to 0.00%. Range / MASTER TEMPO / BPM / panel position are saved
- Works in fullscreen as well (the panel is re-attached to the fullscreen element)

## Customization

You can change these via the constants at the top of `content.js`.

```js
const FADER_INVERTED = true; // set to false to invert (up = plus)
const RANGES = [8, 10, 16];  // range buttons
const STEP = 0.05;           // internal minimum step (%)
const SNAP = 0.12;           // center snap width (%)
```

## Files

```
manifest.json  Extension definition (Manifest V3 / only the storage permission)
content.js     UI and pitch control logic
content.css    CDJ-style panel styles
```
