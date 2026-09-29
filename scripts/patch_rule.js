#!/usr/bin/env node
/**
 * patch_rule.js — 抹掉标题下方的装饰横线 / 下划线（不重跑、不花额度）
 *
 * 背景：图像模型很爱在标题与编号下方补一条细横线或分隔线，而参照样张里没有。
 *       母版已写「不得加下划线、装饰横线、边框或色块底衬」，但偶发仍会出现。
 *
 * 判据（四条同时满足才算「装饰线」，缺一条就会误伤文字或沙盘内容）：
 *   1) 横向跨度为实心：跨度 > 图宽 12%，且跨度内暗像素覆盖率 > 85%（文字笔画有大量空隙，覆盖率远低于此）
 *   2) 很薄：连续暗行 <= 6px
 *   3) 孤立：线上下各 3 行在**同一跨度内**几乎全白（>=90% 近白）——这一条排除了沙盘边缘、投影、草地等大面积暗区
 *   4) 阈值自适应：以图下半部分的亮度中位数为背景基准，取 bg-16 为暗阈值（固定阈值会被纸纹背景整片误判）
 *
 * 修补分两步（两步都不能省，否则会留下很淡但肉眼可见的残线）：
 *   a) 扩张：线芯 + 抗锯齿光晕才是真实影响范围。光晕行亮度只比背景暗几度，
 *      不会被暗阈值判成线芯，所以要主动向外扩张——且只扩张进背景行（跨度内白像素占比 >= 0.5），
 *      遇到标题文字或沙盘体块立刻停手。
 *   b) 重建：用扩张带**外**紧邻各 3 行做逐列线性插值，横向羽化、补回纸张颗粒，不产生硬边。
 *
 * 用法：
 *   NODE_PATH=<sharp 所在 node_modules> node patch_rule.js --in 生成图.png --out 成品.png
 *   node patch_rule.js --in x.png --detect                 # 只检测不改，打印候选线
 *   node patch_rule.js --in x.png --no-expand --out y.png  # 只补线芯（调试用）
 *   node patch_rule.js --in x.png --y0 896 --y1 897 --x0 60 --x1 420 --out y.png   # 手工指定
 */
const sharp = require("sharp");

const args = (() => {
  const a = process.argv.slice(2);
  const o = { detect: false, "no-expand": false };
  const BOOL = new Set(["--detect", "--no-expand"]);
  for (let i = 0; i < a.length; i++) {
    if (BOOL.has(a[i])) o[a[i].slice(2)] = true;
    else if (a[i].startsWith("--")) o[a[i].slice(2)] = a[++i];
  }
  return o;
})();

