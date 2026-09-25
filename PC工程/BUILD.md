# 构建说明（开发者向）

> 面向玩家的玩法说明见 [README.md](README.md)。本文件只讲怎么从源码构建出 Windows 安装包。

---

## 1. 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | ≥ 18（推荐 20 / 22） |
| Python | ≥ 3.8（仅用于构建期脚本，运行时不需要） |
| 操作系统 | Linux / macOS / **Windows** 均可构建 |
| 磁盘 | 约 2 GB（含 Electron 二进制与构建缓存） |

**不需要 wine。** 详见 [§4 免 wine 构建原理](#4-免-wine-构建原理)。

---

## 2. 快速开始

```bash
npm install          # 安装依赖；postinstall 会自动打 electron-builder 补丁
npm start            # 本地运行（开发调试）
npm run build        # 构建 Windows x64 安装包 + 便携版
```

产物输出到 `../dist/`：

```
混在日本-4.0.0-x64.exe           NSIS 安装版
混在日本-4.0.0-x64.exe.blockmap  增量更新差分包（本项目未启用更新，可忽略）
混在日本-便携版-4.0.0.exe         免安装便携版
win-unpacked/                     免打包目录版，可直接运行 混在日本.exe
```

只想快速验证、不要安装包：

```bash
npm run build:dir    # 只产出 win-unpacked/
```

---

## 3. 镜像加速（中国大陆网络）

`.npmrc` 已预设三处镜像，无需手动配置：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
electron_builder_binaries_mirror=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
```

若你的网络环境不同，把这几个值改成可达的镜像即可。首次构建时 `electron-builder`
会下载 `nsis` / `nsis-resources` / `winCodeSign` 三个工具包，约 40 MB。

---

## 4. 免 wine 构建原理

### 问题

electron-builder 生成 NSIS 安装包时，原生流程会**两次**调用 `makensis`：

1. 先单独编译「卸载器」；
2. 再编译「安装器」，并把第 ① 步的卸载器文件用 `File` 指令嵌进去。

在第 ② 步之前，electron-builder 需要在**宿主机上运行**第 ① 步产出的安装器来把卸载器
「提取」出来（`app-builder-lib/out/targets/nsis/NsisTarget.js` 中的 `execWine` 调用）。
Linux 上没有 wine 就会直接报错：`wine is required`。

而 Debian / Ubuntu 当前软件源里只有 `libwine`，没有可用的 `wine` 命令 —— 这条路走不通。

### 方案

上游之所以要「预生成 + 嵌入」，只是为了给卸载器 exe 带上自定义图标和版本信息。
NSIS 从 2.x 起就原生提供 **`WriteUninstaller`**：安装时由安装器自己吐出卸载器，
功能完全等价，代价仅仅是卸载器 exe 缺少自定义图标（不影响卸载行为）。

三处改动，全部由 `scripts/patch_builder.py` 自动完成：

| # | 文件 | 改动 |
|---|---|---|
| ① | `templates/nsis/include/installer.nsh` | `File "/oname=…" "${UNINSTALLER_OUT_FILE}"` → `WriteUninstaller "$INSTDIR\…"` |
| ② | `templates/nsis/include/getProcessInfo.nsh` | `GetProcessInfo` 宏由 `Call _GetProcessInfo` 改为**内联展开** `!insertmacro FUNC_GETPROCESSINFO` |
| ③ | 同上 | `_GetProcessInfo` / `un._GetProcessInfo` 两个包装函数改为**都定义** |

配套的两处工程侧配置：

- `package.json` → `build.nsis.script: "build/nsis/installer.nsi"`
  指定自定义脚本后，electron-builder 会跳过「运行安装器提取卸载器」这一步。
- `package.json` → `build.nsis.warningsAsErrors: false`
  上游默认给 makensis 传 `-WX`（警告即错误）。我们的改动会产生若干无害警告
  （主要是 `WriteUninstaller` 相关的提示），关掉 `-WX` 让构建通过。
- `build/nsis/installer.nsi` 尾部**无条件** `!include "uninstaller.nsh"`。
  NSIS 硬性要求：只要用了 `WriteUninstaller`，脚本中就必须真的存在 Uninstall Section。

### 为什么补丁 ② 是必须的

一旦脚本里同时存在安装与卸载两个 Section，`GetProcessInfo` 宏会在两个上下文中各展开一次。
上游写法是按 `!ifdef BUILD_UNINSTALLER` 二选一，而 NSIS 有一条硬性约束：

> **卸载 Section 中只能 Call 以 `un.` 开头的函数。**

于是「二选一」必然有一边编译不过。把函数体**内联展开**就彻底绕开了 `Call`，
前缀约束自然失效。补丁 ③ 再把两个包装函数都定义出来，兼容其它外部引用。

### 补丁的持久性

补丁打在 `node_modules/` 里，**不在版本控制范围内**。每次 `npm install` 或重装依赖后
都会丢失，因此 `package.json` 里配置了：

```json
"postinstall": "python3 scripts/patch_builder.py"
```

脚本是**幂等**的，重复执行安全。相关命令：

```bash
npm run patch           # 手动重新打补丁
npm run patch:check     # 只检查状态，不改动
python3 scripts/patch_builder.py --revert   # 从上游模板还原
```

---

## 5. 工程结构

```
pc/
├── electron/
│   ├── main.js              主进程：窗口、离网守卫、原生 API、存档目录
│   └── preload.js           contextBridge 暴露 window.hunNative
├── www/                     游戏本体（离线化后的 H5）
│   ├── index.html           9:16 舞台外壳 + 启动进度条
│   ├── game_main_offline.html   游戏主页面
│   ├── js/hun_min.js        游戏核心逻辑（原版，未改动）
│   ├── img/  audio/  json/  精灵图集、音频、配置
│   └── offline/             离线适配层（本项目的全部改造所在）
├── build/
│   ├── icon.ico             应用图标（256/128/64/48/32/24/16 七帧）
│   ├── icon.png             图标 PNG 源
│   └── nsis/installer.nsi   自定义 NSIS 脚本
├── scripts/
│   ├── patch_builder.py     免 wine 补丁（postinstall 自动执行）
│   ├── make_offline_page.py 由原版页面生成 game_main_offline.html
│   ├── assemble.py          资源装配
│   ├── serve.py             本地静态服务器（调试用）
│   ├── deep_play.js         深度玩法闭环验证（25 项断言）
│   ├── headless_test.js     无头浏览器冒烟测试
│   ├── probe_pcux.js        PC 交互验证（26 项断言，真实鼠标事件）
│   ├── make_overlay.py      更新包生成工具
│   └── verify_overlay.sh    更新包机制四阶段验证
├── docs/
│   └── overlay-notes-v*.md  各版本更新说明（供更新包引用）
├── .npmrc                   npm / electron 镜像
├── package.json
├── BUILD.md                 本文档（开发者向）
└── README.md                面向玩家的玩法说明
```

### 离线适配层（`www/offline/`）

这是本项目**唯一**修改游戏行为的地方，原版 `hun_min.js` 保持字节级不变，
所有改动都以「猴补丁 / 运行时覆写」的方式叠加：

| 文件 | 职责 |
|---|---|
| `boot.js` | 装在 `<head>`。覆写资源路径函数指向本地；建立腾讯云 COS 的本地替身；固定画布倍率 |
| `offline.js` | 核心离线层：配置、存档引擎、设置、支付框架、路由表、事件引擎、AJAX 全局拦截 |
| `start.js` | `</body>` 加载。初始化存档、注入初始混币、提供解析器 |
| `module-cutter.js` | 按开关裁掉社团 / FC 小游戏 / 艺妓 / 排行榜 / 众筹 / 内购模块 |
| `load-order.js` | 修正资源加载顺序，保证初始化序列完整走完 |
| `event-engine.js` | 11 类随机事件模板 |
| `native-bridge.js` | 前端 `jsbridge_android.callbackJs` 与 Electron 主进程之间的桥 |
| `shell.js` | 启动引导覆盖层 |
| `pc-ux.js` | **PC 交互增强层**：鼠标拖曳平移、滚轮缩放、双击复位（详见第 7 章） |

---

## 6. 调试与验证

```bash
npm start                       # 带开发者工具
npm run dev                     # 同上（--dev）
python3 scripts/serve.py        # 起一个 8100 端口的静态服务，浏览器里调 www/
node scripts/headless_test.js   # 无头浏览器冒烟测试（12 项验收）
npm test                        # 深度玩法闭环验证（25 项断言）
npm run test:pcux              # PC 交互验证（26 项断言，真实鼠标事件）
npm run test:overlay           # 更新包机制验证（四阶段端到端）
```

> **注意**：调试 `game_main_offline.html` 时必须带完整启动参数
> （`?openid=...&channel=pc&epv=jp&...`），否则页面会走「参数缺失」分支。
> 该分支在原版中会跳转外站，本项目已改为就地补全本地默认值。

查看离线拦截日志：启动时加 `--dev`，主进程会把所有被拦截的外网请求打到控制台。

### 深度验证（`npm test`）

`scripts/deep_play.js` 通过 CDP 驱动无头 Chromium，实际走一遍
「启动 → 开始游戏 → 进城市 → 推进天数 → 存档」的完整流程，
而不是只检查文件是否存在。共 25 项断言，覆盖九个维度：

| 维度 | 验证内容 |
|---|---|
| 开局加载 | 主菜单场景、车辆 66 条、人物 110 条 |
| 开局数值 | `SCENE_PLAY`、hp 100、现金 3000、混币 20000 |
| 进入城市 | `PM_STATE_CITY`、城市名正确（京都） |
| 城市机制 | 寻路系统、事件管理器、演员管理器可用 |
| 时间推进 | `pm.passDay()` / `passDayAndSaveGame()` 可调用 |
| 存档 | 键名正确、结构可解析（`singleGame` / `globalParams`） |
| 模块裁剪 | 社团 / 排行 / 内购 / 众筹开关均为 `false` |
| 离线层 | 11 个模块装载、**45 个路由端点**、支付框架在位 |
| 网络 | 外网请求 0、资源失败 0、运行时异常 0 |

依赖 `ws`；如未安装执行 `npm i -D ws`。需要先起静态服务：

```bash
python3 scripts/serve.py &
npm test
```

> 注意：脚本默认访问 `http://127.0.0.1:8100/game_main_offline.html`，
> 并用 `HUN_BASE_URL` 环境变量可覆盖。

**排查提示**：游戏的状态 API **不在全局作用域**，而挂在 `mainManager` 上
（`mainManager.getScene()` / `mainManager.getState()`）。
另需注意两个易踩的坑：路由表字段是 `Router.table`（小写），
推进天数的入口是 `playManager.passDay()`。

存档位置（Windows）：

```
%APPDATA%\混在日本\saves\
```

删除该目录即可重置存档。

---

## 7. PC 交互层（`www/offline/pc-ux.js`）

### 7.1 它解决什么问题

游戏原本是移动端 H5，地图交互依赖触摸。在 PC 上表现为：

| 现象 | 根因 |
|---|---|
| 大地图只能看到约 56%×70% | 地图按移动端屏幕比例初始化，未提供缩放能力 |
| 鼠标拖动无效 | 原版的鼠标处理器 `userMouse` **从未被注册** |
| 滚轮无效 | 没有滚轮事件处理 |
| 城市热点不跟随 | 缩放后未重算热点的绘制坐标 |

### 7.2 关键发现：原版已内置鼠标处理器

`hun_min.js` 中早已实现了完整的鼠标处理器 `userMouse(event)`，
把 `mousedown/mousemove/mouseup` 翻译为引擎消费的输入变量族：

```js
case "mousedown": touchStartX = b.clientX; touchStartY = b.clientY;
                  touchMove_PreX = touchMove_X = null; ... break;
case "mousemove": touchMove_X = touchMoveX = b.clientX;
                  touchMove_StepX += (touchMove_X - touchMove_PreX);   // 累加
                  touchMove_PreX = touchMove_X; ... break;
case "mouseup":   touchEndX = b.clientX; touchEndY = b.clientY; ... break;
```

但它从未被注册 —— 只注册了触摸版 `userTouch`：

```js
hasInput_TouchNotMouse = channel == CHANNEL_PC ? !1 : !0;
hasInput_TouchNotMouse = !0;              // ← 上一行的 PC 判断被无条件覆盖
gCanvas.addEventListener("touchstart", userTouch, !1);   // 只有触摸
```

**因此 PC 适配的正确做法不是自己重写一套输入，而是复用这个原生处理器。**

### 7.3 三个必须绕过的坑

**坑 1：输入「按帧消费」模型**

`MainManager.userInput()` 每帧末尾把输入变量全部清零：

```js
touchEndY = touchEndX = touchStartY = touchStartX
          = touchMove_StepY = touchMove_StepX = clickY = clickX = null;
```

且开头有门控：只有上述变量之一非 `null` 时才进入分发分支。
鼠标事件的刷新频率（~125 Hz）远高于主循环门控周期（50 ms），
因此**由事件自身重填变量即可**，无需逐帧注入。

**坑 2：`hasInput_TouchNotMouse` 决定点击取值路径**

```js
gCanvas.onclick = function (b) {
    if (hasInput_TouchNotMouse) clickX = b.clientX - gCanvas.offsetLeft + ...;   // 触摸：直接取
    else { /* 用 mouseDownX/mouseDownY 做 3px 抖动过滤 */ }                      // 鼠标：过滤抖动
};
```

PC 端应走 `false` 分支。`pc-ux.js` 会把它纠正回 `false`，
并起一个 1 秒周期的幂等守护（防止运行期被改写回去）。

**坑 3：拖曳后误触城市按钮**

拖拽松手时浏览器会补发一次 `click`，若不拦截会误触城市/热点。
`pc-ux.js` 用位移阈值（4 px）判定是否为拖曳，
在 **capture 阶段**拦截该次 `click`（`stopImmediatePropagation`），
并只吞掉一次。

### 7.4 缩放实现

缩放走**锚点缩放**：指针所指的地图内容在缩放前后停留在原处。

```
contentX = (anchorX - map.x - map.scrollX) / s0     // 换算为地图内容坐标
nx       = anchorX - map.x - contentX * s1          // 反算新滚动量
```

随后：

1. `map.picW = base.picW * s1`（`picH` 同理）
2. `map.initScrollParam()` —— 重算 `min_scrollX/max_scrollX` 边界
3. 若 `picW <= w`（地图比视口窄）→ 居中锁定：`min_scrollX = max_scrollX = (w - picW) / 2`
4. 增量调用 `map.setScrollXY(dx, dy)`（注意：该函数是**增量**语义）
5. `resyncHotspots(map)` —— 重写热点的 `orgX/orgY/w/h` 并同步 `x = drawPicX + orgX`

缩放范围 **0.25x ～ 3.0x**（`CONFIG.MIN_SCALE` / `MAX_SCALE`）。

### 7.5 地图类包装

三个地图类需要打标记以便统一处理：

- `JapanMap`（大地图）
- `CityMap`（城市内部）
- `CityMap_Type2`（城市内部，类型 2）

`pc-ux.js` 包装它们的全局构造器，为新实例补上
`__zoomable`、`__viewScale`、`__basePicW/__basePicH` 等字段
（`Wrapped.prototype = Ctor.prototype`，保证 `instanceof` 不变）。

### 7.6 对外 API

```js
window.PCUX = {
    CONFIG,            // { MIN_SCALE, MAX_SCALE, WHEEL_STEP, ... }
    getScale,          // () => number
    setScale,          // (s) => void
    zoomIn, zoomOut,   // () => void
    reset,             // () => void
    getActiveMap,      // () => map | null
    setMapScale,       // (map, scale, anchorX, anchorY) => void
    install            // 手动安装（一般不需要）
};
```

调试时可用：

```js
PCUX.getScale()        // 当前缩放
PCUX.setScale(2.0)     // 直接设为 2.0x
PCUX.reset()           // 复位
PCUX.getActiveMap()    // 当前地图实例
```

### 7.7 约束

- **`www/js/hun_min.js` 保持字节级零改动** —— 玩法逻辑与原版完全一致
- 所有 PC 适配集中在 `www/offline/pc-ux.js`，可单独替换或移除

### 7.8 验证

```bash
npm run test:pcux        # 26 项 PC 交互断言（真实 CDP 鼠标事件）
```

覆盖：事件注册、缩放上下限、锚点精度、拖曳位移与方向、惯性衰减、
双击复位、贴图与边界同步、运行期异常。

---

## 8. 更新包机制（Overlay）

### 8.1 设计目标

- 玩家把更新包放进游戏目录即可升级，**无需重装**
- **不影响存档**
- 可叠加安装在**任意历史版本**之上
- 可一键回退

### 8.2 原理

程序代码与存档**物理分离**：

| | 位置 | 更新包是否触碰 |
|---|---|---|
| 程序代码 | `<安装目录>/resources/app.asar`（只读基础版）<br>`<安装目录>/app_overlay/`（可写覆盖层） | ✅ 只动覆盖层 |
| 玩家存档 | `%APPDATA%/hun-japan-pc/saves/` | ❌ 从不触碰 |

启动时 `main.js` 按顺序查找覆盖层，**找到即用**：

```js
function resolveOverlayRoot() {
    const candidates = [];
    if (process.resourcesPath)
        candidates.push(path.join(process.resourcesPath, 'app_overlay'));   // ① 安装版
    candidates.push(path.join(path.dirname(app.getPath('exe')), 'app_overlay'));  // ② exe 同级（便携版）
    candidates.push(path.join(app.getPath('userData'), 'app_overlay'));     // ③ 用户目录兜底
    candidates.push(path.join(__dirname, '..', 'app_overlay'));             // ④ 开发态
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'www', 'index.html'))) return dir;
    }
    return null;
}
```

随后 `resolveCodeRoots()` 决定 `WEB_ROOT`（`index.html` 所在目录）与
`PRELOAD_PATH`，两者各自独立回退 —— 即使覆盖层只更新了其中一部分也能正常工作。

### 8.3 覆盖层结构

```
app_overlay/
├── version.json          # 版本元信息（版本号、文件清单、SHA-256）
├── www/                  # 网页层（游戏本体）
└── electron/
    └── preload.js        # 预加载桥接层
```

### 8.4 制作更新包

```bash
python3 scripts/make_overlay.py \
    --version 4.2.0 \
    --out "dist/update-pkg/混在日本-更新包-v4.2.0-<名称>" \
    --notes docs/overlay-notes-v4.2.0.md \
    --zip
```

产物包含：

| 文件 | 说明 |
|---|---|
| `app_overlay/` | 覆盖层内容 |
| `version.json` | 版本元信息（含每个文件的 SHA-256） |
| `apply-update.bat` | 玩家端一键安装脚本（自动定位游戏目录、检测运行状态、备份旧版） |
| `更新说明.md` | 面向玩家的更新日志 |

### 8.5 验证

```bash
npm run test:overlay     # 四阶段端到端验证
```

| 阶段 | 场景 | 期望 |
|---|---|---|
| 1 | 无 `app_overlay` | 使用内置版本 |
| 2 | 放入 `app_overlay` | 切换到覆盖层，版本号正确 |
| 3 | 删除 `app_overlay` | 回退到内置版本 |
| 4 | 放入 userData 位置 | 被识别并生效 |

各阶段通过「标记文件」（内置版写 `BUILTIN_x`，覆盖层写 `OVERLAY_x`）
来证实**实际加载的确实是预期来源**，而非仅检查路径字符串。

### 8.6 注意事项

- 更新包**不得包含**任何存档文件或 Electron 运行时
- `baseVersion` 默认 `any`（表示可叠加任意版本）；仅当有前置依赖时才填具体版本
- `apply-update.bat` 会把旧覆盖层备份为 `app_overlay.bak`，便于回退

---

## 9. 常见问题

**Q：构建报 `wine is required`**
补丁没生效。执行 `npm run patch` 后重试；若仍失败，跑 `npm run patch:check` 确认状态。

**Q：构建报 `macro named "installApplicationFiles" already exists`**
说明 `node_modules` 里残留了早期失败实验的改动。先 `npm run patch --revert`，或直接
`rm -rf node_modules && npm install` 重装。

**Q：安装包体积有 100 MB+，能压吗**
其中约 90 MB 是 Electron 运行时本身，属正常范围。压缩需要换更小的运行时，
不属于本项目的目标。

**Q：想改游戏版本号 / 应用名**
`package.json` 的 `version` 与 `build.productName`，以及 `electron/main.js` 顶部的
`APP_NAME` / `APP_VERSION` 常量。

---

## 10. 版权

游戏内容、美术、音乐、剧本的一切权利归**原作者**所有。
本仓库仅包含使其能在 PC 上离线运行所需的适配代码。
