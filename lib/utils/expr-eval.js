/**
 * 安全表达式计算模块
 * 支持: + - * / > < >= <= == != && ||
 */

/**
 * 安全计算表达式
 * @param {string} expr - 表达式字符串
 * @param {Function} log - 日志函数
 * @returns {boolean|number} 计算结果
 */
function evalExpression(expr, log) {
  log = log || (() => {});

  // 1. 清理表达式
  let sanitized = String(expr).trim();
  log(`[expr-eval] 原始表达式: ${sanitized}`);

  // 2. 替换布尔值
  sanitized = sanitized.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');

  // 3. 替换双等号为单等号用于计算（后面用 eval 风格）
  // 注意：这里保留原始运算符，后面用 new Function 执行

  // 4. 安全检查：只允许数字、运算符、括号、空格、点号
  if (!/^[0-9+\-*/().<>=!&|\s.]+$/.test(sanitized)) {
    throw new Error(`表达式包含非法字符: ${sanitized}`);
  }

  // 5. 使用 Function 安全计算（比 eval 更安全，限制作用域）
  try {
    const result = new Function('return ' + sanitized)();
    log(`[expr-eval] 计算结果: ${result}`);
    return result;
  } catch (e) {
    throw new Error(`表达式计算失败: ${e.message}, 表达式: ${sanitized}`);
  }
}

module.exports = { evalExpression };
