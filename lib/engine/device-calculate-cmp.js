/**
 * 设备条件计算模块
 * 对应 Java 端的 deviceCalculateCmp
 */

const { evalExpression } = require('../utils/expr-eval');

/**
 * 设备条件计算
 * @param {Object} context - 执行上下文
 * @param {Object} context.rule - 规则对象
 * @param {Array} context.pointList - 当前点值列表
 * @param {string} context.chainName - 规则链名称
 * @param {Object} context.delayManager - 延迟管理器实例
 * @param {Function} context.log - 日志函数
 * @param {Function} context.triggerAlarmRecovery - 告警恢复触发函数
 * @returns {boolean} true=条件满足, false=不满足（触发恢复）
 */
function deviceCalculateCmp(context) {
  const { rule, pointList, chainName, delayManager, log, triggerAlarmRecovery, currentStepIndex } = context;

  const total = rule.scripts ? rule.scripts.length : 0;
  const index = currentStepIndex !== undefined ? currentStepIndex : 1;
  const script = rule.scripts && index >= 0 && index < rule.scripts.length ? rule.scripts[index] : null;
  const stepIndex = script ? script.stepIndex : (index + 1);

  log(`[deviceCalculateCmp][${chainName}] 开始设备条件计算, currentStepIndex=${index}, stepIndex=${stepIndex}, total=${total}`);

  // 1. 获取当前步骤的脚本（与 Java 端对齐：scripts.get(index)）
  if (!script) {
    log(`[deviceCalculateCmp][${chainName}] 未找到步骤 ${index} 的脚本`);
    return false;
  }

  if (!pointList || pointList.length === 0) {
    log(`[deviceCalculateCmp][${chainName}] pointList 为空`);
    return false;
  }

  // 2. 构建 pointTypeId -> value 映射
  const pointMap = {};
  for (const p of pointList) {
    if (p.pointTypeId !== undefined && p.pointTypeId !== null) {
      pointMap[String(p.pointTypeId)] = p.value;
    }
  }

  // 3. 替换表达式中的 {pointTypeId}，收集 matchPoints（与 Java 端对齐：缺失点位不替换）
  const matchPoints = [];
  let expr = script.function;
  if (!expr) {
    log(`[deviceCalculateCmp][${chainName}] 脚本无表达式, 默认不满足`);
    return false;
  }
  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    const value = pointMap[ptid];
    if (value !== undefined) {
      const point = pointList.find(p => String(p.pointTypeId) === ptid);
      if (point && !matchPoints.find(mp => mp.pointId === point.pointId)) {
        matchPoints.push(point);
      }
      return value;
    }
    // 与 Java 端对齐：缺失点位不替换，保留 {ptid} 使表达式计算失败
    return match;
  });

  log(`[deviceCalculateCmp][${chainName}] 替换后表达式: ${expr}, matchPoints=${matchPoints.length}`);

  // 4. 计算表达式
  let result;
  try {
    result = evalExpression(expr, log);
    log(`[deviceCalculateCmp][${chainName}] 计算结果: ${result}`);
  } catch (e) {
    log(`[deviceCalculateCmp][${chainName}] 表达式计算错误: ${e.message}`);
    return false;
  }

  // 将结果转为布尔值
  result = Boolean(result);

  // 5. 处理延迟（与 Java 端对齐：per-point 粒度）
  const delay = parseInt(script.delay) || 0;
  if (delay > 0 && result) {
    let firstCalculateDelay = true;
    let lastProcessTimestamp = null;

    for (const point of matchPoints) {
      // 与 Java 端对齐：key 使用 0-based 的 index（nodeIndex），而非 1-based stepIndex
      const key = `${chainName}:${index}:${point.pointId}`;
      const delayInfo = delayManager ? delayManager.get(key) : null;

      if (!delayInfo) {
        // 首次满足，记录时间戳并保存执行上下文快照
        if (delayManager) {
          delayManager.set(key, {
            chainName,
            stepIndex: index,
            pointId: point.pointId,
            processTimestamp: Date.now(),
            delay,
            pointListSnapshot: JSON.parse(JSON.stringify(pointList)),
            ruleSnapshot: {
              chainName: rule.chainName,
              ruleId: rule.ruleId,
              ruleSource: rule.ruleSource,
              elData: rule.elData
            }
          });
        }
        lastProcessTimestamp = Date.now();
      } else {
        firstCalculateDelay = false;
        lastProcessTimestamp = delayInfo.processTimestamp;
      }
    }

    // 与 Java 端对齐：非首次且延迟到期返回 true，否则返回 false（注意 Java 使用 <）
    if (!firstCalculateDelay && lastProcessTimestamp !== null && ((lastProcessTimestamp + delay * 1000) < Date.now())) {
      log(`[deviceCalculateCmp][${chainName}] 延迟已到期, 返回 true`);
      return true;
    } else {
      log(`[deviceCalculateCmp][${chainName}] 延迟未到期或首次计算, 返回 false`);
      return false;
    }
  }

  // 6. 条件不满足（与 Java 端对齐：仅告警类型触发恢复，仅清除当前步骤及后续步骤）
  if (!result) {
    log(`[deviceCalculateCmp][${chainName}] 条件不满足`);
    if (rule.ruleSource === 'alarm' && triggerAlarmRecovery) {
      triggerAlarmRecovery(context);
    }
    if (delayManager) delayManager.clearFromStep(chainName, stepIndex, total, pointList);
  }

  return result;
}

module.exports = { deviceCalculateCmp };
