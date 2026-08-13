(function () {
  const RAW_SAMPLE_ROWS = [
    ["case_id", "tag", "lyrics", "Model_A_URL", "Model_B_URL", "Model_C_URL", "Model_D_URL", "Model_E_URL", "Model_F_URL"],
    [
      "CASE-0007",
      "温暖 R&B，男声，92 BPM，雨夜氛围",
      "[主歌]\n夜色落在玻璃窗，雨声把街灯慢慢拉长\n我把未寄出的信，藏进外套最深的地方\n风经过空荡站台，吹散那句没说完的原谅\n\n[副歌]\n如果明天还会下雨，请替我留一盏微光\n等城市安静以后，我会循着回忆的方向\n穿过人海和漫长夜晚，再一次走到你身旁",
      "https://example.com/audio/case-0007/a01.mp3",
      "https://example.com/audio/case-0007/b02.mp3",
      "https://example.com/audio/case-0007/c03.mp3",
      "https://example.com/audio/case-0007/d04.mp3",
      "https://example.com/audio/case-0007/e05.mp3",
      "https://example.com/audio/case-0007/f06.mp3"
    ],
    [
      "CASE-0012",
      "Afrobeat，女声，法语，明亮夏日",
      "Sous le soleil, je retrouve le rythme de nos pas",
      "https://example.com/audio/case-0012/a01.mp3",
      "https://example.com/audio/case-0012/b02.mp3",
      "https://example.com/audio/case-0012/c03.mp3",
      "https://example.com/audio/case-0012/d04.mp3",
      "https://example.com/audio/case-0012/e05.mp3",
      "https://example.com/audio/case-0012/f06.mp3"
    ],
    [
      "CASE-0021",
      "电影配乐，弦乐，渐进式高潮，无人声",
      "",
      "https://example.com/audio/case-0021/a01.mp3",
      "https://example.com/audio/case-0021/b02.mp3",
      "https://example.com/audio/case-0021/c03.mp3",
      "https://example.com/audio/case-0021/d04.mp3",
      "https://example.com/audio/case-0021/e05.mp3",
      "https://example.com/audio/case-0021/f06.mp3"
    ]
  ];

  Object.assign(window, {
    SB_ADMIN_DATA: { RAW_SAMPLE_ROWS, RAW_SAMPLE_TSV: RAW_SAMPLE_ROWS }
  });
})();
