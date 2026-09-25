# 《混在日本》（混二）APK 深度调查文档

> **调查对象**：`com.hao.hun.japan` v4.0（Google Play 官方发行版）
> **调查日期**：2026-09-19
> **调查方式**：APK 静态解包 + Java 反编译 + 线上 H5 资源逆向 + 后端接口验证
> **文档版本**：v1.0

---

## 目录

1. [调查摘要](#一调查摘要)
2. [样本基本信息](#二样本基本信息)
3. [整体架构：双层结构](#三整体架构双层结构)
4. [APK 静态结构分析](#四apk-静态结构分析)
5. [外观与视觉设计](#五外观与视觉设计)
6. [原生层代码分析](#六原生层代码分析)
7. [JS 桥接机制（核心）](#七js-桥接机制核心)
8. [游戏内容层：H5 逆向](#八游戏内容层h5-逆向)
9. [玩法系统全解析](#九玩法系统全解析)
10. [元素数据库](#十元素数据库)
11. [后端与网络架构](#十一后端与网络架构)
12. [商业化与经济系统](#十二商业化与经济系统)
13. [安全与风控机制](#十三安全与风控机制)
14. [特殊功能模块](#十四特殊功能模块)
15. [版本迭代与运营体系](#十五版本迭代与运营体系)
16. [风险与合规评估](#十六风险与合规评估)
17. [技术结论](#十七技术结论)
18. [附录](#十八附录)

---

## 一、调查摘要

本次调查对《混在日本》（亦名《混二》）的 Android 安装包进行了完整解包与逆向分析，得到以下核心结论：

| 维度 | 结论 |
|---|---|
| **真实性质** | **WebView 空壳容器 + 服务端 H5 游戏**。APK 本体不含任何游戏逻辑、图片、音频资源 |
| **APK 体积构成** | 10.3 MB 中，约 7.5 MB 为 `classes.dex`（其中绝大部分是 AndroidX/Firebase/Google Play 依赖库），游戏内容体积为 **0 字节** |
| **游戏引擎** | 非商业引擎（无 LayaAir/Cocos/Egret/CreateJS 痕迹），为**自研 Closure 编译型 H5 框架**，6241 个函数、2349 个构造器 |
| **游戏框架** | WebView + `@JavascriptInterface` 双向 JS 桥（`jsbridge_android`） |
| **发行渠道** | **Google Play 官方签名**（证书颁发者 `CN=Android, O=Google Inc.`），非第三方渠道包 |
| **商业模型** | 免费下载 + 虚拟货币「魂币(HunCoin)」内购 + Google Play Billing 7.1.1 |
| **题材性质** | 成人向黑帮犯罪题材中文手游（含性暗示、暴力、犯罪教唆元素） |
| **后端存活状态** | 部分存活（OSS/CDN 全部可用），主域名 `h2jp.hun333.com` 返回 522 |

> **一句话概括**：这是一个「App 只是浏览器，游戏全在云上」的典型形态。想要获取游戏的"完整内容"，必须连服务器资源一起抓取——APK 本身解密后基本是个空盒子。

---

## 二、样本基本信息

### 2.1 文件指纹

| 项目 | 值 |
|---|---|
| 文件名 | `hun.apk` |
| 文件大小 | 10,296,686 字节（9.82 MiB） |
| MD5 | `6b7823e48373f97b0020dd1716314139` |
| SHA-256 | `21998cb7b674574a9b3c96e992a970ff6ef2cc7f74497c7fa83448e5d728ac4f` |
| ZIP 条目数 | 458 |
| 完整性校验 | 通过（`unzip -t` 无错误） |
| 压缩方式 | 标准 ZIP（文件头 `50 4B 03 04`） |

### 2.2 应用元数据

| 项目 | 值 |
|---|---|
| 包名 | `com.hao.hun.japan` |
| 应用显示名 | **混在日本** |
| 版本名 / 版本号 | `4.0` / `4` |
| minSdkVersion | **24**（Android 7.0） |
| targetSdkVersion | **35**（Android 15） |
| compileSdkVersion | **35** (Android 15 / `VanillaIceCream`) |
| MainActivity | `com.hao.hun.japan.MainActivity` |
| 屏幕方向 | `screenOrientation=1`（**竖屏锁定**） |
| 主题 | `@7F0F0108` |
| 允许备份 | `allowBackup=true` |
| 明文流量 | **`usesCleartextTraffic=true`**（允许 HTTP） |
| 原生库 | **无**（`lib/` 目录不存在，`extractNativeLibs=false`） |
| 应用分类 | `appCategory=0` |

> **竖屏锁定** 是一个值得注意的细节：说明游戏采用手机竖屏单手操作模式，而非横屏 SLG。

### 2.3 签名信息（关键证据）

APK 采用 **APK Signature Scheme v2 + v3** 双重签名（无 v1 JAR 签名）。

**V2 签名证书链**：

| 层级 | 长度 | SHA-256 | SHA-1 |
|---|---|---|---|
| 叶子证书 | 1416 B | `ef5b1dd61379d223d285a87984f56bb56c819bdc13aa840f68dd27947e80716e` | `dc714e74a15d54e8bd917a705613d19de45cfc52` |
| 中间证书 | 546 B | `29f0cef1acf924eed818a6f3d28978b1576cbdb3bc0808467f4f30ef2a0b0a2f` | `d82453e9880b87db799c2964a831e981f57e4bf0` |

**证书主题（Subject）**：

```
C  = US
ST = California
L  = Mountain View
O  = Google Inc.
CN = Android
```

**有效期**：`2025-07-22` → `2055-07-22`（30 年）

> **结论**：证书颁发者为 `Google Inc. / Android`，这是 Google 为开发者提供的 **Play App Signing（应用签名服务）** 标准证书。
> 结合 manifest 中的 `com.android.stamp.source = https://play.google.com/store`、`com.android.stamp.type = STAMP_TYPE_DISTRIBUTION_APK` 与 `com.android.vending.derived.apk.id=3`，
> **可 100% 确认此包是从 Google Play 官方渠道下载的正版发行包**，而非第三方修改版或渠道包。

**签名块结构**（block size = 12,280 字节）：

| Pair ID | 长度 | 含义 |
|---|---|---|
| `0x7109871A` | 2626 | V2 签名 |
| `0xF05368C0` | 2626 | V3 签名 |
| `0x6DFF800D` | 3061 | V3.1 签名 |
| `0xFA1CFABE` | 1762 | **Source Stamp**（源码戳，Google Play 归属验证） |
| `0x2146444E` | 228 | 证明轮转（Proof of Rotation）相关 |
| `0x42726577` | 1905 | 验证器信息 |

---

## 三、整体架构：双层结构

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     Android 容器层 (APK 本体)                 │
│                    体积 ≈ 10.3 MB，游戏内容 0 字节             │
├─────────────────────────────────────────────────────────────┤
│  MainActivity  ──继承──►  Activity                            │
│      │                                                       │
│      ├─ SafeWebView  (WebView 子类，屏蔽 setInitialScale)     │
│      ├─ BillingManager (Google Play Billing 7.1.1)           │
│      ├─ DeviceUtils / MD5 / SharedPrefUtil                   │
│      ├─ RootCheck / RootCheckPlus  (Root 检测)                │
│      └─ PairIP LicenseCheck  (Google 加固壳)                  │
│                                                              │
│          │ addJavascriptInterface("jsbridge_android")        │
│          ▼                                                   │
├─────────────────────────────────────────────────────────────┤
│                  H5 游戏层（完全在云端）                       │
│                                                              │
│  jump.html (路由)  ──►  hun_japan.html (启动器)               │
│                              │                               │
│                              ├─ word_cn.js   (2423 条文案)    │
│                              └─ hun_min.js   (2.1MB 核心逻辑) │
│                                     │                        │
│                                     ▼                        │
│              hun2-cn.oss-cn-hangzhou.aliyuncs.com            │
│              (LayaAir 风格资源 / 图片 / 音效 / 数据)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       后端服务层                              │
│  h2jp.hun333.com      (主 API / 参数下发)                     │
│  h2jpen.hun333.com    (英文/国际版 API)                      │
│  hun1.hun333.com      (统计埋点)                             │
│  www.hun369.cn/h2pay  (支付网关)                             │
│  hun2web*.myqcloud.com / oss-accelerate (静态 CDN)           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计特征

| 特征 | 说明 |
|---|---|
| **内容零本地化** | APK 中完全没有游戏图片、音频、关卡数据。所有内容实时从 CDN 拉取 |
| **热更新能力** | 修改服务端 `hun_min.js` 即可全网更新游戏逻辑，无需重新发版 |
| **双版本共存** | 代码内置 `日本版(jp)` 与 `美国版(usa)` 两套内容，通过 `EXPENSION_PACK_VERSION` 切换 |
| **多端复用** | 同一套 H5 同时支撑 Android / iOS / PC / 微信小程序 / 头条小程序 |
| **强依赖网络** | 断网即无法启动游戏（除壳层崩溃外，无任何离线降级） |

---

## 四、APK 静态结构分析

### 4.1 目录结构

```
hun.apk
├── AndroidManifest.xml      (9,044 B，二进制)
├── classes.dex              (7,563,816 B — 唯一的 dex)
├── resources.arsc           (398,304 B)
├── assets/
│   └── dexopt/
│       ├── baseline.prof
│       └── baseline.profm   (共 8 KB)
├── res/
│   ├── mipmap-*/            应用图标（5 档密度）
│   ├── drawable*/           全部为 AndroidX 默认资源
│   ├── layout*/             AndroidX 布局
│   ├── xml/                 网络与 Billing 配置
│   └── raw/                 Billing 配置
├── META-INF/                AndroidX/Firebase 版本标记
├── kotlin/                  Kotlin 元数据
└── (无 lib/ 目录)           无任何 .so 原生库
```

### 4.2 资源分布分析

| 目录 | 内容 | 与游戏相关性 |
|---|---|---|
| `res/drawable*` | 全部为 `abc_*`（AppCompat）、`notification_*` 等系统资源 | **无** |
| `res/mipmap-*` | 仅 3 个图标（`ic_launcher`、`ic_launcher_round`、`ic_launcher_foreground`） | **仅图标** |
| `res/layout*` | AndroidX 系统布局 | **无** |
| `res/raw` | `com_android_billingclient_*` | Billing 配置 |
| `assets` | 仅 dexopt profile | **无** |

> **重要结论**：除应用图标外，**APK 中不含任何游戏美术资源**。所有游戏画面均在运行时从 CDN 下载。

### 4.3 权限清单

| 权限 | 类型 | 用途 |
|---|---|---|
| `android.permission.INTERNET` | 普通 | 网络访问（核心） |
| `android.permission.ACCESS_NETWORK_STATE` | 普通 | 网络状态检测 |
| `android.permission.VIBRATE` | 普通 | 震动反馈（JS 桥 `audiovibrate`） |
| `com.android.vending.BILLING` | 普通 | **Google Play 内购** |
| `com.android.vending.CHECK_LICENSE` | 普通 | **License 校验（PairIP）** |
| `com.hao.hun.japan.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | signature | AndroidX 自动生成 |

> **权限极简**：无位置、无存储、无相机、无联系人、无电话。这一点与游戏本身的"犯罪题材"形成强烈反差——**它并不需要敏感权限，因为它的一切都在云端完成**。

### 4.4 组件清单

**Activity（4 个）**：

| 组件 | 导出 | 说明 |
|---|---|---|
| `com.hao.hun.japan.MainActivity` | ✅ exported=true | 主入口，LAUNCHER |
| `com.android.billingclient.api.ProxyBillingActivity` | ❌ | 内购代理 |
| `com.android.billingclient.api.ProxyBillingActivityV2` | ❌ | 内购代理 V2 |
| `com.google.android.gms.common.api.GoogleApiActivity` | ❌ | GMS 通用 |
| `com.pairip.licensecheck.LicenseActivity` | ❌ | **PairIP 授权校验页** |

**Provider（3 个）**：

| 组件 | Authority |
|---|---|
| `androidx.startup.InitializationProvider` | `com.hao.hun.japan.androidx-startup` |
| `com.pairip.licensecheck.LicenseContentProvider` | `com.hao.hun.japan.com.pairip.licensecheck.LicenseContentProvider` |

**Service / Receiver**：

- `com.google.android.datatransport.runtime.backends.TransportBackendDiscovery`（Firebase 遥测传输）
- `com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService`
- `com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver`

### 4.5 网络与安全配置

`res/xml/network_security_config.xml`：

```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="true"/>
</network-security-config>
```

> **`cleartextTrafficPermitted=true`** 意味着应用允许 HTTP 明文传输。结合游戏 URL 中确实存在 `http://hkh2jp.hun333.com/...` 这样的明文地址，**用户流量存在被中间人监听的风险**。

另外，manifest 中同时设置了 `android:usesCleartextTraffic="true"`——双重确认放开明文。

---

## 五、外观与视觉设计

### 5.1 应用图标

应用图标是整个 APK 中**唯一的自研美术资源**。

| 属性 | 值 |
|---|---|
| 设计风格 | **黑白高对比 + 书法字体** |
| 主体文字 | 单个汉字「**混**」 |
| 构图 | 上半部白底黑字，下半部黑底白字，形成"分割"效果 |
| 字体 | 行书/草书风格毛笔字，笔画飞白明显 |
| 背景 | 纯白 → 纯黑横向分界（营造"混"字的双面意象） |
| 文件格式 | WebP（自适应图标 foreground + 圆形 round 两套） |

**图标规格**：

| 密度 | ic_launcher | ic_launcher_round | foreground |
|---|---|---|---|
| mdpi | 48×48 | 48×48 | 108×108 |
| hdpi | 72×72 | 72×72 | 162×162 |
| xhdpi | 96×96 | 96×96 | 216×216 |
| xxhdpi | 144×144 | 144×144 | 324×324 |
| xxxhdpi | 192×192 | 192×192 | 432×432 |

**自适应图标配置**（`mipmap-anydpi-v26/ic_launcher.xml`）：

```xml
<adaptive-icon>
  <background android:drawable="@7F07006C"/>
  <foreground android:drawable="@7F0C0001"/>
</adaptive-icon>
```

> **设计解读**：极简黑白书法「混」字，不露任何游戏内容，属于高度品牌化的"LOGO 型"图标。黑白分割暗示"亦正亦邪"，与游戏"在黑白两道夹缝求生"的主题高度吻合。这种极简设计在 Google Play 上更易通过审核（避免暴露敏感内容）。

### 5.2 视觉设计推断（基于文案与配置）

由于美术资源在云端，视觉风格从文案与配置反推：

| 维度 | 推断 |
|---|---|
| **主色调** | 黑（`[000000]`）、白、**血红（`[FF0000]`）**、**金黄（`[FF9912]`）**、**紫蓝（`[8A2BE2]`）** |
| **文字表现** | 大量使用 RichText 彩色标记（`[FF0000]...[-]`），典型港式黑帮题材 |
| **氛围词** | 「猛龙过江」「独闯龙潭」「暴尸街头」「刀口舔血」「不眠之街」 |
| **UI 构成** | 竖屏、地图热点（天平/银行/黑店图标）、进度条、对话框 |
| **音效** | 移动端通过 JS 桥 `audiovibrate` 触发原生震动 + BGM |

**颜色标记语义**（从 `word_cn.js` 统计）：

| 色值 | 出现语境 | 语义 |
|---|---|---|
| `[FF0000]` 红 | 危险、损失、死亡、警告、领导力下降 | ⚠️ 负面 |
| `[00FF00]` 绿 | 获得、成功、离开 | ✅ 正面 |
| `[FF9912]` 橙金 | 数字、金额、奖励、提示 | 💰 数值 |
| `[00AAFF]` / `[00AAAA]` 蓝 | 地点、场所、功能入口 | 📍 指引 |
| `[FF69B4]` 粉 | 歌舞伎町等"特殊场所" | 🔞 成人 |
| `[8A2BE2]` 紫 | 近战距离 | ⚔️ 战斗 |
| `[00FFFF]` 青 | 可点击链接 | 🔗 交互 |

### 5.3 游戏内文字风格

从 2423 条文案可见，游戏语言风格为**港式黑帮片语气 + 东北/网络俚语**：

- 「猛龙过江　独闯龙潭」（主标题）
- 「去日本混出个人样」（宣传语）
- 「你的人被打的屁滚尿流，全军覆没」（失败文案）
- 「逗我呢？你钱够吗？」（嘲讽式提示）
- 「老子不降」（战斗选项）

> 这种"痞气 + 幽默"的文案风格是该系列的核心辨识度，也是其在中国港澳台及海外华人圈流行的原因。

---

## 六、原生层代码分析

### 6.1 代码规模

| 项目 | 数值 |
|---|---|
| dex 文件 | 1 个（`classes.dex`） |
| dex 大小 | 7,563,816 B（占 APK 的 73.5%） |
| 自研类 | **仅 13 个 Java 文件** |
| 其余 | AndroidX / Firebase / GMS / Billing / PairIP（第三方库） |

**自研类清单**：

```
com/hao/hun/BillingManager.java          (127 行)
com/hao/hun/japan/MainActivity.java      (255 行)
com/hao/hun/japan/SafeWebView.java       (22 行)
com/hao/hun/japan/R.java                 (自动生成)
com/hao/js/JsToAndroid.java              (111 行)
com/hao/js/AndroidToJs.java              (173 行)
com/hao/stuff/Haodaren.java              (12 行)
com/util/DeviceUtils.java                (138 行)
com/util/MD5.java
com/util/ResizableImageView.java
com/util/RootCheck.java                  (50 行)
com/util/RootCheckPlus.java              (217 行)
com/util/SharedPrefUtil.java
```

> **关键结论**：自研代码总量 **不足 1100 行**。7.5 MB 的 dex 中 99% 是第三方依赖库（AndroidX、Firebase、Google Play Services、Billing）。**这印证了"空壳"判断**。

### 6.2 MainActivity —— 启动流程

`MainActivity` 是唯一入口，核心逻辑：

```java
// 关键常量
static final String APP_VERSION   = "4";
static final String CHANNEL       = "android";
static final String baseURL       = "https://h2jp.hun333.com";
static final String market_channel = "google_play";

// 核心：构造首页 URL
private String createHomeULR() {
    return "https://h2jp.nbn369.com/jump/jump.html"
         + "?openid="      + OPENID
         + "&channel=android"
         + "&app_version=4"
         + "&app_lg="      + locale.getLanguage()
         + "&pkname="      + PKNAME
         + "&mk="          + market_channel        // google_play
         + "&lg_sc="       + locale.getScript()
         + "&lg_cr="       + locale.getCountry()
         + "&epv=jp"                               // 版本：日本
         + "&cac="         + DeviceUtils.getRandomInt(0, 99999999);
}
```

**流程**：

```
onCreate()
  ├─ 初始化 BillingManager
  ├─ 创建 SafeWebView
  ├─ WebSettings 配置：
  │    ├─ setJavaScriptEnabled(true)
  │    ├─ setDomStorageEnabled(true)
  │    ├─ setAllowFileAccess(true)
  │    ├─ setMediaPlaybackRequiresUserGesture(false)  // 允许媒体自动播放
  │    └─ ...
  ├─ addJavascriptInterface(new JsToAndroid(), "jsbridge_android")
  ├─ 注入 AndroidToJs（供 JS 调用）
  ├─ 加载 createHomeULR()
  └─ 显示启动流程
```

**WebView 设置要点**：

| 设置 | 值 | 风险 |
|---|---|---|
| JavaScript | ✅ 启用 | 必需 |
| DOM Storage | ✅ 启用 | 存 openid 等 |
| File Access | ✅ 启用 | ⚠️ 允许 JS 访问本地文件 |
| Media 自动播放 | ✅ 允许 | 无需用户手势 |
| 明文流量 | ✅ 允许 | ⚠️ HTTP 可用 |

### 6.3 SafeWebView —— 一个 22 行的"补丁类"

```java
public class SafeWebView extends WebView {
    @Override
    public void setInitialScale(int scaleInPercent) {
        // 空实现——屏蔽缩放设置
    }
    // 可能还有其它被屏蔽的方法
}
```

> **设计意图**：某些国产 ROM 或 X5 内核会错误处理 `setInitialScale`，导致页面排版错乱。通过继承 WebView 并覆写该方法为空，规避兼容性问题。这是典型的"踩坑后打的补丁"。

### 6.4 Haodaren —— 埋下的"签名彩蛋"

```java
public class Haodaren {
    public static String bbc = "bbc";
    public void hello() { ... }
    public String sayMyName() { ... }
}
```

> 一个只有 12 行的空类，类名直译是「**好大人**」（开发者自嘲或致敬）。疑似开发者留的标记类，无功能作用。

### 6.5 DeviceUtils —— 设备指纹

| 方法 | 实现 | 用途 |
|---|---|---|
| `getUniqueId()` | `MD5(android_id + Build.SERIAL)` | **设备唯一标识** |
| `getPkName()` | 返回包名 | 上报 |
| `vibrate()` | `Vibrator.vibrate()` | JS 桥震动 |
| `openPlayStoreForReview()` | 跳转 Google Play 评价页 | **引导好评** |
| `getSystemMemory()` | 读 `/proc/meminfo` | 性能适配 |
| `getAppMaxMemory()` | `Runtime.maxMemory()` | 内存上限 |
| `getAppTotalMemory()` | `Runtime.totalMemory()` | 已分配内存 |
| `getAppFreeMemory()` | `Runtime.freeMemory()` | 空闲内存 |
| `getRandomInt(min, max)` | 随机数 | 生成 `cac` 参数（缓存击穿） |

**设备指纹含义**：
- `android_id`：设备级唯一（应用签名相关，重置系统会变）
- `Build.SERIAL`：硬件序列号（Android 10+ 需权限，通常返回 "unknown"）
- 组合哈希后作为设备 ID，**用于防止刷小号、封号追踪**

---

## 七、JS 桥接机制（核心）

这是整个应用**最核心、最有价值的代码**——它是原生能力与 H5 游戏之间的唯一通道。

### 7.1 通道总览

```
         ┌──────────────────────────────────────┐
         │            H5 游戏 (JS)               │
         └──────────────────────────────────────┘
              │                        ▲
   ① JS 主动调用 │                        │ ② Android 主动回调
              ▼                        │
   ┌────────────────────┐    ┌──────────────────────┐
   │  JsToAndroid        │    │  AndroidToJs          │
   │  (JS → Native)      │    │  (Native → JS)        │
   │  入口: callbackJs() │    │  evaluateJavascript() │
   │  对象: jsbridge_android                     │
   └────────────────────┘    └──────────────────────┘
```

### 7.2 JsToAndroid —— JS 调用原生（上行）

**入口方法**：

```java
@JavascriptInterface
public String callbackJs(String str)
```

**协议格式**：使用 `&` 分隔的 `key=value` 字符串，形如：

```
命令名&参数1=值1&参数2=值2&...
```

**完整指令表**：

| 指令 | 功能 | 实现细节 |
|---|---|---|
| `outlink` | 在系统浏览器打开外链 | `Intent.ACTION_VIEW` |
| `googleplay` | **触发 Google Play 内购** | `billingManager.purchase(pid)` |
| `googleplayReview` | 跳转 Google Play 评价页 | `openPlayStoreForReview()` |
| `saveKY` | 保存激活码/卡钥到本地 | SharedPreferences |
| `deleteKY` | 删除卡钥 | SharedPreferences |
| `getKY` | 读取卡钥 | SharedPreferences |
| `audiovibrate` | **震动反馈** | `DeviceUtils.vibrate()` |
| `base_url` | 获取后端根地址 | 返回 `baseURL` |
| `reset_label_text` | 重置按钮文字 | UI 调整 |
| `remove_splash` | 移除启动闪屏 | UI 调整 |
| `show_splash` | 显示闪屏 | UI 调整 |
| `remove_reloadbutton` | 移除刷新按钮 | UI 调整 |
| `uuid` | 获取设备 UUID | `DeviceUtils.getUniqueId()` |
| `getSystemMemory` | 系统内存 | 性能适配 |
| `getAppMaxMemory` | 应用最大内存 | 性能适配 |
| `getAppTotalMemory` | 应用已分配内存 | 性能适配 |
| `getAppFreeMemory` | 应用空闲内存 | 性能适配 |
| `checkRoot` | **Root 检测** | `RootCheck` / `RootCheckPlus` |

**静态状态字段**（原生 ↔ JS 共享）：

```java
public static String lastHunCoin  = "0";   // 上一次魂币数量
public static String lastPayMoney = "0";   // 上一次支付金额
public static String out_trade_no = "";    // 订单号
```

> **`checkRoot` 的存在**：说明游戏会**检测设备是否 Root**，可能用于反作弊（防止内存修改器刷魂币）或做风控标记。

### 7.3 AndroidToJs —— 原生回调 JS（下行）

原生层通过 `evaluateJavascript()` 主动调用 H5 中的回调函数：

**调用方法（Java → 触发 JS）**：

| Java 方法 | 触发场景 |
|---|---|
| `callAlert(msg)` | 弹出提示 |
| `callGooglePay(pid, ...)` | 发起 Google 支付 |
| `callWxPay(...)` | 发起微信支付 |
| `callAlipay(...)` | 发起支付宝支付 |
| `callShare_QQ_Result(...)` | QQ 分享结果 |
| `openShowLoading()` | 显示加载动画 |
| `closeShowLoading()` | 关闭加载动画 |
| `openAccessibility()` | **跳转无障碍设置页** ⚠️ |

**JS 侧回调函数（H5 必须实现）**：

| JS 回调 | 触发时机 |
|---|---|
| `fromAndroid_GooglePlayResult(...)` | Google Play 支付结果 |
| `fromAndroid_WxPayResult(...)` | 微信支付结果 |
| `fromAndroid_AlipayResult(...)` | 支付宝支付结果 |
| `fromAndroid_ShareQQResult(...)` | QQ 分享结果 |
| `fromAppOpenShowLoading()` | 打开 Loading |
| `fromAppCloseShowLoading()` | 关闭 Loading |
| `fromAppOpenAccessibility()` | 打开无障碍 |

> **⚠️ `openAccessibility()` 值得警惕**：引导用户开启"无障碍服务"是 Android 上权限最高、最危险的操作之一。虽然在当前 `jsbridge_android` 指令表与 manifest 中**未发现直接实现**（可能为预留接口或已废弃），但其存在说明**代码库曾计划或部分具备该能力**。若后续版本启用，将具备"模拟点击、读取屏幕内容"的能力。

### 7.4 BillingManager —— 内购实现

**依赖**：Google Play Billing Library **7.1.1**

**接口**：

```java
public interface BillingListener {
    void onRewardGiven(String sku, ...);    // 发货成功
    void onPurchaseCancelled();             // 用户取消
    void onPurchaseFailed(String reason);   // 支付失败
}
```

**流程**：

```
purchase(sku)
  └─► querySkuDetailsAsync()      // 查询商品详情
        └─► launchBillingFlow()   // 拉起 Google Play 支付
              └─► onPurchasesUpdated()
                    ├─ onRewardGiven   → 调用 JS fromAndroid_GooglePlayResult 发货
                    └─ consumeAsync()  → 消耗掉（允许重复购买）
```

> **`consumeAsync` 消耗型商品**：说明魂币是**可重复购买的消耗品**（氪金核心）。

**Billing 配置**（`res/raw/` + `billing.properties`）：

```
version=7.1.1
client=billing
billing_client=7.1.1
```

### 7.5 内购商品线索

从 `word_cn.js` 中的黑金兑换文案可反推商品 SKU 设计：

```
199WWW_HUNCOIN_WWW 换 19999黑金
299WWW_HUNCOIN_WWW 换 29999黑金
399WWW_HUNCOIN_WWW 换 39999黑金
499WWW_HUNCOIN_WWW 换 49999黑金
```

> 暗示魂币商品档次约为 **199 / 299 / 399 / 499 日元**（日本区定价），对应 19999/29999/39999/49999 黑金。

---

## 八、游戏内容层：H5 逆向

### 8.1 内容获取方式

由于 APK 无内容，我从**依然存活的 CDN** 拉取了完整游戏逻辑：

| 文件 | 大小 | 来源 |
|---|---|---|
| `word_cn.js` | 262,599 B（原文件）/ 188KB（去重后） | `hun2-cn.oss-cn-hangzhou.aliyuncs.com/static/js/` |
| `hun_min.js` | 2,136,759 B（2.04 MB） | 同上 |
| `version.json` | 1,421 B | 同上 |
| `hun_japan.html` | — | `h2jp.hun333.com/static/html/` |
| `jump.html` | — | `h2jp.nbn369.com/jump/` |

### 8.2 加载链路

```
APK 启动
  └─► https://h2jp.nbn369.com/jump/jump.html?openid=...&epv=jp&cac=...
        │
        ├─ 判断平台/版本
        ├─ 解析 openid（如无则从 localStorage 读，并支持 rew_openid=y 重写）
        └─► https://h2jp.nbn369.com/hun2android/static/html/hun_japan_android.html
              │
              ├─ 读取 version.json 获取版本号
              ├─ getResPath_CORS_Web() 确定资源服务器
              └─► 动态加载：
                    ├─ word_{lang}.js?v=39396      (文案)
                    └─ hun_min.js?v=39396          (核心逻辑)
```

**资源服务器选择逻辑**（`getResPath_CORS_Web()`）：

| 优先级 | 服务器 | 备注 |
|---|---|---|
| 国内 | `hun2-cn.oss-cn-hangzhou.aliyuncs.com` | 阿里云杭州 OSS |
| 国际 | `hun2-en.oss-accelerate.aliyuncs.com` | 阿里云全球加速 |
| 备用 | `hun2cos-1300260944.file.myqcloud.com` | 腾讯云 COS |
| 备用 | `h2jpenoss.nbn369.com` | 自建 |

> 注释中明确写道：`<!--【重要】腾讯云的CDN，由于不稳定，所以废弃 -->` —— 开发者曾因腾讯云 CDN 不稳定而切换到阿里云。

### 8.3 word_cn.js —— 文案数据库

| 项目 | 数值 |
|---|---|
| 文件大小 | 262,599 B |
| 变量总数 | 2,423 |
| 数组数量 | 802（`new Array()`） |
| 语言 | 中文（简体） |

**变量前缀分布**：

| 前缀 | 数量 | 含义 | 示例 |
|---|---|---|---|
| `WORD_` | 781 | 单字/词组（核心名词库） | `WORD_CREDITOR = "债主"` |
| `ARR_` | 736 | 随机文案数组（同一情境多套） | `ARR_MSG_BASE_DEAD` |
| `TITLE_` | 306 | 界面标题/弹窗标题 | `TITLE_GAME_INTRO = "猛龙过江　独闯龙潭"` |
| `MSG_` | 233 | 系统消息/提示 | `MSG_ALERT_INTRO = "该属性反映你在本城市被通缉的指数..."` |
| `LABEL_` | 93 | UI 标签/按钮文字 | `LABEL_CLUB_NAME = "社团"` |
| `BTN_` | 63 | 按钮 | — |
| `NAME_` | 44 | 地点/属性名称 | `NAME_HS_CASINO = "娱乐城"` |
| `CONTENT_` | 17 | 长文本说明 | `CONTENT_GAME_INTOR1 = "你孤身一人跑到日本..."` |
| `ACTOR_` | 17 | 部队/兵种相关 | — |
| `CAR_` | 11 | 车辆相关 | — |
| `FLOW_` | 9 | 流程相关 | — |
| `MISSION` | 8×N | 任务 1~10 定义 | `MISSION1_NAME` … `MISSION10_NAME` |
| `SKILL_` | 6 | 技能 | — |
| `SCHOOL_` | 6 | 培训学校 | — |

**`ARR_` 的设计巧思**：同一情境准备了 **2~6 套随机文案**，避免重复感。例如：

```javascript
ARR_MSG_BASE_DEAD = [
  "XXX_NAME_XXX[FF0000]挂了[-]",
  "XXX_NAME_XXX[FF0000]死了[-]",
  "XXX_NAME_XXX[FF0000]死掉了[-]"
];
```

> 这种"文案随机池"是提升文字游戏沉浸感的关键工程手段。

**占位符系统**：

| 占位符 | 含义 |
|---|---|
| `XXX_NAME_XXX` / `XXX_ACTOR_XXX` | 人名 / 单位名 |
| `XXX_CITY_XXX` / `XXX_PLACE_XXX` | 地点 |
| `XXX_CAR_XXX` | 车辆 |
| `XXX_MONEY_XXX` / `XXX_CASH_XXX` | 现金 |
| `XXX_HUNCOIN_XXX` / `WWW_HUNCOIN_WWW` | 魂币（内购货币） |
| `XXX_BG_XXX` | 黑金（社团货币） |
| `XXX_NUM_XXX` / `XXX_VALUE_XXX` | 数值 |
| `$NEW_LINE$` | 换行 |
| `[RRGGBB]...[-]` | 彩色文字标记 |

### 8.4 hun_min.js —— 游戏核心逻辑

| 项目 | 数值 |
|---|---|
| 文件大小 | 2,136,759 B（2.04 MB） |
| 函数数量 | 6,241 个 |
| 构造函数/类 | 2,349 个（`X = function(){}` 形式） |
| 唯一域名 | 27 个 |
| 唯一 URL | 198 个 |
| 代码风格 | **Google Closure Compiler 深度压缩混淆** |

**核心技术检测结果**：

| 检测项 | 结果 | 结论 |
|---|---|---|
| LayaAir | 0 | ❌ 非 LayaAir |
| Cocos / CocosCreator | 0 | ❌ |
| Egret | 0 | ❌ |
| CreateJS | 0 | ❌ |
| PIXI / Phaser / Three | 0 | ❌ |
| `canvas` | 115 | ✅ Canvas 渲染 |
| `drawImage` | 33 | ✅ 位图绘制 |
| `createElement` | 22 | ✅ DOM 操作 |
| `style.` | 110 | ✅ CSS 样式控制 |
| `requestAnimationFrame` | 0 | ⚠️ 不使用 RAF |
| `webgl` | 0 | ❌ 无 WebGL |
| **自研类** | 2349 | ✅ **完全自研框架** |

> **重要更正**：早期分析曾误判为 LayaAir 引擎（因统计方式失误）。经 5 种引擎关键词精确比对，**确认为自研 Canvas + DOM 混合渲染框架**，无任何商业引擎痕迹。
>
> 这也解释了为什么 `word_cn.js` 会和 `hun_min.js` 分离——作者自建了一套完整的「文案 / 逻辑分离」体系。

**核心类命名（从混淆代码中提取）**：

```
MainManager          主管理器
GameManager          游戏管理器
PlayerGroup (375)    玩家团队
GameLevel (124)      游戏关卡
GameBoard            游戏面板
GameRoom             游戏房间
GameType             游戏类型
GameEmulator         模拟器
GameEmulatorManager  模拟器管理器
PlayerClub (28)      玩家社团
PlayerHunCoinItem    魂币条目
MainBGM              主背景音乐
PlayerHead           玩家头像
GameInfo / GameInfos 游戏信息
GameOver             游戏结束
GameTimes            游戏次数
GameEnv              游戏环境
GameData             游戏数据
PlayerDead           玩家死亡
```

> 从类名密度看，`PlayerGroup`（375 次）是**最核心的类**——印证了"团队作战"是游戏主轴。

---

## 九、玩法系统全解析

### 9.1 世界观与主线

**开篇剧情**（`CONTENT_GAME_INTOR1`）：

> 「你孤身一人跑到日本，赎回了被黑帮控制的留学女友。
> 　条件是在约定期限内还清一切债务，否则等待你的只有暴尸街头。」

**第二章**（`CONTENT_GAME_INTOR2`）：

> 「给女友买完回国飞机票后，你兜里没剩几个钢镚。
> 　护照被债主扣押你无法找到工作。
> 　为了还债你只能干一些不上道的勾当。
> 　选个落脚地开始还债吧！」

**主标题**：`猛龙过江　独闯龙潭`

**核心循环**：

```
借钱（被债主控制）
   ↓
找落脚城市
   ↓
拉人手 → 做任务（犯罪）→ 赚钱
   ↑                          ↓
   └──────── 还债 ←────────────┘
              ↓
       债务清偿 → 夺回护照 → 结局
```

**通关条件**：还清债务 + 拿回护照。若逾期未还，则"暴尸街头"（Game Over）。

### 9.2 核心属性系统

| 属性 | 作用 | 说明 |
|---|---|---|
| **领导力 (Leadership)** | 决定可招募手下上限；影响任务额外行动值 | ≤50 点靠实战获得；>50 点每日 -1，需去歌舞伎町提升 |
| **通缉指数 (Alert)** | 被警方围捕概率 | 越高越危险，可在"天平"热点贿赂警察降低 |
| **道值 (DAO)** | **排行榜排名依据** | 资产型数值，用于全服排行 |
| **生命值 (HP)** | 单位存活 | 诊所可恢复 |
| **现金 (Cash)** | 游戏内通用货币 | 买装备、情报、贿赂 |
| **魂币 (HunCoin)** | **内购货币** | 现实货币兑换 |
| **黑金 (BG)** | 社团货币 | 抢地盘、打探情报 |

### 9.3 八大技能系统

| 技能 | 影响的任务 | 训练地点 |
|---|---|---|
| **开锁** | 入室、盗车、终极任务 | 开锁技巧 |
| **电器** | 盗车、终极任务 | 电工技校 |
| **射击** | 打劫、劫持、打斗、劫狱、终极任务 | 射击特训 |
| **演技** | 行窃、打劫、劫持、终极任务 | 表演专业 |
| **车技** | 飙车、逃逸 | 汽修厂练习 |
| **隐匿** | 行窃、入室、盗车、终极任务 | 间谍速成 |
| **领导力** | 招募人数、行动值 | 歌舞伎町团建 |
| **生命** | 生存能力 | — |

**技能上限**：培训最多到 **30 点**；高技能是装备高级工具的前置条件。

> **重要惩罚机制**：
> - 「任务中退出游戏，将会扣除团队成员各技能值 **10~15 点**」
> - 「未上传任务结果将视为强制退出，会扣除角色相应的技能值」
>
> 这是**防作弊**设计——防止玩家看到任务失败就强退。

### 9.4 犯罪任务体系

**七类犯罪/任务类型**：

| 类型 | 说明 | 关键机制 |
|---|---|---|
| **入室洗劫** | 打劫住宅/银行 | 需要开锁工具、"划玻璃"工具 |
| **盗车** | 偷窃车辆 | 需要破解防盗锁止系统、解除 GPS 追踪 |
| **打劫** | 抢劫银行/住宅（`打劫XXX_HOUSE_XXX`） | 银行"套个头套举把枪，进去容易出来难" |
| **劫持** | 劫持车辆 | **高警戒值，易被警察围剿，风险高** |
| **劫狱** | 营救被关押的同伴 | 需击败警察或匪徒守卫 |
| **行窃** | 扒窃/偷窃物品 | 依赖演技 + 隐匿 |
| **偷飞船** | **终极任务**（美国版） | 需购买情报 + 雇佣飞船驾驶员 |

**终极任务（日本版）—— 炸毁宙斯盾**：

这是一个**具有地缘政治色彩的终局任务**：

```
任务链：
  去军事基地
    → 进入库房
    → 地毯式搜寻宙斯盾系统（可能需要多次搜寻）
    → 遇到库管（NPC 提示系统位置）
    → 跳上宙斯盾控制平台
    → 装备指定工具（不然提示"别扯淡了！要装备XXX_TOOLS_XXX才能炸宙斯盾"）
    → 启动炸弹
    → 出现核弹头警告："你在发现宙斯盾导弹上印着"nuclear warhead"，原来是核弹头。
       架子上还有几十枚。启动炸弹意味着你也必死无疑"
    → 成功炸毁 → 结局
```

任务名称：`阻止日本部署路基宙斯盾` / `破坏宙斯盾？`
地点提示：`去军事基地炸毁宙斯盾？\n这可是有去无回啊~~~`

> **⚠️ 该内容具有明显的政治敏感性**：以"阻止某国部署陆基宙斯盾系统"为核心终局目标，属于**迎合特定民族主义情绪的游戏设计**。在多数应用商店属高风险内容。

**美国版终局——偷窃曲速飞船**：

```
任务链：
  支付现金购买情报 + 雇佣飞船驾驶员
    → 冲入库房搜寻曲速飞船
    → 找到紧闭大门（无钥匙孔）
    → 等待驾驶员到位
    → 冲上飞船
    → 驾驶员输入目的地"维纳斯城"
    → 飞船瞬间到达！
```

### 9.5 战斗机制

**回合制战术战斗**：

| 机制 | 说明 |
|---|---|
| **回合制** | "回合执行中，暂时无法调整装备" |
| **行动值** | 每回合可行动点数，受领导力加成 |
| **距离系统** | 近战/远程区分，用进度条表示 |
| **近战命中率** | 近战时有命中判定 |
| **射击限制** | "距离太远，没有装备枪支，无法攻击" |
| **投降机制** | 可选择"我投降"或"老子不降" |
| **逃跑机制** | 可"逃离战场"（但会损失收益） |
| **增援机制** | 警报响起后会有警察/保安增援 |

**距离进度条**：

```
[FF3F00]红色进度条[-] → 敌人与玩家的距离（普通任务）
[00AAFF]蓝色进度条   → 敌人超出玩家的距离（赛车任务）
[8A2BE2]紫色进度条   → 当前处于近战距离
```

**战斗中的敌人类型**：

| 敌人 | 出现场景 |
|---|---|
| 保安 (Security) | 私人场所 |
| 警官 (Police) | 通缉度高时 |
| 保镖 (Bodyguard) | 大佬身边，"各个凶神恶煞" |
| 追债帮派 | 债务逾期 |
| 敌对方社团 | PvP |

### 9.6 飙车系统

| 机制 | 说明 |
|---|---|
| 赛车场 | 地图热点「飙车场」 |
| 车辆参数 | 核载 / 级别 / 成色 / 安全 / 速度 / 货载 |
| 竞速博彩 | 「竞速博车」「竞速博钱」 |
| 车技判定 | 「当前车技失误概率: XXX%」 |
| 高倍率加成 | 「如脱缰的野马般极速飞车，速度增值 X 倍」 |

**车辆参数详解**：

| 参数 | 作用 |
|---|---|
| **核载** | 载人数（用"人"作单位） |
| **级别** | 车辆等级 |
| **成色** | 车况（汽修厂可恢复，满值可离厂） |
| **安全** | 「车辆安全值越高，越能保护车内人员的安全」 |
| **速度** | 竞速 & 逃逸能力 |
| **货载** | 「货载量越大，跑商就能拉更多的货物」 |

**特殊车辆**：超跑 + 货车（`CAR_AND_TRUCK`），支持跑商贸易。

### 9.7 社团（帮派）系统 —— 社交核心

这是游戏的**中后期核心玩法**与**社交/微交易驱动**：

| 功能 | 说明 |
|---|---|
| **创建社团** | 免费，创建即奖励魂币（`创建社团领取魂币`） |
| **社团势力** | 战力值 |
| **社团排行榜** | 全服竞争 |
| **地盘 (Land)** | 占有地盘，每 N 秒上缴黑金 |
| **黑金 (BG)** | 社团货币，用于打探、升级、抢地盘 |
| **打探** | 花黑金侦察敌方社团守军情况 |
| **抢夺地盘** | 战斗胜利可得对方一块地盘 + 黑金 |
| **抢夺游戏** | 战斗胜利可随机获得对方社团名下的一款游戏 |
| **抢夺艺伎** | 战斗胜利可随机获得对方旗下的一名艺伎 |
| **防守记录** | 「你的地盘被袭击了，具体列表如下」 |
| **兵力队列** | 攻击队列 / 防守队列（兵力会周期性损耗） |

**每日魂币激励（强 PvP 引导）**：

| 行为 | 奖励 |
|---|---|
| 每天第 1 次抢地盘成功 | 魂币奖励 |
| 每天第 2 次抢地盘成功 | 魂币奖励 |
| 每天第 3 次抢地盘成功 | 魂币奖励 |
| 每天前 N 次社团战斗获胜 | 每次随机 1~5 魂币 |
| 创建社团 | 一次性魂币奖励 |
| 社团打仗 | 魂币奖励 |

> **设计逻辑**：用**真金白银的内购货币（魂币）**作为 PvP 奖励，制造"打游戏就能免费赚氪金货币"的错觉，同时用"每天前 3 次"限制防止刷取——这是极其成熟的**留存 + 转化**设计。

### 9.8 经济活动体系

| 活动 | 说明 |
|---|---|
| **跑商贸易** | 用货车拉货，跨城差价 |
| **打工** | 「打工换XXX」——用劳动换取装备 |
| **跑外卖** | 仅"混在美国"版本开放 |
| **抡大锤** | 计时小游戏，可"抡大锤所得" |
| **抢地盘** | 社团 PvP |
| **黑市拳** | 拳击小游戏 |
| **文化课代考** | 仅"混在美国"版本 |

**打工换装备清单**（完整武器/工具表）：

| 类别 | 装备 |
|---|---|
| 手枪/冲锋枪 | AK47、MP5 冲锋枪 |
| 卡宾枪 | M4 卡宾枪、艾奇逊 AA12 卡宾枪 |
| 霰弹枪 | 雷明顿 870、莫斯伯格 590 |
| 狙击枪 | AWP 狙击步枪、AR-50 狙击步枪 |
| 冷兵器 | 武士刀、唐刀 |
| 防护 | 防弹厚马甲 |
| 工具 | 电工套装、簧片撬锁勾具、含氧汽油切割机 |
| 通货 | 金砖（可用于"上供金砖"） |

**工具使用场景**（从文案反推）：

| 工具 | 用途 |
|---|---|
| 撬锁工具 | 撬车门、撬保险柜、撬钢锁 |
| 暴力工具 | 砸门（"暴力工具才能砸门"） |
| 电工套装 | 拆警报器、短接点火开关、破坏点火开关保护系统 |
| 划玻璃工具 | 划玻璃、划开皮包 |
| 含氧汽油切割机 | 破拆保险柜、劈仪表盘 |
| 枪支 | 远程攻击、恐吓 |
| 迷药 | "迷倒对方" |

### 9.9 任务章节

游戏有 **10 章任务（MISSION1 ~ MISSION10）**，从 `word_cn.js` 变量可见：

```
MISSION1_NAME / MISSION1_MEMO / MISSION1_ARR_MSG_EXE / MISSION1_ARR_MSG_EXIST
MISSION2_NAME / MISSION2_TITLE_DOMISSION / MISSION2_CONTENT_DOMISSION / MISSION2_LABEL_ARRCHOICE
...
MISSION10_NAME / MISSION10_MEMO / ...
```

**任务解锁条件**：前置任务完成
> 「执行本任务需要先完成【任务一】」
> 「执行本任务需要先完成【任务二】」
> 「执行本任务需要先完成【任务三】」

**特殊任务机制**：
- 「这个任务必须 XXX_NAME_XXX 亲自挂帅」（指定角色）
- 「任务成功」/ 「任务失败」/ 「任务完成」
- 版本校验：「当前版本过于陈旧无法做任务，请更新最新版本继续」

> `word_cn.js` 中 `MISSION*` 定义为**空字符串**，说明任务的具体文案由服务端动态下发（或存于其它文件），客户端仅保留结构定义。

### 9.10 小游戏矩阵（氪金 + 留存）

游戏内置了 **5+ 款小游戏**，每款都有独立报名/倒计时，形成"每日必玩"习惯：

| 小游戏 | 报名标签 | 说明 |
|---|---|---|
| **黑市拳** | `黑市拳报名开始` / `下一场倒计时` | 拳击对战，有 win/lose 图 |
| **考试/答题** | `考试开始` / `下一场倒计时` | 文化课代考，有 pass/fail 图 |
| **抡大锤** | `可以抡大锤了` / `下个活儿倒计时` | 力量小游戏 |
| **跑外卖** | `可以跑外卖了` / `下单倒计时` | 限"混在美国"版 |
| **FC 红白机** | — | 见下节 |
| **飙车** | — | 竞速博彩 |

**小游戏图片资源**（从 URL 推断）：

```
hun2_ex_pages/boxing/pic/boxing_win.jpg
hun2_ex_pages/boxing/pic/boxing_lose.jpg
hun2_ex_pages/boxing/pic/black_boxing_1.jpg
hun2_ex_pages/question_answer/pic/exam_pass.jpg
hun2_ex_pages/question_answer/pic/exam_fail.jpg
hun2_ex_pages/question_answer/pic/exam_mask.jpg
```

### 9.11 艺伎系统（成人向社交）

| 功能 | 说明 |
|---|---|
| **艺伎馆** | 社团可拥有艺伎 |
| **解救艺伎** | 「去"解救"艺伎」——实为掳掠（"解救"加引号） |
| **名媛统计** | 「相同名字的多个艺伎只算一个名媛」 |
| **抢夺艺伎** | 战斗胜利随机获得对方一名艺伎 |
| **被抢记录** | 「您的艺伎馆被袭击了」 |
| **歌舞伎町** | 东京新宿地标，用于提升领导力 |

**原文描写**：

> 「歌舞伎町，领导团建好去处。歌舞伎町位于东京都繁华的新宿区中心地带。歌舞伎町区内聚集许多电影院、酒吧、风俗店、夜总会、情人旅馆等，被称作"不眠之街"」

> ⚠️ **该模块含明显成人/性交易影射**，是游戏的一大风险点。

### 9.12 家庭任务线（情感支线）

从文案可见一条**家庭责任支线**：

```
任务一：报平安
任务二：寄生活费
任务三：寄礼品
任务四：生日礼物
任务五：结婚纪念日
任务六：买别墅
任务七：盖福利院
```

> 这条支线通过"从报平安到盖福利院"的递进，构建**情感绑定**，让玩家在犯罪主线之外获得道德慰藉——提升叙事层次。

### 9.13 多地图城市系统

**地图热点（18 个）**：

| 热点 | 功能 |
|---|---|
| 商圈 (`NAME_HS_TRADING_AREA`) | 跑商贸易 |
| 银行 (`NAME_HS_BANK`) | 存钱/打劫目标 |
| 小诊所 (`NAME_HS_BLACK_HOSPITAL`) | 恢复生命值 |
| 培训班 (`NAME_HS_SCHOOL`) | 技能培训 |
| 汽修厂 (`NAME_HS_CAR_SERVICE`) | 恢复车辆成色 |
| 黑店 (`NAME_HS_BLACK_SHOP`) | 黑市交易 |
| 居民区 (`NAME_HS_COMMUNITY`) | 入室目标 |
| 贿赂 (`NAME_HS_CORRUPT_POLICE`) | **贿赂警察降通缉**（天平图标） |
| 黑帮 (`NAME_HS_GANGSTER`) | 黑帮据点 |
| 飙车场 (`NAME_HS_RACING`) | 竞速博彩 |
| 黑车市场 (`NAME_HS_BUY_CAR`) | 买车 |
| 新干线 (`NAME_HS_RAILWAY`) | 跨城移动 |
| 线人 (`NAME_HS_SOCIAL_MIX`) | 打探情报 |
| 商超 (`NAME_HS_STORE`) | 购物 |
| 街头 (`NAME_HS_STREET`) | 随机事件 |
| 娱乐城 (`NAME_HS_CASINO`) | 赌博 |
| 飞机场 | 出国（回国） |
| 地下批发市场 | 走私货源 |

**城市间移动**：

- 出城需要过**城界警察检查**（有幸运逃脱文案）
- 「城界警察看你不对，要求检查」
- 幸运事件：「领头的警察突然尿急，放你过去了」「女警见你长得不错，放你通行」
- 办案中无法出城：「出什么城？当前正在作案」

### 9.14 医院与培训系统

| 设施 | 机制 |
|---|---|
| **小诊所** | 每床位收费 X/天，每天最多恢复 HP X 点；床位满则「床位已满」 |
| **培训班** | 每名额收费 X/天，每天技能最多增长 X 点，**技能上限 30 点**；名额满则「名额已满」 |
| **汽修厂** | 每工位收费 X/天，每天最多恢复成色 X 点 |

> 全部采用**"床位/工位/名额"资源竞争模型**——营造稀缺感，刺激玩家频繁上线抢位。

---

## 十、元素数据库

### 10.1 全部物品清单（从文案提取）

**武器类**：
`AK47`、`MP5冲锋枪`、`M4卡宾枪`、`艾奇逊AA12卡宾枪`、`雷明顿870`、`莫斯伯格590`、`AWP狙击步枪`、`AR-50狙击步枪`、`武士刀`、`唐刀`

**工具类**：
`电工套装`、`簧片撬锁勾具`、`含氧汽油切割机`

**防护/通货**：
`防弹厚马甲`、`金砖`

### 10.2 资产类型

| 类型 | 说明 |
|---|---|
| 汽车 (`NAME_OBJECT_CAR`) | 可购买、出售、偷窃、修理 |
| 房产/车库 | 「车库购买成功」「房子购买成功」 |
| 地盘 (`LABEL_CLUB_LAND`) | 社团资产 |
| 艺伎/名媛 | 社团资产 |

### 10.3 状态标记

| 标记 | 含义 |
|---|---|
| `LABEL_BOUGHT = "已购买"` | 已购 |
| `LABEL_ONSALE = "在售中"` | 待售 |
| `CAR_DISABLE = "残"` | 车辆损坏 |

---

## 十一、后端与网络架构

### 11.1 域名资产清单（27 个唯一域名）

**核心业务域**：

| 域名 | 用途 | 存活状态 |
|---|---|---|
| `h2jp.hun333.com` | **日本版主 API + 静态页** | ⚠️ 522（超时） |
| `h2jpen.hun333.com` | 国际版/英文版 API | 未知 |
| `h2jpenoss.nbn369.com` | 国际版 OSS | 未知 |
| `hun1.hun333.com` | 统计埋点 / 老版本页 | 未知 |
| `hkh2jp.hun333.com` | **中国香港中转节点**（路由页） | 未知 |
| `route.hun333.com` | 路由分发 | 未知 |
| `h2jp.nbn369.com` | 跳转页 + Android 专用入口 | ✅ 可用 |
| `statichun.nbn369.com` | 静态分享页 | ✅ 可用 |
| `allopen.hun333.com` | 小程序跳转 | 未知 |
| `www.hun369.cn` | **支付网关** | 未知 |
| `hun2web.hun369.cn` | APK 分发 | 未知 |

**CDN / 存储域**：

| 域名 | 服务商 | 存活 |
|---|---|---|
| `hun2-cn.oss-cn-hangzhou.aliyuncs.com` | 阿里云 OSS（杭州） | ✅ 200 |
| `hun2-en.oss-accelerate.aliyuncs.com` | 阿里云全球加速 | ✅ 200 |
| `hun2cos-1300260944.file.myqcloud.com` | 腾讯云 COS | ✅ 200 |
| `hun2web-1300260944.file.myqcloud.com` | 腾讯云 COS（web） | ✅ 200 |
| `hun2web-1300260944.cos.na-siliconvalley.myqcloud.com` | 腾讯云 COS（硅谷） | ✅ 200 |

**第三方服务**：

| 域名 | 用途 |
|---|---|
| `ipapi.co` | IP 地理位置查询 |
| `discord.gg/5T6pQ3XgPG` | Discord 社区 |
| `facebook.com/hun369` | Facebook 官方页 |
| `facebook.com/japanronin` | Facebook（日本浪人） |
| `apps.apple.com/.../id925606960` | iOS 版 App Store 链接 |
| `badguys.sinaapp.com` | 早期新浪云服务（遗留） |
| `jingtaiweb.applinzi.com` | 静态图床（新浪云） |
| `cdn.bootcss.com` | Bootstrap CDN（已注释废弃） |
| `vjs.zencdn.net` | Video.js CDN（已注释废弃） |

### 11.2 核心接口清单

| 接口 | 方法 | 用途 |
|---|---|---|
| `https://h2jp.hun333.com/h2/get_exparam_by_openid.do` | GET | **按 openid 下发游戏初始参数**（核心接口） |
| `https://h2jpen.hun333.com/h2/get_exparam_by_openid.do` | GET | 国际版同上 |
| `https://hun1.hun333.com/stat/add_point.do?point_type=` | GET | **埋点上报** |
| `https://www.hun369.cn/h2pay/pay.do` | POST | **支付下单** |
| `https://www.hun369.cn/h2pay/pay_qq.do` | POST | QQ 支付 |
| `https://www.hun369.cn/h2pay/qq_user_comfirm.do` | POST | QQ 支付确认 |
| `https://www.hun369.cn/h2pay/wx_user_comfirm.do` | POST | 微信支付确认 |
| `https://ipapi.co/json/` | GET | IP 归属地（可能是用户地域风控） |

### 11.3 静态资源路径结构

```
{CDN}/static/
         ├─ js/
         │   ├─ word_cn.js          ← 中文文案
         │   ├─ word_zh_fan.js      ← 繁体（推断）
         │   ├─ word_en.js          ← 英文（推断）
         │   ├─ word_ja.js          ← 日文（推断）
         │   ├─ hun_min.js          ← 核心逻辑
         │   └─ lib/LAB.min.js      ← 资源加载器
         ├─ json/
         │   └─ version.json        ← 版本清单
         ├─ html/
         │   └─ hun_japan.html      ← 启动器页
         └─ pic/                    ← 图片资源
```

**外挂页面（ex_pages）**：

```
hun2_ex_pages/
  ├─ tutorial/tutorial.html      ← 新手教程
  ├─ tutorial/open_path.html     ← 路径引导
  ├─ boxing/pic/*.jpg            ← 拳击小游戏
  └─ question_answer/pic/*.jpg   ← 答题小游戏

club/geisha/intro/geisha.html    ← 艺伎介绍页
emulator/fc/emulator/index.html  ← FC 红白机模拟器
emulator/fc/rom/{gid}.nes        ← NES ROM（按 gid 索引）
pub/apk/hun1.apk                 ← 旧版分发
pub/apk/hun2.apk                 ← 新版分发
share_nes/index.html             ← 分享页
```

### 11.4 数据安全分析

| 风险项 | 说明 |
|---|---|
| **明文 HTTP** | `http://hkh2jp.hun333.com/...`、`usesCleartextTraffic=true` |
| **openid 明文** | 用户标识通过 URL 明文传递，可被窃取 |
| **无 API 签名** | `get_exparam_by_openid.do` 直接 GET，无签名/时间戳 |
| **支付跳转** | 支付经由 `www.hun369.cn/h2pay/` 自建网关（非直连渠道），存在**资金安全风险** |
| **`.do` 后缀** | 暗示后端为 **Java Servlet** 技术栈（Struts2/SpringMVC 风格） |

> **后端技术栈推断**：`.do` + `.html` 静态页 + `get_exparam_by_openid` 命名规范，高度符合 **Java + Servlet/Struts + Tomcat** 的传统架构。这也解释了为什么 CDN 上全是静态 JS——**后端只负责数据，不负责渲染**。

---

## 十二、商业化与经济系统

### 12.1 双货币体系

| 货币 | 获取方式 | 用途 | 性质 |
|---|---|---|---|
| **现金 (Cash)** | 游戏内赚取 | 买装备、情报、贿赂、治疗 | 游戏币 |
| **魂币 (HunCoin)** | **真金白银购买** | 加速解锁、买兵种、买车辆、兑换黑金 | **氪金货币** |
| **黑金 (BG)** | 魂币兑换 / 抢地盘 | 社团运营 | 次级氪金货币 |

**兑换比例（文案泄露）**：

| 魂币 | 黑金 |
|---|---|
| 199 | 19,999 |
| 299 | 29,999 |
| 399 | 39,999 |
| 499 | 49,999 |

### 12.2 魂币消费点（完整清单）

| 消费场景 | 文案 | 说明 |
|---|---|---|
| **加速兵种训练** | 「立刻完成XXX个XXX」 | 跳过等待 |
| **立即解锁兵种** | 「立刻解锁XXX_NAME_XXX 魂币:XXX 黑金:XXX 耗时:XXX」 | 双币消耗 |
| **购买兵种** | 「购买XXX个XXX_ACTOR_XXX，花费XXX魂币?」 | 兵力 |
| **购买车辆参赛** | 「你参赛的XXX为魂币购买车辆，如果比赛落败将**无法回收**车辆对应的魂币」 | 高风险 |
| **购买装备** | 「购买装备的魂币本局结束后将返回您的账号，请放心购买」 | 可退 |
| **购买房产/车库** | 「购买XXX_PROPERTY_XXX需要XXX现金」 | — |

**重要保护机制**：
> 「提示:购买装备的魂币本局结束后将返回您的账号，请放心购买」
> 「提示:购车魂币本局结束后将返回您的账号，请放心购买」

这是**降低氪金抵触感**的心理学设计——"反正会还给你"，诱导玩家大胆消费。

**但赛车有例外**：
> 「如果比赛落败将无法回收车辆对应的魂币」

——**赌博式消费**，进一步刺激。

### 12.3 魂币回收规则（防止套利）

> 「当前账户魂币 XXX
> 　本局内回收的 XXX 魂币，将在提交分数后返回到您的账户中
> 　**[FF0000]仅魂币购买且未卖出装备计算在内[-]**」

——严格限定回收范围，防止玩家通过"买装备→卖装备"套现。

### 12.4 每日魂币激励（免费获取渠道）

| 行为 | 每日奖励 |
|---|---|
| 抢地盘成功（第 1/2/3 次） | 魂币 |
| 社团战斗获胜（前 N 次） | 随机 1~5 魂币 |
| 创建社团 | 一次性 |
| 社团打仗 | 魂币 |
| 打赢小游戏 | 「今天再打赢一次可获得 XXX 魂币奖励」 |

> **设计精髓**：让**不氪金玩家也能获得氪金货币**，但通过"每天前 N 次"严格限制总量。既保证免费玩家有盼头（留存），又保证氪金玩家的优势不被稀释（付费转化）。

### 12.5 支付渠道

| 渠道 | 接口 | 市场 |
|---|---|---|
| **Google Play Billing** | 原生 BillingManager | Google Play（当前包） |
| 微信支付 | `wx_user_comfirm.do` | 中国大陆（H5） |
| 支付宝 | — | 中国大陆 |
| QQ 支付 | `pay_qq.do` / `qq_user_comfirm.do` | 中国大陆 |

> **注意**：当前 APK（`com.hao.hun.japan`）走 **Google Play 官方内购**；而 H5 版本内置了微信/支付宝/QQ 支付，用于**绕过应用商店抽成**。这是典型的"双轨支付"策略。

---

## 十三、安全与风控机制

### 13.1 Root 检测

**双实现**：

| 类 | 行数 | 检测手段 |
|---|---|---|
| `RootCheck` | 50 行 | 基础检测 |
| `RootCheckPlus` | 217 行 | 增强检测 |

**检测项（推断）**：

- `Build.TAGS` 包含 `test-keys`
- `su` 二进制文件路径检查（`/system/bin/su`、`/system/xbin/su` 等）
- `Runtime.exec("su")` 尝试执行
- busybox 检测
- 常见 Root 管理 App 包名检测
- 系统目录可写性检测

**用途**：
1. **反作弊**——防止使用内存修改器（GameGuardian 等）刷魂币
2. **风控标记**——Root 设备可能被限制活动或标记为高风险

**调用方式**：通过 JS 桥 `checkRoot` 指令，由 H5 主动查询。

### 13.2 Google Play PairIP 加固

**组件**：

| 组件 | 作用 |
|---|---|
| `com.pairip.licensecheck.LicenseActivity` | 授权校验界面 |
| `com.pairip.licensecheck.LicenseContentProvider` | 授权状态提供器 |
| `com.pairip.licensecheck.LicenseClient` | 校验客户端 |
| `com.pairip.licensecheck.ResponseValidator` | 响应验证器 |
| `com.pairip.licensecheck.ILicenseV2ResultListener` | 结果监听 |

**PairIP 是什么**：

Google 官方推出的**应用完整性保护方案**（Play Integrity Protection），提供：
- **运行时完整性校验**——检测 APK 是否被篡改/重打包
- **签名验证**——确保运行的是原始签名版本
- **反调试**——阻止动态分析
- **License 校验**——确认来自 Google Play

**影响**：
- ✅ **正面**：说明该游戏确实从 Google Play 发布，开发者使用了官方保护
- ⚠️ **负面**：**二次打包/修改版将无法运行**（启动即校验失败）

> 这也解释了为什么网上流传的"混二破解版"往往需要额外处理——PairIP 会拦截。

### 13.3 存档与状态存储

**客户端存储**：

| 存储 | 内容 |
|---|---|
| `localStorage` | `openid`、`game_language`、其它本地状态 |
| SharedPreferences | 卡钥（KY）、设备信息 |

**关键设计**：`openid` 持久化
```javascript
// 拿到新 openid
var openid = getPageParamValue("openid");
// 若支持重写（rew_openid=y）则覆盖本地
if (rew_openid=='y' && openid!=null)
    localStorage.setItem("openid", openid);
// 优先使用本地已有 openid
var localOpenId = localStorage.getItem("openid");
if (localOpenId) openid = localOpenId;
else localStorage.setItem("openid", openid);
```

**目的**：**重装系统/App 时不丢存档**（注释原文：「为防止App的openid发生改变如重装系统」）。

**反强退机制**：
> 「任务中退出游戏，将会扣除团队成员各技能值 10~15 点」
> 「未上传任务结果将视为强制退出，会扣除角色相应的技能值」

——**服务端权威**：任务结果必须上传，否则视为放弃并受罚。防止玩家"看到失败就杀进程"。

---

## 十四、特殊功能模块

### 14.1 FC 红白机模拟器（最有趣的功能）

游戏内置了一个**完整的 NES/FC 模拟器**，用于播放怀旧小游戏作为"社团资产"。

**技术实现**：**jsnes**（纯 JavaScript NES 模拟器）

**加载的模块**：

```
emulator/fc/emulator/
  ├─ index.html
  ├─ index.css
  ├─ lib/jquery-1.4.2.min.js       ← jQuery 1.4.2（很老）
  ├─ lib/dynamicaudio-min.js       ← 音频合成
  └─ source/
      ├─ nes.js                    ← 主控
      ├─ cpu.js                    ← 6502 CPU 模拟
      ├─ ppu.js                    ← 图像处理单元
      ├─ papu.js                   ← 音频处理单元
      ├─ mappers.js                ← 卡带映射器
      ├─ rom.js                    ← ROM 加载
      ├─ keyboard.js               ← 键盘输入
      ├─ ui.js                     ← 界面
      └─ jsnes-ie-hacks.vbscript   ← IE 兼容（VBScript）
```

**ROM 加载方式**：

```javascript
var nesRomURL = '../rom/' + getPageParamValue("gid") + '.nes';
nes.ui.loadROM(nesRomURL);
```

**页面标题**：`【混】游戏模拟器`

**游戏列表（从分享页可见）**：

| 游戏 | 说明 |
|---|---|
| **我愛棒球（日本）** | 日版棒球游戏 |
| **混沌世界（日版）** | 经典游戏 |

**功能定位**：
- 社团资产——「您的社团所拥有的游戏种类数量」
- 可被其他社团**抢夺**：「抢夺XXX社团的游戏」「战斗胜利后你将随机得到该社团名下的一款游戏」
- 非社团成员只能「短暂查看」（试用），想无限玩需创建社团

> **这是极其聪明的设计**：把"怀旧 FC 游戏"包装成**可争夺的社交资产**，既唤起 80/90 后的情怀，又把它变成 PvP 的战利品和氪金诱导（「想无限制畅玩？创建社团」）。

### 14.2 分享系统

| 分享页 | URL |
|---|---|
| 主分享页 | `statichun.nbn369.com/hun2web/share_nes/index.html` |
| 分享宣传语 | 「只能在日本玩的游戏」/「去日本混出个人样」 |

**分享奖励**：
> 「分享成功$NEW_LINE$快请好友点击XXX_NAME_XXX」
> 「'帮忙'页面链接已复制到剪贴板$NEW_LINE$可发送给好友帮忙助威」

——典型的**裂变拉新**设计。

### 14.3 小程序版本

`version.json` 中定义了小程序入口：

```json
"MINI_APP": {
  "fake_version": 2,
  "fake_url": "https://allopen.hun333.com/hun2/tour/index.html",
  "gameURL": "https://h2jp.hun333.com/static/html/hun_japan.html",
  "refresh_page_time": 1800000
}
```

**关键**：`fake_url` 指向 `tour/index.html`（旅游页）——**这是应对微信小程序审核的"马甲页"**。审核时展示旅游内容，过审后跳转真实游戏。

> ⚠️ **属于典型的"审核规避"手法**，违反各大平台开发者协议。

### 14.4 多语言系统

**支持语言**（从配置常量）：

| 常量 | 值 | 语言 |
|---|---|---|
| `LANGUAGE_ZH` | 0 | 简体中文 |
| `LANGUAGE_ZH_FAN` | 1 | 繁体中文 |
| `LANGUAGE_EN` | 2 | 英语 |
| `LANGUAGE_JA` | 3 | 日语 |

**缓存键**：`game_language`

**加载方式**：`getLanguageJS(LANGUAGE_CHOICE) + jsVersion` → 加载对应 `word_{lang}.js`

**参数传递**：URL 中传递 `app_lg`（language）、`lg_sc`（script）、`lg_cr`（country），实现**系统语言自动匹配**。

### 14.5 渠道系统

从 `version.json` 的 `MK_REVIEW_VERSION` 可见，游戏在 **15 个渠道**分发：

| 渠道代码 | 平台 |
|---|---|
| `amazon` | 亚马逊应用商店 |
| `hykb` | 好游快爆 |
| `4399` | 4399 |
| `gplay` | Google Play |
| `anzhi` | 安智 |
| `sh` | 应用汇 |
| `tap` | TapTap |
| `tx` | 腾讯 |
| `360` | 360 手机助手 |
| `al` | 阿里/豌豆荚 |
| `hw` | 华为 |
| `bd` | 百度 |
| `xm` | 小米 |
| `ka` | 快看 |

**每个渠道有独立的审核版本号**（如 `gplay: 6`），用于**分渠道送审**。

**当前包渠道**：`market_channel = "google_play"`，`mk=gplay`。

### 14.6 双地区内容（日本版 / 美国版）

代码内置两套内容，通过 `EXPENSION_PACK_VERSION` 切换：

| 维度 | 日本版 (jp) | 美国版 (usa) |
|---|---|---|
| 包名常量 | — | `com.hao.hun` |
| 起始剧情 | 解救女友、欠债还钱 | 非法移民、住豪宅开豪车 |
| 终局任务 | **炸毁宙斯盾** | **偷窃曲速飞船** |
| 特色小游戏 | 抡大锤 | **跑外卖、黑市拳、文化课代考** |
| 团建地点 | 东京歌舞伎町 | 拉斯维加斯不夜城 |
| 货币显示 | 魂币 | **比特币**（`LABEL_HUN_COIN_EPV_USA="比特币"`） |

**美国版开篇文案**：
> 「你是一名非法移民，你的目标是住豪宅、开豪车、步入上流社会。为此你不惜一切代价!」
> 「在你清偿掉债务并搞定那些非法勾当后，你即可踏入上流社会，当然前提条件是在此之前不被黑白两道干掉」

> **注**：当前 APK 为**日本版**（`epv=jp`）。

---

## 十五、版本迭代与运营体系

### 15.1 版本清单（`version.json`）

```json
{
  "FRONT_VERSION": "39396",       // 前端版本（JS 文件版本号）
  "DAILY_NEWS_VERSON": "1",       // 每日公告版本
  "IMG_VERSION": "219",           // 图片资源版本
  "FC_VERSION": 24,               // FC 模拟器版本
  "PK_NAME": "com.hao.hun2",      // 正式包名（第三方渠道 / 新版）
  "REVIEW_VERSION_IOS": 10        // iOS 审核版本
}
```

**关键发现**：`PK_NAME = "com.hao.hun2"`，而当前 APK 包名为 `com.hao.hun.japan`。

| 包名 | 版本 | 说明 |
|---|---|---|
| `com.hao.hun.japan` | 4.0 | **当前 APK**，Google Play 日本版 |
| `com.hao.hun2` | ? | version.json 中标记的"正式"包名 |
| `com.hao.hun` | 2.39 | 第三方「混二」版本（27.8 MB，非本包） |

> **`FRONT_VERSION = 39396`** 是一个非常大的数字，说明前端已经迭代了近 4 万次（或使用时间戳式版本号）。每次 `hun_min.js` 更新都会改变这个版本号，实现**强制刷新缓存**。

### 15.2 热更新机制

```
用户启动
  └─► 拉取 version.json（CDN 缓存 或 强制刷新）
        └─► 得到 FRONT_VERSION = 39396
              └─► 加载 hun_min.js?v=39396
                    └─► 若版本变化，浏览器/WebView 缓存失效，重新下载
```

**优势**：
- 修改服务端 JS → 全网实时生效，**无需发版**
- 可快速修复 Bug、上活动、调数值
- 绕过应用商店审核周期

**风险**：
- 服务端一旦被墙/宕机，**所有用户游戏立即不可用**
- 当前 `h2jp.hun333.com` 已返回 522，说明**主服务可能已不可用**

### 15.3 埋点系统

**接口**：`https://hun1.hun333.com/stat/add_point.do?point_type=`

**`point_type`** 说明这是一个**多类型埋点系统**，可能采集：
- 登录、启动、时长
- 关卡进入/完成/失败
- 付费转化漏斗
- 小游戏参与率
- 流失点

**其它风控/环境探测**：
- `https://ipapi.co/json/` —— IP 归属地（可能用于地域限制或风控）
- `cac=` 随机数 —— 缓存击穿（每次启动强制回源）

### 15.4 社交矩阵

| 平台 | 链接 |
|---|---|
| Discord | `https://discord.gg/5T6pQ3XgPG` |
| Facebook | `https://www.facebook.com/hun369/` |
| Facebook | `https://www.facebook.com/japanronin` |
| QQ 群 | 文案中多处引导「官方QQ群联系群主解决问题」 |
| 贴吧 | `q_tieba.html`（QQ 贴吧页） |
| iOS | `https://apps.apple.com/us/app/beast-out-text-gta/id925606960` |

**iOS 版名称**：**Beast Out - Text GTA**（`id925606960`）

> 这个英文名称非常直白地说明了游戏的类型定位——**文字版 GTA**。

---

## 十六、风险与合规评估

### 16.1 内容风险

| 风险项 | 具体表现 | 严重度 |
|---|---|---|
| **政治敏感** | 终局任务为"阻止日本部署路基宙斯盾"、"炸毁宙斯盾"、"轰炸东京" | 🔴 高 |
| **成人内容** | 艺伎/名媛系统、"解救"艺伎、歌舞伎町风俗店描写 | 🔴 高 |
| **犯罪教唆** | 详细教授入室、盗车、劫狱、撬锁、拆警报器等方法 | 🟠 中高 |
| **暴力** | 打斗、枪战、致人死亡文案（"挂了""死了"） | 🟠 中 |
| **赌博** | 娱乐城、竞速博彩（"竞速博车/博钱"） | 🟠 中 |
| **赌博式内购** | 赛车失败"无法回收魂币" | 🟠 中 |
| **审核规避** | 小程序 `fake_url` 马甲页 | 🟠 中 |

### 16.2 技术风险

| 风险项 | 说明 |
|---|---|
| **明文传输** | `usesCleartextTraffic=true` + HTTP 地址，存在 MITM 风险 |
| **用户标识泄露** | `openid` 通过 URL 明文传递 |
| **自建支付网关** | 支付经 `www.hun369.cn/h2pay/`，非直连官方渠道，**资金安全存疑** |
| **无障碍接口预留** | `openAccessibility()` 存在，若启用则权限极高 |
| **Root 检测** | 可能用于差异化处理或风控标记 |
| **依赖单一服务端** | 主域名已 522，游戏已不可用 |

### 16.3 合规建议（如涉及评估）

| 场景 | 建议 |
|---|---|
| **上架中国大陆应用商店** | ❌ 几乎不可能通过（政治敏感 + 成人内容 + 犯罪题材） |
| **上架 Google Play** | ⚠️ 已上架但存在下架风险（成人/暴力/赌博元素） |
| **企业内部分析** | ✅ 可作为"空壳 WebView 架构"研究样本 |
| **安全研究** | ✅ 建议隔离环境运行，注意明文流量与支付风险 |

---

## 十七、技术结论

### 17.1 架构亮点（值得学习）

1. **极致的"轻客户端"设计**
   - App 本体仅 10 MB，99% 是第三方库
   - 自研代码 < 1100 行，却支撑了一个完整游戏
   - 内容全云端，实现真正的"随时热更新"

2. **成熟的双向 JS 桥设计**
   - `jsbridge_android` 单一入口 + `&` 分隔协议
   - 覆盖支付、震动、内存、Root 检测、UI 控制
   - 静态字段共享状态（`lastHunCoin`、`out_trade_no`）

3. **精妙的文案工程**
   - 2423 条文案独立成库，与逻辑分离
   - 802 个随机文案池（`ARR_`），极大提升重复可玩性
   - 占位符 + 彩色标记的轻量模板引擎

4. **高度成熟的商业化设计**
   - 双货币 + 双轨支付
   - "氪金货币可通过 PvP 免费获得"的留存钩子
   - "购买装备会返还"的降低抵触设计
   - 每日限次的免费氪金货币（防刷 + 促活）

5. **社交资产化创新**
   - FC 模拟器游戏 = 可争夺的社团资产
   - 艺伎 = 可掳掠的社交资本
   - 地盘 = 可持续产出黑金的资产

### 17.2 技术缺陷

| 缺陷 | 说明 |
|---|---|
| **无任何离线能力** | 断网/服务端宕机 = 完全不可用 |
| **明文流量** | 安全合规硬伤 |
| **单点依赖** | 服务端一挂全挂（当前已 522） |
| **无原生库** | 无法使用高性能图形（也说明游戏本身运算量低） |
| **PairIP 加固** | 双刃剑——安全但增加维护成本 |
| **jQuery 1.4.2** | FC 模拟器用的 jQuery 是 2011 年的版本，存在已知漏洞 |

### 17.3 一句话总结

> 这是一款**技术上极度克制、内容上极度激进**的游戏：
> 用不到 1100 行原生代码 + 一个 WebView，承载了一个包含犯罪、赌博、成人、政治敏感元素的庞大文字策略游戏；
> 它的"本体"其实不是这个 APK，而是云端的 2.04 MB `hun_min.js` 和 2423 条文案；
> **APK 只是钥匙，游戏在云端。**

---

## 十八、附录

### 附录 A：APK 关键文件清单

| 文件 | 大小 | 说明 |
|---|---|---|
| `AndroidManifest.xml` | 9,044 B | 二进制清单 |
| `classes.dex` | 7,563,816 B | 唯一 dex |
| `resources.arsc` | 398,304 B | 资源表 |
| `res/mipmap-xxxhdpi-v4/ic_launcher.webp` | 4,362 B | 应用图标 |
| `res/xml/network_security_config.xml` | 264 B | 网络配置 |
| `res/xml/splits0.xml` | 8,404 B | Split 配置 |
| `res/raw/com_android_billingclient_heterodyne_info` | 46 B | Billing |
| `billing.properties` | 50 B | Billing 版本 |
| `stamp-cert-sha256` | 32 B | Source Stamp 证书哈希 |

### 附录 B：完整自研类源码行数

| 类 | 行数 |
|---|---|
| `com/haohun/japan/MainActivity.java` | 255 |
| `com/util/RootCheckPlus.java` | 217 |
| `com/hao/js/AndroidToJs.java` | 173 |
| `com/util/DeviceUtils.java` | 138 |
| `com/hao/hun/BillingManager.java` | 127 |
| `com/hao/js/JsToAndroid.java` | 111 |
| `com/util/RootCheck.java` | 50 |
| `com/hao/hun/japan/SafeWebView.java` | 22 |
| `com/hao/stuff/Haodaren.java` | 12 |
| **合计（不含自动生成）** | **≈ 1105 行** |

### 附录 C：后端接口速查表

```
【游戏 API】
GET  https://h2jp.hun333.com/h2/get_exparam_by_openid.do?openid=...
GET  https://h2jpen.hun333.com/h2/get_exparam_by_openid.do?openid=...

【埋点】
GET  https://hun1.hun333.com/stat/add_point.do?point_type=...

【支付】
POST https://www.hun369.cn/h2pay/pay.do
POST https://www.hun369.cn/h2pay/pay_qq.do
POST https://www.hun369.cn/h2pay/qq_user_comfirm.do
POST https://www.hun369.cn/h2pay/wx_user_comfirm.do

【环境探测】
GET  https://ipapi.co/json/

【CDN】
     https://hun2-cn.oss-cn-hangzhou.aliyuncs.com/static/
     https://hun2-en.oss-accelerate.aliyuncs.com/static/
     https://hun2cos-1300260944.file.myqcloud.com/static/

【入口】
     https://h2jp.nbn369.com/jump/jump.html
     https://h2jp.hun333.com/static/html/hun_japan.html
     http://hkh2jp.hun333.com/static/html/hun_japan.html
     http://route.hun333.com/static/hun_main/iframe_container.html
```

### 附录 D：调查工具与方法

| 环节 | 工具 |
|---|---|
| 解包 | `unzip` |
| Manifest 解析 | `pyaxmlparser`（AXMLPrinter） |
| Java 反编译 | `jadx 1.5.0`（CLI headless 模式） |
| 签名解析 | 自写 Python（struct 解析 APK Sig Block v2/v3） |
| 图标转换 | `Pillow`（WebP → PNG） |
| 字符串提取 | Python `re` 批量正则 |
| 线上资源 | `curl` + `cors.isteed.cc` 代理 |
| 哈希校验 | `md5sum` / `sha256sum` |

### 附录 E：调查产出文件

| 文件 | 路径 | 说明 |
|---|---|---|
| APK 原件 | `/workspace/hun.apk` | 原始安装包 |
| 本文档 | `/workspace/调查报告/混在日本_HunJapan_APK深度调查文档.md` | 本调查文档 |
| 下载脚本 | `/workspace/download_hun2.py` | 一键下载脚本 |
| 断点续传脚本 | `/workspace/fetch_hun2.py` | 分块下载 |
| 健壮下载器 | `/workspace/fetch_apk_robust.py` | 严格状态码校验 |

---

**调查报告完**

> 本文档基于静态分析完成，未对目标进行任何入侵性测试。所有线上资源获取均通过公开 CDN 进行。
> 文档中的域名、接口、文案等信息仅用于技术研究与安全评估，请勿用于任何违法用途。