const SPAN = 0.12;     // 最小横向跨度（占图宽）
const COVER = 0.85;    // 跨度内覆盖率下限
const MAXTHICK = 6;    // 最大厚度
const FLANK = 3;       // 上下各检查几行
const FLANK_WHITE = 0.90;
const MARGIN = 4;      // 线芯向外扩张成修补带的最大行数（只扩张进背景行）

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function medianLowerHalf(data, W, H, C) {
  const vals = [];
  for (let y = Math.floor(H / 2); y < H; y += 3)
    for (let x = 0; x < W; x += 3) {
      const o = (y * W + x) * C;
      vals.push(lum(data[o], data[o + 1], data[o + 2]));
    }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

function findRules(data, W, H, C, yTop, bg) {
  // 装饰线常是抗锯齿的浅灰（只比背景暗 15~25 度），阈值必须贴着背景走；
  // 收紧到 bg-32 会漏检，放宽到 bg-16 靠「孤立性」判据挡住纸纹与沙盘内容。
  const dark = bg - 16;
  const nearWhite = bg - 8;

  // 逐行统计：跨度、跨度内的暗像素数、以及「实心度」cover = n / span
  const rows = [];
  for (let y = yTop; y < H; y++) {
    let first = -1, last = -1, n = 0, s = 0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      const v = lum(data[o], data[o + 1], data[o + 2]);
      s += v;
      if (v < dark) {
        if (first < 0) first = x;
        last = x;
        n++;
      }
    }
    const span = last < 0 ? 0 : last - first + 1;
    rows.push({ y, first, last, n, span, mean: s / W, cover: span ? n / span : 0 });
  }

  const whiteFrac = (y, xa, xb) => {
    let white = 0, tot = 0;
    for (let x = xa; x <= xb; x++) {
      const o = (y * W + x) * C;
      tot++;
      if (lum(data[o], data[o + 1], data[o + 2]) >= nearWhite) white++;
    }
    return white / tot;
  };

  // 关键：装饰线是**抗锯齿**的——只有中间 1 行是深灰（cover≈1），上下各 1~2 行是浅灰软边
  // （cover 可能低到 0.2~0.3）。若只认「高 cover 行」当线体，就会只补中间那行、留下上下残影。
  // 所以判据分两层：core = 高 cover 行（确定是线），edge = 低 cover 但横向跨度接近的行（软边）。
  const out = [];
  const isCore = (r) => r.span >= W * SPAN && r.cover >= COVER;
  const isEdge = (r, ref) =>
    r.span >= ref.span * 0.9 && r.cover >= 0.15 && r.cover < COVER;

  for (let i = 0; i < rows.length; i++) {
    if (!isCore(rows[i])) continue;

    // 1) 先取连续 core 行作为线芯
    let j = i, x0 = rows[i].first, x1 = rows[i].last;
    while (j + 1 < rows.length && isCore(rows[j + 1])) {
      j++;
      x0 = Math.min(x0, rows[j].first);
      x1 = Math.max(x1, rows[j].last);
    }
    const core = { span: x1 - x0 + 1 };

    // 2) 向上下扩散软边：跨度与线芯相当、且该行在跨度内不够白
    let a = i, b = j;
    while (a - 1 >= i - 3 && a - 1 >= 0 && rows[a - 1].y >= yTop &&
           (isEdge(rows[a - 1], core) || whiteFrac(rows[a - 1].y, x0, x1) < FLANK_WHITE)) {
      a--;
      x0 = Math.min(x0, Math.max(0, rows[a].first));
      x1 = Math.max(x1, rows[a].last);
      core.span = x1 - x0 + 1;
    }
    while (b + 1 <= j + 3 && b + 1 < rows.length &&
           (isEdge(rows[b + 1], core) || whiteFrac(rows[b + 1].y, x0, x1) < FLANK_WHITE)) {
      b++;
      x0 = Math.min(x0, Math.max(0, rows[b].first));
      x1 = Math.max(x1, rows[b].last);
      core.span = x1 - x0 + 1;
    }
    i = j;

    const y0 = rows[a].y, y1 = rows[b].y, thick = y1 - y0 + 1;
    if (thick > MAXTHICK) continue;

    // 3) 孤立性：线体之外的上下各 FLANK 行，在同一跨度内必须几乎全白
    //    这一条排除沙盘边缘、投影、草地等大面积暗区
    let ok = true;
    for (let d = 1; d <= FLANK && ok; d++) {
      for (const y of [y0 - d, y1 + d]) {
        if (y < 0 || y >= H) continue;
        if (whiteFrac(y, x0, x1) < FLANK_WHITE) { ok = false; break; }
      }
    }
    if (ok) out.push({ y0, y1, x0, x1 });
  }
  return out;
}

/**
 * 把线芯向外扩张成「修补带」。
 *
 * 装饰线是抗锯齿的，真正的影响范围比线芯宽 2~3 行（上下各有一条浅灰光晕）。
 * 只补线芯会留下一条很淡但肉眼可见的残线，所以必须连同光晕一起补。
 * 但扩张有风险：可能吃进标题文字或沙盘体块。因此只在**背景行**上扩张——
 * 一行只要在跨度内的白像素占比 >= 0.5 就认为它是背景，可以安全纳管；
 * 一旦遇到有内容的行就立刻停手。供体行再取自扩张带之外 3 行，保证取样干净。
 */
function expandBand(data, W, H, C, x0, x1, y0, y1, bg) {
  const nearWhite = bg - 8;
  const whiteFrac = (y) => {
    let white = 0, tot = 0;
    for (let x = x0; x <= x1; x++) {
      const o = (y * W + x) * C;
      tot++;
      if (lum(data[o], data[o + 1], data[o + 2]) >= nearWhite) white++;
    }
    return white / tot;
  };
  let by0 = y0, by1 = y1;
  for (let m = 1; m <= MARGIN; m++) {
    if (by0 - 1 < 0 || whiteFrac(by0 - 1) < 0.5) break;
    by0--;
  }
  for (let m = 1; m <= MARGIN; m++) {
    if (by1 + 1 >= H || whiteFrac(by1 + 1) < 0.5) break;
    by1++;
  }
  return { y0: by0, y1: by1 };
}

