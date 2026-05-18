/**
 * 告警输出模块
 * 对应 Java 端的 alarmCmp
 */

const crypto = require('crypto');

/**
 * 生成 UUID
 * @returns {string}
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 计算 MD5
 * @param {string} str
 * @returns {string}
 */
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * 告警输出
 * @param {Object} context - 执行上下文
 * @param {Object} context.rule - 规则对象
 * @param {Array} context.pointList - 当前点值列表
 * @param {string} context.chainName - 规则链名称
 * @param {Function} context.log - 日志函数
 * @param {Map} context.alarmStateCache - 告警状态缓存（Map 实例）
 * @returns {Object|null} 告警输出消息对象
 */
function alarmCmp(context) {
  const { rule, pointList, chainName, log, alarmStateCache } = context;

  log(`[alarmCmp][${chainName}] 开始告警输出`);

  // 1. 获取告警输入点位（dataType="in" 的点）
  const alarmPointTypes = rule.rulePointTypes.filter(rpt => rpt.dataType === 'in');
  if (!alarmPointTypes || alarmPointTypes.length === 0) {
    log(`[alarmCmp][${chainName}] 未找到告警输入点位`);
    return null;
  }

  const outputs = [];

  for (const alarmPointType of alarmPointTypes) {
    // 从 pointList 中找到对应点位的当前值
    const point = pointList.find(p => String(p.pointTypeId) === String(alarmPointType.pointTypeId));
    if (!point) {
      log(`[alarmCmp][${chainName}] 点列表中无告警点位 pointTypeId=${alarmPointType.pointTypeId}`);
      continue;
    }

    // 2. 告警去重检查
    const alarmKey = `${chainName}:${point.pointId}`;
    if (alarmStateCache && alarmStateCache.has(alarmKey)) {
      log(`[alarmCmp][${chainName}] 告警已存在, 跳过: pointId=${point.pointId}`);
      continue;
    }

    // 3. 构建告警
    const alarmId = generateUUID();
    const conditionId = `${chainName}_${md5(chainName)}`;

    const alarmTime = Date.now();
    const output = {
      type: 'alarm',
      chainName,
      ruleId: rule.ruleId,
      alarmId,
      conditionId,
      alarmStatus: 'offnormal',
      alarmTime,
      priority: rule.priority || '3',
      pointId: point.pointId,
      slotPath: point.slotPath,
      alarmValue: point.value,
      alarmDesc: rule.alarmDesc || '',
      pointTypeId: alarmPointType.pointTypeId,
      timestamp: Date.now()
    };

    // 4. 记录告警状态（保存完整告警消息，用于恢复时输出）
    if (alarmStateCache) {
      alarmStateCache.set(alarmKey, {
        alarmId,
        alarmTime,
        timestamp: Date.now(),
        alarmMessage: output
      });
    }

    log(`[alarmCmp][${chainName}] 新建告警: alarmId=${alarmId}, pointId=${point.pointId}, priority=${output.priority}`);
    outputs.push(output);
  }

  if (outputs.length === 0) {
    return null;
  }

  // 返回第一个告警（如果只有一个）或告警数组
  return outputs.length === 1 ? outputs[0] : outputs;
}

module.exports = { alarmCmp };
