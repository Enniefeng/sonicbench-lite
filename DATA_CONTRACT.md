# SonicBench 2–6 模型动态数据合同

## 1. 数量与任务公式

模型数 `n` 必须为 2–6。每个 Case 派生：

- MOS：`n` 项。
- ELO：完整两两组合 `C(n,2) = n × (n-1) / 2` 项。
- 总子任务：`n + C(n,2) = n × (n+1) / 2`。

| n | 原始列 | 工单列 | MOS | ELO | 总任务 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 5 | 12 | 2 | 1 | 3 |
| 3 | 6 | 14 | 3 | 3 | 6 |
| 4 | 7 | 16 | 4 | 6 | 10 |
| 5 | 8 | 18 | 5 | 10 | 15 |
| 6 | 9 | 20 | 6 | 15 | 21 |

## 2. 管理员原始输入

物理结构为 `case_id, tag, lyrics, model_1_url ... model_n_url`。同一批次所有 Case 的模型数必须一致；URL 列必须从 1 开始连续填写，不允许中间留空。若使用 9 列最大模板，未使用的右侧 URL 列可留空，系统按所有数据行中最后一个非空 URL 列推断 `n`。

校验规则：Case ID 批次内唯一；每个 URL 为非空 HTTP(S)；同一 Case 内 URL 唯一；含逗号、引号或换行的单元格必须由 CSV 正确引用。

## 3. 动态脱敏工单

新工单 Schema：`sonicbench-work-order/flexible-model/1.0`。

列顺序：

1. `schema_version`
2. `batch_id`
3. `task_bundle_id`
4. `case_id`
5. `tag`
6. `lyrics`
7. 从 `candidate_1_blind_id, candidate_1_url` 开始重复 n 组
8. `elo_order_key`
9. `annotation_result_json`

标准总列数为 `8 + 2n`。初始导出时结果末列为空。管理员对每个 Case 独立安全洗牌；Blind ID 在批次内唯一；Mapping 单独导出且不得进入评测工单。

评测端不再用粘贴行的物理总列数推断 `n`，而是读取评测员明确选择且缓存在本地的模型数量。解析时，`schema_version` 到 `elo_order_key` 是必要标准前缀；初始为空的 `annotation_result_json` 可以省略。标准结果列右侧允许附加评审员、工单分配、备注等任意业务列：这些列不参与工单校验、候选识别或指纹计算，并在复制／下载回填行时按原值保留。若所选 `n` 后仍出现一组 Blind ID + HTTP(S) URL，必须提示模型数量不匹配，禁止静默把候选当作附加列丢弃。

原始模型 URL 与脱敏工单 URL 均接受纯 HTTP(S) 地址，或 Markdown 链接格式 `[显示文本](https://...)`。解析器必须先将 Markdown 链接规范化为括号内的纯 URL，再执行合法性校验、重复检测、脱敏导出、指纹计算与音频播放。规范化后的 Mapping、工单及结果 JSON 不保留 Markdown 包装。

`elo_order_key` 是无语义随机 Token。评测端用 Key 和当前 n 个 Blind ID 稳定派生所有两两组合的出现顺序及 A/B 左右位；同一工单重载不得重新洗牌。ELO 页面不展示 Blind ID。

## 4. 结果 JSON

新结果 Schema：`sonicbench-annotation-result/flexible-model/1.0`。顶层必须包含：

- `model_count`：2–6，且等于 `work_order.candidates.length`。
- `work_order_fingerprint`：仅由标准前缀（`schema_version` 到 `elo_order_key`）计算；结果列和右侧业务附加列均不参与。
- `batch_id`、`task_bundle_id`、`case_id`。
- `work_order`：脱敏上下文、n 个匿名候选与 `elo_order_key`。
- `mos`：恰好 n 项，与候选槽位对齐。
- `elo_matches`：恰好 C(n,2) 项，与 Key 派生顺序、左右位完全一致。
- `completed_subtask_count` 与 `total_subtask_count`：均为 n(n+1)/2。
- `started_at`、`completed_at`、`updated_at`、`result_revision`。
- `revision_remark`：当前版本的简短修改摘要。
- `revision_history`：按 Revision 递增的版本记录。每个条目包含 `revision`、`updated_at`、`remark` 和本轮增量 `changes`；每条 Change 记录子任务、字段路径、维度及修改前后值。

结果回填只写入标准 `annotation_result_json` 槽位，不得改变前置匿名工单字段；原输入右侧业务附加列原样跟随。质检未修改结果时应保持原结果字节稳定；修改时保留原 `completed_at`，更新 `updated_at`，增加 Revision，并向 `revision_history` 追加一条增量记录，不覆盖旧版本。历史结果没有 `revision_history` 时仍可载入；首次修订会为旧版本补一条“此前未记录字段级明细”的兼容记录。

管理员参考答案对比页接受两份自包含结果 JSON。两份结果的 `batch_id`、`task_bundle_id`、`case_id`、`work_order_fingerprint`、Blind ID 集合以及 ELO 对战左右候选必须一致。管理员发生修订时沿用上述 Revision 规则，并可增加可选的 `admin_quality_review` 对象，记录参考答案 Revision、MOS 容差、修订前后超差数量和 ELO 差异数量。问题／扣分项必须直接复用评测端的 `LOW_SCORE_OPTIONS` 与 `INSTRUCTION_DEDUCTION_OPTIONS`，不得维护第二套自由文本标签。管理员还可生成不含真实模型 Mapping 的 PNG 对比长图；该图片是验收辅助材料，不替代可计算的 JSON 结果。

## 5. 兼容策略

- 接受旧 `sonicbench-work-order/{n}-model/1.0`（n=2–6）工单。
- 接受现行六模型 `sonicbench-annotation-result/6-model/2.0` 历史结果。早期 4/5 模型结果维度不同，必须重新标注或由单独迁移脚本处理，不做有损自动转换。
- 新导出一律使用 flexible Schema。
- 标准前缀字段不足、所选模型数与候选数不一致、`model_count` 或历史结果数量不一致时必须拒绝载入；仅在标准字段右侧增加业务附加列不得导致拒绝。

## 6. 管理员还原与聚合报告

回算页接受同批次 Mapping JSON 与一个或多个完整结果。每个候选使用复合键 `batch_id + case_id + blind_id` 还原，禁止只凭候选位置或 URL 猜测来源。重复 `task_bundle_id`、未完成结果、批次不一致、Blind ID 缺失或模型数不一致均拒绝计算。

输出 Schema：`sonicbench-aggregate-report/1.0`，包含：

- 批次、模型数、Case 数、有效结果数与生成时间。
- `mos_summary`：按 `source_model_key` 聚合的全部 MOS 维度均分。
- `elo_summary`：音乐性、音质与声学、Vocals、总体四维最终 ELO。
- `restored_mos_records`：逐 Case、逐真实模型的 MOS 明细与源 URL。
- `restored_elo_records`：逐场、逐维度的真实模型对战、赛前／赛后 Rating 与结果。
- `elo_config`：初始分、K、平局分值与更新顺序。

MVP 固定 ELO 初始分 1500、K=32、平局计 0.5，并按输入结果顺序及结果内 `elo_matches` 顺序逐项更新。ELO 结果具有顺序依赖性；正式使用应冻结输入排序和算法配置版本。聚合报告已恢复真实模型与源 URL，仅限管理员受控保存。
