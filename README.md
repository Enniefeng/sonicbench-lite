# SonicBench Lite｜2–6 模型动态评测任务卡

这是一个无需后端、无需安装依赖的纯前端 MVP，用来跑通“2–6 个模型结果脱敏 → 标注员逐 Case 评分 → 质检验收 → Mapping 还原 → MOS/ELO 计算”的闭环。

## 三个入口

- `admin.html`：管理员导入 5–9 列原始 CSV（Case、Tag、Lyrics + 2–6 个 URL）。系统自动识别模型数、逐 Case 随机候选位置，并导出动态列工单与管理员 Mapping。
- `index.html`：标注／质检任务台。标注模式粘贴单行动态工单；质检模式可直接粘贴新版自包含结果 JSON。
- `aggregation.html`：管理员导入 Mapping JSON 与回收结果，按真实模型来源计算 MOS 均分和四维 ELO，并导出管理员敏感结果包。

| 模型数 n | 原始 CSV 列数 | 脱敏工单列数 | MOS | ELO C(n,2) | 总子任务 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 5 | 12 | 2 | 1 | 3 |
| 3 | 6 | 14 | 3 | 3 | 6 |
| 4 | 7 | 16 | 4 | 6 | 10 |
| 5 | 8 | 18 | 5 | 10 | 15 |
| 6 | 9 | 20 | 6 | 15 | 21 |

## 快速体验

1. 打开 `admin.html`，选择 2–6 个模型并加载样例，或上传 CSV。
2. 生成并下载脱敏工单 CSV 与 Mapping JSON。
3. 复制一条脱敏任务行，打开 `index.html` 并粘贴。
4. 完成 n 个 MOS 卡片，再完成 C(n,2) 个 ELO 对战。
5. 在结果页复制 JSON、完整工单行或下载结果 CSV。
6. 质检人员粘贴自包含 JSON 或带结果的完整工单，即可恢复历史评分与时间。
7. 管理员在 `aggregation.html` 同时导入原 Mapping 与回收结果，完成来源还原和指标计算。

管理员 Excel 模板为 [`SonicBench-flexible-2-6-model-admin-import-template.xlsx`](templates/SonicBench-flexible-2-6-model-admin-import-template.xlsx)，其中包含 2/3/4/5/6 模型的 10 条示例 Sheet、空白模板和 CSV 导出说明。旧六模型模板和测试工单继续保留用于兼容回归。

## 兼容性

- 新生成工单使用 `sonicbench-work-order/flexible-model/1.0`。
- 新结果使用 `sonicbench-annotation-result/flexible-model/1.0`，并显式保存 `model_count`。
- 已有 4/5/6 模型空工单仍可载入；现行六模型 2.0 历史结果也可继续质检。早期 4/5 模型结果维度不同，不做有损自动转换。
- 同一 Case 的 ELO 顺序和 A/B 左右位仍由无语义 `elo_order_key` 稳定派生；ELO 页面不显示 Blind ID。

详细字段约束见 [`DATA_CONTRACT.md`](DATA_CONTRACT.md)，分角色交付说明见 [`DELIVERY_AND_USER_GUIDE.md`](DELIVERY_AND_USER_GUIDE.md)。

## 本地运行

三个入口都是静态页面，可直接打开；若浏览器限制本地资源，可在目录中运行 `python3 -m http.server 8765`，再访问：

- `http://127.0.0.1:8765/admin.html`
- `http://127.0.0.1:8765/index.html`
- `http://127.0.0.1:8765/aggregation.html`

仓库只包含虚构示例，不包含完整平台 PRD、组织权限设计或真实业务数据。提交前请阅读 [`SECURITY.md`](SECURITY.md) 和 [`PUBLIC_RELEASE_CHECKLIST.md`](PUBLIC_RELEASE_CHECKLIST.md)。

## License

当前未附开放源代码许可证，默认保留全部权利。若要允许外部复用、修改或分发，请由代码权利人审批并添加合适的 `LICENSE`。

## MVP 边界

- Mapping 只存在管理员端内存，生成后应立即下载并限制访问。
- URL 域名、路径、查询参数、音频 metadata 或封面仍可能泄漏来源；正式评测应使用无语义代理 URL。
- 草稿保存在当前浏览器 localStorage；CSV/Excel 工单仍是最终事实来源。
- 回算页默认 ELO 参数为初始分 1500、K=32、平局 0.5，按“结果导入顺序 → 子任务顺序”更新；参数与顺序会写入导出报告。正式使用前应由评测负责人冻结版本。
- 回算报告包含真实模型来源与源 URL，属于管理员敏感文件，不得发送给评测员或提交到公开仓库。
