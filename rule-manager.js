/**
 * 规则管理节点
 * 接收云端下发的配置报文，解析并持久化到本地缓存
 * 项目独立部署，使用单例缓存，无需 projectCard 配置
 */

module.exports = function(RED) {
  const RuleCache = require('./lib/cache/rule-cache');
  const TimeCache = require('./lib/cache/time-cache');
  const MappingCache = require('./lib/cache/mapping-cache');

  function RuleEnergyManagerNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.name = config.name;

    const log = function(msgStr) {
      node.log(msgStr);
    };

    // 单例缓存（项目独立部署，无需隔离）
    node.ruleCache = new RuleCache(log);
    node.timeCache = new TimeCache(log);
    node.mappingCache = new MappingCache(log);

    node.on('input', function(msg) {
      log(`[rule-energy-manager][${node.id}] 收到报文, topic=${msg.topic || 'none'}`);

      try {
        const payload = msg.payload || {};

        // ==================== 查询功能 ====================
        if (payload.action) {
          handleQuery(payload, node, log, msg);
          return;
        }

        let detail = [];

        // 支持完整报文结构 或 简化结构
        if (payload.messageContent && Array.isArray(payload.messageContent.detail)) {
          detail = payload.messageContent.detail;
          log(`[rule-energy-manager][${node.id}] 解析到 detail 数组, length=${detail.length}, messageId=${payload.messageId || 'none'}`);
        } else if (payload.rulePubType) {
          detail = [payload];
          log(`[rule-energy-manager][${node.id}] 收到简化结构报文, rulePubType=${payload.rulePubType}`);
        } else {
          log(`[rule-energy-manager][${node.id}] 报文格式不匹配, 无有效 detail 也无 action`);
          msg.payload = { type: 'error', error: '报文格式不匹配, 缺少 rulePubType、messageContent.detail 或 action' };
          node.send(msg);
          return;
        }

        const results = [];

        for (const item of detail) {
          const rulePubType = item.rulePubType;

          log(`[rule-energy-manager][${node.id}] 处理 rulePubType=${rulePubType}`);

          switch(rulePubType) {
            case 'ruleAndPointInfo':
              handleRuleAndPointInfo(item, node, log, results);
              break;
            case 'edgeRelativeTime':
              handleEdgeRelativeTime(item, node, log, results);
              break;
            case 'pointTypeRuleMapping':
              handlePointTypeRuleMapping(item, node, log, results);
              break;
            case 'deleteRule':
              handleDeleteRule(item, node, log, results);
              break;
            default:
              log(`[rule-energy-manager][${node.id}] 未知 rulePubType: ${rulePubType}, 跳过`);
              results.push({ type: 'unknown', rulePubType });
          }
        }

        msg.payload = results.length === 1 ? results[0] : { type: 'batch', results };
        node.send(msg);

      } catch (e) {
        log(`[rule-energy-manager][${node.id}] 处理报文异常: ${e.message}`);
        msg.payload = { type: 'error', error: e.message };
        node.send(msg);
      }
    });

    node.on('close', function() {
      log(`[rule-energy-manager][${node.id}] 节点关闭`);
    });
  }

  /**
   * 处理查询请求
   */
  function handleQuery(payload, node, log, msg) {
    const action = payload.action;

    log(`[rule-energy-manager][${node.id}] 处理查询请求, action=${action}`);

    switch(action) {
      case 'getRules': {
        const rules = node.ruleCache.getAll();
        const ruleList = Object.entries(rules).map(([chainName, rule]) => ({
          chainName,
          ruleId: rule.ruleId,
          ruleType: rule.ruleType,
          ruleSource: rule.ruleSource,
          effectTimeName: rule.effectTimeName,
          elData: rule.elData,
          scriptsCount: (rule.scripts || []).length,
          pointTypesCount: (rule.rulePointTypes || []).length,
          equipPointsCount: (rule.equipPoints || []).length,
          updateTime: rule.updateTime
        }));
        log(`[rule-energy-manager][${node.id}] 查询 getRules, 返回 ${ruleList.length} 条规则摘要`);
        msg.payload = { type: 'queryResult', action: 'getRules', count: ruleList.length, rules: ruleList };
        break;
      }
      case 'getRule': {
        const chainName = payload.chainName;
        const rule = chainName ? node.ruleCache.get(chainName) : null;
        log(`[rule-energy-manager][${node.id}] 查询 getRule, chainName=${chainName || '未指定'}, 结果=${rule ? '存在' : '不存在'}`);
        msg.payload = { type: 'queryResult', action: 'getRule', chainName, rule };
        break;
      }
      case 'getTimes': {
        const times = node.timeCache.getAll();
        log(`[rule-energy-manager][${node.id}] 查询 getTimes, 返回 ${Object.keys(times).length} 条时间配置`);
        msg.payload = { type: 'queryResult', action: 'getTimes', count: Object.keys(times).length, times };
        break;
      }
      case 'getMappings': {
        const mappings = node.mappingCache.getAll();
        log(`[rule-energy-manager][${node.id}] 查询 getMappings, 返回 ${Object.keys(mappings).length} 条映射`);
        msg.payload = { type: 'queryResult', action: 'getMappings', count: Object.keys(mappings).length, mappings };
        break;
      }
      case 'getStatus': {
        const rules = node.ruleCache.getAll();
        const times = node.timeCache.getAll();
        const mappings = node.mappingCache.getAll();
        log(`[rule-energy-manager][${node.id}] 查询 getStatus, 规则=${Object.keys(rules).length}, 时间=${Object.keys(times).length}, 映射=${Object.keys(mappings).length}`);
        msg.payload = {
          type: 'queryResult',
          action: 'getStatus',
          ruleCount: Object.keys(rules).length,
          timeCount: Object.keys(times).length,
          mappingCount: Object.keys(mappings).length,
          ruleChainNames: Object.keys(rules),
          timeNames: Object.keys(times)
        };
        break;
      }
      default:
        log(`[rule-energy-manager][${node.id}] 未知查询 action: ${action}`);
        msg.payload = { type: 'error', action, error: '未知查询 action' };
    }

    node.send(msg);
  }

  /**
   * 处理 ruleAndPointInfo — 创建/更新规则
   */
  function handleRuleAndPointInfo(item, node, log, results) {
    try {
      if (!item.edgeRuleInfo) {
        log(`[rule-energy-manager][${node.id}] ruleAndPointInfo 缺少 edgeRuleInfo`);
        results.push({ type: 'error', action: 'ruleAndPointInfo', error: '缺少 edgeRuleInfo' });
        return;
      }

      const edgeRuleInfo = JSON.parse(item.edgeRuleInfo);
      const chainName = edgeRuleInfo.chainName;

      if (!chainName) {
        log(`[rule-energy-manager][${node.id}] edgeRuleInfo 缺少 chainName`);
        results.push({ type: 'error', action: 'ruleAndPointInfo', error: 'edgeRuleInfo 缺少 chainName' });
        return;
      }

      log(`[rule-energy-manager][${node.id}] 处理 ruleAndPointInfo, chainName=${chainName}, ruleId=${edgeRuleInfo.ruleId}, pubFlag=${item.pubFlag}`);

      // 解析 equipPoints
      let equipPoints = [];
      if (item.edgeEquipPointInfos) {
        try {
          equipPoints = JSON.parse(item.edgeEquipPointInfos);
          log(`[rule-energy-manager][${node.id}] 解析 edgeEquipPointInfos 成功, 共 ${equipPoints.length} 个点位`);
        } catch (e) {
          log(`[rule-energy-manager][${node.id}] 解析 edgeEquipPointInfos 失败: ${e.message}`);
        }
      }

      // 构建规则对象
      const rule = {
        chainName: edgeRuleInfo.chainName,
        ruleId: edgeRuleInfo.ruleId,
        ruleType: edgeRuleInfo.ruleType,
        ruleSource: edgeRuleInfo.ruleSource,
        effectTimeName: edgeRuleInfo.effectTimeName,
        elData: edgeRuleInfo.elData,
        scripts: edgeRuleInfo.scripts || [],
        rulePointTypes: edgeRuleInfo.rulePointTypes || [],
        equipPoints: equipPoints,
        updateTime: Date.now()
      };

      node.ruleCache.set(chainName, rule);
      log(`[rule-energy-manager][${node.id}] 规则已保存, chainName=${chainName}, 当前规则总数=${node.ruleCache.size()}`);

      results.push({
        type: 'ruleUpdated',
        chainName: chainName,
        ruleId: edgeRuleInfo.ruleId,
        action: item.pubFlag === false ? 'saved' : 'published'
      });

    } catch (e) {
      log(`[rule-energy-manager][${node.id}] 解析 ruleAndPointInfo 失败: ${e.message}`);
      results.push({ type: 'error', action: 'ruleAndPointInfo', error: e.message });
    }
  }

  /**
   * 处理 edgeRelativeTime — 时间配置
   */
  function handleEdgeRelativeTime(item, node, log, results) {
    try {
      const timeList = JSON.parse(item.edgeRelativeTimeList || '[]');
      log(`[rule-energy-manager][${node.id}] 处理 edgeRelativeTime, 共 ${timeList.length} 条时间配置`);

      for (const timeConfig of timeList) {
        if (timeConfig.timeName) {
          node.timeCache.set(timeConfig.timeName, timeConfig);
        }
      }

      results.push({
        type: 'timeUpdated',
        count: timeList.length,
        timeNames: timeList.map(t => t.timeName)
      });

    } catch (e) {
      log(`[rule-energy-manager][${node.id}] 解析 edgeRelativeTime 失败: ${e.message}`);
      results.push({ type: 'error', action: 'edgeRelativeTime', error: e.message });
    }
  }

  /**
   * 处理 pointTypeRuleMapping — 点类型规则映射
   */
  function handlePointTypeRuleMapping(item, node, log, results) {
    try {
      const mappingList = JSON.parse(item.pointTypeRuleMappingList || '[]');
      log(`[rule-energy-manager][${node.id}] 处理 pointTypeRuleMapping, 共 ${mappingList.length} 条映射`);

      for (const mapping of mappingList) {
        if (mapping.pointTypeId !== undefined) {
          node.mappingCache.set(mapping.pointTypeId, mapping.chainIds || []);
        }
      }

      results.push({
        type: 'mappingUpdated',
        count: mappingList.length
      });

    } catch (e) {
      log(`[rule-energy-manager][${node.id}] 解析 pointTypeRuleMapping 失败: ${e.message}`);
      results.push({ type: 'error', action: 'pointTypeRuleMapping', error: e.message });
    }
  }

  /**
   * 处理 deleteRule — 删除规则
   */
  function handleDeleteRule(item, node, log, results) {
    try {
      const edgeRuleInfo = JSON.parse(item.edgeRuleInfo || '{}');
      const chainName = edgeRuleInfo.chainName;

      if (!chainName) {
        log(`[rule-energy-manager][${node.id}] deleteRule 缺少 chainName`);
        results.push({ type: 'error', action: 'deleteRule', error: '缺少 chainName' });
        return;
      }

      log(`[rule-energy-manager][${node.id}] 处理 deleteRule, chainName=${chainName}`);

      node.ruleCache.remove(chainName);

      results.push({
        type: 'ruleDeleted',
        chainName: chainName
      });

    } catch (e) {
      log(`[rule-energy-manager][${node.id}] 解析 deleteRule 失败: ${e.message}`);
      results.push({ type: 'error', action: 'deleteRule', error: e.message });
    }
  }

  RED.nodes.registerType('rule-energy-manager', RuleEnergyManagerNode);

  // ==================== HTTP API ====================
  RED.httpAdmin.get('/rule-energy-manager/:id/rules', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.ruleCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    const rules = node.ruleCache.getAll();
    const ruleList = Object.entries(rules).map(([chainName, rule]) => ({
      chainName,
      ruleId: rule.ruleId,
      ruleType: rule.ruleType,
      ruleSource: rule.ruleSource,
      effectTimeName: rule.effectTimeName,
      elData: rule.elData,
      scriptsCount: (rule.scripts || []).length,
      pointTypesCount: (rule.rulePointTypes || []).length,
      equipPointsCount: (rule.equipPoints || []).length,
      updateTime: rule.updateTime
    }));
    res.json({ count: ruleList.length, rules: ruleList });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/rule/:chainName', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.ruleCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    const rule = node.ruleCache.get(req.params.chainName);
    res.json({ chainName: req.params.chainName, rule: rule || null });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/status', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.ruleCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    res.json({
      ruleCount: node.ruleCache.size(),
      timeCount: node.timeCache.size(),
      mappingCount: node.mappingCache.size()
    });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/times', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.timeCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    res.json({ count: node.timeCache.size(), times: node.timeCache.getAll() });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/time/:timeName', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.timeCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    const timeConfig = node.timeCache.get(req.params.timeName);
    res.json({ timeName: req.params.timeName, timeConfig: timeConfig || null });
  });

  RED.httpAdmin.delete('/rule-energy-manager/:id/rule/:chainName', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.ruleCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    node.ruleCache.remove(req.params.chainName);
    res.json({ type: 'ruleDeleted', chainName: req.params.chainName });
  });

  RED.httpAdmin.delete('/rule-energy-manager/:id/time/:timeName', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.timeCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    node.timeCache.remove(req.params.timeName);
    res.json({ type: 'timeDeleted', timeName: req.params.timeName });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/mappings', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.mappingCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    res.json({ count: node.mappingCache.size(), mappings: node.mappingCache.getAll() });
  });

  RED.httpAdmin.delete('/rule-energy-manager/:id/mapping/:pointTypeId', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.mappingCache) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }
    node.mappingCache.remove(req.params.pointTypeId);
    res.json({ type: 'mappingDeleted', pointTypeId: req.params.pointTypeId });
  });
};
