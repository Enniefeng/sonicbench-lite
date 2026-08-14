# SonicBench Lite 最近两项修复说明

更新时间：2026-08-15

本文说明最近完成的两项前端修复，以及它们在代码层面解决的问题。

## 1. 支持 Markdown 包装的音频 URL

### 原问题

实际工单中的音频地址可能不是纯 URL，而是以下 Markdown 链接格式：

```text
[https://example.com/audio.wav](https://example.com/audio.wav)
```

旧版会把整个 Markdown 字符串当成 URL。它无法通过 `new URL(...)` 校验，也不能作为浏览器 `<audio src>` 的真实媒体地址，因此工单可能被拒绝，或者音频无法播放。

### 代码修复

在 `utils.js` 中新增统一的 `normalizeHttpUrl()`：

- 纯 `http://`、`https://` URL 保持不变。
- Markdown 链接自动提取圆括号中的真实 HTTP(S) URL。
- URL 合法性校验和域名展示统一使用规范化后的地址。

在 `admin-tool.js` 中，将管理员导入的每个模型 URL 先规范化，再执行：

- HTTP(S) 合法性校验；
- 同一 Case 重复 URL 检测；
- URL 风险提示；
- 候选随机化；
- Mapping 与脱敏工单导出。

因此，Mapping、脱敏工单和后续结果 JSON 中保存的都是纯 URL，不再携带 Markdown 包装。

在 `review-tool.js` 中，评测工单和质检结果恢复都会先规范化所有候选 URL。规范化发生在工单指纹计算之前，避免以下情况：

- 初次标注使用 Markdown URL；
- 结果 JSON 保存的是纯 URL；
- 质检回填时因为两种文本形式不同而出现工单指纹不一致。

### 兼容结果

以下两种输入现在都受支持：

```text
https://example.com/audio.wav
```

```text
[https://example.com/audio.wav](https://example.com/audio.wav)
```

相关提交：`51e605a Support Markdown-wrapped audio URLs`

## 2. 播放前显示音频总时长

### 原问题

播放器原来使用：

```html
preload="none"
```

该配置会阻止浏览器在用户点击播放前请求音频元数据，因此播放器初始通常显示 `0:00 / 0:00`，第一次点击后才出现真实时长。

### 代码修复

在 `review-tool.js` 中将播放器改为：

```html
preload="metadata"
```

浏览器现在会在播放器渲染后请求媒体元数据，从而提前获得：

- 音频总时长；
- 媒体格式等播放所需的基础信息。

该配置不会预下载完整音频文件，只会获取解析时长所需的数据，适合包含多个候选音频的评测页面。

如果某个地址仍然显示 `0:00`，一般不是前端配置问题，而可能是资源服务端存在以下情况：

- 不支持媒体 Range 请求；
- 签名已经过期；
- 返回 302 登录页、403 或非音频响应；
- 当前浏览器没有访问该内部资源的权限。

相关提交：`7bc062f Preload audio duration metadata`

## 验证范围

两项修复均已覆盖 2–6 模型动态评测流程，并通过以下回归测试：

```bash
node test-dynamic-models.js
node test-aggregation.js
```

测试覆盖：

- 管理员导入 Markdown URL 后输出纯 URL；
- Mapping 中不保留 Markdown 包装；
- 评测工单直接包含 Markdown URL 时能够正常解析；
- 质检自包含 JSON 能够正常恢复且指纹一致；
- 音频播放器输出 `preload="metadata"`；
- MOS、ELO 与 Mapping 汇总逻辑不受影响。

## GitHub 状态

上述两项修改已通过 [PR #1](https://github.com/Enniefeng/sonicbench-lite/pull/1) squash 合并到公开仓库 `main`。

