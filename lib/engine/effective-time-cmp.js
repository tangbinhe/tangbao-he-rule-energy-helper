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
  const { rule, chainName, timeCache, delayManager, log, triggerAlarmRecovery } = context;

  log(`[effectiveTimeCmp][${chainName}] 开始检查生效时间`);

  // 辅助：触发恢复并清除整条链的延迟（与 Java 端 handleAlarmRecovery 对齐）
  const handleRecovery = () => {
    if (triggerAlarmRecovery) triggerAlarmRecovery(context);
    if (delayManager) delayManager.clear(chainName);
  };

  // 0. 获取日期和时间配置名称（与 Java 端对齐：分别判断，无配置则跳过）
  const dateName = rule.effectDateName;
  const timeName = rule.effectTimeName;
  const hasDateConfig = !!dateName;
  const hasTimeConfig = !!timeName;

  if (!hasDateConfig && !hasTimeConfig) {
    log(`[effectiveTimeCmp][${chainName}] 日期和时间均未配置, 默认通过`);
    return true;
  }

  // 1. 日期范围判断（仅配置了日期时检查）
  if (hasDateConfig) {
    const dateConfig = timeCache ? timeCache.get(dateName) : null;
    if (!dateConfig) {
      log(`[effectiveTimeCmp][${chainName}] 日期配置不存在: ${dateName}, 不生效`);
      handleRecovery();
      return false;
    }

    if (dateConfig.begin && dateConfig.end) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const startDate = parseDate(dateConfig.begin);
      const endDate = parseDate(dateConfig.end);

      log(`[effectiveTimeCmp][${chainName}] 日期配置: ${dateName}, 范围: ${dateConfig.begin} ~ ${dateConfig.end}`);

      if (now < startDate || now > endDate) {
        log(`[effectiveTimeCmp][${chainName}] 日期范围不满足`);
        handleRecovery();
        return false;
      }
      log(`[effectiveTimeCmp][${chainName}] 日期范围检查通过`);
    }
  }

  // 2. 时间范围判断（仅配置了时间时检查）
  if (hasTimeConfig) {
    const timeConfig = timeCache ? timeCache.get(timeName) : null;
    if (!timeConfig) {
      log(`[effectiveTimeCmp][${chainName}] 时间配置不存在: ${timeName}, 不生效`);
      handleRecovery();
      return false;
    }

  log(`[effectiveTimeCmp][${chainName}] 时间配置: timeName=${timeName}, timeType=${timeConfig.timeType}, ${timeConfig.begin}-${timeConfig.end}`);

  // 4. 时间判断（timeType="2" 表示相对时间/每日时间, timeType="3" 表示日期范围）
  const nowTime = formatTime(new Date());
  const begin = timeConfig.begin;  // "09:16:10"
  const end = timeConfig.end;      // "23:16:10"

  if (!begin || !end) {
    log(`[effectiveTimeCmp][${chainName}] 时间范围不完整, 不生效`);
    handleRecovery();
    return false;
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
    handleRecovery();
    return false;
  }

    log(`[effectiveTimeCmp][${chainName}] 时间检查通过: ${begin} ~ ${end}`);
    return true;
  }

  // 仅配置了日期且通过时，返回 true
  return true;
}

module.exports = { effectiveTimeCmp };
