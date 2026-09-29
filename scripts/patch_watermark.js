#!/usr/bin/env node
/**
 * patch_watermark.js — 抹掉生成图右下角的「AI生成 WORKBUDDY」水印
 *
 * 做法：取水印左右两侧各 1px 的竖列，逐行做横向线性插值，重建整块水印区域。
 * 白底与柔和渐变背景上几乎看不出痕迹，且同时保留纵向与横向的明暗过渡。
 * 不用直接涂白（会在渐变底上留色块），也不裁切（会破坏 3:4 画幅）。
 *
 * 用法：
 *   NODE_PATH=<sharp 所在 node_modules> node patch_watermark.js \
 *     --in 生成图.png --out 干净图.png [--w 160] [--h 100] [--offset 8]
 *
 * 未指定 --out 时原地覆写。
 */
const sharp = require("sharp");
const path = require("path");

/** 对一维通道序列做移动平均，去掉纸张颗粒带来的逐行噪声 */
function smoothSeries(vals, window) {
  const half = Math.floor(window / 2);
  const out = new Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    let s = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k < 0 || k >= vals.length) continue;
      s += vals[k]; n++;
    }
    out[i] = s / n;
  }
  return out;
}

/**
 * @param {string} file   输入图路径
 * @param {object} opt    { w, h, offset, feather }
 * @returns {Promise<Buffer>} 处理后的 PNG buffer
 */
async function patchWatermark(file, opt = {}) {
  const patchW = opt.w ?? 176;
  const patchH = opt.h ?? 112;
  const offset = opt.offset ?? 4;
  const feather = opt.feather ?? 7;

  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) throw new Error("无法读取图片尺寸: " + file);

  const left = Math.max(0, meta.width - patchW - offset);
  const top = Math.max(0, meta.height - patchH);
  const height = meta.height - top;
  const sampleLeft = Math.max(0, left - 40);
  const sampleRight = Math.min(meta.width - 1, left + patchW + offset - 1);

  if (sampleRight <= sampleLeft + 1) throw new Error("图片太窄，无法在不含右边缘的位置取样");

  // 竖向多取 20px 余量，方便做纵向平滑（避免窗口贴边）
  const pad = 20;
  const gTop = Math.max(0, top - pad);
  const gH = Math.min(meta.height - gTop, height + pad);

  const grab = async (x) =>
    sharp(file).extract({ left: x, top: gTop, width: 1, height: gH }).raw().toBuffer({ resolveWithObject: true });

  const L = await grab(sampleLeft);
  const R = await grab(sampleRight);
  const ch = Math.min(L.info.channels, R.info.channels, 3);
  const rowOffset = top - gTop;

  // 逐通道纵向平滑，得到"该行背景色"的稳定估计
  const col = (S) => {
    const res = [];
    for (let c = 0; c < ch; c++) {
      const series = [];
      for (let y = 0; y < gH; y++) series.push(S.data[y * S.info.channels + c]);
      res.push(smoothSeries(series, 9));
    }
    return res;
  };
  const lc = col(L), rc = col(R);

  // 背景不是纯色而是带纸张颗粒的。平滑后的重建会显得"过于干净"，
  // 于是从采样列的残差里估出颗粒幅度，给补丁补回同幅度的噪声。
  const noiseStd = [];
  for (let c = 0; c < ch; c++) {
    let s = 0, n = 0;
    for (let y = 0; y < gH; y++) {
      const v = L.data[y * L.info.channels + c] - lc[c][y];
      s += v * v; n++;
    }
    noiseStd.push(Math.sqrt(s / Math.max(1, n)));
  }
  let seed = 20260929;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const randn = () => {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // 水印左右两侧逐行横向线性插值 → 同时保留纵向渐变与横向渐变
  const buf = Buffer.alloc(patchW * height * 4);
  for (let y = 0; y < height; y++) {
    const gy = y + rowOffset;
    for (let x = 0; x < patchW; x++) {
      const t = patchW > 1 ? x / (patchW - 1) : 0;
      const dx = Math.min(x, patchW - 1 - x, y, height - 1 - y);
      const a = dx >= feather ? 255 : Math.round((dx / feather) * 255);
      const o = (y * patchW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = c < ch ? lc[c][gy] * (1 - t) + rc[c][gy] * t : lc[0][gy];
        const v = base + (c < ch ? randn() * noiseStd[c] : 0);
        buf[o + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
      buf[o + 3] = a;
    }
  }

  return sharp(file)
    .composite([{ input: buf, raw: { width: patchW, height, channels: 4 }, left, top }])
    .png()
    .toBuffer();
}

function parseArgs(argv) {
  const a = { w: 160, h: 100, offset: 8 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--in") a.in = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--w") a.w = parseInt(argv[++i], 10);
    else if (k === "--h") a.h = parseInt(argv[++i], 10);
    else if (k === "--offset") a.offset = parseInt(argv[++i], 10);
  }
  if (!a.in) {
    console.error("必填：--in <图片>  [--out <输出>]");
    process.exit(1);
  }
  return a;
}

module.exports = { patchWatermark };

if (require.main === module) {
  (async () => {
    const a = parseArgs(process.argv);
    const out = a.out || a.in;
    const buf = await patchWatermark(a.in, a);
    await sharp(buf).toFile(out);
    const meta = await sharp(out).metadata();
    console.log(`水印已抹除：${path.resolve(out)}（${meta.width}x${meta.height}）`);
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
