# SonicBench Lite 2–6 模型版｜交付与使用手册

版本：纯前端动态多模型 MVP
适用角色：评测管理员、评测员、质检员

## 一、交付内容

| 文件 | 使用人 | 用途 |
| --- | --- | --- |
| `admin.html` | 评测管理员 | 原始结果导入、校验、随机脱敏、工单与 Mapping 导出 |
| `index.html` | 评测员／质检员 | MOS、ELO 标注，历史结果恢复、修订与导出 |
| `aggregation.html` | 评测管理员 | 回收结果、Mapping 还原、MOS/ELO 计算与敏感报告导出 |
| `templates/SonicBench-flexible-2-6-model-admin-import-template.xlsx` | 管理员 | 2/3/4/5/6 模型原始数据模板与各 10 条示例 |
| `templates/SonicBench-6-model-admin-import-example-10-cases.csv` | 管理员 | 旧六模型 CSV 回归样例 |
| `templates/SonicBench-6-model-reviewer-qc-test-workbook.xlsx` | 评测／质检 | 旧六模型评测、历史行和 JSON 兼容测试 |
| `DATA_CONTRACT.md` | 技术／数据同学 | 动态列数、Schema、结果与兼容规则 |

页面全部在浏览器本地运行，无需安装、无需后端。建议使用最新版 Chrome 或 Edge。

## 二、动态数量规则

| 模型数 | 原始 CSV | 脱敏工单 | MOS | ELO | 总子任务 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 5 列 | 12 列 | 2 | 1 | 3 |
| 3 | 6 列 | 14 列 | 3 | 3 | 6 |
| 4 | 7 列 | 16 列 | 4 | 6 | 10 |
| 5 | 8 列 | 18 列 | 5 | 10 | 15 |
| 6 | 9 列 | 20 列 | 6 | 15 | 21 |

同一批次必须保持相同模型数。ELO 覆盖所有两两组合，场次数为 C(n,2)。

## 三、评测管理员使用手册

### 3.1 准备原始 Excel／CSV

1. 打开 `templates/SonicBench-flexible-2-6-model-admin-import-template.xlsx`。
2. 先看“使用说明”，再根据本批次模型数选择“2模型示例”至“6模型示例”，或复制“空白模板”。
3. 前三列固定为 `case_id`、`tag`、`lyrics`；从 `model_1_url` 开始连续填写 2–6 个 URL。
4. 未使用的右侧 URL 列留空即可；不可出现 model_1、model_2 有值、model_3 空、model_4 又有值的断列。
5. 将目标 Sheet 另存为“CSV UTF-8（逗号分隔）”。系统不要求使用 TSV。

注意：Case ID 批次内唯一；URL 必须为 HTTP(S)；同一 Case 的 URL 不得重复；每一模型列在整批中必须始终指向同一真实模型。

URL 可以直接填写 `https://...`，也可以填写 `[https://...](https://...)`。后一种常见于从 Markdown、IM 或文档中复制链接；工具会自动提取括号内的真实地址，导出的工单与 Mapping 将统一使用纯 URL。

### 3.2 生成脱敏工单

1. 打开 `admin.html`。
2. 上传 CSV，或选择 2–6 模型后点击“加载样例”。
3. 确认预览显示正确的模型数量。系统会按所有数据行的最后一个非空 URL 列自动推断数量。
4. 点击“校验并生成脱敏工单”。
5. 下载两个文件：
   - 工单 CSV：发给评测员；列数随模型数动态变化。
   - Mapping JSON：仅管理员保存，不得发给评测员或质检员。

每个 Case 都会独立打乱候选，Blind ID 在批次内唯一。`elo_order_key` 以无语义 Token 记录稳定顺序，不在 ELO 页面展示。

### 3.3 回收结果

评测员可以交回自包含结果 JSON、完整动态工单行或单 Case 结果 CSV。管理员以 `batch_id + task_bundle_id + case_id` 对齐；完整行只能替换最后的 `annotation_result_json`，不得改动前置工单列。

### 3.4 Mapping 还原与指标计算

1. 打开 `aggregation.html`。
2. 左侧导入生成工单时下载的同批次 Mapping JSON。
3. 右侧导入一个或多个结果：支持单个结果 JSON、JSON 数组、JSONL，或含 `annotation_result_json` 末列的 CSV。
4. 点击“还原并计算结果”。页面会校验批次、任务唯一性、完成状态、候选数量，并按 `batch_id + case_id + blind_id` 还原真实模型来源。
5. 查看并导出：
   - MOS CSV：每个真实模型的 15 个维度均分与 Case 数。
   - ELO CSV：音乐性、音质与声学、Vocals、总体四个维度的最终分。
   - 完整 JSON：真实模型、源 URL、逐 Case MOS 明细与每一步 ELO 更新轨迹。

