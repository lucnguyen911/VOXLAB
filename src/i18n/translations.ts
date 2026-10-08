export type SupportedLang = "vi" | "en" | "ja" | "zh";

export interface Translations {
  topbar: {
    title: string;
    projectTitle: string;
    saved: string;
    local: string;
    onlineActive: string;
    langTitle: string;
    themeTitle: string;
    settingsTitle: string;
  };
  nav: {
    primaryWorkspaces: string;
    tts: string;
    ttsDesc: string;
    dialogue: string;
    dialogueDesc: string;
    clone: string;
    cloneDesc: string;
    library: string;
    libraryDesc: string;
    dubbing: string;
    dubbingDesc: string;
    batch: string;
    batchDesc: string;
    transcription: string;
    transcriptionDesc: string;
    utility: string;
    history: string;
    settings: string;
    activeEngine: string;
    collapse: string;
    expand: string;
    collapseSidebar: string;
    expandSidebar: string;
  };
  tts: {
    prepStage: string;
    studioStage: string;
    comfortable: string;
    compact: string;
    editText: string;
    splitAndStudio: string;
    normalize: string;
    aiPunctuation: string;
    aiPauses: string;
    restoreOriginal: string;
    regenInvalid: string;
    generateAll: string;
    generateAudio: string;
    sentencesCount: string;
    errorsCount: string;
    needsRegenCount: string;
    pauseOverride: string;
    exportAudio: string;
    chars: string;
    words: string;
    estAudio: string;
    chunkSummary: string;
    protectedSpanNote: string;
    ready: string;
    modified: string;
    generating: string;
    pending: string;
    failed: string;
    preview: string;
    regenerateChunk: string;
    retry: string;
    chunkModifiedWarning: string;
    pauseAfter: string;
    autoPause: string;
    fullySynced: string;
  };
  inspector: {
    title: string;
    globalTab: string;
    chunkTab: string;
    primaryVoice: string;
    voicesReady: string;
    changeVoice: string;
    localBadge: string;
    model: string;
    settings: string;
    defaultBtn: string;
    advanced: string;
    resetSettings: string;
    speed: string;
    normal: string;
    pitch: string;
    low: string;
    high: string;
    volume: string;
    processingSpeed: string;
    speed1x: string;
    speed2x: string;
    speed3x: string;
    speed4x: string;
    processingSpeedHelper: string;
    resetSettingsTooltip: string;
    exportSrt: string;
    exportSrtDesc: string;
    optimizeClarity: string;
    optimizeClarityDesc: string;
    batchConcurrency: string;
    batchConcurrencyHelper: string;
    emotion: string;
    emotionNatural: string;
    emotionExpressive: string;
    emotionFormal: string;
    emotionEnergetic: string;
    emotionNotSupported: string;
    pausesTitle: string;
    segmentPauseTitle: string;
    min: string;
    max: string;
    punctuationPausesTitle: string;
    comma: string;
    period: string;
    questionExclamation: string;
    colonSemicolon: string;
    pauseBetween: string;
    pausesHelper: string;
    sec: string;
    ms: string;
    voiceOverrideForSentence: string;
    fromLibrary: string;
    useGlobalVoice: string;
    pauseAfterSentence: string;
    useGlobalSettings: string;
    clickSentenceHint: string;
  };
  jobbar: {
    generating: string;
    generatingShort: string;
    pausedStatus: string;
    completedStatus: string;
    errorStatus: string;
    retry: string;
    chunkOf: string;
    elapsed: string;
    eta: string;
    synthesisProgress: string;
    completedSummary: string;
    remainingShort: string;
    pause: string;
    resume: string;
    cancel: string;
    openFolder: string;
    gpuReady: string;
  };
  voiceModal: {
    title: string;
    tabSystem: string;
    tabMyVoices: string;
    tabFavorites: string;
    cloneNew: string;
    searchPlaceholder: string;
    langLabel: string;
    all: string;
    male: string;
    female: string;
    popular: string;
    recent: string;
    newest: string;
    alphabetical: string;
    uses: string;
    currentlyUsed: string;
    useThis: string;
    emptyTitleFav: string;
    emptyDescFav: string;
    emptyTitleMy: string;
    emptyDescMy: string;
    emptyTitleSearch: string;
    emptyDescSearch: string;
    createCloneNow: string;
    showingCount: string;
    close: string;
    regionAccentLabel: string;
    filterBtn: string;
    filterCount: string;
    sortLabel: string;
    genderLabel: string;
    styleLabel: string;
    modelLabel: string;
    resetFilters: string;
    clearAll: string;
    removeFilter: string;
    styleNatural: string;
    styleStory: string;
    styleNarration: string;
    stylePodcast: string;
    styleAd: string;
    accentNorth: string;
    accentCentral: string;
    accentSouth: string;
    accentUs: string;
    accentUk: string;
    accentAu: string;
    voiceCount: string;
    selectLanguageFirst: string;
    noAccentFilterForLanguage: string;
    accentFilterLabel: string;
    sourceFilterLabel: string;
    allSources: string;
    groupOnline: string;
    groupLocal: string;
    groupMyVoices: string;
    sourceEdge: string;
    sourceOpenAi: string;
    sourceGoogle: string;
    sourceLocal: string;
    sourceClone: string;
    notConfigured: string;
    unavailable: string;
    badgeEdge: string;
    badgeOpenAi: string;
    badgeGoogle: string;
    badgeLocal: string;
    badgeClone: string;
    categoryFilterLabel: string;
    styleFilterLabel: string;
    genderFilterLabel: string;
    ageFilterLabel: string;
    clearAllFilters: string;
    emptyTitle: string;
    emptyDesc: string;
    createVoiceCta: string;
    resetFiltersBtn: string;
    allLanguages: string;
    allAccents: string;
    allCategories: string;
    allStyles: string;
    allGenders: string;
    allAges: string;
    searchInsideDropdown: string;
    styleConversational: string;
    styleAdvertising: string;
    previewVoice: string;
    previewLoading: string;
    stopPreview: string;
    openAiNotConfigured: string;
    previewError: string;
  };
  clone: {
    title: string;
    subtitle: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    box1Title: string;
    recDuration: string;
    changeFile: string;
    safeStorageNote: string;
    box2Title: string;
    cloneModel: string;
    availLangs: string;
    box3Title: string;
    testPrompt: string;
    genPreviewBtn: string;
    readyPreview: string;
    box4Title: string;
    displayName: string;
    tags: string;
    tagsHelper: string;
    permanentSaveNote: string;
    saveToLibrary: string;
  };
  library: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    filterAll: string;
    filterCloned: string;
    filterPreset: string;
    filterOnline: string;
    useVoice: string;
    sampleSec: string;
  };
  transcription: {
    title: string;
    subtitle: string;
    dropTitle: string;
    dropDesc: string;
    chooseFile: string;
    trySample: string;
    supportedFormats: string;
    emptyDesc: string;
    fileReady: string;
    changeFile: string;
    removeFile: string;
    createSubtitles: string;
    processingTitle: string;
    speechRecognition: string;
    processedTime: string;
    cancel: string;
    asrSettings: string;
    asrSettingsDesc: string;
    modelLabel: string;
    whisperModelMedium: string;
    whisperModelTurbo: string;
    whisperModelLarge: string;
    langAudio: string;
    autoDetect: string;
    advancedOptions: string;
    device: string;
    precision: string;
    vad: string;
    exportTxt: string;
    exportSrt: string;
    sendToTts: string;
    sendToDubbing: string;
    subtitleSettingsTitle: string;
    recognitionGroupTitle: string;
    displayGroupTitle: string;
    speechSpeedLabel: string;
    speechSpeedDesc: string;
    speechSpeedNormal: string;
    speechSpeedFast: string;
    speechSpeedVeryFast: string;
    processingSpeedLabel: string;
    aspectRatioLabel: string;
    maxLinesLabel: string;
    invalidationNotice: string;
    cueCount: string;
    activeCue: string;
    clickToEdit: string;
    errorTitle: string;
    errorRetry: string;
    unsupportedFile: string;
    noAudioStream: string;
    recognitionFailed: string;
    modeSegments: string;
    modeContinuous: string;
    changeMedia: string;
    fileReadyDesc: string;
    togglePanel: string;
  };
  history: {
    title: string;
    subtitle: string;
    openOutputFolder: string;
    colTitle: string;
    colType: string;
    colDuration: string;
    colChunks: string;
    colTime: string;
    colStatus: string;
    colActions: string;
    resume: string;
    completed: string;
    interrupted: string;
    failed: string;
  };
  settings: {
    title: string;
    subtitle: string;
    storageTitle: string;
    storageDesc: string;
    changeDir: string;
    cacheTitle: string;
    clearCache: string;
    clearCacheDesc: string;
    clearHistory: string;
    clearHistoryDesc: string;
  };
  audioPlayer: {
    chunkPrefix: string;
    play: string;
    pause: string;
    rewind5s: string;
    forward5s: string;
    speed: string;
    seekWaveform: string;
    volume: string;
    mute: string;
    unmute: string;
    download: string;
    close: string;
  };
  normalizerModal: {
    title: string;
    subtitle: string;
    rulesTitle: string;
    selectAll: string;
    deselectAll: string;
    restoreDefault: string;
    beforeTitle: string;
    afterTitle: string;
    noChanges: string;
    changesCount: string;
    charsUnit: string;
    wordsUnit: string;
    cancel: string;
    applyChanges: string;
    applyNoChanges: string;
    appliedToast: string;
    undoNormalize: string;
  };
}

