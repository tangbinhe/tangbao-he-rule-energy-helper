/**
 * 执行链解析器
 * 将 elData（如 <chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>）
 * 解析为 AST（抽象语法树）
 */

/**
 * 解析执行链表达式为 AST
 * @param {string} elData - 原始执行链数据
 * @param {Function} log - 日志函数
 * @returns {Object} AST 根节点
 */
function parseChain(elData, log) {
  log = log || (() => {});

  log(`[chain-parser] 解析执行链: ${elData}`);

  // 1. 提取 <chain>...</chain> 内容
  const match = elData.match(/<chain>(.*)<\/chain>/s);
  if (!match) {
    throw new Error('执行链格式错误，未找到 <chain> 标签');
  }
  const expr = match[1].trim();
  log(`[chain-parser] 提取表达式: ${expr}`);

  // 2. 解析为 AST
  const ast = parseExpression(expr);

  log(`[chain-parser] 解析完成, AST: ${JSON.stringify(ast)}`);
  return ast;
}

/**
 * 递归解析表达式为 AST
 * @param {string} expr
 * @returns {Object}
 */
function parseExpression(expr) {
  expr = expr.trim();

  if (!expr) {
    return null;
  }

  // 检查是否是函数调用: name(...)
  const funcMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/s);
  if (funcMatch) {
    const name = funcMatch[1];
    const argsStr = funcMatch[2];
    const args = splitArgs(argsStr);
    return {
      type: 'function',
      name: name,
      args: args.map(arg => parseExpression(arg))
    };
  }

  // 检查是否是 bare name（函数引用，如 effectiveTimeCmp）
  const bareNameMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (bareNameMatch) {
    return {
      type: 'function',
      name: bareNameMatch[1],
      args: []
    };
  }

  // 字面量（数字或字符串）
  return {
    type: 'literal',
    value: expr
  };
}

/**
 * 按逗号分隔参数，但忽略嵌套括号内的逗号
 * @param {string} str
 * @returns {string[]}
 */
function splitArgs(str) {
  const args = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

/**
 * 递归执行 AST
 * @param {Object} ast - AST 节点
 * @param {Object} context - 执行上下文
 * @param {Object} cmpMap - cmp 函数映射 { name: function }
 * @param {Function} log - 日志函数
 * @returns {any}
 */
function evaluateAst(ast, context, cmpMap, log) {
  log = log || (() => {});

  if (!ast) {
    return null;
  }

  if (ast.type === 'literal') {
    return ast.value;
  }

  if (ast.type === 'function') {
    // 内置函数 IF
    if (ast.name === 'IF') {
      if (ast.args.length < 2) {
        throw new Error('IF 函数至少需要 2 个参数');
      }
      const condition = evaluateAst(ast.args[0], context, cmpMap, log);
      log(`[chain-parser] IF 条件结果: ${condition}`);
      if (condition) {
        return evaluateAst(ast.args[1], context, cmpMap, log);
      } else if (ast.args[2]) {
        return evaluateAst(ast.args[2], context, cmpMap, log);
      }
      return { outputs: [] };
    }

    // 内置函数 AND
    if (ast.name === 'AND') {
      for (const arg of ast.args) {
        const result = evaluateAst(arg, context, cmpMap, log);
        if (!result) {
          return false;
        }
      }
      return true;
    }

    // 内置函数 OR
    if (ast.name === 'OR') {
      for (const arg of ast.args) {
        const result = evaluateAst(arg, context, cmpMap, log);
        if (result) {
          return true;
        }
      }
      return false;
    }

    // 自定义 cmp 函数
    const cmpFn = cmpMap[ast.name];
    if (cmpFn) {
      if (!context._nodeStepCount) context._nodeStepCount = 0;
      context.currentStepIndex = context._nodeStepCount++;
      log(`[chain-parser] 执行 cmp: ${ast.name}, stepIndex=${context.currentStepIndex}`);
      return cmpFn(context);
    }

    throw new Error(`未知函数: ${ast.name}`);
  }

  return null;
}

module.exports = {
  parseChain,
  evaluateAst
};
