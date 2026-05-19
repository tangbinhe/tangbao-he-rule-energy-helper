/**
 * 单元测试
 * 覆盖缓存模块、引擎模块和工具模块
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 工具模块
const { evalExpression } = require('../lib/utils/expr-eval');

// 引擎模块
const { parseChain, evaluateAst } = require('../lib/engine/chain-parser');
const { effectiveTimeCmp } = require('../lib/engine/effective-time-cmp');
const { deviceCalculateCmp } = require('../lib/engine/device-calculate-cmp');
const { controlCmp } = require('../lib/engine/control-cmp');
const { alarmCmp } = require('../lib/engine/alarm-cmp');
const DelayManager = require('../lib/engine/delay-manager');

// 缓存模块
const RuleCache = require('../lib/cache/rule-cache');
const TimeCache = require('../lib/cache/time-cache');
const MappingCache = require('../lib/cache/mapping-cache');

const TEST_DIR = path.join(__dirname, '.test-cache');
const noopLog = () => {};

describe('tangbao-he-rule-energy-helper 单元测试', function() {

  // 测试前清理测试目录
  before(function() {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  // 测试后清理测试目录
  after(function() {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  // ==================== expr-eval ====================
  describe('expr-eval', function() {
    it('应正确计算 1==1 为 true', function() {
      const result = evalExpression('1==1', noopLog);
      assert.strictEqual(result, true);
    });

    it('应正确计算 1==0 为 false', function() {
      const result = evalExpression('1==0', noopLog);
      assert.strictEqual(result, false);
    });

    it('应正确计算数值比较', function() {
      assert.strictEqual(evalExpression('5 > 3', noopLog), true);
      assert.strictEqual(evalExpression('5 < 3', noopLog), false);
      assert.strictEqual(evalExpression('5 >= 5', noopLog), true);
      assert.strictEqual(evalExpression('5 <= 4', noopLog), false);
    });

    it('应正确计算逻辑运算', function() {
      assert.strictEqual(evalExpression('1==1 && 2==2', noopLog), true);
      assert.strictEqual(evalExpression('1==1 && 2==3', noopLog), false);
      assert.strictEqual(evalExpression('1==2 || 2==2', noopLog), true);
      assert.strictEqual(evalExpression('1==2 || 2==3', noopLog), false);
    });

    it('应正确计算算术运算', function() {
      assert.strictEqual(evalExpression('2 + 3', noopLog), 5);
      assert.strictEqual(evalExpression('10 - 3', noopLog), 7);
      assert.strictEqual(evalExpression('4 * 5', noopLog), 20);
      assert.strictEqual(evalExpression('20 / 4', noopLog), 5);
    });

    it('非法字符应抛出异常', function() {
      assert.throws(() => evalExpression('alert(1)', noopLog), /非法字符/);
    });
  });

  // ==================== chain-parser ====================
  describe('chain-parser', function() {
    it('应正确解析两层 IF 嵌套', function() {
      const ast = parseChain('<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>', noopLog);
      assert.strictEqual(ast.type, 'function');
      assert.strictEqual(ast.name, 'IF');
      assert.strictEqual(ast.args.length, 2);
      assert.strictEqual(ast.args[0].name, 'effectiveTimeCmp');
      assert.strictEqual(ast.args[1].name, 'IF');
      assert.strictEqual(ast.args[1].args[0].name, 'deviceCalculateCmp');
      assert.strictEqual(ast.args[1].args[1].name, 'controlCmp');
    });

    it('应正确解析三层 IF 嵌套', function() {
      const ast = parseChain('<chain>IF(a,IF(b,IF(c,d)))</chain>', noopLog);
      assert.strictEqual(ast.args[1].args[1].name, 'IF');
      assert.strictEqual(ast.args[1].args[1].args[0].name, 'c');
      assert.strictEqual(ast.args[1].args[1].args[1].name, 'd');
    });

    it('格式错误应抛出异常', function() {
      assert.throws(() => parseChain('invalid', noopLog), /格式错误/);
    });

    it('应正确执行 IF 条件为 true 的分支', function() {
      const ast = parseChain('<chain>IF(effectiveTimeCmp,controlCmp)</chain>', noopLog);
      const cmpMap = {
        effectiveTimeCmp: () => true,
        controlCmp: () => ({ type: 'control', value: 1 })
      };
      const result = evaluateAst(ast, {}, cmpMap, noopLog);
      assert.deepStrictEqual(result, { type: 'control', value: 1 });
    });

    it('应正确执行 IF 条件为 false 的分支', function() {
      const ast = parseChain('<chain>IF(effectiveTimeCmp,controlCmp,alarmCmp)</chain>', noopLog);
      const cmpMap = {
        effectiveTimeCmp: () => false,
        controlCmp: () => ({ type: 'control' }),
        alarmCmp: () => ({ type: 'alarm' })
      };
      const result = evaluateAst(ast, {}, cmpMap, noopLog);
      assert.deepStrictEqual(result, { type: 'alarm' });
    });
  });

  // ==================== cache ====================
  describe('cache', function() {
    it('rule-cache 应正确保存和读取规则', function() {
      const cache = new RuleCache(noopLog);
      const rule = { chainName: 'chain-test-save', ruleId: 999, elData: '<chain>IF(a,b)</chain>' };
      cache.set('chain-test-save', rule);
      const result = cache.get('chain-test-save');
      assert.deepStrictEqual(result, rule);
      assert.ok(cache.size() >= 1);
    });

    it('rule-cache 应正确通过 pointId 反查 pointTypeId', function() {
      const cache = new RuleCache(noopLog);
      const rule = {
        chainName: 'chain2',
        equipPoints: [
          { pointId: 'pid-001', pointTypeId: 1111101101, slotPath: '/a/b' }
        ]
      };
      cache.set('chain2', rule);
      const ptid = cache.findPointTypeIdByPointId('pid-001');
      assert.strictEqual(ptid, 1111101101);
    });

    it('rule-cache 应正确删除规则', function() {
      const cache = new RuleCache(noopLog);
      cache.set('chain3', { chainName: 'chain3' });
      cache.remove('chain3');
      assert.strictEqual(cache.get('chain3'), null);
    });

    it('time-cache 应正确保存和读取时间配置', function() {
      const cache = new TimeCache(noopLog);
      const config = { timeName: '营业时间', timeType: '2', begin: '09:00:00', end: '18:00:00' };
      cache.set('营业时间', config);
      const result = cache.get('营业时间');
      assert.deepStrictEqual(result, config);
    });

    it('mapping-cache 应正确保存和读取映射', function() {
      const cache = new MappingCache(noopLog);
      cache.set(1111101101, ['chain1', 'chain2']);
      const result = cache.get(1111101101);
      assert.deepStrictEqual(result, ['chain1', 'chain2']);
    });
  });

  // ==================== effective-time-cmp ====================
  describe('effective-time-cmp', function() {
    it('无日期和时间配置应默认通过', function() {
      const result = effectiveTimeCmp({
        rule: {},
        chainName: 'test',
        timeCache: null,
        log: noopLog
      });
      assert.strictEqual(result, true);
    });

    it('只配置了日期且满足应通过', function() {
      const cache = new TimeCache(noopLog);
      cache.set('日期', { timeName: '日期', timeType: '3', begin: '2020-01-01', end: '2099-12-31' });

      const result = effectiveTimeCmp({
        rule: { effectDateName: '日期' },
        chainName: 'test',
        timeCache: cache,
        log: noopLog,
        triggerAlarmRecovery: () => {}
      });
      assert.strictEqual(result, true);
    });

    it('只配置了时间且满足应通过', function() {
      const begin = '00:00:00';
      const end = '23:59:59';
      const cache = new TimeCache(noopLog);
      cache.set('全天', { timeName: '全天', timeType: '2', begin, end });

      const result = effectiveTimeCmp({
        rule: { effectTimeName: '全天' },
        chainName: 'test',
        timeCache: cache,
        log: noopLog,
        triggerAlarmRecovery: () => {}
      });
      assert.strictEqual(result, true);
    });

    it('配置了时间但缓存不存在应返回 false', function() {
      const cache = new TimeCache(noopLog);
      const result = effectiveTimeCmp({
        rule: { effectTimeName: '不存在的配置' },
        chainName: 'test',
        timeCache: cache,
        log: noopLog
      });
      assert.strictEqual(result, false);
    });

    it('日期和时间都配置且在范围内应通过', function() {
      const begin = '00:00:00';
      const end = '23:59:59';
      const cache = new TimeCache(noopLog);
      cache.set('日期', { timeName: '日期', timeType: '3', begin: '2020-01-01', end: '2099-12-31' });
      cache.set('全天', { timeName: '全天', timeType: '2', begin, end });

      const result = effectiveTimeCmp({
        rule: { effectDateName: '日期', effectTimeName: '全天' },
        chainName: 'test',
        timeCache: cache,
        log: noopLog,
        triggerAlarmRecovery: () => {}
      });
      assert.strictEqual(result, true);
    });
  });

  // ==================== device-calculate-cmp ====================
  describe('device-calculate-cmp', function() {
    it('条件满足且无延迟应返回 true', function() {
      const result = deviceCalculateCmp({
        rule: {
          scripts: [
            { stepIndex: 1, stepType: '0', function: 'EMPTY' },
            { stepIndex: 2, stepType: '1', function: '{1111101101}==0' }
          ]
        },
        pointList: [{ pointTypeId: 1111101101, value: '0' }],
        chainName: 'test',
        delayManager: null,
        log: noopLog,
        triggerAlarmRecovery: () => {}
      });
      assert.strictEqual(result, true);
    });

    it('条件不满足应返回 false 并触发恢复', function() {
      let recoveryCalled = false;
      const result = deviceCalculateCmp({
        rule: {
          ruleSource: 'alarm',
          scripts: [
            { stepIndex: 1, stepType: '0', function: 'EMPTY' },
            { stepIndex: 2, stepType: '1', function: '{1111101101}==0' }
          ]
        },
        pointList: [{ pointTypeId: 1111101101, value: '1' }],
        chainName: 'test',
        delayManager: null,
        log: noopLog,
        triggerAlarmRecovery: () => { recoveryCalled = true; }
      });
      assert.strictEqual(result, false);
      assert.strictEqual(recoveryCalled, true);
    });

    it('条件满足且有延迟时首次应返回 false', function() {
      const dm = new DelayManager(noopLog);
      const result = deviceCalculateCmp({
        rule: {
          scripts: [
            { stepIndex: 1, stepType: '0', function: 'EMPTY' },
            { stepIndex: 2, stepType: '1', function: '{1111101101}==0', delay: 10 }
          ]
        },
        pointList: [{ pointTypeId: 1111101101, value: '0' }],
        chainName: 'test',
        delayManager: dm,
        log: noopLog,
        triggerAlarmRecovery: () => {}
      });
      assert.strictEqual(result, false);
      dm.clear('test');
    });
  });

  // ==================== control-cmp ====================
  describe('control-cmp', function() {
    it('应正确构建控制输出消息', function() {
      const result = controlCmp({
        rule: {
          scripts: [
            { stepIndex: 1, stepType: '0', function: 'EMPTY' },
            { stepIndex: 3, stepType: '3', function: '1' }
          ],
          rulePointTypes: [
            { dataType: 'control', pointTypeId: 1111101104, stepId: 557 }
          ],
          equipPoints: [
            { pointId: 'pid-ctrl', slotPath: '/Drivers/控制点', pointTypeId: 1111101104, equipId: 'EQ-001' }
          ]
        },
        pointList: [{ pointTypeId: 1111101104, pointId: 'pid-ctrl', slotPath: '/Drivers/控制点', value: '0', dataType: 'control', stepId: 557 }],
        chainName: 'test',
        log: noopLog,
        currentStepIndex: 1
      });
      assert.strictEqual(result.type, 'control');
      assert.strictEqual(result.outputs[0].value, '1');
      assert.strictEqual(result.outputs[0].pointId, 'pid-ctrl');
    });

    it('无控制点位应返回 null', function() {
      const result = controlCmp({
        rule: {
          scripts: [{ stepIndex: 3, stepType: '3', function: '1' }],
          rulePointTypes: [],
          equipPoints: []
        },
        pointList: [],
        chainName: 'test',
        log: noopLog
      });
      assert.strictEqual(result, null);
    });
  });

  // ==================== alarm-cmp ====================
  describe('alarm-cmp', function() {
    it('应正确构建告警输出消息', function() {
      const alarmState = new Map();
      const result = alarmCmp({
        rule: {
          ruleId: 1,
          rulePointTypes: [{ dataType: 'alarm', pointTypeId: 1111101101 }],
          priority: '1',
          alarmDesc: '测试告警'
        },
        pointList: [{ pointTypeId: 1111101101, pointId: 'pid-alarm', slotPath: '/a/b', value: '100' }],
        chainName: 'test',
        log: noopLog,
        alarmStateCache: alarmState
      });
      assert.strictEqual(result.type, 'alarm');
      assert.strictEqual(result.pointId, 'pid-alarm');
      assert.strictEqual(result.alarmValue, '100');
      assert.strictEqual(alarmState.size, 1);
    });

    it('重复告警应返回 null（去重）', function() {
      const alarmState = new Map();
      const ctx = {
        rule: {
          ruleId: 1,
          rulePointTypes: [{ dataType: 'alarm', pointTypeId: 1111101101 }]
        },
        pointList: [{ pointTypeId: 1111101101, pointId: 'pid-alarm2', slotPath: '/a/b', value: '100' }],
        chainName: 'test',
        log: noopLog,
        alarmStateCache: alarmState
      };
      alarmCmp(ctx);
      const result = alarmCmp(ctx);
      assert.strictEqual(result, null);
    });
  });

  // ==================== delay-manager ====================
  describe('delay-manager', function() {
    it('应正确设置和获取延迟信息', function() {
      const dm = new DelayManager(noopLog);
      dm.set('chain1:2', {
        chainName: 'chain1',
        stepIndex: 2,
        pointId: 'pid-001',
        processTimestamp: Date.now(),
        delay: 10
      });
      const info = dm.get('chain1:2');
      assert.ok(info);
      assert.strictEqual(info.delay, 10);
      dm.remove('chain1:2');
    });

    it('延迟未到期应返回 false', function() {
      const dm = new DelayManager(noopLog);
      dm.set('chain1:2', {
        chainName: 'chain1',
        stepIndex: 2,
        pointId: 'pid-001',
        processTimestamp: Date.now(),
        delay: 10
      });
      const expired = dm.isExpired('chain1:2');
      assert.strictEqual(expired, false);
      dm.clear('chain1');
    });

    it('延迟已到期应返回 true', function() {
      const dm = new DelayManager(noopLog);
      dm.set('chain1:2', {
        chainName: 'chain1',
        stepIndex: 2,
        pointId: 'pid-001',
        processTimestamp: Date.now() - 15000, // 15秒前
        delay: 10
      });
      const expired = dm.isExpired('chain1:2');
      assert.strictEqual(expired, true);
      dm.clear('chain1');
    });

    it('clear 应清除指定规则的所有延迟', function() {
      const dm = new DelayManager(noopLog);
      dm.set('chain1:2', { chainName: 'chain1', delay: 10, processTimestamp: Date.now() });
      dm.set('chain1:3', { chainName: 'chain1', delay: 10, processTimestamp: Date.now() });
      dm.clear('chain1');
      assert.strictEqual(dm.size(), 0);
    });
  });
});
