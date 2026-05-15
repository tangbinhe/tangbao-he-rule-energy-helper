/**
 * 生效时间判断模块
 * 对应 Java 端的 effectiveTimeCmp
 */

/**
 * 格式化时间为 HH:mm:ss
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * 解析日期字符串
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDate(dateStr) {
  // 支持 yyyy-MM-dd 格式
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  return new Date(dateStr);
}

/**
 * 生效时间判断
 * @param {Object} context - 执行上下文
 * @param {Object} context.rule - 规则对象
 * @param {string} context.chainName - 规则链名称
 * @param {Object} context.timeCache - 时间配置缓存实例
 * @param {Function} context.log - 日志函数
 * @param {Function} context.triggerAlarmRecovery - 告警恢复触发函数
 * @returns {boolean} true=生效, false=不生效（触发恢复）
 */
function effectiveTimeCmp(context) {
  const { rule, chainName, timeCache, log, triggerAlarmRecovery } = context;

  log(`[effectiveTimeCmp][${chainName}] 开始检查生效时间`);

  // 1. 获取时间配置名称
  const timeName = rule.effectTimeName;
  if (!timeName) {
    log(`[effectiveTimeCmp][${chainName}] 无生效时间配置, 默认通过`);
    return true;
  }

  // 2. 从缓存获取时间配置
  const timeConfig = timeCache ? timeCache.get(timeName) : null;
  if (!timeConfig) {
    log(`[effectiveTimeCmp][${chainName}] 时间配置不存在: ${timeName}, 默认通过`);
    return true;
  }

  log(`[effectiveTimeCmp][${chainName}] 时间配置: timeName=${timeName}, timeType=${timeConfig.timeType}, ${timeConfig.begin}-${timeConfig.end}`);

  // 3. 日期判断（timeType="3" 表示日期范围）
  if (timeConfig.timeType === '3' && timeConfig.begin && timeConfig.end) {
    const now = new Date();
    const startDate = parseDate(timeConfig.begin);
    const endDate = parseDate(timeConfig.end);
    // 结束日期设为当天最后一毫秒
    endDate.setHours(23, 59, 59, 999);

    log(`[effectiveTimeCmp][${chainName}] 日期范围: ${timeConfig.begin} ~ ${timeConfig.end}, 当前: ${now.toISOString().split('T')[0]}`);

    if (now < startDate || now > endDate) {
      log(`[effectiveTimeCmp][${chainName}] 日期不满足`);
      if (triggerAlarmRecovery) triggerAlarmRecovery(context);
      return false;
    }
  }

  // 4. 时间判断（timeType="2" 表示相对时间/每日时间）
  const nowTime = formatTime(new Date());
  const begin = timeConfig.begin;  // "09:16:10"
  const end = timeConfig.end;      // "23:16:10"

  if (!begin || !end) {
    log(`[effectiveTimeCmp][${chainName}] 时间范围不完整, 默认通过`);
    return true;
  }

  log(`[effectiveTimeCmp][${chainName}] 时间范围: ${begin} ~ ${end}, 当前: ${nowTime}`);

  let result;
  if (begin <= end) {
    // 正常区间 09:00-18:00
    result = (nowTime >= begin && nowTime <= end);
  } else {
    // 跨天区间 21:00-06:00
    result = (nowTime >= begin || nowTime <= end);
  }

  if (!result) {
    log(`[effectiveTimeCmp][${chainName}] 时间不满足: ${begin} ~ ${end}, 当前: ${nowTime}`);
    if (triggerAlarmRecovery) triggerAlarmRecovery(context);
    return false;
  }

  log(`[effectiveTimeCmp][${chainName}] 时间检查通过: ${begin} ~ ${end}`);
  return true;
}

module.exports = { effectiveTimeCmp };
