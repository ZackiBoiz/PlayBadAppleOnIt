const { execSync, spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const os = require("os");
const deasync = require("deasync");
const { URL } = require("url");

class PlayBadAppleOnIt extends EventEmitter {
    #file;
    #mode;
    #debug;
    #width;
    #height;
    #speed;
    #loop;
    #startTime;
    #endTime;
    #regulatedFps;

    #ffmpeg = null;
    #paused = false;
    #frameBuffer = Buffer.alloc(0);
    #playbackInterval = null;
    #ffmpegExited = false;
    #cleanupTmpFile = null;

    constructor(options = {}) {
        super();

        if (!options || typeof options !== "object") throw new TypeError("options must be an object");
        if (typeof options.file !== "string") throw TypeError("options.file must be a string");

        const rawFile = options.file;
        if (/^https?:\/\//.test(rawFile)) {
            const tmpPath = path.join(
                os.tmpdir(),
                "play-bad-apple-on-it-" + Date.now() + "-" + Math.random().toString(36).slice(2) +
                path.extname(new URL(rawFile).pathname)
            );
            this.#downloadSyncFetch(rawFile, tmpPath);
            this.#file = tmpPath;
            this.#cleanupTmpFile = tmpPath;
        } else {
            this.#file = path.resolve(rawFile);
        }

        if (typeof options.mode !== "string") throw TypeError("options.mode must be a string");
        this.#mode = options.mode;

        if (typeof options.debug !== "boolean") throw TypeError("options.debug must be a boolean");
        this.#debug = options.debug;

        const ffmpegPixFmts = this.#getFfmpegPixFmts();
        if (!ffmpegPixFmts.includes(this.#mode)) {
            throw new Error(`Invalid ffmpeg pixel format: ${this.#mode}\nValid formats: ${ffmpegPixFmts.join(", ")}`);
        }

        this.#width = typeof options.width === "number" ? options.width : undefined;
        this.#height = typeof options.height === "number" ? options.height : undefined;
        if (this.#width && !this.#height) this.#height = null;
        else if (!this.#width && this.#height) this.#width = null;

        this.#speed = typeof options.speed === "number" ? options.speed : 1;
        this.#loop = options.loop === true;
        this.#startTime = typeof options.startTime === "number" ? options.startTime : 0;
        this.#endTime = typeof options.endTime === "number" ? options.endTime : null;
        this.#regulatedFps = typeof options.fps === "number" ? options.fps : null;
    }

    get file() {
        return this.#file;
    }

    get mode() {
        return this.#mode;
    }
    set mode(value) {
        if (typeof value !== "string") throw new TypeError("mode must be a string");
        const fmts = this.#getFfmpegPixFmts();
        if (!fmts.includes(value)) throw new Error(`Invalid ffmpeg pixel format: ${value}`);

        const wasRunning = !!this.#ffmpeg;
        if (wasRunning) this.stop();
        this.#mode = value;
        if (wasRunning) this.start();
    }

    get debug() {
        return this.#debug;
    }
    set debug(v) {
        if (typeof v !== "boolean") throw new TypeError("debug must be a boolean");
        this.#debug = v;
    }

    get width() {
        return this.#width;
    }
    set width(v) {
        if (typeof v !== "number" && typeof v !== "undefined" && v !== null) throw new TypeError("width must be a number, null or undefined");
        const wasRunning = !!this.#ffmpeg;
        if (wasRunning) this.stop();
        this.#width = typeof v === "number" ? v : v;
        if (wasRunning) this.start();
    }

    get height() {
        return this.#height;
    }
    set height(v) {
        if (typeof v !== "number" && typeof v !== "undefined" && v !== null) throw new TypeError("height must be a number, null or undefined");
        const wasRunning = !!this.#ffmpeg;
        if (wasRunning) this.stop();
        this.#height = typeof v === "number" ? v : v;
        if (wasRunning) this.start();
    }

    get speed() {
        return this.#speed;
    }
    set speed(v) {
        if (typeof v !== "number" || v <= 0) throw new Error("Speed must be > 0");
        const wasRunning = !!this.#ffmpeg;
        if (wasRunning) this.stop();
        this.#speed = v;
        if (wasRunning) this.start();
    }

    get loop() {
        return this.#loop;
    }
    set loop(v) {
        this.#loop = !!v;
    }

    get startTime() {
        return this.#startTime;
    }
    set startTime(v) {
        if (typeof v !== "number") throw new TypeError("startTime must be a number");
        this.#startTime = v;
    }

    get endTime() {
        return this.#endTime;
    }
    set endTime(v) {
        if (typeof v !== "number" && v !== null) throw new TypeError("endTime must be a number or null");
        this.#endTime = v;
    }

    get fps() {
        return this.#regulatedFps;
    }
    set fps(v) {
        if (typeof v !== "number" && v !== null) throw new TypeError("fps must be a number or null");
        const wasRunning = !!this.#ffmpeg;
        if (wasRunning) this.stop();
        this.#regulatedFps = v;
        if (wasRunning) this.start();
    }

    start() {
        if (this.#ffmpeg) return;

        let isImage = false;
        try {
            const probe = execSync(
                `ffprobe -v error -show_entries format=format_name -of default=noprint_wrappers=1 "${this.#file}"`,
                { encoding: "utf8" }
            );
            const fmt = probe.match(/format_name=([^\n]+)/);
            if (fmt && fmt[1]) {
                const formatName = fmt[1];
                if (formatName.includes("image2") || formatName.match(/(png|jpeg|jpg|bmp|gif|webp|tiff)/)) {
                    isImage = true;
                }
            }
        } catch (e) {
            throw new Error("Could not probe file: " + e.message);
        }

        let videoWidth = this.#width;
        let videoHeight = this.#height;
        let fps;
        let origW = 0, origH = 0;
        let totalFrames = null;

        try {
            const probe = execSync(
                `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1 "${this.#file}"`,
                { encoding: "utf8" }
            );
            const w = probe.match(/width=(\d+)/);
            const h = probe.match(/height=(\d+)/);
            const r = probe.match(/r_frame_rate=(\d+\/?\d*(?:\.\d+)?)/);
            origW = w ? +w[1] : 0;
            origH = h ? +h[1] : 0;
            let origFps = 30;
            if (r) {
                const s = r[1];
                if (s.includes("/")) {
                    const [num, den] = s.split("/").map(Number);
                    origFps = num / den;
                } else origFps = +s;
            }
            fps = (this.#regulatedFps ? this.#regulatedFps : origFps) * this.#speed;

            if (!this.#width && !this.#height) {
                videoWidth = origW;
                videoHeight = origH;
                this.#width = origW;
                this.#height = origH;
            } else if (this.#width && !this.#height) {
                videoHeight = Math.round(origH * (this.#width / origW));
                this.#height = videoHeight;
            } else if (!this.#width && this.#height) {
                videoWidth = Math.round(origW * (this.#height / origH));
                this.#width = videoWidth;
            } else {
                videoWidth = this.#width;
                videoHeight = this.#height;
            }

            if (!isImage) {
                try {
                    const probeFrames = execSync(
                        `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of default=noprint_wrappers=1 "${this.#file}"`,
                        { encoding: "utf8" }
                    );
                    const match = probeFrames.match(/nb_read_frames=(\d+)/);
                    if (match) totalFrames = parseInt(match[1], 10);
                } catch (e) {
                    totalFrames = null;
                }
            }
        } catch (e) {
            throw new Error("Could not probe video/image: " + e.message);
        }

        const args = [
            "-loglevel", "info",
            "-i", this.#file,
            "-an"
        ];

        const vf = [];
        if (videoWidth && videoHeight) vf.push(`scale=${videoWidth}:${videoHeight}`);
        if (!isImage && this.#speed !== 1) vf.push(`setpts=${(1 / this.#speed).toFixed(3)}*PTS`);
        if (vf.length) args.push("-vf", vf.join(","));

        args.push("-pix_fmt", this.#mode);
        args.push("-s", `${videoWidth}x${videoHeight}`);
        args.push("-f", "rawvideo", "-");

        this.#ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
        this.#ffmpegExited = false;
        const bpp = this.#bitsPerPixel(this.#mode);
        const frameSize = Math.ceil(videoWidth * videoHeight * bpp / 8);

        this.#ffmpeg.totalFrames = totalFrames ? Math.floor(totalFrames / this.#speed) : null;

        this.#ffmpeg.stderr.setEncoding("utf8");
        this.#ffmpeg.stderr.on("data", d => d.trim().split(/\r?\n/).forEach(l => this.#debug && l && console.log("[ffmpeg]", l)));

        let allFrames = [];
        this.#ffmpeg.stdout.on("data", chunk => {
            this.#frameBuffer = Buffer.concat([this.#frameBuffer, chunk]);
            while (this.#frameBuffer.length >= frameSize) {
                const frame = this.#frameBuffer.slice(0, frameSize);
                this.#frameBuffer = this.#frameBuffer.slice(frameSize);
                allFrames.push(frame);
            }
        });

        this.#ffmpeg.on("close", code => {
            this.#ffmpegExited = true;
            if (isImage) {
                if (allFrames.length > 0) {
                    this.emit("frame", allFrames[0]);
                }
                this.#ffmpeg = null;
                this.emit("end", code);
            } else {
                let idx = 0;
                const emitFrame = () => {
                    if (this.#paused) return;
                    if (idx < allFrames.length) {
                        this.emit("frame", allFrames[idx]);
                        idx++;
                    } else {
                        if (this.#playbackInterval) clearInterval(this.#playbackInterval);
                        this.#ffmpeg = null;
                        this.emit("end", code);
                        if (this.#loop) {
                            setImmediate(() => this.start());
                        }
                    }
                };
                if (allFrames.length > 0 && fps > 0) {
                    this.#playbackInterval = setInterval(emitFrame, 1000 / fps);
                } else {
                    this.#ffmpeg = null;
                    this.emit("end", code);
                }
            }
        });

        this.#ffmpeg.on("error", err => this.emit("error", err));
    }

    pause() {
        if (this.#playbackInterval && !this.#paused) {
            this.#paused = true;
            this.emit("pause");
        }
    }

    resume() {
        if (this.#playbackInterval && this.#paused) {
            this.#paused = false;
            this.emit("resume");
        }
    }

    setSpeed(speed) {
        this.speed = speed;
    }

    stop() {
        if (this.#playbackInterval) {
            clearInterval(this.#playbackInterval);
            this.#playbackInterval = null;
        }
        if (this.#ffmpeg) {
            try { this.#ffmpeg.kill(); } catch (e) { /* ignore */ }
            this.#ffmpeg = null;
        }
        this.emit("stop");
    }

    #getFfmpegPixFmts(full = false) {
        const output = execSync("ffmpeg -hide_banner -pix_fmts", { encoding: "utf8" });
        const lines = output.split("\n");
        const startIdx = lines.findIndex(line => line.trim().startsWith("-----"));
        if (startIdx === -1) throw new Error("Unexpected ffmpeg -pix_fmts output format");
        const fmtLines = lines.slice(startIdx + 1)
            .map(line => {
                const match = line.match(/^[IOHPB\.]{5}\s+([a-zA-Z0-9_]+)/);
                if (!match) return null;
                const cols = line.trim().split(/\s+/);
                return { name: match[1], bits_per_pixel: cols[3] };
            })
            .filter(fmt => fmt);
        if (full) return fmtLines;
        return fmtLines.map(fmt => fmt.name);
    }

    #bitsPerPixel(mode) {
        const fmts = this.#getFfmpegPixFmts(true);
        const fmt = fmts.find(f => f.name === mode);
        if (!fmt) throw new Error(`Pixel format not found: ${mode}`);
        const bpp = parseInt(fmt.bits_per_pixel, 10);
        if (isNaN(bpp)) throw new Error(`Invalid bits_per_pixel for ${mode}`);
        return bpp;
    }

    async #downloadFetch(url, dest) {
        if (typeof fetch !== "function") {
            throw new Error("Global fetch not available. Node >=18 is required to download remote files.");
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch: ${url} (${res.status})`);
        const fileStream = fs.createWriteStream(dest);
        for await (const chunk of res.body) {
            fileStream.write(chunk);
        }
        fileStream.end();
        await new Promise((resolve, reject) => {
            fileStream.on("finish", resolve);
            fileStream.on("error", reject);
        });
    }

    #downloadSyncFetch(url, dest) {
        let done = false, error = null;
        this.#downloadFetch(url, dest)
            .then(() => { done = true; })
            .catch(err => { error = err; done = true; });
        while (!done) {
            deasync.runLoopOnce();
        }
        if (error) throw error;
    }
}

module.exports = PlayBadAppleOnIt;