export const TRANSLATIONS: Record<SupportedLang, Translations> = {
  vi: {
    topbar: {
      title: "VOXLAB",
      projectTitle: "Kịch bản Podcast Công nghệ Tập 12",
      saved: "Đã lưu",
      local: "Cục bộ",
      onlineActive: "Dịch vụ Online đang bật",
      langTitle: "Ngôn ngữ giao diện",
      themeTitle: "Giao diện Sáng/Tối",
      settingsTitle: "Cài đặt hệ thống",
    },
    nav: {
      primaryWorkspaces: "KHÔNG GIAN LÀM VIỆC CHÍNH",
      tts: "Text to Speech",
      ttsDesc: "Kịch bản dài & Câu đọc",
      dialogue: "Hội Thoại",
      dialogueDesc: "Hội thoại đa nhân vật",
      clone: "Voice Clone",
      cloneDesc: "Tạo mẫu giọng mới",
      library: "Voice Library",
      libraryDesc: "Quản lý & Tái sử dụng giọng",
      dubbing: "Dịch & Lồng tiếng",
      dubbingDesc: "Dịch phụ đề & lồng tiếng audio",
      batch: "Hàng loạt",
      batchDesc: "Điều phối xử lý hàng loạt theo hàng đợi",
      transcription: "Phụ đề",
      transcriptionDesc: "Tạo phụ đề từ Audio & Video",
      utility: "TIỆN ÍCH",
      history: "Lịch sử",
      settings: "Cài đặt",
      activeEngine: "Active Engine",
      collapse: "Thu gọn",
      expand: "Mở rộng",
      collapseSidebar: "Thu gọn thanh bên",
      expandSidebar: "Mở rộng thanh bên",
    },
    tts: {
      prepStage: "Soạn thảo",
      studioStage: "Tạo giọng",
      comfortable: "Thoáng",
      compact: "Gọn",
      editText: "Sửa văn bản",
      splitAndStudio: "Chuyển sang tạo giọng",
      normalize: "Chuẩn hóa văn bản",
      aiPunctuation: "AI Thêm dấu câu",
      aiPauses: "AI Tối ưu ngắt nghỉ",
      restoreOriginal: "Khôi phục bản gốc",
      regenInvalid: "Tạo lại {count} đoạn",
      generateAll: "Tạo tất cả ({count})",
      generateAudio: "Tạo audio",
      sentencesCount: "{count} đoạn",
      errorsCount: "{count} lỗi",
      needsRegenCount: "{count} đoạn cần tạo lại",
      pauseOverride: "Nghỉ: {ms}ms",
      exportAudio: "Ghép & xuất",
      chars: "ký tự",
      words: "từ",
      estAudio: "Ước tính audio",
      chunkSummary: "Kịch bản gồm {count} đoạn",
      protectedSpanNote: "Tự động giữ nguyên số, mốc thời gian và định dạng kỹ thuật.",
      ready: "Sẵn sàng",
      modified: "Đã sửa",
      generating: "Đang tạo...",
      pending: "Chờ",
      failed: "Lỗi",
      preview: "Nghe thử",
      regenerateChunk: "Tạo lại",
      retry: "Thử lại",
      chunkModifiedWarning: "Audio cũ không còn khớp với nội dung mới.",
      pauseAfter: "Khoảng nghỉ sau câu:",
      autoPause: "Tự động (~400ms)",
      fullySynced: "Khớp hoàn toàn",
    },
    inspector: {
      title: "GIỌNG & CÀI ĐẶT",
      globalTab: "Toàn bộ",
      chunkTab: "Câu #{index}",
      primaryVoice: "Giọng đọc chính",
      voicesReady: "{count} giọng sẵn có",
      changeVoice: "Đổi giọng",
      localBadge: "Cục bộ",
      model: "Model",
      settings: "Cài đặt",
      defaultBtn: "Mặc định",
      advanced: "Nâng cao",
      resetSettings: "Đặt lại",
      speed: "Tốc độ",
      normal: "Chuẩn",
      pitch: "Cao độ",
      low: "Trầm",
      high: "Bổng",
      volume: "Âm lượng",
      processingSpeed: "Tốc độ xử lý",
      speed1x: "1x · Mặc định",
      speed2x: "2x · Nhanh",
      speed3x: "3x · Hiệu suất cao",
      speed4x: "4x · Tối đa",
      processingSpeedHelper: "Tăng mức xử lý sẽ render nhiều đoạn đồng thời và sử dụng thêm VRAM. Tốc độ thực tế phụ thuộc model, GPU và nội dung.",
      resetSettingsTooltip: "Đặt lại cài đặt giọng",
      exportSrt: "Tạo phụ đề SRT",
      exportSrtDesc: "Tạo file .srt cùng với file âm thanh.",
      optimizeClarity: "Tối ưu độ rõ giọng đọc",
      optimizeClarityDesc: "Áp dụng thuật toán vi giãn nhịp đọc có bảo toàn cao độ nhằm giảm hiện tượng dính chữ khi mô hình đọc quá nhanh.",
      batchConcurrency: "Xử lý song song (Batch)",
      batchConcurrencyHelper: "Số luồng render audio đồng thời. Khuyên dùng 2-4 luồng cho máy có GPU rời.",
      emotion: "Sắc thái",
      emotionNatural: "Tự nhiên",
      emotionExpressive: "Truyền cảm",
      emotionFormal: "Thời sự",
      emotionEnergetic: "Sôi nổi",
      emotionNotSupported: "Model {model} sử dụng ngữ điệu chuẩn, không hỗ trợ đổi cảm xúc.",
      pausesTitle: "Ngắt nghỉ",
      segmentPauseTitle: "Thời gian nghỉ giữa các đoạn",
      min: "Tối thiểu",
      max: "Tối đa",
      punctuationPausesTitle: "Nghỉ theo dấu câu",
      comma: "Dấu phẩy ( , )",
      period: "Dấu chấm ( . )",
      questionExclamation: "Hỏi / Than ( ? ! )",
      colonSemicolon: "Hai chấm ( : ; )",
      pauseBetween: "Khoảng nghỉ giữa các đoạn:",
      pausesHelper: "Tự động chèn khoảng lặng sau các dấu câu trong kịch bản để tạo nhịp thở tự nhiên.",
      sec: "giây",
      ms: "mili-giây (ms)",
      voiceOverrideForSentence: "Giọng đọc riêng cho câu này",
      fromLibrary: "Chọn từ thư viện →",
      useGlobalVoice: "(Sử dụng giọng chung: {name})",
      pauseAfterSentence: "Khoảng nghỉ sau câu này",
      useGlobalSettings: "Dùng lại thiết lập chung",
      clickSentenceHint: "Bấm chọn một câu trong danh sách để điều chỉnh riêng cho câu đó.",
    },
    jobbar: {
      generating: "Đang tạo audio",
      generatingShort: "Đang tạo",
      pausedStatus: "Đã tạm dừng",
      completedStatus: "Hoàn tất",
      errorStatus: "Lỗi",
      retry: "Thử lại",
      chunkOf: "Câu {current}/{total} ({percent}%)",
      elapsed: "Đã chạy: {time}",
      eta: "Còn lại: ~{time}",
      synthesisProgress: "Tiến độ tổng hợp",
      completedSummary: "Hoàn tất · {count} câu",
      remainingShort: "còn ~{time}",
      pause: "Tạm dừng",
      resume: "Tiếp tục",
      cancel: "Hủy",
      openFolder: "Mở thư mục",
      gpuReady: "GPU: Sẵn sàng",
    },
    voiceModal: {
      title: "Chọn giọng nói",
      tabSystem: "Hệ thống",
      tabMyVoices: "Giọng của tôi",
      tabFavorites: "Yêu thích",
      cloneNew: "Tạo giọng mới",
      searchPlaceholder: "Tìm kiếm theo tên giọng, vùng miền, phong cách...",
      langLabel: "Ngôn ngữ:",
      all: "Tất cả",
      male: "Nam",
      female: "Nữ",
      popular: "Dùng nhiều",
      recent: "Gần đây",
      newest: "Mới nhất",
      alphabetical: "A–Z",
      uses: "lượt dùng",
      currentlyUsed: "Đang dùng",
      useThis: "Chọn giọng này →",
      emptyTitleFav: "Chưa có giọng nói yêu thích",
      emptyDescFav: "Bấm vào biểu tượng trái tim trên các thẻ giọng nói để lưu vào danh sách truy cập nhanh.",
      emptyTitleMy: "Chưa có giọng nhân bản nào",
      emptyDescMy: "Bạn có thể tải lên một đoạn âm thanh mẫu ngắn 10-30s để nhân bản giọng nói của chính mình.",
      emptyTitleSearch: "Không tìm thấy giọng phù hợp",
      emptyDescSearch: "Thử điều chỉnh lại bộ lọc hoặc bấm Đặt lại để hiển thị tất cả giọng.",
      createCloneNow: "Tạo giọng mới ngay",
      showingCount: "Đang hiển thị {count} giọng",
      close: "Đóng",
      regionAccentLabel: "Vùng / Accent",
      filterBtn: "Bộ lọc",
      filterCount: "Bộ lọc ({count})",
      sortLabel: "Sắp xếp",
      genderLabel: "Giới tính",
      styleLabel: "Phong cách",
      modelLabel: "Model",
      resetFilters: "Đặt lại",
      clearAll: "Xóa tất cả",
      removeFilter: "Xóa bộ lọc này",
      styleNatural: "Tự nhiên",
      styleStory: "Kể chuyện",
      styleNarration: "Thuyết minh",
      stylePodcast: "Podcast",
      styleAd: "Quảng cáo",
      accentNorth: "Miền Bắc",
      accentCentral: "Miền Trung",
      accentSouth: "Miền Nam",
      accentUs: "Tiếng Anh (Mỹ)",
      accentUk: "Tiếng Anh (Anh)",
      accentAu: "Tiếng Anh (Úc)",
      voiceCount: "{count} giọng",
      selectLanguageFirst: "Chọn ngôn ngữ trước",
      noAccentFilterForLanguage: "Chưa có bộ lọc vùng cho ngôn ngữ này",
      accentFilterLabel: "Vùng / Accent",
      sourceFilterLabel: "Nguồn",
      allSources: "Tất cả",
      groupOnline: "TRỰC TUYẾN",
      groupLocal: "CỤC BỘ",
      groupMyVoices: "GIỌNG CỦA TÔI",
      sourceEdge: "Edge TTS",
      sourceOpenAi: "OpenAI TTS",
      sourceGoogle: "Google TTS",
      sourceLocal: "Local AI",
      sourceClone: "Clone",
      notConfigured: "Chưa cấu hình",
      unavailable: "Không khả dụng",
      badgeEdge: "Edge",
      badgeOpenAi: "OpenAI",
      badgeGoogle: "Google",
      badgeLocal: "Local",
      badgeClone: "Clone",
      categoryFilterLabel: "Phong cách",
      styleFilterLabel: "Phong cách",
      genderFilterLabel: "Giới tính",
      ageFilterLabel: "Tuổi",
      clearAllFilters: "Xóa tất cả bộ lọc",
      emptyTitle: "Không tìm thấy giọng nói nào.",
      emptyDesc: "Chúng tôi không tìm thấy bất kỳ giọng nói nào cho tìm kiếm và bộ lọc này.",
      createVoiceCta: "Tạo giọng mới",
      resetFiltersBtn: "Đặt lại bộ lọc",
      allLanguages: "Tất cả ngôn ngữ",
      allAccents: "Tất cả vùng / accent",
      allCategories: "Tất cả",
      allStyles: "Tất cả",
      allGenders: "Tất cả giới tính",
      allAges: "Tất cả độ tuổi",
      searchInsideDropdown: "Tìm kiếm...",
      styleConversational: "Đàm thoại",
      styleAdvertising: "Quảng cáo",
      previewVoice: "Nghe thử",
      previewLoading: "Đang tải",
      stopPreview: "Dừng",
      openAiNotConfigured: "OpenAI TTS chưa được cấu hình.",
      previewError: "Không thể phát âm thanh thử.",
    },
    clone: {
      title: "Tạo giọng nhân bản (Voice Clone)",
      subtitle: "Nhân bản giọng nói tự nhiên từ một đoạn âm thanh mẫu ngắn.",
      step1: "1. File mẫu",
      step2: "2. Cấu hình",
      step3: "3. Nghe thử",
      step4: "4. Lưu giọng",
      box1Title: "1. File âm thanh mẫu",
      recDuration: "Độ dài khuyến nghị: 10s – 30s",
      changeFile: "Đổi file khác",
      safeStorageNote: "VoxLab sẽ lưu an toàn file mẫu khi bạn lưu giọng.",
      box2Title: "2. Model & Ngôn ngữ",
      cloneModel: "Mô hình nhân bản",
      availLangs: "Ngôn ngữ khả dụng",
      box3Title: "3. Nghe thử giọng mẫu",
      testPrompt: "Câu nói thử nghiệm:",
      genPreviewBtn: "Tạo giọng nghe thử",
      readyPreview: "Mẫu đã tạo ({dur}s) • Sẵn sàng",
      box4Title: "4. Thông tin & Lưu giọng",
      displayName: "Tên hiển thị",
      tags: "Nhãn phân loại (Tags)",
      tagsHelper: "Phân cách bằng dấu phẩy để dễ tìm kiếm trong Thư viện giọng.",
      permanentSaveNote: "Giọng sẽ được lưu vĩnh viễn vào thư viện của bạn.",
      saveToLibrary: "Lưu vào Thư viện giọng",
    },
    library: {
      title: "Thư viện giọng nói",
      subtitle: "Quản lý, tìm kiếm và tái sử dụng các mẫu giọng cho kịch bản TTS.",
      searchPlaceholder: "Tìm kiếm theo tên giọng hoặc nhãn...",
      filterAll: "Tất cả ({count})",
      filterCloned: "Giọng nhân bản ({count})",
      filterPreset: "Giọng có sẵn ({count})",
      filterOnline: "Giọng Online ({count})",
      useVoice: "Dùng giọng này →",
      sampleSec: "Mẫu {dur}s",
    },
    transcription: {
      title: "Phụ đề",
      subtitle: "Tạo phụ đề từ Audio hoặc Video",
      dropTitle: "Kéo thả âm thanh hoặc video vào đây",
      dropDesc: "Kéo thả file vào đây",
      chooseFile: "Chọn tệp",
      trySample: "Dùng file mẫu thử nghiệm",
      supportedFormats: "Audio (WAV, MP3, FLAC, M4A) • Video (MP4, MOV, MKV, WEBM)",
      emptyDesc: "VoxLab sẽ tự nhận diện lời nói và tạo phụ đề có timestamp.",
      fileReady: "Tệp đã sẵn sàng",
      changeFile: "Đổi tệp",
      removeFile: "Xóa tệp",
      createSubtitles: "Tạo phụ đề",
      processingTitle: "Đang tạo phụ đề...",
      speechRecognition: "Nhận diện giọng nói",
      processedTime: "{current} / {total} đã xử lý",
      cancel: "Hủy",
      asrSettings: "CÀI ĐẶT NHẬN DIỆN",
      asrSettingsDesc: "Mô hình nhận diện giọng nói tự động trên máy tính.",
      modelLabel: "Mô hình Whisper",
      whisperModelTurbo: "Large-V3-Turbo (Cân Bằng)",
      whisperModelLarge: "Large-V3 (Máy Mạnh)",
      whisperModelMedium: "Medium (Máy Yếu)",
      langAudio: "Ngôn ngữ",
      autoDetect: "Tự Động Phát Hiện",
      advancedOptions: "Tùy chọn nâng cao",
      device: "Thiết bị",
      precision: "Độ chính xác",
      vad: "VAD",
      exportTxt: "Xuất TXT",
      exportSrt: "Xuất SRT",
      sendToTts: "Tạo Giọng Đọc",
      sendToDubbing: "Dịch Và Lồng Tiếng",
      subtitleSettingsTitle: "CÀI ĐẶT PHỤ ĐỀ",
      recognitionGroupTitle: "Nhận diện",
      displayGroupTitle: "Hiển thị",
      speechSpeedLabel: "Tốc độ giọng nói",
      speechSpeedDesc: "Làm chậm audio để nhận diện tốt hơn (timestamps tự quy đổi về audio gốc)",
      speechSpeedNormal: "Chuẩn",
      speechSpeedFast: "Nhanh",
      speechSpeedVeryFast: "Rất nhanh",
      processingSpeedLabel: "Tốc độ xử lý",
      aspectRatioLabel: "Tỷ lệ khung hình",
      maxLinesLabel: "Số dòng tối đa",
      invalidationNotice: "Cài đặt nhận diện đã thay đổi. Kết quả cũ đã được đặt lại.",
      cueCount: "{count} phụ đề",
      activeCue: "Đang phát",
      clickToEdit: "Nhấp để chỉnh sửa nội dung phụ đề",
      errorTitle: "Không thể tạo phụ đề",
      errorRetry: "Thử lại",
      unsupportedFile: "Định dạng tệp không được hỗ trợ. Vui lòng chọn tệp Audio hoặc Video.",
      noAudioStream: "Không tìm thấy track âm thanh trong video.",
      recognitionFailed: "Không thể tải mô hình nhận diện. Kiểm tra model/runtime và thử lại.",
      modeSegments: "Từng câu (Mốc thời gian)",
      modeContinuous: "Văn bản liền",
      changeMedia: "Đổi tệp",
      fileReadyDesc: "Sẵn sàng nhận diện lời nói và tạo phụ đề.",
      togglePanel: "Cài đặt nhận diện",
    },
    history: {
      title: "Lịch sử sản xuất",
      subtitle: "Quản lý các phiên tạo audio và bóc băng đã thực hiện.",
      openOutputFolder: "Mở thư mục xuất",
      colTitle: "Tên phiên / Dự án",
      colType: "Loại tác vụ",
      colDuration: "Thời lượng",
      colChunks: "Số câu",
      colTime: "Thời gian tạo",
      colStatus: "Trạng thái",
      colActions: "Hành động",
      resume: "Mở lại",
      completed: "Hoàn tất",
      interrupted: "Tạm dừng",
      failed: "Thất bại",
    },
    settings: {
      title: "Lưu trữ & Dữ liệu",
      subtitle: "Quản lý thư mục lưu trữ dữ liệu ứng dụng và bộ nhớ tạm.",
      storageTitle: "Thư mục dữ liệu VoxLab",
      storageDesc: "Cơ sở dữ liệu, lịch sử, giọng đã lưu và bộ nhớ tạm được lưu tại đây.",
      changeDir: "Thay đổi thư mục...",
      cacheTitle: "Dọn dẹp bộ nhớ",
      clearCache: "Dọn bộ nhớ tạm (Cache)",
      clearCacheDesc: "Xóa file âm thanh tạm thời. Không ảnh hưởng đến các file đã xuất ra thư mục của bạn.",
      clearHistory: "Xóa lịch sử phiên",
      clearHistoryDesc: "Chỉ xóa danh sách các phiên làm việc trước. File âm thanh trên đĩa được giữ nguyên 100%.",
    },
    audioPlayer: {
      chunkPrefix: "Đoạn",
      play: "Phát",
      pause: "Tạm dừng",
      rewind5s: "Lùi 5 giây",
      forward5s: "Tua 5 giây",
      speed: "Tốc độ",
      seekWaveform: "Kéo để tua đoạn",
      volume: "Âm lượng",
      mute: "Tắt tiếng",
      unmute: "Bật tiếng",
      download: "Tải audio đoạn này",
      close: "Đóng trình phát",
    },
    normalizerModal: {
      title: "Chuẩn hóa văn bản",
      subtitle: "Làm sạch và chuẩn hóa văn bản trước khi tạo giọng",
      rulesTitle: "QUY TẮC CHUẨN HÓA",
      selectAll: "Chọn tất cả",
      deselectAll: "Bỏ chọn tất cả",
      restoreDefault: "Khôi phục mặc định",
      beforeTitle: "VĂN BẢN GỐC",
      afterTitle: "KẾT QUẢ SAU CHUẨN HÓA",
      noChanges: "Không có thay đổi",
      changesCount: "thay đổi",
      charsUnit: "ký tự",
      wordsUnit: "từ",
      cancel: "Hủy",
      applyChanges: "Áp dụng {count} thay đổi",
      applyNoChanges: "Không có thay đổi để áp dụng",
      appliedToast: "Đã áp dụng chuẩn hóa văn bản thành công",
      undoNormalize: "Hoàn tác chuẩn hóa",
    },
  },

  en: {
    topbar: {
      title: "VOXLAB",
      projectTitle: "Tech Podcast Script Episode 12",
      saved: "Saved",
      local: "Local",
      onlineActive: "Online Service Active",
      langTitle: "Interface Language",
      themeTitle: "Theme Light/Dark",
      settingsTitle: "System Settings",
    },
    nav: {
      primaryWorkspaces: "PRIMARY WORKSPACES",
      tts: "Text to Speech",
      ttsDesc: "Long-form & Chunk TTS",
      dialogue: "Dialogue",
      dialogueDesc: "Multi-character conversation",
      clone: "Voice Clone",
      cloneDesc: "Clone Voice Profile",
      library: "Voice Library",
      libraryDesc: "Manage & Reuse Voices",
      dubbing: "Dubbing & Translation",
      dubbingDesc: "Translate subtitles & synthesize dubbing audio",
      batch: "Batch Processing",
      batchDesc: "Automated batch queue orchestrator",
      transcription: "Subtitles",
      transcriptionDesc: "Generate subtitles from audio & video",
      utility: "UTILITY",
      history: "History",
      settings: "Settings",
      activeEngine: "Active Engine",
      collapse: "Collapse",
      expand: "Expand",
      collapseSidebar: "Collapse sidebar",
      expandSidebar: "Expand sidebar",
    },
    tts: {
      prepStage: "Script Editor",
      studioStage: "Voice Generation",
      comfortable: "Comfortable",
      compact: "Compact",
      editText: "Edit script",
      splitAndStudio: "Move to Studio",
      normalize: "Normalize text",
      aiPunctuation: "AI Punctuation",
      aiPauses: "AI Pause Optimizer",
      restoreOriginal: "Restore original",
      regenInvalid: "Regenerate {count} chunks",
      generateAll: "Generate all ({count})",
      generateAudio: "Generate Audio",
      sentencesCount: "{count} chunks",
      errorsCount: "{count} errors",
      needsRegenCount: "{count} need regeneration",
      pauseOverride: "Pause: {ms}ms",
      exportAudio: "Merge & Export",
      chars: "chars",
      words: "words",
      estAudio: "Estimated audio",
      chunkSummary: "Script contains {count} chunks",
      protectedSpanNote: "Numbers, timestamps and technical formats automatically preserved.",
      ready: "Ready",
      modified: "Modified",
      generating: "Generating...",
      pending: "Pending",
      failed: "Failed",
      preview: "Preview",
      regenerateChunk: "Regenerate",
      retry: "Retry",
      chunkModifiedWarning: "Audio out of sync with updated text.",
      pauseAfter: "Pause after chunk:",
      autoPause: "Auto (~400ms)",
      fullySynced: "Fully synced",
    },
    inspector: {
      title: "Voice & Settings",
      globalTab: "Global",
      chunkTab: "Sentence #{index}",
      primaryVoice: "Primary Voice",
      voicesReady: "{count} voices ready",
      changeVoice: "Change voice",
      localBadge: "Local",
      model: "Model",
      settings: "Settings",
      defaultBtn: "Default",
      advanced: "Advanced",
      resetSettings: "Reset",
      speed: "Speed",
      normal: "Normal",
      pitch: "Pitch",
      low: "Low",
      high: "High",
      volume: "Volume",
      processingSpeed: "Processing speed",
      speed1x: "1x · Default",
      speed2x: "2x · Fast",
      speed3x: "3x · High performance",
      speed4x: "4x · Maximum",
      processingSpeedHelper: "Higher levels render more segments concurrently and use more VRAM. Actual speed depends on the model, GPU, and content.",
      resetSettingsTooltip: "Reset voice settings",
      exportSrt: "Generate SRT subtitles",
      exportSrtDesc: "Generate a .srt file alongside the audio file.",
      optimizeClarity: "Optimize Speech Clarity",
      optimizeClarityDesc: "Applies pitch-preserving micro time-stretch to reduce crowded words when models speak too rapidly.",
      batchConcurrency: "Parallel Batches",
      batchConcurrencyHelper: "Concurrent audio render threads. 2-4 threads recommended for dedicated GPU.",
      emotion: "Emotion",
      emotionNatural: "Natural",
      emotionExpressive: "Expressive",
      emotionFormal: "Formal / News",
      emotionEnergetic: "Energetic",
      emotionNotSupported: "Model {model} uses standard tone, emotion adjustment not supported.",
      pausesTitle: "Pauses",
      segmentPauseTitle: "Pause between segments",
      min: "Min",
      max: "Max",
      punctuationPausesTitle: "Punctuation pauses",
      comma: "Comma ( , )",
      period: "Period ( . )",
      questionExclamation: "Question / Exclamation ( ? ! )",
      colonSemicolon: "Colon / Semicolon ( : ; )",
      pauseBetween: "Pause between segments:",
      pausesHelper: "Automatically insert pauses after punctuation in script for natural pacing.",
      sec: "sec",
      ms: "ms",
      voiceOverrideForSentence: "Voice override for this sentence",
      fromLibrary: "From library →",
      useGlobalVoice: "(Use primary voice: {name})",
      pauseAfterSentence: "Pause after this sentence",
      useGlobalSettings: "Use global settings",
      clickSentenceHint: "Click a sentence in the list to configure it individually.",
    },
    jobbar: {
      generating: "Generating audio",
      generatingShort: "Generating",
      pausedStatus: "Paused",
      completedStatus: "Completed",
      errorStatus: "Error",
      retry: "Retry",
      chunkOf: "Chunk {current}/{total} ({percent}%)",
      elapsed: "Elapsed: {time}",
      eta: "ETA: ~{time}",
      synthesisProgress: "Synthesis progress",
      completedSummary: "Completed · {count} sentences",
      remainingShort: "~{time} left",
      pause: "Pause",
      resume: "Resume",
      cancel: "Cancel",
      openFolder: "Open folder",
      gpuReady: "GPU: Ready",
    },
    voiceModal: {
      title: "Select Voice",
      tabSystem: "System",
      tabMyVoices: "My Voices",
      tabFavorites: "Favorites",
      cloneNew: "Create New Voice",
      searchPlaceholder: "Search by voice name, region, style...",
      langLabel: "Language:",
      all: "All",
      male: "Male",
      female: "Female",
      popular: "Popular",
      recent: "Recent",
      newest: "Newest",
      alphabetical: "A–Z",
      uses: "uses",
      currentlyUsed: "Active",
      useThis: "Use this voice →",
      emptyTitleFav: "No favorite voices",
      emptyDescFav: "Click the heart icon on any voice card to save it for quick access.",
      emptyTitleMy: "No cloned voices yet",
      emptyDescMy: "Upload a short 10-30s audio sample to clone your natural voice.",
      emptyTitleSearch: "No matching voices found",
      emptyDescSearch: "Try adjusting your filters or click Reset to show all available voices.",
      createCloneNow: "Create new voice now",
      showingCount: "Showing {count} voices",
      close: "Close",
      regionAccentLabel: "Region / Accent",
      filterBtn: "Filters",
      filterCount: "Filters ({count})",
      sortLabel: "Sort by",
      genderLabel: "Gender",
      styleLabel: "Style",
      modelLabel: "Model",
      resetFilters: "Reset",
      clearAll: "Clear all",
      removeFilter: "Remove this filter",
      styleNatural: "Natural",
      styleStory: "Storytelling",
      styleNarration: "Narration",
      stylePodcast: "Podcast",
      styleAd: "Advertising",
      accentNorth: "Northern",
      accentCentral: "Central",
      accentSouth: "Southern",
      accentUs: "US English",
      accentUk: "UK English",
      accentAu: "Australian English",
      voiceCount: "{count} voices",
      selectLanguageFirst: "Select language first",
      noAccentFilterForLanguage: "No region/accent filter available for this language",
      accentFilterLabel: "Region / Accent",
      sourceFilterLabel: "Source",
      allSources: "All",
      groupOnline: "ONLINE",
      groupLocal: "LOCAL",
      groupMyVoices: "MY VOICES",
      sourceEdge: "Edge TTS",
      sourceOpenAi: "OpenAI TTS",
      sourceGoogle: "Google TTS",
      sourceLocal: "Local AI",
      sourceClone: "Clone",
      notConfigured: "Not configured",
      unavailable: "Unavailable",
      badgeEdge: "Edge",
      badgeOpenAi: "OpenAI",
      badgeGoogle: "Google",
      badgeLocal: "Local",
      badgeClone: "Clone",
      categoryFilterLabel: "Style",
      styleFilterLabel: "Style",
      genderFilterLabel: "Gender",
      ageFilterLabel: "Age",
      clearAllFilters: "Clear all filters",
      emptyTitle: "No voices found.",
      emptyDesc: "We couldn't find any voices matching this search and filters.",
      createVoiceCta: "Create new voice",
      resetFiltersBtn: "Reset filters",
      allLanguages: "All languages",
      allAccents: "All accents",
      allCategories: "All",
      allStyles: "All",
      allGenders: "All genders",
      allAges: "All age groups",
      searchInsideDropdown: "Search...",
      styleConversational: "Conversational",
      styleAdvertising: "Advertising",
      previewVoice: "Preview",
      previewLoading: "Loading",
      stopPreview: "Stop",
      openAiNotConfigured: "OpenAI TTS is not configured.",
      previewError: "Failed to play audio preview.",
    },
    clone: {
      title: "Create Voice Clone",
      subtitle: "Clone a natural voice from a short reference audio clip.",
      step1: "1. Reference Sample",
      step2: "2. Configuration",
      step3: "3. Preview",
      step4: "4. Save Voice",
      box1Title: "1. Reference Audio File",
      recDuration: "Recommended duration: 10s – 30s",
      changeFile: "Change file",
      safeStorageNote: "VoxLab safely preserves the reference audio asset when saved.",
      box2Title: "2. Model & Language",
      cloneModel: "Cloning Model",
      availLangs: "Available languages",
      box3Title: "3. Test Voice Sample",
      testPrompt: "Test sentence:",
      genPreviewBtn: "Generate test sample",
      readyPreview: "Sample generated ({dur}s) • Ready",
      box4Title: "4. Info & Save Voice",
      displayName: "Display Name",
      tags: "Tags",
      tagsHelper: "Separate tags by commas to search easily in Voice Library.",
      permanentSaveNote: "Voice will be permanently stored in your local library.",
      saveToLibrary: "Save to Voice Library",
    },
    library: {
      title: "Voice Library",
      subtitle: "Manage, search and reuse voice profiles for your TTS scripts.",
      searchPlaceholder: "Search by voice name or tags...",
      filterAll: "All ({count})",
      filterCloned: "Cloned ({count})",
      filterPreset: "Preset ({count})",
      filterOnline: "Online ({count})",
      useVoice: "Use this voice →",
      sampleSec: "Sample {dur}s",
    },
    transcription: {
      title: "Subtitles",
      subtitle: "Generate subtitles from Audio or Video",
      dropTitle: "Drag and drop audio or video here",
      dropDesc: "Drag and drop files here",
      chooseFile: "Choose File",
      trySample: "Try sample file",
      supportedFormats: "Audio (WAV, MP3, FLAC, M4A) • Video (MP4, MOV, MKV, WEBM)",
      emptyDesc: "VoxLab automatically recognizes speech and creates timestamped subtitles.",
      fileReady: "File Ready",
      changeFile: "Change File",
      removeFile: "Remove File",
      createSubtitles: "Generate Subtitles",
      processingTitle: "Generating subtitles...",
      speechRecognition: "Speech Recognition",
      processedTime: "{current} / {total} processed",
      cancel: "Cancel",
      asrSettings: "RECOGNITION SETTINGS",
      asrSettingsDesc: "Automatic speech recognition running on local hardware.",
      modelLabel: "Whisper Model",
      whisperModelTurbo: "Large-V3-Turbo (Balanced)",
      whisperModelLarge: "Large-V3 (High Spec)",
      whisperModelMedium: "Medium (Low Spec)",
      langAudio: "Language",
      autoDetect: "Auto Detect",
      advancedOptions: "Advanced Options",
      device: "Device",
      precision: "Precision",
      vad: "VAD",
      exportTxt: "Export TXT",
      exportSrt: "Export SRT",
      sendToTts: "Create Voiceover",
      sendToDubbing: "Translate & Dub",
      subtitleSettingsTitle: "SUBTITLE SETTINGS",
      recognitionGroupTitle: "Recognition",
      displayGroupTitle: "Display",
      speechSpeedLabel: "Speech Speed",
      speechSpeedDesc: "Slow down audio for better recognition (timestamps auto-remap to original)",
      speechSpeedNormal: "Normal",
      speechSpeedFast: "Fast",
      speechSpeedVeryFast: "Very Fast",
      processingSpeedLabel: "Processing Speed",
      aspectRatioLabel: "Aspect Ratio",
      maxLinesLabel: "Max Lines",
      invalidationNotice: "Recognition settings changed. Previous result was reset.",
      cueCount: "{count} cues",
      activeCue: "Playing",
      clickToEdit: "Click to edit subtitle cue text",
      errorTitle: "Failed to generate subtitles",
      errorRetry: "Retry",
      unsupportedFile: "Unsupported file format. Please select an Audio or Video file.",
      noAudioStream: "No audio track found in video.",
      recognitionFailed: "Could not load recognition model. Check model/runtime and retry.",
      modeSegments: "Timestamped Segments",
      modeContinuous: "Continuous Text",
      changeMedia: "Change File",
      fileReadyDesc: "Ready to recognize speech and create subtitles.",
      togglePanel: "Recognition Settings",
    },
    history: {
      title: "Production History",
      subtitle: "Manage your generated audio and transcription sessions.",
      openOutputFolder: "Open Output Folder",
      colTitle: "Session / Title",
      colType: "Type",
      colDuration: "Duration",
      colChunks: "Chunks",
      colTime: "Created At",
      colStatus: "Status",
      colActions: "Actions",
      resume: "Resume",
      completed: "Completed",
      interrupted: "Interrupted",
      failed: "Failed",
    },
    settings: {
      title: "Storage & Data",
      subtitle: "Manage application data root directory and cache storage.",
      storageTitle: "VoxLab Data Root Directory",
      storageDesc: "Database, session history, saved voices and cache are stored here.",
      changeDir: "Change directory...",
      cacheTitle: "Cache & Storage Cleanup",
      clearCache: "Clear Temporary Cache",
      clearCacheDesc: "Delete temporary audio chunks. Does not affect your exported files.",
      clearHistory: "Clear Session History",
      clearHistoryDesc: "Only clears session metadata list. All exported audio files on disk remain safe.",
    },
    audioPlayer: {
      chunkPrefix: "Chunk",
      play: "Play",
      pause: "Pause",
      rewind5s: "Rewind 5s",
      forward5s: "Forward 5s",
      speed: "Speed",
      seekWaveform: "Click or drag to seek",
      volume: "Volume",
      mute: "Mute",
      unmute: "Unmute",
      download: "Download this chunk audio",
      close: "Close player",
    },
    normalizerModal: {
      title: "Text Normalization",
      subtitle: "Clean and normalize text before speech generation",
      rulesTitle: "NORMALIZATION RULES",
      selectAll: "Select all",
      deselectAll: "Deselect all",
      restoreDefault: "Reset defaults",
      beforeTitle: "ORIGINAL TEXT",
      afterTitle: "NORMALIZED PREVIEW",
      noChanges: "No changes",
      changesCount: "changes",
      charsUnit: "chars",
      wordsUnit: "words",
      cancel: "Cancel",
      applyChanges: "Apply {count} changes",
      applyNoChanges: "No changes to apply",
      appliedToast: "Text normalization applied successfully",
      undoNormalize: "Undo normalization",
    },
  },

  ja: {
    topbar: {
      title: "VOXLAB",
      projectTitle: "テックポッドキャスト 第12話",
      saved: "保存済み",
      local: "ローカル",
      onlineActive: "オンライン有効",
      langTitle: "表示言語",
      themeTitle: "テーマ切り替え",
      settingsTitle: "システム設定",
    },
    nav: {
      primaryWorkspaces: "メインワークスペース",
      tts: "Text to Speech",
      ttsDesc: "長文スクリプト＆音声合成",
      dialogue: "対話スタジオ",
      dialogueDesc: "複数キャラクター対話",
      clone: "Voice Clone",
      cloneDesc: "声のクローン作成",
      library: "Voice Library",
      libraryDesc: "音声ライブラリ管理",
      dubbing: "翻訳・吹替",
      dubbingDesc: "字幕翻訳と吹替音声制作",
      batch: "一括処理",
      batchDesc: "バッチキュー自動処理オーケストレーター",
      transcription: "字幕",
      transcriptionDesc: "音声・動画から字幕生成",
      utility: "ユーティリティ",
      history: "履歴",
      settings: "設定",
      activeEngine: "実行中エンジン",
      collapse: "折りたたむ",
      expand: "展開",
      collapseSidebar: "サイドバーを折りたたむ",
      expandSidebar: "サイドバーを展開する",
    },
    tts: {
      prepStage: "テキスト編集",
      studioStage: "音声生成",
      comfortable: "標準",
      compact: "コンパクト",
      editText: "テキスト編集",
      splitAndStudio: "文分割してスタジオを開く",
      normalize: "テキスト正規化",
      aiPunctuation: "AI 句読点補正",
      aiPauses: "AI ポーズ最適化",
      restoreOriginal: "元に戻す",
      regenInvalid: "{count} 文を再生成",
      generateAll: "すべて生成 ({count})",
      generateAudio: "音声生成",
      sentencesCount: "{count} 文",
      errorsCount: "{count} エラー",
      needsRegenCount: "{count} 文の再生成が必要",
      pauseOverride: "ポーズ: {ms}ms",
      exportAudio: "音声を書き出す",
      chars: "文字",
      words: "単語",
      estAudio: "推定音声",
      chunkSummary: "合計 {count} 文",
      protectedSpanNote: "数字、時間、技術表記は自動保護されます。",
      ready: "準備完了",
      modified: "変更あり",
      generating: "生成中...",
      pending: "待機中",
      failed: "エラー",
      preview: "試聴",
      regenerateChunk: "再生成",
      retry: "再試行",
      chunkModifiedWarning: "テキストが変更されています。",
      pauseAfter: "文末ポーズ:",
      autoPause: "自動 (~400ms)",
      fullySynced: "同期済み",
    },
    inspector: {
      title: "音声 & 設定",
      globalTab: "全体",
      chunkTab: "第 #{index} 文",
      primaryVoice: "メイン音声",
      voicesReady: "{count} 音声利用可能",
      changeVoice: "声を変更",
      localBadge: "ローカル",
      model: "モデル",
      settings: "設定",
      defaultBtn: "デフォルト",
      advanced: "高度な設定",
      resetSettings: "リセット",
      speed: "速度",
      normal: "標準",
      pitch: "ピッチ (音高)",
      low: "低め",
      high: "高め",
      volume: "音量",
      processingSpeed: "処理速度",
      speed1x: "1x · デフォルト",
      speed2x: "2x · 高速",
      speed3x: "3x · 高性能",
      speed4x: "4x · 最大",
      processingSpeedHelper: "処理レベルを上げると複数のセグメントを同時にレンダリングし、VRAM使用量が増加します。実際の速度はモデル、GPU、内容によって異なります。",
      resetSettingsTooltip: "音声設定をリセット",
      exportSrt: "SRT字幕を生成",
      exportSrtDesc: "音声ファイルと一緒に.srtファイルを生成します。",
      optimizeClarity: "音声の明瞭さを最適化",
      optimizeClarityDesc: "話速が速すぎる場合の単語の重なりを軽減するため、ピッチを保持したままテンポを微調整します。",
      batchConcurrency: "並列バッチ処理",
      batchConcurrencyHelper: "同時にレンダリングするスレッド数。GPU搭載環境では2〜4スレッドを推奨します。",
      emotion: "感情",
      emotionNatural: "自然",
      emotionExpressive: "表現豊か",
      emotionFormal: "フォーマル・ニュース",
      emotionEnergetic: "明るい・元気",
      emotionNotSupported: "選択中のモデルは感情トーン変更に対応していません。",
      pausesTitle: "ポーズ設定",
      segmentPauseTitle: "セグメント間の間隔",
      min: "最小",
      max: "最大",
      punctuationPausesTitle: "句読点によるポーズ",
      comma: "読点 ( 、/ , )",
      period: "句点 ( 。/ . )",
      questionExclamation: "感嘆符 ( ? ! )",
      colonSemicolon: "コロン ( : ; )",
      pauseBetween: "セグメントの間隔:",
      pausesHelper: "自然な呼吸感を再現するため句読点後にポーズを挿入します。",
      sec: "秒",
      ms: "ミリ秒 (ms)",
      voiceOverrideForSentence: "この文専用の音声",
      fromLibrary: "ライブラリから選択 →",
      useGlobalVoice: "(全体音声を使用: {name})",
      pauseAfterSentence: "この文の後のポーズ",
      useGlobalSettings: "全体設定に戻す",
      clickSentenceHint: "一覧から文をクリックして個別に調整できます。",
    },
    jobbar: {
      generating: "音声生成中",
      generatingShort: "生成中",
      pausedStatus: "一時停止中",
      completedStatus: "完了",
      errorStatus: "エラー",
      retry: "再試行",
      chunkOf: "第 {current}/{total} 文 ({percent}%)",
      elapsed: "経過: {time}",
      eta: "残り: ~{time}",
      synthesisProgress: "生成進捗",
      completedSummary: "完了 · {count} 文",
      remainingShort: "残り ~{time}",
      pause: "一時停止",
      resume: "再開",
      cancel: "キャンセル",
      openFolder: "フォルダを開く",
      gpuReady: "GPU: 準備完了",
    },
    voiceModal: {
      title: "音声の選択",
      tabSystem: "システム",
      tabMyVoices: "マイボイス",
      tabFavorites: "お気に入り",
      cloneNew: "新規音声作成",
      searchPlaceholder: "音声名、地域、スタイルで検索...",
      langLabel: "言語:",
      all: "すべて",
      male: "男性",
      female: "女性",
      popular: "人気順",
      recent: "最近",
      newest: "新着順",
      alphabetical: "A–Z",
      uses: "回使用",
      currentlyUsed: "選択中",
      useThis: "この声を使用 →",
      emptyTitleFav: "お気に入りがありません",
      emptyDescFav: "カードのハートアイコンをクリックしてお気に入りに追加してください。",
      emptyTitleMy: "クローンされた音声がありません",
      emptyDescMy: "10〜30秒の音声をアップロードして自分の声をクローンできます。",
      emptyTitleSearch: "一致する音声が見つかりません",
      emptyDescSearch: "フィルターを調整するか、リセットしてすべての音声を表示してください。",
      createCloneNow: "今すぐ新しい音声を作成",
      showingCount: "{count} 件の音声を表示中",
      close: "閉じる",
      regionAccentLabel: "地域 / アクセント",
      filterBtn: "フィルター",
      filterCount: "フィルター ({count})",
      sortLabel: "並び替え",
      genderLabel: "性別",
      styleLabel: "スタイル",
      modelLabel: "モデル",
      resetFilters: "リセット",
      clearAll: "すべてクリア",
      removeFilter: "このフィルターを削除",
      styleNatural: "自然",
      styleStory: "朗読・物語",
      styleNarration: "ナレーション",
      stylePodcast: "ポッドキャスト",
      styleAd: "広告・CM",
      accentNorth: "北部",
      accentCentral: "中部",
      accentSouth: "南部",
      accentUs: "アメリカ英語",
      accentUk: "イギリス英語",
      accentAu: "オーストラリア英語",
      voiceCount: "{count} 音声",
      selectLanguageFirst: "先に言語を選択",
      noAccentFilterForLanguage: "この言語には地域フィルターがありません",
      accentFilterLabel: "地域 / アクセント",
      sourceFilterLabel: "ソース",
      allSources: "すべて",
      groupOnline: "オンライン",
      groupLocal: "ローカル",
      groupMyVoices: "マイボイス",
      sourceEdge: "Edge TTS",
      sourceOpenAi: "OpenAI TTS",
      sourceGoogle: "Google TTS",
      sourceLocal: "Local",
      sourceClone: "Clone",
      notConfigured: "未設定",
      unavailable: "利用不可",
      badgeEdge: "Edge",
      badgeOpenAi: "OpenAI",
      badgeGoogle: "Google",
      badgeLocal: "Local",
      badgeClone: "Clone",
      categoryFilterLabel: "スタイル",
      styleFilterLabel: "スタイル",
      genderFilterLabel: "性別",
      ageFilterLabel: "年齢",
      clearAllFilters: "すべてのフィルターをクリア",
      emptyTitle: "音声が見つかりません。",
      emptyDesc: "条件に一致する音声が見つかりませんでした。",
      createVoiceCta: "音声を作成",
      resetFiltersBtn: "フィルターをリセット",
      allLanguages: "すべての言語",
      allAccents: "すべてのアクセント",
      allCategories: "すべて",
      allStyles: "すべて",
      allGenders: "すべての性別",
      allAges: "すべての年齢層",
      searchInsideDropdown: "検索...",
      styleConversational: "対話",
      styleAdvertising: "広告",
      previewVoice: "プレビュー",
      previewLoading: "読み込み中",
      stopPreview: "停止",
      openAiNotConfigured: "OpenAI TTSが設定されていません。",
      previewError: "プレビューの再生に失敗しました。",
    },
    clone: {
      title: "音声クローン作成 (Voice Clone)",
      subtitle: "短いリファレンス音声から自然な音声を複製します。",
      step1: "1. 音声サンプル",
      step2: "2. 設定",
      step3: "3. 試聴",
      step4: "4. 保存",
      box1Title: "1. サンプル音声ファイル",
      recDuration: "推奨録音時間: 10秒〜30秒",
      changeFile: "ファイル変更",
      safeStorageNote: "サンプル音声はローカルに安全に保存されます。",
      box2Title: "2. モデルと言語",
      cloneModel: "クローンモデル",
      availLangs: "対応言語",
      box3Title: "3. テスト読み上げ",
      testPrompt: "テストテキスト:",
      genPreviewBtn: "試聴サンプル作成",
      readyPreview: "生成完了 ({dur}秒) • 再生可能",
      box4Title: "4. 情報と保存",
      displayName: "表示名",
      tags: "タグ",
      tagsHelper: "カンマ区切りで入力すると検索しやすくなります。",
      permanentSaveNote: "ローカル音声ライブラリに保存されます。",
      saveToLibrary: "ライブラリに保存",
    },
    library: {
      title: "音声ライブラリ",
      subtitle: "プロジェクト用音声の管理、検索、再利用。",
      searchPlaceholder: "音声名またはタグで検索...",
      filterAll: "すべて ({count})",
      filterCloned: "クローン ({count})",
      filterPreset: "プリセット ({count})",
      filterOnline: "オンライン ({count})",
      useVoice: "この声を使用 →",
      sampleSec: "サンプル {dur}秒",
    },
    transcription: {
      title: "字幕",
      subtitle: "音声または動画から字幕を生成",
      dropTitle: "ここに音声または動画をドラッグ＆ドロップ",
      dropDesc: "ここにファイルをドロップ",
      chooseFile: "ファイルを選択",
      trySample: "サンプルファイルで試す",
      supportedFormats: "音声 (WAV, MP3, FLAC, M4A) • 動画 (MP4, MOV, MKV, WEBM)",
      emptyDesc: "VoxLabは音声を自動認識し、タイムスタンプ付き字幕を生成します。",
      fileReady: "ファイル準備完了",
      changeFile: "ファイル変更",
      removeFile: "ファイル削除",
      createSubtitles: "字幕を生成",
      processingTitle: "字幕を生成中...",
      speechRecognition: "音声認識",
      processedTime: "{current} / {total} 処理完了",
      cancel: "キャンセル",
      asrSettings: "音声認識設定",
      asrSettingsDesc: "ローカルハードウェア上で実行される音声認識モデル。",
      modelLabel: "認識モデル",
      whisperModelTurbo: "Large-V3-Turbo（バランス）",
      whisperModelLarge: "Large-V3（高精度・高性能PC）",
      whisperModelMedium: "Medium（低負荷）",
      langAudio: "言語",
      autoDetect: "自動検出",
      advancedOptions: "詳細オプション",
      device: "デバイス",
      precision: "精度",
      vad: "VAD",
      exportTxt: "TXT 出力",
      exportSrt: "SRT 出力",
      sendToTts: "音声読み上げ作成",
      sendToDubbing: "翻訳・吹き替え",
      subtitleSettingsTitle: "字幕設定",
      recognitionGroupTitle: "音声認識",
      displayGroupTitle: "表示設定",
      speechSpeedLabel: "音声速度",
      speechSpeedDesc: "認識精度向上のため音声を減速（タイムスタンプは元動画に自動逆換算）",
      speechSpeedNormal: "標準",
      speechSpeedFast: "速い",
      speechSpeedVeryFast: "とても速い",
      processingSpeedLabel: "処理速度",
      aspectRatioLabel: "アスペクト比",
      maxLinesLabel: "最大行数",
      invalidationNotice: "認識設定が変更されたため、前回の結果をリセットしました。",
      cueCount: "{count} 件の字幕",
      activeCue: "再生中",
      clickToEdit: "クリックして字幕テキストを編集",
      errorTitle: "字幕生成に失敗しました",
      errorRetry: "再試行",
      unsupportedFile: "サポートされていないファイル形式です。音声または動画を選択してください。",
      noAudioStream: "動画内に音声トラックが見つかりません。",
      recognitionFailed: "認識モデルを読み込めませんでした。モデル設定を確認してください。",
      modeSegments: "タイムスタンプ付き",
      modeContinuous: "連続テキスト",
      changeMedia: "ファイル変更",
      fileReadyDesc: "音声を認識して字幕を生成する準備が整いました。",
      togglePanel: "音声認識設定",
    },
    history: {
      title: "制作履歴",
      subtitle: "生成済み音声および文字起こしセッションの管理。",
      openOutputFolder: "出力先を開く",
      colTitle: "セッション名 / タイトル",
      colType: "種類",
      colDuration: "長さ",
      colChunks: "文数",
      colTime: "作成日時",
      colStatus: "ステータス",
      colActions: "操作",
      resume: "再開",
      completed: "完了",
      interrupted: "中断",
      failed: "失敗",
    },
    settings: {
      title: "ストレージとデータ",
      subtitle: "アプリのデータルートおよびキャッシュの管理。",
      storageTitle: "VoxLab データフォルダ",
      storageDesc: "データベース、履歴、音声、キャッシュがここに保存されます。",
      changeDir: "フォルダ変更...",
      cacheTitle: "キャッシュクリア",
      clearCache: "一時キャッシュを削除",
      clearCacheDesc: "一時的な音声チャンクを削除します。書き出し済みファイルには影響しません。",
      clearHistory: "履歴を削除",
      clearHistoryDesc: "セッション一覧のみクリアします。ディスク上の音声ファイルは保護されます。",
    },
    audioPlayer: {
      chunkPrefix: "チャンク",
      play: "再生",
      pause: "一時停止",
      rewind5s: "5秒戻る",
      forward5s: "5秒進む",
      speed: "速度",
      seekWaveform: "クリックまたはドラッグしてシーク",
      volume: "音量",
      mute: "ミュート",
      unmute: "ミュート解除",
      download: "音声ダウンロード (.wav)",
      close: "プレーヤーを閉じる",
    },
    normalizerModal: {
      title: "テキスト正規化",
      subtitle: "音声生成前にテキストを整形およびクリーンアップ",
      rulesTitle: "正規化ルール",
      selectAll: "すべて選択",
      deselectAll: "すべて解除",
      restoreDefault: "初期値に戻す",
      beforeTitle: "元のテキスト",
      afterTitle: "正規化プレビュー",
      noChanges: "変更なし",
      changesCount: "件の変更",
      charsUnit: "文字",
      wordsUnit: "単語",
      cancel: "キャンセル",
      applyChanges: "{count} 件の変更を適用",
      applyNoChanges: "適用する変更がありません",
      appliedToast: "テキスト正規化が正常に適用されました",
      undoNormalize: "正規化を元に戻す",
    },
  },

  zh: {
    topbar: {
      title: "VOXLAB",
      projectTitle: "科技播客剧本 第12集",
      saved: "已保存",
      local: "本地",
      onlineActive: "在线服务激活",
      langTitle: "界面语言",
      themeTitle: "主题明暗",
      settingsTitle: "系统设置",
    },
    nav: {
      primaryWorkspaces: "主要工作区",
      tts: "Text to Speech",
      ttsDesc: "长篇剧本与语音合成",
      dialogue: "多角色对话",
      dialogueDesc: "多角色对话生成",
      clone: "Voice Clone",
      cloneDesc: "克隆新声音",
      library: "Voice Library",
      libraryDesc: "声音库管理与复用",
      dubbing: "翻译与配音",
      dubbingDesc: "字幕翻译与配音制作",
      batch: "批量处理",
      batchDesc: "批量队列自动调度器",
      transcription: "字幕",
      transcriptionDesc: "从音频/视频生成字幕",
      utility: "实用工具",
      history: "历史记录",
      settings: "设置",
      activeEngine: "运行引擎",
      collapse: "收起",
      expand: "展开",
      collapseSidebar: "折叠侧边栏",
      expandSidebar: "展开侧边栏",
    },
    tts: {
      prepStage: "脚本编辑",
      studioStage: "语音生成",
      comfortable: "舒适",
      compact: "紧凑",
      editText: "修改文本",
      splitAndStudio: "分句并进入工作台",
      normalize: "文本规范化",
      aiPunctuation: "AI 标点补全",
      aiPauses: "AI 停顿优化",
      restoreOriginal: "恢复原文",
      regenInvalid: "重新生成 {count} 句",
      generateAll: "全部生成 ({count})",
      generateAudio: "生成音频",
      sentencesCount: "{count} 句",
      errorsCount: "{count} 个错误",
      needsRegenCount: "{count} 句需要重新生成",
      pauseOverride: "停顿: {ms}ms",
      exportAudio: "导出音频",
      chars: "字符",
      words: "词",
      estAudio: "预计音频",
      chunkSummary: "剧本共 {count} 句",
      protectedSpanNote: "自动保护数字、时间戳及技术格式不受破坏。",
      ready: "就绪",
      modified: "已修改",
      generating: "生成中...",
      pending: "等待中",
      failed: "失败",
      preview: "试听",
      regenerateChunk: "重新生成",
      retry: "重试",
      chunkModifiedWarning: "音频与修改后的文本不匹配。",
      pauseAfter: "句末停顿:",
      autoPause: "自动 (~400ms)",
      fullySynced: "已完全同步",
    },
    inspector: {
      title: "声音与设置",
      globalTab: "全局",
      chunkTab: "分句 #{index}",
      primaryVoice: "主声音",
      voicesReady: "{count} 个声音可用",
      changeVoice: "更换声音",
      localBadge: "本地",
      model: "模型",
      settings: "设置",
      defaultBtn: "默认",
      advanced: "高级设置",
      resetSettings: "重置",
      speed: "语速",
      normal: "标准",
      pitch: "音调",
      low: "低沉",
      high: "高亢",
      volume: "音量",
      processingSpeed: "处理速度",
      speed1x: "1x · 默认",
      speed2x: "2x · 快速",
      speed3x: "3x · 高性能",
      speed4x: "4x · 最大",
      processingSpeedHelper: "提高处理级别将同时渲染更多段落并占用更多显存。实际速度取决于模型、GPU 和内容。",
      resetSettingsTooltip: "重置语音设置",
      exportSrt: "生成SRT字幕",
      exportSrtDesc: "与音频文件一同生成.srt文件。",
      optimizeClarity: "优化语音清晰度",
      optimizeClarityDesc: "应用保调微拉伸算法，在模型语速过快时减少字词黏连现象。",
      batchConcurrency: "并发批处理",
      batchConcurrencyHelper: "同时渲染的音频线程数。配备独立显卡推荐 2-4 线程。",
      emotion: "情绪",
      emotionNatural: "自然",
      emotionExpressive: "富有表现力",
      emotionFormal: "庄重 / 新闻",
      emotionEnergetic: "欢快活力",
      emotionNotSupported: "当前模型不支持调整情绪风格。",
      pausesTitle: "停顿设置",
      segmentPauseTitle: "段落间停顿时间",
      min: "最小",
      max: "最大",
      punctuationPausesTitle: "标点符号停顿",
      comma: "逗号 ( , )",
      period: "句号 ( . )",
      questionExclamation: "问号 / 感叹号 ( ? ! )",
      colonSemicolon: "冒号 / 分号 ( : ; )",
      pauseBetween: "段落间停顿时间:",
      pausesHelper: "自动在标点符号后插入停顿，营造自然呼吸感。",
      sec: "秒",
      ms: "毫秒 (ms)",
      voiceOverrideForSentence: "此句独立声音",
      fromLibrary: "从声音库选择 →",
      useGlobalVoice: "(使用全局声音: {name})",
      pauseAfterSentence: "此句末停顿",
      useGlobalSettings: "恢复全局设置",
      clickSentenceHint: "点击列表中的分句以单独调整设置。",
    },
    jobbar: {
      generating: "正在合成音频",
      generatingShort: "正在生成",
      pausedStatus: "已暂停",
      completedStatus: "已完成",
      errorStatus: "出错了",
      retry: "重试",
      chunkOf: "第 {current}/{total} 句 ({percent}%)",
      elapsed: "已用时: {time}",
      eta: "预计剩余: ~{time}",
      synthesisProgress: "合成进度",
      completedSummary: "已完成 · {count} 句",
      remainingShort: "剩余 ~{time}",
      pause: "暂停",
      resume: "继续",
      cancel: "取消",
      openFolder: "打开文件夹",
      gpuReady: "GPU: 就绪",
    },
    voiceModal: {
      title: "选择声音",
      tabSystem: "系统声音",
      tabMyVoices: "我的克隆",
      tabFavorites: "我的收藏",
      cloneNew: "创建新声音",
      searchPlaceholder: "按声音名称、地区、风格搜索...",
      langLabel: "语言:",
      all: "全部",
      male: "男声",
      female: "女声",
      popular: "热门",
      recent: "最近",
      newest: "最新",
      alphabetical: "A–Z",
      uses: "次使用",
      currentlyUsed: "使用中",
      useThis: "使用此声音 →",
      emptyTitleFav: "暂无收藏声音",
      emptyDescFav: "点击声音卡片上的爱心图标即可加入收藏。",
      emptyTitleMy: "暂无克隆声音",
      emptyDescMy: "上传一段 10-30 秒的短音频即可克隆您的专属声音。",
      emptyTitleSearch: "未找到匹配声音",
      emptyDescSearch: "请尝试调整筛选条件或点击重置查看所有声音。",
      createCloneNow: "立即创建新声音",
      showingCount: "显示 {count} 个声音",
      close: "关闭",
      regionAccentLabel: "地区 / 口音",
      filterBtn: "筛选",
      filterCount: "筛选 ({count})",
      sortLabel: "排序方式",
      genderLabel: "性别",
      styleLabel: "风格",
      modelLabel: "模型",
      resetFilters: "重置",
      clearAll: "清除全部",
      removeFilter: "移除此筛选",
      styleNatural: "自然",
      styleStory: "讲故事",
      styleNarration: "旁白解说",
      stylePodcast: "播客",
      styleAd: "广告宣传",
      accentNorth: "北方口音",
      accentCentral: "中部口音",
      accentSouth: "南方口音",
      accentUs: "美式英语",
      accentUk: "英式英语",
      accentAu: "澳式英语",
      voiceCount: "{count} 个声音",
      selectLanguageFirst: "请先选择语言",
      noAccentFilterForLanguage: "此语言暂无地区筛选",
      accentFilterLabel: "地区 / 口音",
      sourceFilterLabel: "来源",
      allSources: "全部",
      groupOnline: "在线",
      groupLocal: "本地",
      groupMyVoices: "我的声音",
      sourceEdge: "Edge TTS",
      sourceOpenAi: "OpenAI TTS",
      sourceGoogle: "Google TTS",
      sourceLocal: "Local",
      sourceClone: "Clone",
      notConfigured: "未配置",
      unavailable: "不可用",
      badgeEdge: "Edge",
      badgeOpenAi: "OpenAI",
      badgeGoogle: "Google",
      badgeLocal: "Local",
      badgeClone: "Clone",
      categoryFilterLabel: "风格",
      styleFilterLabel: "风格",
      genderFilterLabel: "性别",
      ageFilterLabel: "年龄",
      clearAllFilters: "清除所有筛选",
      emptyTitle: "未找到匹配的声音。",
      emptyDesc: "未找到与此搜索和筛选条件匹配的声音。",
      createVoiceCta: "创建新声音",
      resetFiltersBtn: "重置筛选",
      allLanguages: "所有语言",
      allAccents: "所有口音",
      allCategories: "全部",
      allStyles: "全部",
      allGenders: "所有性别",
      allAges: "所有年龄段",
      searchInsideDropdown: "搜索...",
      styleConversational: "对话",
      styleAdvertising: "广告",
      previewVoice: "试听",
      previewLoading: "加载中",
      stopPreview: "停止",
      openAiNotConfigured: "OpenAI TTS 未配置。",
      previewError: "播放试听音频失败。",
    },
    clone: {
      title: "创建声音克隆 (Voice Clone)",
      subtitle: "从短参考音频中克隆出自然的专属声音。",
      step1: "1. 样本音频",
      step2: "2. 配置",
      step3: "3. 试听",
      step4: "4. 保存",
      box1Title: "1. 参考音频文件",
      recDuration: "推荐时长: 10秒 – 30秒",
      changeFile: "更改文件",
      safeStorageNote: "VoxLab 将安全保存您的参考音频资产。",
      box2Title: "2. 模型与语言",
      cloneModel: "克隆模型",
      availLangs: "支持语言",
      box3Title: "3. 试听声音样本",
      testPrompt: "测试文本:",
      genPreviewBtn: "生成试听样本",
      readyPreview: "已生成试听 ({dur}秒) • 准备就绪",
      box4Title: "4. 信息与保存",
      displayName: "显示名称",
      tags: "分类标签",
      tagsHelper: "使用逗号分隔标签以便在声音库中检索。",
      permanentSaveNote: "声音将永久保存到本地声音库中。",
      saveToLibrary: "保存到声音库",
    },
    library: {
      title: "声音库",
      subtitle: "管理、检索并复用您的各种配音样本。",
      searchPlaceholder: "按声音名称或标签搜索...",
      filterAll: "全部 ({count})",
      filterCloned: "克隆声音 ({count})",
      filterPreset: "预设声音 ({count})",
      filterOnline: "在线声音 ({count})",
      useVoice: "使用此声音 →",
      sampleSec: "试听 {dur}秒",
    },
    transcription: {
      title: "字幕",
      subtitle: "从音频或视频生成字幕",
      dropTitle: "将音频或视频拖放到此处",
      dropDesc: "将文件拖放到此处",
      chooseFile: "选择文件",
      trySample: "使用示例文件试用",
      supportedFormats: "音频 (WAV, MP3, FLAC, M4A) • 视频 (MP4, MOV, MKV, WEBM)",
      emptyDesc: "VoxLab 将自动识别语音并生成带时间戳的字幕。",
      fileReady: "文件已就绪",
      changeFile: "更换文件",
      removeFile: "删除文件",
      createSubtitles: "生成字幕",
      processingTitle: "正在生成字幕...",
      speechRecognition: "语音识别",
      processedTime: "{current} / {total} 已处理",
      cancel: "取消",
      asrSettings: "识别设置",
      asrSettingsDesc: "在本地硬件上运行的自动语音识别模型。",
      modelLabel: "识别模型",
      whisperModelTurbo: "Large-V3-Turbo（平衡）",
      whisperModelLarge: "Large-V3（高配置）",
      whisperModelMedium: "Medium（低配置）",
      langAudio: "语言",
      autoDetect: "自动检测",
      advancedOptions: "高级选项",
      device: "设备",
      precision: "精度",
      vad: "VAD",
      exportTxt: "导出 TXT",
      exportSrt: "导出 SRT",
      sendToTts: "生成语音朗读",
      sendToDubbing: "翻译与配音",
      subtitleSettingsTitle: "字幕设置",
      recognitionGroupTitle: "语音识别",
      displayGroupTitle: "字幕显示",
      speechSpeedLabel: "语音速度",
      speechSpeedDesc: "放慢音频以提高识别准确率（时间戳自动映射回原始音频）",
      speechSpeedNormal: "标准",
      speechSpeedFast: "较快",
      speechSpeedVeryFast: "很快",
      processingSpeedLabel: "处理速度",
      aspectRatioLabel: "画幅比例",
      maxLinesLabel: "最大行数",
      invalidationNotice: "识别设置已更改，已重置旧结果。",
      cueCount: "{count} 条字幕",
      activeCue: "正在播放",
      clickToEdit: "点击编辑字幕文本",
      errorTitle: "生成字幕失败",
      errorRetry: "重试",
      unsupportedFile: "不支持的文件格式。请选择音频或视频文件。",
      noAudioStream: "未在视频中找到音轨。",
      recognitionFailed: "无法加载识别模型。请检查模型设置后重试。",
      modeSegments: "时间戳分句",
      modeContinuous: "连续文本",
      changeMedia: "更换文件",
      fileReadyDesc: "已就绪，可开始语音识别并生成字幕。",
      togglePanel: "识别设置",
    },
    history: {
      title: "制作历史",
      subtitle: "管理已生成的配音及语音转文字会话。",
      openOutputFolder: "打开输出文件夹",
      colTitle: "项目 / 会话名称",
      colType: "任务类型",
      colDuration: "时长",
      colChunks: "句数",
      colTime: "创建时间",
      colStatus: "状态",
      colActions: "操作",
      resume: "继续制作",
      completed: "已完成",
      interrupted: "已中断",
      failed: "失败",
    },
    settings: {
      title: "存储与数据",
      subtitle: "管理应用程序数据根目录与临时缓存。",
      storageTitle: "VoxLab 数据根目录",
      storageDesc: "数据库、历史记录、已保存声音和缓存均存放于此。",
      changeDir: "更改目录...",
      cacheTitle: "清理存储空间",
      clearCache: "清理临时缓存",
      clearCacheDesc: "删除临时音频分句，不会影响已导出的正式文件。",
      clearHistory: "清空历史记录",
      clearHistoryDesc: "仅清空历史会话记录列表，磁盘中的音频文件依然完整保留。",
    },
    audioPlayer: {
      chunkPrefix: "句",
      play: "播放",
      pause: "暂停",
      rewind5s: "快退5秒",
      forward5s: "快进5秒",
      speed: "倍速",
      seekWaveform: "点击或拖动快进退",
      volume: "音量",
      mute: "静音",
      unmute: "取消静音",
      download: "下载音频 (.wav)",
      close: "关闭播放器",
    },
    normalizerModal: {
      title: "文本规范化",
      subtitle: "在生成语音前清理并规范化文本",
      rulesTitle: "规范化规则",
      selectAll: "全选",
      deselectAll: "取消全选",
      restoreDefault: "恢复默认",
      beforeTitle: "原始内容",
      afterTitle: "规范化预览",
      noChanges: "无更改",
      changesCount: "处更改",
      charsUnit: "字符",
      wordsUnit: "词",
      cancel: "取消",
      applyChanges: "应用 {count} 处更改",
      applyNoChanges: "无更改可应用",
      appliedToast: "已成功应用文本规范化",
      undoNormalize: "撤销规范化",
    },
  },
};

export const translations = TRANSLATIONS;