function buildPatch(data, W, H, C, y0, y1, x0, x1) {
  const px = (x, y, c) => data[(y * W + x) * C + c];
  const avg = (x, a, b, c) => {
    let s = 0;
    for (let y = a; y <= b; y++) s += px(x, y, c);
    return s / (b - a + 1);
  };
  // 邻行取样带：取修补带之外紧邻的 3 行（必须避开线芯与它的抗锯齿光晕）
  const uA = Math.max(0, y0 - 3), uB = Math.max(0, y0 - 1);
  const dA = Math.min(H - 1, y1 + 1), dB = Math.min(H - 1, y1 + 3);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const buf = Buffer.alloc(w * h * 4);
  // 羽化必须横向、纵向分开算：
  //   早先写成 dx = min(左右, 上下) 且 feather = min(w,h)/3，当线体只有 1~3 行时
  //   纵向距离恒为 0，alpha 被算成 0，于是首尾行整行透明 —— 表现为「只补了中间一行、上下留残影」。
  //   装饰线本身就很薄，纵向不需要羽化（接缝靠邻行插值已经连续），只对左右端做横向羽化。
  const featherX = Math.min(6, Math.max(0, Math.floor(w / 20)));
  const featherY = h >= 5 ? 1 : 0;
  for (let i = 0; i < w; i++) {
    const x = x0 + i;
    for (let c = 0; c < 3; c++) {
      const a = avg(x, uA, uB, c), b = avg(x, dA, dB, c);
      for (let k = 0; k < h; k++) {
        const t = h > 1 ? (k + 1) / (h + 1) : 0.5;
        buf[((k * w) + i) * 4 + c] = Math.max(0, Math.min(255, Math.round(a * (1 - t) + b * t)));
      }
    }
    for (let k = 0; k < h; k++) {
      const dxx = Math.min(i, w - 1 - i);
      const dyy = Math.min(k, h - 1 - k);
      const ax = featherX === 0 ? 1 : Math.min(1, dxx / featherX);
      const ay = featherY === 0 ? 1 : Math.min(1, dyy / featherY);
      buf[((k * w) + i) * 4 + 3] = Math.round(ax * ay * 255);
    }
  }
  return { input: buf, raw: { width: w, height: h, channels: 4 }, left: x0, top: y0 };
}

(async () => {
  if (!args.in) throw new Error("缺少 --in");
  const { data, info } = await sharp(args.in).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const bg = medianLowerHalf(data, W, H, C);
  const yTop = Math.floor(H / 2) + 6;    // 只在分界线以下找

  const rules = args.y0
    ? [{ y0: +args.y0, y1: args.y1 ? +args.y1 : +args.y0, x0: args.x0 ? +args.x0 : 0, x1: args.x1 ? +args.x1 : W - 1 }]
    : findRules(data, W, H, C, yTop, bg);

  console.log(`背景亮度中位数 ${bg.toFixed(1)} → 暗阈值 ${(bg - 16).toFixed(1)}、近白阈值 ${(bg - 8).toFixed(1)}`);
  if (!rules.length) console.log("未发现装饰横线");
  // 检测给的是「线芯」；真正要补的是线芯 + 抗锯齿光晕，向外扩张成修补带
  const bands = rules.map((r) => {
    const band = args["no-expand"] ? { y0: r.y0, y1: r.y1 } : expandBand(data, W, H, C, r.x0, r.x1, r.y0, r.y1, bg);
    console.log(
      `装饰线：线芯 y=${r.y0}..${r.y1} → 修补带 y=${band.y0}..${band.y1}（${band.y1 - band.y0 + 1} 行）  x=${r.x0}..${r.x1}（跨 ${r.x1 - r.x0 + 1}px）`
    );
    return { ...r, y0: band.y0, y1: band.y1 };
  });
  if (args.detect) return;

  const patches = bands.map((r) => buildPatch(data, W, H, C, r.y0, r.y1, r.x0, r.x1));
  const outPath = args.out || args.in.replace(/(\.[a-z]+)$/i, "_norule$1");
  if (patches.length) {
    await sharp(args.in).composite(patches).png({ compressionLevel: 9 }).toFile(outPath);
    console.log(`已修补 ${patches.length} 处 → ${outPath}`);
  } else if (args.out) {
    await sharp(args.in).png({ compressionLevel: 9 }).toFile(args.out);
    console.log(`无线可补，已原样复制 → ${args.out}`);
  }
})();
