/**
 * 规则执行引擎
 * 按步骤执行规则，处理延时，输出结果
 */

var ExprEvaluator = require('./expr-eval');

function RuleExecutor(node) {
    this.node = node;
    this.expr = new ExprEvaluator();
}

/**
 * 执行单条规则
 * @param {Object} rule 规则对象
 * @param {Object} triggerData 触发数据
 * @param {Function} outputCallback 输出回调 (payload)
 * @returns {Promise} 
 */
RuleExecutor.prototype.execute = function(rule, triggerData, outputCallback) {
    var self = this;
    return new Promise(function(resolve) {
        var steps = rule.partList || [];
        if (steps.length === 0) {
            self.node.log('规则 [' + rule.ruleName + '] 无执行步骤，跳过');
            resolve();
            return;
        }

        self.node.log('开始执行规则: [' + rule.ruleName + ']');

        var executeStep = function(stepIndex) {
            if (stepIndex >= steps.length) {
                self.node.log('规则 [' + rule.ruleName + '] 执行完成');
                resolve();
                return;
            }

            var step = steps[stepIndex];
            self.node.log('执行步骤 ' + step.stepIndex + ': ' + step.ruleName);

            // 收集步骤中的变量值（数据源对应值）
            var variables = self._buildVariables(step, triggerData);

            // 依次处理步骤中的组件
            var items = step.partList || [];
            var conditionPassed = true;
            var delayMs = 0;
            var outputActions = [];

            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                try {
                    switch (item.type) {
                        case '4': // 数据源
                            self.node.log('数据源: ' + item.ruleName + ' = ' + variables[item.ruleName]);
                            break;
                        case '5': // 生效时间
                            self.node.log('生效时间检查: ' + (item.effectDateName || '') + ' ' + (item.effectTimeName || ''));
                            break;
                        case '6': // 判断条件
                            var condResult = self._evaluateCondition(item, variables);
                            conditionPassed = conditionPassed && condResult;
                            self.node.log('判断条件结果: ' + condResult);
                            if (item.delay !== undefined && item.delay !== '') {
                                delayMs = self._parseDelay(item.delay, item.delayType);
                            }
                            break;
                        case '7': // 控制
                            if (conditionPassed) {
                                outputActions.push({
                                    type: 'control',
                                    ruleId: rule.id,
                                    ruleName: rule.ruleName,
                                    ruleType: 'linkage',
                                    subsystemId: item.subsystemId,
                                    equipTypeId: item.equipTypeId,
                                    pointTypeId: item.pointTypeId,
                                    value: item.function,
                                    deviceId: triggerData.deviceId || '',
                                    alarmDesc: rule.ruleDesc || ''
                                });
                            }
                            break;
                        case '8': // 告警
                            if (conditionPassed) {
                                outputActions.push({
                                    type: 'alarm',
                                    ruleId: rule.id,
                                    ruleName: rule.ruleName,
                                    ruleType: 'logical',
                                    equipTypeId: item.equipTypeId,
                                    pointTypeId: item.pointTypeId,
                                    deviceId: triggerData.deviceId || '',
                                    alarmLevel: item.alarmLevel || '',
                                    alarmDesc: item.alarmDesc || rule.ruleDesc || ''
                                });
                            }
                            break;
                    }
                } catch (err) {
                    self.node.error('规则 [' + rule.ruleName + '] 步骤组件执行异常: ' + err.message);
                    conditionPassed = false;
                }
            }

            // 延时后执行输出
            setTimeout(function() {
                if (conditionPassed) {
                    for (var j = 0; j < outputActions.length; j++) {
                        outputCallback(outputActions[j]);
                    }
                } else {
                    self.node.log('规则 [' + rule.ruleName + '] 条件不满足，跳过输出');
                }
                executeStep(stepIndex + 1);
            }, delayMs);
        };

        executeStep(0);
    });
};

RuleExecutor.prototype._buildVariables = function(step, triggerData) {
    var variables = {};
    var items = step.partList || [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.type === '4') {
            // 数据源变量名取 ruleName（如 A, B, C）
            var key = item.ruleName || 'A';
            variables[key] = triggerData.value !== undefined ? triggerData.value : 0;
        }
    }
    return variables;
};

RuleExecutor.prototype._evaluateCondition = function(item, variables) {
    if (item.functionType === '1') {
        // 公式计算
        if (!item.function) return true;
        var result = this.expr.evaluate(item.function, variables);
        return !!result;
    } else {
        // 状态判断
        if (!item.function) return true;
        // 将点位状态与触发数据的值比较
        var currentValue = variables[Object.keys(variables)[0]];
        return String(currentValue) === String(item.function);
    }
};

RuleExecutor.prototype._parseDelay = function(delay, delayType) {
    var val = parseFloat(delay) || 0;
    if (delayType === 1) {
        return val * 60 * 1000; // 分钟转毫秒
    }
    return val * 1000; // 秒转毫秒
};

module.exports = RuleExecutor;
