# photo-diorama-poster

> 把一张照片做成「上下 1:1 分区」的高级编辑风海报——**上半区是原照片**（仅做杂志级调色），**下半区是同一主体的微缩实体模型（diorama）**：原图那块地形被整片切下，安放在一块很薄的层叠纸板上，哑光材质、近白影棚背景、柔和接触阴影，配色完全取自原图，并配一个克制的英文标题与微型注释。

![示例](https://via.placeholder.com/1152x1536.png?text=Blue+Hill+01+%2F+Harbour+Dusk+02+%2F+The+Visitor+03)

这是一个 **WorkBuddy Skill**，但**不绑定任何图像工具**——核心是一份槽位化的母版提示词 + 一套从照片提炼槽位的方法，因此任何具备文生图 / 图生图能力的 Agent 都能用（OpenAI Image、Gemini、混元、SDXL 等均可）。

## 为什么是「diorama」而不是「插画」

下半区**不是扁平矢量插画，也不是照片的复制**，而是一个摆在白背景上的实体沙盘。这个心智图像一旦错了，后面全错：

- ✅ 薄层叠纸板基座（侧面露出一层层纸页纹理）
- ✅ 板顶面沿用原图那块地形
- ✅ 哑光材质、近白影棚背景、板下只有一层收敛的接触阴影
- ❌ 不得是扁平矢量插画、不得是照片复制、不得出现竖立天空面板

## 安装

### 方式 A：导入 WorkBuddy（推荐）

1. 下载本仓库（ZIP 或 `git clone`）
2. 在 WorkBuddy 中打开该 skill 文件夹，或把 `photo-diorama-poster/` 整个目录放到 `~/.workbuddy/skills/`
3. 下次对话直接说「把这张照片做成上下分区的等距微缩海报」即可触发

### 方式 B：给其它 Agent 用

把 `SKILL.md` + `references/` + `scripts/` 交给任意 Agent。脚本只依赖 **Python 标准库**（`build_prompt.py`）与 **Node + sharp**（`compose_halves.js` / `patch_watermark.js` / `patch_rule.js`）；图像生成能力由宿主 Agent 自己提供。

## 用法

```bash
# 1) 装配整张海报提示词（中文母版）
python3 scripts/build_prompt.py \
  --title "Still Waters" \
  --subject "一位老渔民站在木质小船上，面朝左侧" \
  --palette "深靛蓝 / 雾灰蓝 / 暖沙白" \
  --notes "03"

# 2) 把整份提示词 + 原图交给图生图（保真度 high），产出 3:4 图
# 3) 后处理：抹水印 + 抹偶发装饰线
NODE_PATH=<sharp 所在 node_modules> node scripts/patch_watermark.js --in 生成图.png --out 成品.png
NODE_PATH=<sharp 所在 node_modules> node scripts/patch_rule.js     --in 成品.png   --out 成品.png
```

常用参数：`--variant vertical|square|landscape|wide`、`--layout topbottom|leftright`、`--lang zh|en|both`、`--part lower`（只出下区提示词，给合成路线用）、`--notes -`（关注释）、`--uppercase`（标题全大写）。

## 目录结构

```
photo-diorama-poster/
├── SKILL.md                       # 工作流与硬性约束
├── references/
│   ├── prompt-zh.txt              # 中文母版（槽位化，可改）
│   ├── prompt-en.txt              # 英文母版（部分模型英文更稳）
│   └── guide.md                   # 槽位提炼 / 变体 / 排错 / 自检清单
├── scripts/
│   ├── build_prompt.py            # 提示词装配（Python 标准库）
│   ├── compose_halves.js          # 路线 B 本地合成（Node + sharp）
│   ├── patch_watermark.js         # 抹平台水印
│   └── patch_rule.js              # 抹标题下偶发装饰横线
├── README.md
└── LICENSE
```

## 依赖

- `build_prompt.py`：Python 3，仅标准库
- `*.js`：`Node.js` + [`sharp`](https://github.com/lovell/sharp)
  ```bash
  npm install sharp
  ```

## License

[MIT](LICENSE) © Song Ziyue (宋子月)
