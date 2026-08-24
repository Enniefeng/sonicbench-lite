(function () {
  const MOS_GROUPS = [
    {
      key: "musicality", label: "音乐性表现", tone: "amber",
      subdimensions: [
        { key: "melody", label: "旋律", hint: "旋律走向、动机与可记忆性" },
        { key: "harmony", label: "和声", hint: "和声进行、色彩与稳定性" },
        { key: "structure", label: "结构", hint: "段落组织、发展与完整度" },
        { key: "rhythm", label: "节奏", hint: "律动、速度与节拍稳定性" },
        { key: "lyrics_melody_relation", label: "词曲关系", hint: "歌词重音、韵律与旋律匹配" },
        { key: "arrangement", label: "编曲", hint: "配器层次、动态与整体推进" }
      ],
      overall: { key: "musicality_overall", label: "音乐性表现整体分", hint: "综合音乐性表现" }
    },
    {
      key: "acoustics", label: "音质与声学表现", tone: "green",
      subdimensions: [
        { key: "audio_quality", label: "音质", hint: "清晰度、噪声、失真与频响" },
        { key: "instrument_realism", label: "乐器音色真实度", hint: "音色自然度与乐器质感" },
        { key: "mix_master", label: "混音与母带完成度", hint: "平衡、空间、响度与完成度" },
        { key: "technical_consistency", label: "单曲内部一致性与技术瑕疵", hint: "音色漂移、断裂、爆音等问题" }
      ],
      overall: { key: "acoustics_overall", label: "音质与声学表现整体分", hint: "综合音质与声学表现" }
    },
    {
      key: "vocals", label: "Vocals", tone: "cyan",
      subdimensions: [
        { key: "vocal_quality", label: "人声质量", hint: "人声自然度、清晰度与稳定性" },
        { key: "singing_performance", label: "演唱表现", hint: "音准、节奏、咬字与技巧" },
        { key: "emotional_expression", label: "情感表达", hint: "情绪投入与歌曲氛围匹配" }
      ],
      overall: { key: "vocals_overall", label: "Vocals整体分", hint: "综合人声表现" }
    }
  ];

  const INSTRUCTION_DIMENSION = { key: "instruction_following", label: "指令遵循", hint: "对 Tag、歌词、语言和生成要求的遵循程度" };
  const TOTAL_DIMENSION = { key: "overall", label: "总评整体分", hint: "综合所有维度后的最终质量判断" };
  const MOS_DIMENSIONS = MOS_GROUPS.flatMap((group) => group.subdimensions.concat(group.overall)).concat(INSTRUCTION_DIMENSION, TOTAL_DIMENSION);
  const ELO_DIMENSIONS = [
    { key: "musicality", label: "音乐性" },
    { key: "acoustics", label: "音质与声学" },
    { key: "vocals", label: "Vocals" },
    { key: "overall", label: "总体" }
  ];
  const LOW_SCORE_OPTIONS = {
    melody: ["主旋律难以分辨", "音高组织混乱", "乐句不完整", "无效重复/素材堆砌", "旋律听感生硬/不顺/杂乱", "其他"],
    harmony: ["调性/和弦关系混乱", "与旋律冲突或配合度差", "和声连接生硬", "风格语汇不地道", "色彩变化不足", "局部出现错和弦", "其他"],
    structure: ["结构残缺", "段落边界模糊", "起承转合弱", "段落对比不足", "段落转折过渡生硬", "推进牵强或重复", "结尾仓促/中断", "其他"],
    rhythm: ["节拍错乱/拍子不稳", "律动僵硬", "重音失衡", "切分/变化处理生硬", "缺少变化", "风格匹配度弱", "其他"],
    lyrics_melody_relation: ["歌词与旋律/节奏错位", "歌词韵律与旋律起伏不匹配", "其他"],
    arrangement: ["主次失衡", "与旋律/结构冲突", "配器不合理", "层次不足或杂乱", "动态推进失衡/平铺", "音色/技法缺少一致性", "其他"],
    audio_quality: ["整体偏糊，清晰度难辨", "低频整体表现异常，如发闷、松散、轰头或缺乏支撑感", "中频区域存在明显异常，如拥堵、顶耳或大量信息挤在中间", "高频整体不自然，如过亮、毛刺明显或高频细节发假", "技术异常，能听到底噪、爆音、卡顿、点击、破损、截断等明显技术问题", "短时间试听即可感到刺耳、压迫或不适，难以持续聆听", "空间异常，如相位不稳、假立体声", "动态异常，如过压、控制失稳", "其他"],
    instrument_realism: ["乐器难辨认", "材质感不对", "发声不合理", "谐波异常", "音高不稳定", "机械纹理重", "音色不一致", "其他"],
    mix_master: ["主次关系混乱", "整体浑浊或声部打架/杂糅", "频段不平衡", "空间扁平/纵深不足", "响度处理不当", "动态压扁或忽大忽小", "分离度/层次不足", "其他"],
    technical_consistency: ["爆音/破音", "卡顿/断裂", "异常拖尾", "结尾截断", "音色断崖变化", "前后段落响度差异过大波动明显", "空间/质感前后差异过大", "机器生成痕迹明显/像拼接样本", "其他"],
    vocal_quality: ["音色刺耳/失真明显", "机械感/合成痕迹重", "自然度不足", "质感偏薄偏硬", "与伴奏割裂/融合差", "人声被伴奏遮蔽或比例失衡", "颗粒/尾音/细节质量差", "其他"],
    singing_performance: ["音准不稳/跑调", "节奏不稳/落点不准", "气息不足/支撑差", "咬字吐字不清/发音不顺", "断句或重音处理不当", "语流不自然/唱感拧巴", "技巧失控或处理生硬", "稳定性不足/句间波动大", "其他"],
    emotional_expression: ["情绪方向错误/与词曲不符", "情感空洞/无感染力", "起伏层次不足", "关键句或副歌推进不成立", "情绪转折生硬", "表达过度或失真", "高潮拉不开/整体偏平", "其他"]
  };
  const INSTRUCTION_DEDUCTION_OPTIONS = ["曲风未遵循", "速度/节奏未遵循", "段落结构未遵循", "人声未遵循", "歌词演唱未遵循", "配器未遵循", "心情/情绪未遵循", "主题未遵循", "场景未遵循", "其他"];
  function normalizeInstructionDeductions(values) {
    const aliases = { "心情未遵循": "心情/情绪未遵循" };
    return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => aliases[value] || value)));
  }
  const MIN_MODEL_COUNT = 2;
  const MAX_MODEL_COUNT = 6;
  const WORK_ORDER_SCHEMA = "sonicbench-work-order/flexible-model/1.0";
  const REVIEW_SCHEMA = "sonicbench-annotation-result/flexible-model/1.0";
  const MAPPING_SCHEMA = "sonicbench-mapping/flexible-model/1.0";
  const RESULT_CELL_CHAR_LIMIT = 50000;

  function finalSnapshotResult(annotation) {
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
      throw new Error("只能从完整评测结果生成最终态快照");
    }
    const snapshot = JSON.parse(JSON.stringify(annotation));
    delete snapshot.revision_history;
    delete snapshot.revision_remark;
    return snapshot;
  }

  function isSupportedModelCount(value) {
    return Number.isInteger(value) && value >= MIN_MODEL_COUNT && value <= MAX_MODEL_COUNT;
  }

  function eloMatchCount(modelCount) {
    return isSupportedModelCount(modelCount) ? modelCount * (modelCount - 1) / 2 : 0;
  }

  function workOrderColumnCount(modelCount) {
    return isSupportedModelCount(modelCount) ? 8 + modelCount * 2 : 0;
  }

  function workOrderHeaders(modelCount) {
    if (!isSupportedModelCount(modelCount)) return [];
    const headers = ["schema_version", "batch_id", "task_bundle_id", "case_id", "tag", "lyrics"];
    for (let index = 1; index <= modelCount; index += 1) {
      headers.push(`candidate_${index}_blind_id`, `candidate_${index}_url`);
    }
    headers.push("elo_order_key", "annotation_result_json");
    return headers;
  }

  function rawInputHeaders(modelCount) {
    if (!isSupportedModelCount(modelCount)) return [];
    return ["case_id", "tag", "lyrics"].concat(
      Array.from({ length: modelCount }, (_, index) => `model_${index + 1}_url`)
    );
  }

  function inferModelCountFromWorkOrderColumnCount(columnCount) {
    const modelCount = (Number(columnCount) - 8) / 2;
    return isSupportedModelCount(modelCount) ? modelCount : 0;
  }

  function canonicalEloSlotPairs(modelCount) {
    if (!isSupportedModelCount(modelCount)) return [];
    const pairs = [];
    for (let left = 1; left <= modelCount; left += 1) {
      for (let right = left + 1; right <= modelCount; right += 1) pairs.push([left, right]);
    }
    return pairs;
  }

  function isCompatibleWorkOrderSchema(schema, modelCount) {
    return schema === WORK_ORDER_SCHEMA
      || schema === `sonicbench-work-order/${modelCount}-model/1.0`
      || (modelCount === 4 && schema === "sonicbench-work-order/1.0");
  }

  function isCompatibleReviewSchema(schema, modelCount) {
    if (schema === REVIEW_SCHEMA) return true;
    return modelCount === 6 && schema === "sonicbench-annotation-result/6-model/2.0";
  }

  const REVIEW_SAMPLE_ROW = [
    WORK_ORDER_SCHEMA,
    "BATCH-DEMO-01",
    "TASK-DEMO-0007",
    "CASE-0007",
    "温暖 R&B，男声，92 BPM，雨夜氛围",
    "[主歌]\n夜色落在玻璃窗，雨声把街灯慢慢拉长\n我把未寄出的信，藏进外套最深的地方\n风经过空荡站台，吹散那句没说完的原谅\n\n[副歌]\n如果明天还会下雨，请替我留一盏微光\n等城市安静以后，我会循着回忆的方向\n穿过人海和漫长夜晚，再一次走到你身旁",
    "R-7KQ2-MX9H-P4VC",
    "https://example.com/audio/case-0007-x1.mp3",
    "R-B9T4-NP6D-K8WR",
    "https://example.com/audio/case-0007-x2.mp3",
    "R-P3V8-LC2F-Q7HM",
    "https://example.com/audio/case-0007-x3.mp3",
    "R-H6R1-WF5K-T2XN",
    "https://example.com/audio/case-0007-x4.mp3",
    "R-D4N7-ZQ8P-V5LM",
    "https://example.com/audio/case-0007-x5.mp3",
    "R-X8C5-J2QL-N7TG",
    "https://example.com/audio/case-0007-x6.mp3",
    "K-7H3M-Q8VK-W2FD-9R6C",
    ""
  ];

  Object.assign(window, {
    SB_SHARED_DATA: {
      MOS_DIMENSIONS,
      MOS_GROUPS,
      INSTRUCTION_DIMENSION,
      TOTAL_DIMENSION,
      ELO_DIMENSIONS,
      LOW_SCORE_OPTIONS,
      INSTRUCTION_DEDUCTION_OPTIONS,
      normalizeInstructionDeductions,
      MIN_MODEL_COUNT,
      MAX_MODEL_COUNT,
      REVIEW_SAMPLE_ROW,
      WORK_ORDER_SCHEMA,
      REVIEW_SCHEMA,
      MAPPING_SCHEMA,
      RESULT_CELL_CHAR_LIMIT,
      finalSnapshotResult,
      isSupportedModelCount,
      eloMatchCount,
      workOrderColumnCount,
      workOrderHeaders,
      rawInputHeaders,
      inferModelCountFromWorkOrderColumnCount,
      canonicalEloSlotPairs,
      isCompatibleWorkOrderSchema,
      isCompatibleReviewSchema,
      CANONICAL_ELO_SLOT_PAIRS: canonicalEloSlotPairs(MAX_MODEL_COUNT),
      WORK_ORDER_HEADERS: workOrderHeaders(MAX_MODEL_COUNT)
    }
  });
})();