默认 ELO 配置为初始分 1500、K=32、平局 0.5，按“输入结果顺序 → 结果内 ELO 子任务顺序”更新。ELO 具有顺序依赖性，因此正式批次应固定输入顺序和配置版本；完整报告会记录本次参数。完整 JSON 属于管理员敏感文件，不得下发或提交到代码仓库。

## 四、评测员使用手册

1. 打开 `index.html`，保持“标注模式”。
2. 在 CSV/Excel 中选中一条完整工单行，从 `schema_version` 一直复制到末列；粘贴后点击进入标注。
3. 页面会自动识别模型数并展示总进度。
4. 先完成每个候选的 MOS：
   - 子维度评分 ≤3：必须多选低分问题；选“其他”需备注。
   - 音乐性、音质与声学、Vocals 整体分 ≤3：必须备注。
   - 总评整体分：所有分数均须备注。
   - 指令遵循低于 5：必须多选扣分项并备注原因。
5. 全部 MOS 完成后，进入 ELO。每场对音乐性、音质与声学、Vocals、总体选择 A胜／平局／B胜；每场共用一条选填备注。
6. 完成后可复制结果 JSON、复制完整工单行或下载结果 CSV。
7. 点击“导入新 Case”继续下一条。

ELO 页面不显示 Blind ID，只显示当前对战临时 A/B，避免直接沿用 MOS 的候选记忆。

## 五、质检员使用手册

### 方式 A：自包含 JSON

1. 打开 `index.html`，切换“质检验收模式”。
2. 粘贴完整结果 JSON。
3. 页面自动恢复模型数、匿名音频、评分、ELO、开始／完成／最近更新时间和 Revision。

### 方式 B：带结果工单

在标注模式粘贴末列已有结果的完整动态工单行，页面也会自动进入历史检查状态。

质检时右下角“下一项”逐卡审核，“导出结果”随时导出完整结果。修改后 Revision 增加，原 `completed_at` 保留，`updated_at` 更新；未修改时结果保持原样。完成后可返回主页导入下一条 Case。

## 六、交付测试

### 6.1 管理员 2–6 模型测试

对 Excel 模板中的“2模型示例”到“6模型示例”分别执行：另存 CSV UTF-8 → 上传管理员页 → 生成工单。预期：

- 识别 10 个 Case，模型数与 Sheet 名一致。
- 工单列数分别为 12/14/16/18/20。
- 每 Case 子任务分别为 3/6/10/15/21。
- Mapping 条数为 `10 × 模型数`。

### 6.2 评测员与质检员测试

每个模型数可在管理员页面生成工单后复制首条任务行到 `index.html`：

- 页面候选数、MOS、ELO、总进度与上表一致。
- MOS 完成前 ELO 锁定。
- ELO 只显示 A/B，不显示 Blind ID。
- 结果 JSON 中 `model_count`、`mos.length`、`elo_matches.length` 正确。
- 将结果 JSON 粘到质检模式可完整恢复。

使用旧 `SonicBench-6-model-reviewer-qc-test-workbook.xlsx` 再测试一条六模型历史工单和一条历史 JSON，确认现行六模型 2.0 结果向后兼容。早期 4/5 模型结果维度不同，不做有损自动转换。

### 6.3 管理员结果回算测试

用管理员页面生成一批工单并保存 Mapping，再完成至少一条评测或加载完整历史示例：

- 在 `aggregation.html` 中导入同批 Mapping 与结果，预期能看到真实模型级 MOS 与 ELO。
- 换成另一批 Mapping，预期被“批次不一致”拦截。
- 重复导入同一 `task_bundle_id`，预期被重复任务校验拦截。
- MOS CSV 不包含 Blind ID；完整 JSON 包含还原明细并明确标记为管理员敏感结果。

## 七、常见问题

| 提示 | 常见原因 | 处理方式 |
| --- | --- | --- |
| 无法识别模型数 | 少于 2 个 URL、超过 6 个或存在断列 | 从 model_1 开始连续填写，尾部未使用列留空 |
| 某模型 URL 为空 | 同批次各行模型数不一致 | 补齐缺失结果，或拆成不同批次 |
| 工单列数无效 | 复制时漏掉中间列或末列 | 重新复制完整一行；合法列数为 12/14/16/18/20 |
| 结果指纹不一致 | JSON/末列结果来自另一个 Case | 按 Case ID 找回正确结果 |
| 音频无法播放 | 示例 URL、鉴权、跨域或链接过期 | 替换为浏览器可访问的有效音频 URL |
| 找不到 Mapping | 页面刷新前未下载 | 重新从原始 CSV 生成；Mapping 不写入浏览器存储 |
