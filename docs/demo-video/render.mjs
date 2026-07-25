import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "docs/demo-video");
const work = resolve(dir, "work/render");
const captions = resolve(work, "captions");
const segments = resolve(work, "segments");
const output = resolve(dir, "hindsight-demo-silent.mp4");

for (const path of [work, captions, segments]) mkdirSync(path, { recursive: true });

const beats = [
  {
    duration: 8,
    label: "HINDSIGHT",
    image: "captures/01-landing.png",
    caption: "Agent failures are paths. Hindsight lets you test a different one.",
    focus: [0.5, 0.48],
  },
  {
    duration: 18,
    label: "1 / OBSERVE",
    image: "../assets/signoz-failed-trace.png",
    caption: "A real failed agent run—captured step by step in SigNoz.",
    focus: [0.5, 0.46],
  },
  {
    duration: 14,
    label: "TRACE-CORRELATED EVIDENCE",
    image: "../assets/signoz-correlated-logs.png",
    caption: "Payloads live in correlated logs, linked by the same trace ID.",
    focus: [0.52, 0.5],
  },
  {
    duration: 12,
    label: "FLEET SIGNALS",
    image: "../assets/signoz-metrics.png",
    caption: "Reliability, latency, loops, tokens, and cost remain native SigNoz signals.",
    focus: [0.5, 0.44],
  },
  {
    duration: 16,
    label: "2 / DETECT",
    image: "captures/05-incidents-live.png",
    caption: "The SigNoz alert opens a deduplicated incident anchored to that trace.",
    focus: [0.55, 0.72],
  },
  {
    duration: 24,
    label: "3 / REPLAY",
    image: "captures/06-signoz-run-failure.png",
    caption: "Hindsight reconstructs the run and isolates the malformed tool result.",
    focus: [0.5, 0.7],
  },
  {
    duration: 18,
    label: "4 / FORK",
    image: "captures/06-signoz-run-failure.png",
    caption: "Change one recorded result. The original run stays untouched.",
    focus: [0.5, 0.88],
  },
  {
    duration: 24,
    label: "5 / VERIFY",
    image: "captures/07-compare-live.png",
    caption: "The tested branch succeeds: failure → success, with both traces preserved.",
    focus: [0.5, 0.34],
  },
  {
    duration: 12,
    label: "ONE EVIDENCE CHAIN",
    image: "work/render/architecture.png",
    caption: "Record in OpenTelemetry. Observe in SigNoz. Replay and prove in Hindsight.",
    focus: [0.5, 0.5],
  },
  {
    duration: 9,
    label: "HINDSIGHT",
    image: "work/render/outro.png",
    caption: "Turn the autopsy into a time machine.",
    focus: [0.5, 0.5],
  },
];

const xml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function wrap(value, limit = 62) {
  const lines = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (`${line} ${word}`.trim().length > limit) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svgToPng(svgPath, pngPath) {
  execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
    stdio: "ignore",
  });
}

