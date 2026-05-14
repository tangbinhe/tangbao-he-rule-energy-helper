/**
 * 规则缓存管理器
 * 负责规则的内存缓存与本地文件持久化
 */

var fs = require('fs');
var path = require('path');

var CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

function RuleCache(configNodeId) {
    this.configNodeId = configNodeId;
    this.cacheFile = path.join(CACHE_DIR, 'rules_' + configNodeId + '.json');
    this.rules = [];
    this.ruleMap = {}; // 按 ruleId 索引
    this.load();
}

RuleCache.prototype.load = function() {
    try {
        if (fs.existsSync(this.cacheFile)) {
            var data = fs.readFileSync(this.cacheFile, 'utf8');
            this.rules = JSON.parse(data);
            this.rebuildIndex();
            console.log('[RuleCache] 从本地加载 ' + this.rules.length + ' 条规则');
        }
    } catch (err) {
        console.error('[RuleCache] 加载本地规则失败:', err.message);
        this.rules = [];
        this.ruleMap = {};
    }
};

RuleCache.prototype.save = function() {
    try {
        fs.writeFileSync(this.cacheFile, JSON.stringify(this.rules, null, 2), 'utf8');
    } catch (err) {
        console.error('[RuleCache] 保存规则到本地失败:', err.message);
    }
};

RuleCache.prototype.rebuildIndex = function() {
    this.ruleMap = {};
    for (var i = 0; i < this.rules.length; i++) {
        var rule = this.rules[i];
        if (rule && rule.id) {
            this.ruleMap[rule.id] = rule;
        }
    }
};

RuleCache.prototype.getAll = function() {
    return this.rules;
};

RuleCache.prototype.getById = function(id) {
    return this.ruleMap[id] || null;
};

RuleCache.prototype.addOrUpdate = function(rule) {
    if (!rule || !rule.id) return;
    var index = this.rules.findIndex(function(r) { return r.id === rule.id; });
    if (index >= 0) {
        this.rules[index] = rule;
    } else {
        this.rules.push(rule);
    }
    this.ruleMap[rule.id] = rule;
    this.save();
};

RuleCache.prototype.batchUpdate = function(rules) {
    if (!Array.isArray(rules)) return;
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule && rule.id) {
            var index = this.rules.findIndex(function(r) { return r.id === rule.id; });
            if (index >= 0) {
                this.rules[index] = rule;
            } else {
                this.rules.push(rule);
            }
            this.ruleMap[rule.id] = rule;
        }
    }
    this.save();
};

RuleCache.prototype.remove = function(id) {
    var index = this.rules.findIndex(function(r) { return r.id === id; });
    if (index >= 0) {
        this.rules.splice(index, 1);
    }
    delete this.ruleMap[id];
    this.save();
};

RuleCache.prototype.clear = function() {
    this.rules = [];
    this.ruleMap = {};
    this.save();
};

module.exports = RuleCache;
