/**
 * 规则执行节点
 * 接收点值上报，匹配规则，执行规则链，输出控制/告警/恢复消息
 * 项目独立部署，使用单例缓存，无需 projectCard 配置
 */

module.exports = function(RED) {
  const { parseChain, evaluateAst } = require('./lib/engine/chain-parser');
  const { effectiveTimeCmp } = require('./lib/engine/effective-time-cmp');
  const { deviceCalculateCmp } = require('./lib/engine/device-calculate-cmp');
  const { controlCmp } = require('./lib/engine/control-cmp');
  const { alarmCmp } = require('./lib/engine/alarm-cmp');
  const DelayManager = require('./lib/engine/delay-manager');
  const RuleCache = require('./lib/cache/rule-cache');
  const TimeCache = require('./lib/cache/time-cache');
  const MappingCache = require('./lib/cache/mapping-cache');

  function RuleEnergyEngineNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.name = config.name;
    node.batchTriggerMode = config.batchTriggerMode || 'once';

    const log = function(msgStr) {
      node.log(msgStr);
    };

    // 单例缓存（项目独立部署，无需隔离）
    node.ruleCache = new RuleCache(log);
    node.timeCache = new TimeCache(log);
    node.mappingCache = new MappingCache(log);
    node.delayManager = new DelayManager(log);

    // 告警状态缓存（Map 实例）
    node.alarmStateCache = new Map();
    // 缓存解析后的 AST（key: chainName）
    node.astCache = new Map();

    node.on('input', function(msg) {
      log(`[rule-energy-engine][${node.id}] 收到点值上报`);

      try {
        // 规范化点值数据（支持单条或批量）
        let points = [];
        if (Array.isArray(msg.payload)) {
          points = msg.payload;
          log(`[rule-energy-engine][${node.id}] 批量点值, 共 ${points.length} 个点`);
        } else if (msg.payload && typeof msg.payload === 'object') {
          points = [msg.payload];
          log(`[rule-energy-engine][${node.id}] 单条点值`);
        } else {
          log(`[rule-energy-engine][${node.id}] 无效的 payload 格式`);
          return;
        }

        // 收集所有需要触发的规则
        const chainIdsToTrigger = new Set();
        const pointValues = {};  // pointTypeId -> { pointId, slotPath, value }

        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          if (!point || typeof point !== 'object') {
            log(`[rule-energy-engine][${node.id}] 点[${i}] 格式无效, 跳过`);
            continue;
          }

          log(`[rule-energy-engine][${node.id}] 点[${i}] pointId=${point.pointId || 'none'}, slotPath=${point.slotPath || 'none'}, value=${point.value}`);

          // 反查 pointTypeId（先通过 pointId，再通过 slotPath）
          let pointTypeId = null;
          if (point.pointId) {
            pointTypeId = node.ruleCache.findPointTypeIdByPointId(point.pointId);
          }
          if (!pointTypeId && point.slotPath) {
            pointTypeId = node.ruleCache.findPointTypeIdBySlotPath(point.slotPath);
          }

          if (!pointTypeId) {
            log(`[rule-energy-engine][${node.id}] 点 ${point.pointId || point.slotPath} 反查 pointTypeId 未找到, 跳过`);
            continue;
          }

          log(`[rule-energy-engine][${node.id}] 点 ${point.pointId || point.slotPath} 反查 pointTypeId=${pointTypeId}`);

          pointValues[pointTypeId] = {
            pointId: point.pointId,
            slotPath: point.slotPath,
            value: point.value,
            pointTypeId: pointTypeId
          };

          // 查映射缓存
          const chainIds = node.mappingCache.get(pointTypeId);
          if (chainIds && chainIds.length > 0) {
            log(`[rule-energy-engine][${node.id}] pointTypeId=${pointTypeId} 关联规则: [${chainIds}]`);
            chainIds.forEach(id => chainIdsToTrigger.add(id));
          } else {
            log(`[rule-energy-engine][${node.id}] pointTypeId=${pointTypeId} 无关联规则`);
          }
        }

        if (chainIdsToTrigger.size === 0) {
          log(`[rule-energy-engine][${node.id}] 无匹配规则, 跳过`);
          return;
        }

        log(`[rule-energy-engine][${node.id}] 本次触发规则集合: [${Array.from(chainIdsToTrigger)}]`);

        // 执行每个触发的规则
        const chainIds = Array.from(chainIdsToTrigger);
        for (let i = 0; i < chainIds.length; i++) {
          const chainId = chainIds[i];
          // mapping 中存的是 chainId（如 "45"），规则缓存 key 是 chainName（如 "chain45"）
          const chainName = String(chainId).startsWith('chain') ? String(chainId) : 'chain' + chainId;
          const rule = node.ruleCache.get(chainName);

          if (!rule) {
            log(`[rule-energy-engine][${node.id}] 规则不存在: chainId=${chainId}, chainName=${chainName}`);
            continue;
          }

          log(`[rule-energy-engine][${node.id}] 开始执行规则[${i + 1}/${chainIds.length}], chainName=${rule.chainName}, ruleId=${rule.ruleId}, ruleType=${rule.ruleType}, ruleSource=${rule.ruleSource}`);

          // 构建 pointList（填充当前值）
          const pointList = buildPointList(rule, pointValues, log);
          log(`[rule-energy-engine][${node.id}] 构建 pointList, 共 ${pointList.length} 个点, 当前值: ${JSON.stringify(pointList.map(p => ({ ptid: p.pointTypeId, val: p.value })))}`);

          // 解析或获取缓存的 AST
          const astKey = rule.chainName;
          let ast = node.astCache.get(astKey);
          if (!ast) {
            try {
              ast = parseChain(rule.elData, log);
              node.astCache.set(astKey, ast);
              log(`[rule-energy-engine][${node.id}] 解析执行链并缓存: ${rule.elData}`);
            } catch (e) {
              log(`[rule-energy-engine][${node.id}] 解析执行链失败: ${e.message}`);
              continue;
            }
          } else {
            log(`[rule-energy-engine][${node.id}] 使用缓存的 AST`);
          }

          // 构建执行上下文
          const context = {
            rule,
            pointList,
            chainName: rule.chainName,
            timeCache: node.timeCache,
            delayManager: node.delayManager,
            log,
            alarmStateCache: node.alarmStateCache,
            triggerAlarmRecovery: () => {
              doAlarmRecovery(rule, pointList, rule.chainName, node, log, node.alarmStateCache, node.delayManager);
            }
          };

          // 构建 cmp 函数映射
          const cmpMap = {
            effectiveTimeCmp: (ctx) => effectiveTimeCmp(ctx),
            deviceCalculateCmp: (ctx) => deviceCalculateCmp(ctx),
            controlCmp: (ctx) => controlCmp(ctx),
            alarmCmp: (ctx) => alarmCmp(ctx)
          };

          // 执行 AST
          log(`[rule-energy-engine][${node.id}] 开始执行 AST...`);
          let result;
          try {
            result = evaluateAst(ast, context, cmpMap, log);
          } catch (e) {
            log(`[rule-energy-engine][${node.id}] 执行 AST 异常: ${e.message}`);
            continue;
          }

          // 处理输出
          let outputCount = 0;
          if (result && result.type) {
            log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${rule.chainName}, 输出 type=${result.type}`);
            node.send({ payload: result });
            outputCount++;
          } else if (Array.isArray(result)) {
            for (const output of result) {
              if (output && output.type) {
                log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${rule.chainName}, 输出 type=${output.type}`);
                node.send({ payload: output });
                outputCount++;
              }
            }
          }

          if (outputCount === 0) {
            log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${rule.chainName}, 无输出`);
          }
        }

      } catch (e) {
        log(`[rule-energy-engine][${node.id}] 处理点值异常: ${e.message}`);
        node.error(e, msg);
      }
    });

    node.on('close', function() {
      log(`[rule-energy-engine][${node.id}] 节点关闭`);
    });
  }

  /**
   * 构建 pointList，填充当前点值
   */
  function buildPointList(rule, pointValues, log) {
    const pointList = [];

    if (!rule.rulePointTypes || !Array.isArray(rule.rulePointTypes)) {
      return pointList;
    }

    for (const rpt of rule.rulePointTypes) {
      // 从 equipPoints 找到对应的点位信息
      const equipPoint = rule.equipPoints && Array.isArray(rule.equipPoints)
        ? rule.equipPoints.find(ep => ep.pointTypeId === rpt.pointTypeId)
        : null;

      const currentValue = pointValues[rpt.pointTypeId];

      pointList.push({
        pointTypeId: rpt.pointTypeId,
        dataType: rpt.dataType,
        stepId: rpt.stepId,
        pointId: currentValue ? currentValue.pointId : (equipPoint ? equipPoint.pointId : null),
        slotPath: currentValue ? currentValue.slotPath : (equipPoint ? equipPoint.slotPath : null),
        value: currentValue ? currentValue.value : null,
        equipId: equipPoint ? equipPoint.equipId : null,
        valueType: equipPoint ? equipPoint.valueType : null
      });
    }

    return pointList;
  }

  /**
   * 执行告警恢复
   */
  function doAlarmRecovery(rule, pointList, chainName, node, log, alarmStateCache, delayManager) {
    log(`[alarmRecovery][${chainName}] 触发告警恢复`);

    // 1. 清除告警状态
    let clearedCount = 0;
    for (const point of pointList) {
      if (!point.pointId) continue;
      const alarmKey = `${chainName}:${point.pointId}`;
      if (alarmStateCache.has(alarmKey)) {
        alarmStateCache.delete(alarmKey);
        clearedCount++;
        log(`[alarmRecovery][${chainName}] 清除告警状态: pointId=${point.pointId}`);
      }
    }
    if (clearedCount === 0) {
      log(`[alarmRecovery][${chainName}] 无告警状态需要清除`);
    }

    // 2. 清除延迟状态
    delayManager.clear(chainName);

    // 3. 输出恢复消息
    let sentCount = 0;
    for (const point of pointList) {
      if (!point.pointId) continue;
      const recoveryMsg = {
        payload: {
          type: 'alarmRecovery',
          chainName,
          ruleId: rule.ruleId,
          pointId: point.pointId,
          slotPath: point.slotPath,
          pointTypeId: point.pointTypeId,
          normalTime: Date.now()
        }
      };
      node.send(recoveryMsg);
      sentCount++;
      log(`[alarmRecovery][${chainName}] 输出恢复消息: pointId=${point.pointId}`);
    }

    if (sentCount === 0) {
      log(`[alarmRecovery][${chainName}] 无恢复消息输出`);
    }
  }

  RED.nodes.registerType('rule-energy-engine', RuleEnergyEngineNode);
};
