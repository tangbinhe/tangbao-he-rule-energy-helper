/**
 * 规则匹配器
 * 根据触发数据匹配符合条件的规则
 */

function RuleMatcher(cache) {
    this.cache = cache;
}

/**
 * 匹配规则
 * @param {Object} triggerData 触发数据，包含 deviceId, subsystemId, equipTypeId, pointTypeId, value 等
 * @returns {Array} 匹配到的规则列表
 */
RuleMatcher.prototype.match = function(triggerData) {
    var rules = this.cache.getAll();
    var matched = [];
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (this._matchRule(rule, triggerData)) {
            matched.push(rule);
        }
    }
    return matched;
};

/**
 * 判断单条规则是否匹配
 */
RuleMatcher.prototype._matchRule = function(rule, triggerData) {
    if (!rule || rule.ruleStatus !== '1') return false;
    if (!rule.partList || rule.partList.length === 0) return false;

    // 提取规则中的数据源组件（type=4）
    var dataSources = this._getDataSources(rule);
    if (dataSources.length === 0) return false;

    // 触发数据是否匹配任一数据源
    var dataSourceMatched = false;
    for (var i = 0; i < dataSources.length; i++) {
        if (this._matchDataSource(dataSources[i], triggerData)) {
            dataSourceMatched = true;
            break;
        }
    }
    if (!dataSourceMatched) return false;

    // 检查生效时间（type=5）
    var effectiveTimes = this._getEffectiveTimes(rule);
    if (effectiveTimes.length > 0) {
        var timeMatched = false;
        for (var j = 0; j < effectiveTimes.length; j++) {
            if (this._matchEffectiveTime(effectiveTimes[j])) {
                timeMatched = true;
                break;
            }
        }
        if (!timeMatched) return false;
    }

    return true;
};

RuleMatcher.prototype._getDataSources = function(rule) {
    var list = [];
    if (!rule.partList) return list;
    for (var i = 0; i < rule.partList.length; i++) {
        var step = rule.partList[i];
        if (!step.partList) continue;
        for (var j = 0; j < step.partList.length; j++) {
            var item = step.partList[j];
            if (item.type === '4') {
                list.push(item);
            }
        }
    }
    return list;
};

RuleMatcher.prototype._getEffectiveTimes = function(rule) {
    var list = [];
    if (!rule.partList) return list;
    for (var i = 0; i < rule.partList.length; i++) {
        var step = rule.partList[i];
        if (!step.partList) continue;
        for (var j = 0; j < step.partList.length; j++) {
            var item = step.partList[j];
            if (item.type === '5') {
                list.push(item);
            }
        }
    }
    return list;
};

RuleMatcher.prototype._matchDataSource = function(dataSource, triggerData) {
    if (dataSource.subsystemId && dataSource.subsystemId !== triggerData.subsystemId) return false;
    if (dataSource.equipTypeId && dataSource.equipTypeId !== triggerData.equipTypeId) return false;
    if (dataSource.pointTypeId && dataSource.pointTypeId !== triggerData.pointTypeId) return false;
    return true;
};

RuleMatcher.prototype._matchEffectiveTime = function(effectiveTime) {
    var now = new Date();
    // 生效日期检查（简化实现，假设 effectDateName 是工作日/周末等标识，或具体日期范围）
    // 生效时间段检查
    if (effectiveTime.effectTimeName) {
        // 假设 effectTimeName 格式为 "08:00-18:00"
        var timeRange = effectiveTime.effectTimeName;
        if (timeRange.indexOf('-') > 0) {
            var parts = timeRange.split('-');
            var startTime = parts[0].trim();
            var endTime = parts[1].trim();
            var currentTime = this._formatTime(now);
            if (currentTime < startTime || currentTime > endTime) {
                return false;
            }
        }
    }
    return true;
};

RuleMatcher.prototype._formatTime = function(date) {
    var h = date.getHours ? date.getHours() : date.hour();
    var m = date.getMinutes ? date.getMinutes() : date.minute();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
};

module.exports = RuleMatcher;
