/**
 * 表达式计算引擎
 * 基于 expr-eval 库，提供安全的数学/逻辑表达式计算
 */

var Parser = require('expr-eval').Parser;

function ExprEvaluator() {
    this.parser = new Parser();
}

/**
 * 计算表达式
 * @param {string} expression 表达式字符串，如 "A > 30 && B < 20"
 * @param {Object} variables 变量字典，如 { A: 35, B: 15 }
 * @returns {boolean|number} 计算结果
 */
ExprEvaluator.prototype.evaluate = function(expression, variables) {
    try {
        // 将 JS 风格的 && || ! 转换为 expr-eval 支持的 and or not
        var expr = expression
            .replace(/&&/g, ' and ')
            .replace(/\|\|/g, ' or ')
            .replace(/!/g, ' not ');

        var result = this.parser.evaluate(expr, variables);
        return result;
    } catch (err) {
        throw new Error('表达式计算失败: ' + err.message + ' | 表达式: ' + expression);
    }
};

/**
 * 验证表达式语法
 * @param {string} expression 表达式字符串
 * @returns {Object} { valid: boolean, error: string|null }
 */
ExprEvaluator.prototype.validate = function(expression) {
    try {
        var expr = expression
            .replace(/&&/g, ' and ')
            .replace(/\|\|/g, ' or ')
            .replace(/!/g, ' not ');
        this.parser.parse(expr);
        return { valid: true, error: null };
    } catch (err) {
        return { valid: false, error: err.message };
    }
};

module.exports = ExprEvaluator;
