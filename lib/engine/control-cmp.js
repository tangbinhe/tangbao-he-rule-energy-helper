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
  const { rule, pointList, chainName, log, currentStepIndex } = context;

  const index = currentStepIndex !== undefined ? currentStepIndex : 2;
  const script = rule.scripts && index >= 0 && index < rule.scripts.length ? rule.scripts[index] : null;
  const stepIndex = script ? script.stepIndex : (index + 1);

  log(`[controlCmp][${chainName}] 开始控制输出, currentStepIndex=${index}, stepIndex=${stepIndex}`);

  // 1. 获取当前步骤的脚本（与 Java 端对齐：scripts.get(index)）
  if (!script) {
    log(`[controlCmp][${chainName}] 未找到步骤 ${index} 的执行脚本`);
    return null;
  }

  if (!pointList || pointList.length === 0) {
    log(`[controlCmp][${chainName}] pointList 为空`);
    return null;
  }

  // 2. 构建 pointTypeId -> value 映射
  const pointMap = {};
  for (const p of pointList) {
    if (p.pointTypeId !== undefined && p.pointTypeId !== null) {
      pointMap[String(p.pointTypeId)] = p.value;
    }
  }

  // 3. 计算设定值（替换 {pointTypeId} 后计算，与 Java 端对齐：缺失点位不替换）
  let expr = script.function;
  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    return pointMap[ptid] !== undefined ? pointMap[ptid] : match;
  });

  let value;
  try {
    value = evalExpression(expr, log);
    log(`[controlCmp][${chainName}] 设定值计算: ${expr} = ${value}`);
  } catch (e) {
    log(`[controlCmp][${chainName}] 设定值计算错误: ${e.message}`);
    return null;
  }

  // 4. 找到控制输出点位（与 Java 端对齐：通过 stepId 匹配当前脚本对应的控制点位）
  let controlPoints = [];
  if (script && script.id !== undefined) {
    controlPoints = pointList.filter(p => p.dataType === 'control' && String(p.stepId) === String(script.id));
  }
  // 如果通过 stepId 未找到，回退到所有控制点位
  if (!controlPoints || controlPoints.length === 0) {
    controlPoints = pointList.filter(p => p.dataType === 'control');
  }
  if (!controlPoints || controlPoints.length === 0) {
    log(`[controlCmp][${chainName}] 未找到控制输出点位`);
    return null;
  }

  // 5. 构建输出列表
  const outputs = [];
  for (const controlPoint of controlPoints) {
    outputs.push({
      pointId: controlPoint.pointId,
      slotPath: controlPoint.slotPath,
      value: String(value),
      equipId: controlPoint.equipId,
      pointTypeId: controlPoint.pointTypeId
    });

    log(`[controlCmp][${chainName}] 控制输出: pointId=${controlPoint.pointId}, slotPath=${controlPoint.slotPath}, value=${value}`);
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
