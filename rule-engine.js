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
  const AlarmStateCache = require('./lib/cache/alarm-state-cache');

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

    // 告警状态缓存（带持久化）
    node.alarmStateCache = new AlarmStateCache(log);
    // 缓存解析后的 AST（key: chainName，不持久化）
    node.astCache = new Map();
    // 点位值缓存（内存缓存，用于单设备/多设备规则填充缺失点位）
    node.pointValueCache = {};
    // 控制输出去重缓存：pointId -> { value, timestamp }
    node.lastControlValues = {};

    // ==================== 延迟到期自动执行定时器（每300秒扫描，与Java端一致） ====================
    node.delayCheckInterval = setInterval(() => {
      try {
        const expiredItems = node.delayManager.getExpiredItems();
        for (const item of expiredItems) {
          log(`[rule-energy-engine][${node.id}] 定时器检测到延迟到期, chainName=${item.chainName}, stepIndex=${item.stepIndex}`);
          executeRuleByDelay(item, node, log);
        }
      } catch (e) {
        log(`[rule-energy-engine][${node.id}] 延迟定时器异常: ${e.message}`);
      }
    }, 300000);

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
        const triggeredPointIds = new Set();  // 本次上报的 pointId 集合

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

          const pv = {
            pointId: point.pointId,
            slotPath: point.slotPath,
            value: point.value,
            pointTypeId: pointTypeId
          };
          pointValues[pointTypeId] = pv;

          // 更新全局点位值缓存
          node.pointValueCache[String(pointTypeId)] = pv;

          if (point.pointId) {
            triggeredPointIds.add(point.pointId);
          }

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

          // 空 elData 保护（对齐 Java 端 FlowBus.containChain 为 false 则跳过）
          if (!rule.elData) {
            log(`[rule-energy-engine][${node.id}] chainName=${rule.chainName} 无 elData, 跳过执行`);
            continue;
          }

          // 构建 pointList（填充当前值，区分单设备/多设备）
          const pointList = buildPointList(rule, pointValues, node.pointValueCache, triggeredPointIds, log);
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
              doAlarmRecovery(rule, pointList, triggeredPointIds, rule.chainName, node, log, node.alarmStateCache, node.delayManager);
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

          // 处理输出（含控制去重）
          handleResult(result, rule.chainName, node, log);
        }

      } catch (e) {
        log(`[rule-energy-engine][${node.id}] 处理点值异常: ${e.message}`);
        node.error(e, msg);
      }
    });

    node.on('close', function() {
      if (node.delayCheckInterval) {
        clearInterval(node.delayCheckInterval);
      }
      log(`[rule-energy-engine][${node.id}] 节点关闭`);
    });
  }

  /**
   * 延迟到期后自动执行规则
   */
  function executeRuleByDelay(delayItem, node, log) {
    const chainName = delayItem.chainName;
    const rule = node.ruleCache.get(chainName);
    if (!rule) {
      log(`[rule-energy-engine][${node.id}] 延迟执行规则不存在: ${chainName}`);
      return;
    }

    if (!rule.elData) {
      log(`[rule-energy-engine][${node.id}] 延迟执行规则无 elData: ${chainName}`);
      return;
    }

    // 尝试用最新缓存值更新 pointListSnapshot
    let pointList = [];
    if (delayItem.pointListSnapshot && Array.isArray(delayItem.pointListSnapshot)) {
      pointList = delayItem.pointListSnapshot.map(p => {
        const latest = node.pointValueCache[String(p.pointTypeId)];
        return latest ? { ...p, ...latest } : p;
      });
    }

    log(`[rule-energy-engine][${node.id}] 延迟到期自动执行, chainName=${chainName}, 点位数=${pointList.length}`);

    // 解析或获取缓存的 AST
    let ast = node.astCache.get(chainName);
    if (!ast) {
      try {
        ast = parseChain(rule.elData, log);
        node.astCache.set(chainName, ast);
      } catch (e) {
        log(`[rule-energy-engine][${node.id}] 延迟执行解析失败: ${e.message}`);
        return;
      }
    }

    const triggeredPointIds = new Set(pointList.map(p => p.pointId).filter(Boolean));

    const context = {
      rule,
      pointList,
      chainName,
      timeCache: node.timeCache,
      delayManager: node.delayManager,
      log,
      alarmStateCache: node.alarmStateCache,
      triggerAlarmRecovery: () => {
        doAlarmRecovery(rule, pointList, triggeredPointIds, chainName, node, log, node.alarmStateCache, node.delayManager);
      }
    };

    const cmpMap = {
      effectiveTimeCmp: (ctx) => effectiveTimeCmp(ctx),
      deviceCalculateCmp: (ctx) => deviceCalculateCmp(ctx),
      controlCmp: (ctx) => controlCmp(ctx),
      alarmCmp: (ctx) => alarmCmp(ctx)
    };

    try {
      const result = evaluateAst(ast, context, cmpMap, log);
      handleResult(result, chainName, node, log);
    } catch (e) {
      log(`[rule-energy-engine][${node.id}] 延迟执行 AST 异常: ${e.message}`);
    }

    // 清除已执行的延迟
    node.delayManager.remove(`${chainName}:${delayItem.stepIndex}`);
  }

  /**
   * 处理 AST 执行结果（含控制输出去重）
   */
  function handleResult(result, chainName, node, log) {
    let outputCount = 0;

    const results = [];
    if (result && result.type) {
      results.push(result);
    } else if (Array.isArray(result)) {
      for (const r of result) {
        if (r && r.type) results.push(r);
      }
    }

    for (const output of results) {
      // 控制输出去重：与上一次发送的值比对
      if (output.type === 'control' && output.outputs) {
        const filteredOutputs = [];
        for (const ctrl of output.outputs) {
          const last = node.lastControlValues[ctrl.pointId];
          if (last && String(last.value) === String(ctrl.value)) {
            log(`[rule-energy-engine][${node.id}] 控制去重跳过: pointId=${ctrl.pointId}, value=${ctrl.value} 未变化`);
            continue;
          }
          node.lastControlValues[ctrl.pointId] = { value: ctrl.value, timestamp: Date.now() };
          filteredOutputs.push(ctrl);
        }
        if (filteredOutputs.length === 0) {
          log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${chainName}, 控制输出全部被去重`);
          continue;
        }
        output.outputs = filteredOutputs;
      }

      log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${chainName}, 输出 type=${output.type}`);
      node.send({ payload: output });
      outputCount++;
    }

    if (outputCount === 0) {
      log(`[rule-energy-engine][${node.id}] 规则执行完成, chainName=${chainName}, 无输出`);
    }
  }

  /**
   * 构建 pointList，填充当前点值
   * 区分单设备规则（ruleType=1）和多设备规则（ruleType=2）
   */
  function buildPointList(rule, pointValues, pointValueCache, triggeredPointIds, log) {
    const pointList = [];
    const triggeredPointId = triggeredPointIds.size > 0 ? Array.from(triggeredPointIds)[0] : null;

    if (!rule.rulePointTypes || !Array.isArray(rule.rulePointTypes)) {
      return pointList;
    }

    const ruleTypeVal = String(rule.ruleType);
    const isSingleDevice = ruleTypeVal === '1';
    const isMultiDevice = ruleTypeVal === '2';

    // ============ 单设备规则 ============
    if (isSingleDevice && triggeredPointId && rule.equipPoints && Array.isArray(rule.equipPoints)) {
      const triggeredEp = rule.equipPoints.find(ep => ep.pointId === triggeredPointId);
      const equipId = triggeredEp ? triggeredEp.equipId : null;

      if (equipId) {
        log(`[buildPointList][${rule.chainName}] 单设备规则, equipId=${equipId}`);
        const devicePoints = rule.equipPoints.filter(ep => ep.equipId === equipId);
        for (const dp of devicePoints) {
          const rpt = rule.rulePointTypes.find(r => String(r.pointTypeId) === String(dp.pointTypeId));
          const cached = pointValueCache[String(dp.pointTypeId)];
          pointList.push({
            pointTypeId: dp.pointTypeId,
            dataType: rpt ? rpt.dataType : null,
            stepId: rpt ? rpt.stepId : null,
            pointId: cached ? cached.pointId : dp.pointId,
            slotPath: cached ? cached.slotPath : dp.slotPath,
            value: cached !== undefined ? cached.value : null,
            equipId: dp.equipId,
            valueType: dp.valueType
          });
        }
        log(`[buildPointList][${rule.chainName}] 单设备 pointList 构建完成, 共 ${pointList.length} 个点`);
        return pointList;
      }
    }

    // ============ 多设备规则 ============
    if (isMultiDevice && triggeredPointId && rule.equipPoints && Array.isArray(rule.equipPoints)) {
      const groupMapping = rule.groupMapping || {};
      const groups = groupMapping[triggeredPointId] || {};
      const groupPointIds = new Set();

      for (const groupName of Object.keys(groups)) {
        for (const pid of groups[groupName]) {
          groupPointIds.add(pid);
        }
      }

      if (groupPointIds.size > 0) {
        log(`[buildPointList][${rule.chainName}] 多设备规则, 分组点位数=${groupPointIds.size}`);
        for (const pid of groupPointIds) {
          const ep = rule.equipPoints.find(e => e.pointId === pid);
          if (ep) {
            const rpt = rule.rulePointTypes.find(r => String(r.pointTypeId) === String(ep.pointTypeId));
            const cached = pointValueCache[String(ep.pointTypeId)];
            pointList.push({
              pointTypeId: ep.pointTypeId,
              dataType: rpt ? rpt.dataType : null,
              stepId: rpt ? rpt.stepId : null,
              pointId: cached ? cached.pointId : ep.pointId,
              slotPath: cached ? cached.slotPath : ep.slotPath,
              value: cached !== undefined ? cached.value : null,
              equipId: ep.equipId,
              valueType: ep.valueType
            });
          }
        }
        log(`[buildPointList][${rule.chainName}] 多设备 pointList 构建完成, 共 ${pointList.length} 个点`);
        return pointList;
      }
    }

    // ============ 回退到原有逻辑（无法区分设备/分组时） ============
    for (const rpt of rule.rulePointTypes) {
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
  function doAlarmRecovery(rule, pointList, triggeredPointIds, chainName, node, log, alarmStateCache, delayManager) {
    log(`[alarmRecovery][${chainName}] 触发告警恢复, 本次上报点位数=${triggeredPointIds.size}`);

    // 清除延迟状态
    delayManager.clear(chainName);

    // 只处理本次上报且存在告警缓存的点位
    let sentCount = 0;
    for (const pointId of triggeredPointIds) {
      const alarmKey = `${chainName}:${pointId}`;
      const alarmState = alarmStateCache.get(alarmKey);

      if (!alarmState || !alarmState.alarmMessage) {
        log(`[alarmRecovery][${chainName}] 跳过无告警状态的点: pointId=${pointId}`);
        continue;
      }

      // 基于原告警消息构建恢复消息，alarmId 保持一致
      const recoveryPayload = JSON.parse(JSON.stringify(alarmState.alarmMessage));

      // 从当前 pointList 中取恢复时的点值
      const recoverPoint = pointList.find(p => p.pointId === pointId);
      const recoverValue = recoverPoint ? recoverPoint.value : null;

      recoveryPayload.alarmStatus = 'normal';
      recoveryPayload.alarmTime = alarmState.alarmTime;
      // alarmDesc 保留报警时的原值，恢复描述使用新字段
      recoveryPayload.recoverDesc = '报警恢复';
      recoveryPayload.recoverValue = recoverValue;
      recoveryPayload.recoverTime = Date.now();
      recoveryPayload.timestamp = Date.now();
      log(`[alarmRecovery][${chainName}] 基于原告警消息恢复: pointId=${pointId}, alarmId=${recoveryPayload.alarmId}`);

      node.send({ payload: recoveryPayload });
      sentCount++;

      // 清除告警状态
      alarmStateCache.delete(alarmKey);
      log(`[alarmRecovery][${chainName}] 清除告警状态: pointId=${pointId}`);
    }

    if (sentCount === 0) {
      log(`[alarmRecovery][${chainName}] 无恢复消息输出（无待恢复告警）`);
    }
  }

  RED.nodes.registerType('rule-energy-engine', RuleEnergyEngineNode);
};
