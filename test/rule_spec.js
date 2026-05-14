var should = require('should');
var RuleCache = require('../lib/rule-cache');
var RuleMatcher = require('../lib/rule-matcher');
var RuleExecutor = require('../lib/rule-executor');
var ExprEvaluator = require('../lib/expr-eval');

describe('规则引擎核心模块测试', function() {

    describe('ExprEvaluator', function() {
        var expr;
        beforeEach(function() {
            expr = new ExprEvaluator();
        });

        it('应正确计算简单比较表达式', function() {
            expr.evaluate('A > 30', { A: 35 }).should.be.true();
            expr.evaluate('A > 30', { A: 25 }).should.be.false();
        });

        it('应正确计算逻辑组合表达式', function() {
            expr.evaluate('A > 30 && B < 20', { A: 35, B: 15 }).should.be.true();
            expr.evaluate('A > 30 && B < 20', { A: 25, B: 15 }).should.be.false();
        });
    });

    describe('RuleCache', function() {
        var cache;
        beforeEach(function() {
            cache = new RuleCache('test-node');
            cache.clear();
        });

        it('应正确添加和查询规则', function() {
            cache.addOrUpdate({ id: 1, ruleName: '测试规则' });
            cache.getAll().length.should.equal(1);
            cache.getById(1).ruleName.should.equal('测试规则');
        });

        it('应正确删除规则', function() {
            cache.addOrUpdate({ id: 1, ruleName: '测试规则' });
            cache.remove(1);
            should.not.exist(cache.getById(1));
        });
    });

    describe('RuleMatcher', function() {
        var cache, matcher;
        beforeEach(function() {
            cache = new RuleCache('test-match');
            cache.clear();
            matcher = new RuleMatcher(cache);
        });

        it('应匹配符合数据源条件的规则', function() {
            cache.addOrUpdate({
                id: 1,
                ruleName: '高温告警',
                ruleStatus: '1',
                partList: [{
                    stepIndex: 1,
                    ruleName: '步骤1',
                    partList: [
                        { type: '4', ruleName: 'A', subsystemId: 'HVAC', equipTypeId: 'chiller', pointTypeId: 'temp' }
                    ]
                }]
            });

            var matched = matcher.match({
                subsystemId: 'HVAC',
                equipTypeId: 'chiller',
                pointTypeId: 'temp',
                deviceId: 'DEV001',
                value: 35
            });

            matched.length.should.equal(1);
            matched[0].ruleName.should.equal('高温告警');
        });

        it('不应匹配数据源条件不符的规则', function() {
            cache.addOrUpdate({
                id: 1,
                ruleName: '高温告警',
                ruleStatus: '1',
                partList: [{
                    stepIndex: 1,
                    ruleName: '步骤1',
                    partList: [
                        { type: '4', ruleName: 'A', subsystemId: 'HVAC', equipTypeId: 'chiller', pointTypeId: 'temp' }
                    ]
                }]
            });

            var matched = matcher.match({
                subsystemId: 'HVAC',
                equipTypeId: 'chiller',
                pointTypeId: 'humidity',
                deviceId: 'DEV001',
                value: 35
            });

            matched.length.should.equal(0);
        });
    });

    describe('RuleExecutor', function() {
        var executor;
        var outputs;
        var mockNode;

        beforeEach(function() {
            outputs = [];
            mockNode = {
                log: function() {},
                error: function() {},
                warn: function() {}
            };
            executor = new RuleExecutor(mockNode);
        });

        it('应执行告警规则并输出告警信息', function(done) {
            var rule = {
                id: 1,
                ruleName: '高温告警',
                ruleStatus: '1',
                ruleType: 'logical',
                ruleDesc: '温度超过阈值',
                partList: [{
                    stepIndex: 1,
                    ruleName: '步骤1',
                    partList: [
                        { type: '4', ruleName: 'A', subsystemId: 'HVAC', equipTypeId: 'chiller', pointTypeId: 'temp' },
                        { type: '6', functionType: '1', function: 'A > 30', delay: '', delayType: 0 },
                        { type: '8', equipTypeId: 'chiller', pointTypeId: 'alarm', alarmLevel: '1', alarmDesc: '温度过高' }
                    ]
                }]
            };

            executor.execute(rule, { value: 35 }, function(output) {
                outputs.push(output);
            }).then(function() {
                outputs.length.should.equal(1);
                outputs[0].type.should.equal('alarm');
                outputs[0].ruleName.should.equal('高温告警');
                done();
            }).catch(done);
        });
    });
});
