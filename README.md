# play-bad-apple-on-it

Stream raw frames from ffmpeg and emit `frame` events so you can play/process them in Node.

> This module spawns `ffmpeg` and emits raw frames (Buffers). It does **not** render — you should decode the raw frames according to the pixel format passed.

## Requirements

- Node.js **>= 18.0.0** (for global `fetch` used by remote downloads)
- `ffmpeg` and `ffprobe` installed and available on `PATH`
- `deasync` will compile native bindings on install

## Install

```bash
npm install play-bad-apple-on-it
```

## Example
```js
const PlayBadAppleOnIt = require("play-bad-apple-on-it");

const player = new PlayBadAppleOnIt({
  file: "video.mp4",    // local path or http(s) URL
  mode: "rgb24",        // ffmpeg pixel format
  debug: false,         // boolean
  width: 80,            // optional
  // height: 60,        // optional
  speed: 1,
  loop: false,
  fps: null
});

player.on("frame", frameBuffer => {
  // frameBuffer is a Buffer of raw frame bytes according to ffmpeg pixel format
  console.log("Got frame of length", frameBuffer.length);
});

player.on("end", code => console.log("ended", code));
player.on("error", err => console.error("err", err));

player.start();

// pause/resume/stop as needed
// player.pause();
// player.resume();
// player.stop();
```

## Notes

- You must pass a valid ffmpeg pixel format (`rgb24`, `yuv420p`, ...). The constructor checks `ffmpeg -pix_fmts`.
- For remote files (http/https) we download into a temporary file using `fetch` (Node 18+).
- For best cross-platform behavior ensure `ffmpeg` is installed and recent.

## Contributing

PRs welcome. Please include reproducible tests for behavior changes.