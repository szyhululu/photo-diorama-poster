#!/usr/bin/env node
/**
 * compose_halves.js — 合成路线（备选路线 B）
 *
 * 上区：直接裁切原照片（零生成、100% 保真、零失真）
 * 下区：单独生成的微缩模型图（脚本自动抹掉生成水印）
 * 合成：整图严格 3:4，两区严格 1:1，分界线落在正中
 *
 * 何时用：宿主图生图保真度完全不可控（下区反复被写成照片）时。
 * 否则走路线 A（一次图生图出整张）即可——下区的板顶面需要沿用原照片那块地形，
 * 这只有把原图交给模型才做得到。详见 references/guide.md 第四节。
 *
 * 用法：
 *   NODE_PATH=<sharp 所在 node_modules> node compose_halves.js \
 *     --photo 原图.jpg --illustration 模型图.png --out 成品.png [--ratio 3:4] [--width 1152]
 */
const sharp = require("sharp");
const path = require("path");
const { patchWatermark } = require("./patch_watermark.js");

function parseArgs(argv) {
  const a = { width: 1152, ratio: "3:4", margin: 8, patch: true, scan: true, cropY: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--photo") a.photo = argv[++i];
    else if (k === "--illustration") a.illustration = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--ratio") a.ratio = argv[++i];
    else if (k === "--width") a.width = parseInt(argv[++i], 10);
    else if (k === "--margin") a.margin = parseInt(argv[++i], 10);
    else if (k === "--crop-y") { a.cropY = parseInt(argv[++i], 10); a.scan = false; }
    else if (k === "--no-patch") a.patch = false;
    else if (k === "--no-scan") a.scan = false;
  }
  if (!a.photo || !a.illustration || !a.out) {
    console.error("必填：--photo --illustration --out");
    process.exit(1);
  }
  return a;
}

/** 扫描原图，返回主体（最底部的强对比行）——用来把上区裁切窗口对准主体 */
async function findSubjectBottom(file, leftFrac = 0.12, rightFrac = 0.88, threshold = 18) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const x0 = Math.floor(W * leftFrac), x1 = Math.floor(W * rightFrac);
  let bottom = -1;
  for (let y = 0; y < H; y++) {
    let s = 0, s2 = 0, n = 0;
    for (let x = x0; x < x1; x += 4) { const v = data[y * W + x]; s += v; s2 += v * v; n++; }
    const sd = Math.sqrt(s2 / n - (s / n) ** 2);
    if (sd > threshold) bottom = y;
  }
  return { bottom, W, H };
}

/** 抹掉生成图右下角的水印（实现见 patch_watermark.js，两个脚本共用） */
const patchWatermarkCompat = (file, patchW = 160, patchH = 100) =>
  patchWatermark(file, { w: patchW, h: patchH });

(async () => {
  const a = parseArgs(process.argv);
  const [rw, rh] = a.ratio.split(":").map(Number);
  const bandH = Math.round((a.width * rh) / rw / 2); // 每区高度（两区等分）
  const bandAspect = a.width / bandH;

  const src = await sharp(a.photo).metadata();
  const srcBandH = Math.round(src.width / bandAspect);

  let offset = a.cropY;
  if (a.cropY === null) {
    if (a.scan) {
      const { bottom } = await findSubjectBottom(a.photo);
      offset = bottom - srcBandH + a.margin;
    } else {
      offset = Math.round((src.height - srcBandH) / 2);
    }
    offset = Math.max(0, Math.min(offset, Math.max(0, src.height - srcBandH)));
  }

  const top = await sharp(a.photo)
    .extract({ left: 0, top: offset, width: src.width, height: srcBandH })
    .resize(a.width, bandH, { fit: "cover" }).png().toBuffer();

  let lowSrc = a.illustration;
  if (a.patch) lowSrc = await patchWatermarkCompat(a.illustration);
  const low = await sharp(lowSrc).resize(a.width, bandH, { fit: "cover" }).png().toBuffer();

  await sharp({ create: { width: a.width, height: bandH * 2, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: top, left: 0, top: 0 }, { input: low, left: 0, top: bandH }])
    .png({ compressionLevel: 9 })
    .toFile(a.out);

  const done = await sharp(a.out).metadata();
  console.log(`原图 ${src.width}x${src.height} → 上区裁切 y ${offset}..${offset + srcBandH}`);
  console.log(`每区 ${a.width}x${bandH}（${(bandAspect).toFixed(3)}）｜整图 ${done.width}x${done.height}（${a.ratio}）`);
  console.log(`分界线落在 y=${bandH}，即画面正中 ✅`);
  console.log(`成品：${path.resolve(a.out)}`);
})();
