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
  file: "video.mp4",
  mode: "rgb24",
  debug: false
});

player.on("frame", (f) => console.log("frame", f.length));
player.on("end", code => console.log("ended", code));
player.on("error", err => console.error("err", err));
player.start();

// pause/resume/stop as needed
// player.pause();
// player.resume();
// player.stop();
```

... or with a URL:


```js
const PlayBadAppleOnIt = require("play-bad-apple-on-it");

(async () => {
  const player = await PlayBadAppleOnIt.create({
    file: "https://example.com/video.mp4",
    mode: "rgb24",
    debug: true
  });
  player.on("frame", f => console.log(f.length));
  player.start();
})();
```

## Notes

- You must pass a valid ffmpeg pixel format (`rgb24`, `yuv420p`, ...). The constructor checks `ffmpeg -pix_fmts`.
- For remote files (http/https) we download into a temporary file using `fetch` (Node 18+).
- For best cross-platform behavior ensure `ffmpeg` is installed and recent.

## Contributing

PRs welcome. Please include reproducible tests for behavior changes.