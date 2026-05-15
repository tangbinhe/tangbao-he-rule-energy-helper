/**
 * 控制输出模块
 * 对应 Java 端的 controlCmp
 */

const { evalExpression } = require('../utils/expr-eval');

/**
 * 控制输出
 * @param {Object} context - 执行上下文
 * @param {Object} context.rule - 规则对象
 * @param {Array} context.pointList - 当前点值列表
 * @param {string} context.chainName - 规则链名称
 * @param {Function} context.log - 日志函数
 * @returns {Object|null} 控制输出消息对象
 */
function controlCmp(context) {
  const { rule, pointList, chainName, log } = context;

  // 自动查找 stepType="3" 的执行脚本
  const script = rule.scripts.find(s => s.stepType === '3');
  const stepIndex = script ? script.stepIndex : 3;

  log(`[controlCmp][${chainName}] 开始控制输出, stepIndex=${stepIndex}`);

  // 1. 获取当前步骤的脚本
  if (!script) {
    log(`[controlCmp][${chainName}] 未找到 stepType=3 的执行脚本`);
    return null;
  }

  // 2. 构建 pointTypeId -> value 映射
  const pointMap = {};
  for (const p of pointList) {
    if (p.pointTypeId !== undefined && p.pointTypeId !== null) {
      pointMap[String(p.pointTypeId)] = p.value;
    }
  }

  // 3. 计算设定值（替换 {pointTypeId} 后计算）
  let expr = script.function;
  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    return pointMap[ptid] !== undefined ? pointMap[ptid] : '0';
  });

  let value;
  try {
    value = evalExpression(expr, log);
    log(`[controlCmp][${chainName}] 设定值计算: ${expr} = ${value}`);
  } catch (e) {
    log(`[controlCmp][${chainName}] 设定值计算错误: ${e.message}`);
    return null;
  }

  // 4. 找到控制输出点位（dataType="control" 的点）
  const controlPointTypes = rule.rulePointTypes.filter(rpt => rpt.dataType === 'control');
  if (!controlPointTypes || controlPointTypes.length === 0) {
    log(`[controlCmp][${chainName}] 未找到控制输出点位`);
    return null;
  }

  // 5. 构建输出列表
  const outputs = [];
  for (const controlPointType of controlPointTypes) {
    // 从 equipPoints 中找到对应的设备点位
    const equipPoint = rule.equipPoints.find(ep => ep.pointTypeId === controlPointType.pointTypeId);
    if (!equipPoint) {
      log(`[controlCmp][${chainName}] 未找到 pointTypeId=${controlPointType.pointTypeId} 对应的设备点位`);
      continue;
    }

    outputs.push({
      pointId: equipPoint.pointId,
      slotPath: equipPoint.slotPath,
      value: String(value),
      equipId: equipPoint.equipId,
      pointTypeId: equipPoint.pointTypeId
    });

    log(`[controlCmp][${chainName}] 控制输出: pointId=${equipPoint.pointId}, slotPath=${equipPoint.slotPath}, value=${value}`);
  }

  if (outputs.length === 0) {
    log(`[controlCmp][${chainName}] 无有效控制输出点位`);
    return null;
  }

  // 6. 构建最终输出消息
  return {
    type: 'control',
    chainName,
    ruleId: rule.ruleId,
    outputs,
    timestamp: Date.now()
  };
}

module.exports = { controlCmp };
