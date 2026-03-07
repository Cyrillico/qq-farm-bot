(function initUiMeta(globalScope, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  if (globalScope) {
    globalScope.QQFarmUiMeta = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const NAV_GROUPS = Object.freeze([
    { key: 'overview', label: '总览' },
    { key: 'operations', label: '账号运营' },
    { key: 'automation', label: '自动化策略' },
    { key: 'alerts', label: '通知告警' },
    { key: 'audit', label: '审计日志' },
  ]);

  const VIEW_META = Object.freeze({
    'account-home': {
      key: 'account-home',
      title: '账号总览',
      hint: '查看账号分布、实时快照、稳定性与效率排行。',
      group: 'overview',
      primaryAction: { label: '查看账号设置', targetId: 'editAccountBtn', fallbackView: 'account-settings' },
      emptyState: '暂无账号，请先新增并启动账号。',
      loadingState: '正在汇总账号运营数据...',
    },
    'account-lands': {
      key: 'account-lands',
      title: '土地详情',
      hint: '查看每块土地的作物、生长阶段和需处理状态。',
      group: 'operations',
      primaryAction: { label: '刷新土地详情', targetId: 'refreshLandsBtn', fallbackView: 'account-lands' },
      emptyState: '暂无土地数据，请先启动账号并刷新。',
      loadingState: '正在加载土地详情...',
    },
    'account-bag': {
      key: 'account-bag',
      title: '背包页',
      hint: '按数量、可售状态与参考价格查看当前背包。',
      group: 'operations',
      primaryAction: { label: '刷新背包', targetId: 'refreshBagBtn', fallbackView: 'account-bag' },
      emptyState: '暂无背包数据，请刷新背包。',
      loadingState: '正在加载背包数据...',
    },
    'account-daily-gifts': {
      key: 'account-daily-gifts',
      title: '每日礼包',
      hint: '聚焦待处理礼包与最近执行结果，支持一键全部执行。',
      group: 'automation',
      primaryAction: { label: '一键全部执行', targetId: 'claimAllDailyGiftsBtn', fallbackView: 'account-daily-gifts' },
      emptyState: '暂无礼包状态，请刷新礼包状态。',
      loadingState: '正在加载礼包状态...',
    },
    'account-analytics': {
      key: 'account-analytics',
      title: '数据分析',
      hint: '按经验、收益、利润等维度查看作物排行。',
      group: 'automation',
      primaryAction: { label: '刷新分析', targetId: 'refreshAnalyticsBtn', fallbackView: 'account-analytics' },
      emptyState: '暂无分析数据，请刷新分析。',
      loadingState: '正在加载分析排行...',
    },
    'account-settings': {
      key: 'account-settings',
      title: '账号设置',
      hint: '配置账号、平台、模式、策略项与二维码登录设置。',
      group: 'operations',
      primaryAction: { label: '新增账号', targetId: 'newAccountBtn', fallbackView: 'account-settings' },
      emptyState: '暂无账号配置，请先新增账号。',
      loadingState: '正在加载账号配置...',
    },
    'account-friends': {
      key: 'account-friends',
      title: '好友操作',
      hint: '执行好友列表操作并管理高风险动作开关。',
      group: 'operations',
      primaryAction: { label: '刷新好友列表', targetId: 'refreshFriendsBtn', fallbackView: 'account-friends' },
      emptyState: '暂无好友数据，请刷新好友列表。',
      loadingState: '正在加载好友列表...',
    },
    'account-bark': {
      key: 'account-bark',
      title: 'Bark 通知',
      hint: '管理 Bark 链接、去重、分类与测试推送。',
      group: 'alerts',
      primaryAction: { label: '保存 Bark 设置', targetId: 'saveBarkBtn', fallbackView: 'account-bark' },
      emptyState: '未配置 Bark 链接。',
      loadingState: '正在加载 Bark 设置...',
    },
    'account-logs': {
      key: 'account-logs',
      title: '账号日志',
      hint: '按级别、标签、关键字与动作筛选日志。',
      group: 'audit',
      primaryAction: { label: '应用筛选', targetId: 'applyLogFiltersBtn', fallbackView: 'account-logs' },
      emptyState: '暂无日志数据。',
      loadingState: '正在加载日志...',
    },
  });

  const VIEW_ALIASES = Object.freeze({
    dashboard: 'account-home',
    overview: 'account-home',
    lands: 'account-lands',
    bag: 'account-bag',
    gifts: 'account-daily-gifts',
    daily: 'account-daily-gifts',
    analytics: 'account-analytics',
    control: 'account-settings',
    settings: 'account-settings',
    status: 'account-home',
    home: 'account-home',
    friends: 'account-friends',
    bark: 'account-bark',
    logs: 'account-logs',
  });

  const DEFAULT_VIEW = 'account-home';
  const VALID_VIEWS = new Set(Object.keys(VIEW_META));

  function getViewMeta(view) {
    const key = typeof view === 'string' ? view : DEFAULT_VIEW;
    return VIEW_META[key] || VIEW_META[DEFAULT_VIEW];
  }

  return {
    NAV_GROUPS,
    VIEW_META,
    VIEW_ALIASES,
    DEFAULT_VIEW,
    VALID_VIEWS,
    getViewMeta,
  };
});
