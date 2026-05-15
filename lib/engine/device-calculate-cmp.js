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
  const { rule, pointList, chainName, delayManager, log, triggerAlarmRecovery } = context;

  // 自动查找 stepType="1" 的条件脚本
  const script = rule.scripts.find(s => s.stepType === '1');
  const stepIndex = script ? script.stepIndex : 2;

  log(`[deviceCalculateCmp][${chainName}] 开始设备条件计算, stepIndex=${stepIndex}`);

  // 1. 获取当前步骤的脚本
  if (!script) {
    log(`[deviceCalculateCmp][${chainName}] 未找到 stepType=1 的条件脚本`);
    return false;
  }

  // 2. 构建 pointTypeId -> value 映射
  const pointMap = {};
  for (const p of pointList) {
    if (p.pointTypeId !== undefined && p.pointTypeId !== null) {
      pointMap[String(p.pointTypeId)] = p.value;
    }
  }

  // 3. 替换表达式中的 {pointTypeId}
  let expr = script.function;
  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    const value = pointMap[ptid];
    log(`[deviceCalculateCmp][${chainName}] 替换 {${ptid}} → ${value !== undefined ? value : 'undefined(使用0)'}`);
    return value !== undefined ? value : '0';
  });

  log(`[deviceCalculateCmp][${chainName}] 替换后表达式: ${expr}`);

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

  // 5. 处理延迟
  const delay = parseInt(script.delay) || 0;
  if (delay > 0 && result) {
    const key = `${chainName}:${stepIndex}`;
    const delayInfo = delayManager ? delayManager.get(key) : null;

    if (!delayInfo) {
      // 首次满足，记录时间戳
      if (delayManager) {
        delayManager.set(key, {
          chainName,
          stepIndex,
          pointId: pointList[0] ? pointList[0].pointId : null,
          processTimestamp: Date.now(),
          delay
        });
      }
      log(`[deviceCalculateCmp][${chainName}] 首次满足, 延迟 ${delay}s, 记录时间戳, 返回 false`);
      return false;  // 首次返回 false，等待延迟
    } else {
      // 非首次，检查延迟是否到期
      const elapsed = (Date.now() - delayInfo.processTimestamp) / 1000;
      if (elapsed >= delay) {
        log(`[deviceCalculateCmp][${chainName}] 延迟已到期 (${elapsed.toFixed(1)}s >= ${delay}s), 返回 true`);
        return true;
      } else {
        log(`[deviceCalculateCmp][${chainName}] 延迟未到期, 还需 ${(delay - elapsed).toFixed(1)}s, 返回 false`);
        return false;
      }
    }
  }

  // 6. 条件不满足，触发恢复
  if (!result) {
    log(`[deviceCalculateCmp][${chainName}] 条件不满足, 触发告警恢复`);
    if (triggerAlarmRecovery) triggerAlarmRecovery(context);
    if (delayManager) delayManager.clear(chainName);  // 清除延迟状态
  }

  return result;
}

module.exports = { deviceCalculateCmp };