function card(path, body) {
  writeFileSync(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <radialGradient id="glow" cx="72%" cy="20%" r="85%">
          <stop offset="0" stop-color="#34251f"/>
          <stop offset=".52" stop-color="#121313"/>
          <stop offset="1" stop-color="#090a0a"/>
        </radialGradient>
        <style>
          .sans { font-family: "SF Pro Display", "Helvetica Neue", Arial, sans-serif; }
          .mono { font-family: "SF Mono", Menlo, monospace; }
        </style>
      </defs>
      <rect width="1920" height="1080" fill="url(#glow)"/>
      <path d="M0 96H1920M0 984H1920" stroke="#2c2d2d"/>
      <text x="110" y="70" fill="#f0ede8" font-size="24" font-weight="700" letter-spacing="5" class="mono">HINDSIGHT</text>
      <text x="1710" y="70" fill="#d86635" font-size="18" text-anchor="end" letter-spacing="3" class="mono">FLIGHT RECORDER</text>
      ${body}
    </svg>`,
  );
}

const architectureSvg = resolve(work, "architecture.svg");
card(
  architectureSvg,
  `<text x="110" y="220" fill="#f4f0ea" font-size="72" font-weight="650" class="sans">From signal to verified fix.</text>
   <text x="112" y="275" fill="#9d9b97" font-size="28" class="sans">One evidence chain. No duplicate telemetry.</text>
   <path d="M350 560H580M850 560H1080M1350 560H1580" stroke="#d86635" stroke-width="4"/>
   <path d="M570 548L590 560L570 572M1070 548L1090 560L1070 572M1570 548L1590 560L1570 572" fill="none" stroke="#d86635" stroke-width="4"/>
   ${[
     ["110", "430", "AGENT", "Record", "OpenTelemetry"],
     ["600", "430", "SIGNOZ", "Observe", "Traces · logs · metrics"],
     ["1100", "430", "HINDSIGHT", "Replay", "Checkpoint · incident"],
     ["1600", "430", "RUNNER", "Fork", "Execute one change"],
   ]
     .map(
       ([x, y, kicker, title, sub]) =>
         `<g transform="translate(${x} ${y})">
            <rect width="260" height="260" rx="12" fill="#151616" stroke="#3b3b39"/>
            <rect x="18" y="18" width="7" height="48" fill="#d86635"/>
            <text x="42" y="49" fill="#9c9a96" font-size="17" letter-spacing="2" class="mono">${kicker}</text>
            <text x="28" y="130" fill="#f4f0ea" font-size="42" font-weight="620" class="sans">${title}</text>
            <text x="28" y="181" fill="#aaa7a2" font-size="21" class="sans">${sub}</text>
          </g>`,
     )
     .join("")}
   <text x="110" y="900" fill="#d86635" font-size="23" letter-spacing="3" class="mono">RECORD  /  REPLAY  /  FORK  /  VERIFY</text>`,
);
svgToPng(architectureSvg, resolve(work, "architecture.png"));

const outroSvg = resolve(work, "outro.svg");
card(
  outroSvg,
  `<text x="960" y="380" fill="#d86635" text-anchor="middle" font-size="24" letter-spacing="6" class="mono">RECORD · REPLAY · FORK · PROVE</text>
   <text x="960" y="520" fill="#f4f0ea" text-anchor="middle" font-size="112" font-weight="680" class="sans">Turn the autopsy</text>
   <text x="960" y="640" fill="#f4f0ea" text-anchor="middle" font-size="112" font-weight="680" class="sans">into a time machine.</text>
   <rect x="600" y="750" width="720" height="78" rx="39" fill="#eeeae4"/>
   <text x="960" y="801" fill="#111212" text-anchor="middle" font-size="27" font-weight="620" class="mono">github.com/piyushpradhan/hindsight</text>`,
);
svgToPng(outroSvg, resolve(work, "outro.png"));

const totalDuration = beats.reduce((sum, beat) => sum + beat.duration, 0);
let elapsed = 0;
for (let i = 0; i < beats.length; i++) {
  const beat = beats[i];
  const id = String(i + 1).padStart(2, "0");
  const lines = wrap(beat.caption);
  const captionSvg = resolve(captions, `${id}.svg`);
  const captionPng = resolve(captions, `${id}.png`);
  const boxHeight = 58 + lines.length * 42;
  const boxY = 1080 - boxHeight - 34;
  const progress = Math.round(((elapsed + beat.duration) / totalDuration) * 1920);

  writeFileSync(
    captionSvg,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
      <style>
        .sans { font-family: "SF Pro Display", "Helvetica Neue", Arial, sans-serif; }
        .mono { font-family: "SF Mono", Menlo, monospace; }
      </style>
      <rect x="54" y="42" width="${Math.max(250, beat.label.length * 16 + 70)}" height="50" rx="25" fill="#090a0a" fill-opacity=".86" stroke="#d86635" stroke-opacity=".75"/>
      <text x="84" y="75" fill="#f3eee8" font-size="18" letter-spacing="2.2" class="mono">${xml(beat.label)}</text>
      <rect x="154" y="${boxY}" width="1460" height="${boxHeight}" rx="16" fill="#080909" fill-opacity=".86" stroke="#454442"/>
      <rect x="180" y="${boxY + 22}" width="5" height="${boxHeight - 44}" fill="#d86635"/>
      ${lines
        .map(
          (line, lineIndex) =>
            `<text x="216" y="${boxY + 52 + lineIndex * 42}" fill="#f7f3ed" font-size="34" font-weight="560" class="sans">${xml(line)}</text>`,
        )
        .join("")}
      <rect x="0" y="1074" width="1920" height="6" fill="#282929"/>
      <rect x="0" y="1074" width="${progress}" height="6" fill="#d86635"/>
    </svg>`,
  );
  svgToPng(captionSvg, captionPng);

  const segment = resolve(segments, `${id}.mp4`);
  const frames = beat.duration * 30;
  const [focusX, focusY] = beat.focus;
  execFileSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-loop", "1", "-framerate", "30", "-t", beat.duration.toFixed(3),
      "-i", resolve(dir, beat.image),
      "-loop", "1", "-framerate", "30", "-t", beat.duration.toFixed(3),
      "-i", captionPng,
      "-filter_complex",
      `[0:v]scale=2000:-1,zoompan=z='1+0.045*on/${frames}':` +
      `x='(iw-iw/zoom)*${focusX}':y='(ih-ih/zoom)*${focusY}':` +
      `d=1:s=1920x1080:fps=30,format=rgba[base];` +
      `[1:v]format=rgba[cap];[base][cap]overlay=0:0:shortest=1,format=yuv420p[v]`,
      "-map", "[v]", "-an",
      "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
      "-movflags", "+faststart", "-t", beat.duration.toFixed(3), segment,
    ],
    { stdio: "inherit" },
  );
  elapsed += beat.duration;
  process.stdout.write(`rendered ${id}/${beats.length}\r`);
}

const concat = resolve(work, "segments.txt");
writeFileSync(
  concat,
  beats.map((_, index) => `file '${resolve(segments, `${String(index + 1).padStart(2, "0")}.mp4`)}'`).join("\n"),
);
execFileSync(
  "ffmpeg",
  [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", concat, "-c", "copy", "-movflags", "+faststart", output,
  ],
  { stdio: "inherit" },
);

const probe = JSON.parse(
  execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
    "-of", "json", output,
  ]).toString(),
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
const duration = Number(probe.format.duration);
if (
  !video ||
  audio ||
  video.codec_name !== "h264" ||
  video.width !== 1920 ||
  video.height !== 1080 ||
  Math.abs(duration - totalDuration) > 0.5
) {
  throw new Error(`Render check failed: ${JSON.stringify(probe)}`);
}
console.log(`\n${output} (${duration.toFixed(2)}s, ${video.width}x${video.height}, silent)`);
