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

        // 支持 detail 直接放在 payload 中（新格式）或 简化结构
        if (Array.isArray(payload.detail)) {
          detail = payload.detail;
          log(`[rule-energy-manager][${node.id}] 解析到 detail 数组, length=${detail.length}`);
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
          effectDateName: rule.effectDateName,
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

      // 解析 edgeGroupEquipPointInfos（多设备配对分组）
      let groupEquipPoints = [];
      let groupMapping = {};
      if (item.edgeGroupEquipPointInfos) {
        try {
          groupEquipPoints = JSON.parse(item.edgeGroupEquipPointInfos);
          log(`[rule-energy-manager][${node.id}] 解析 edgeGroupEquipPointInfos 成功, 共 ${groupEquipPoints.length} 个分组点位`);

          // 将分组点位合并到 equipPoints，用于反查 pointTypeId
          equipPoints = equipPoints.concat(groupEquipPoints);
          log(`[rule-energy-manager][${node.id}] 合并分组点位到 equipPoints, 当前共 ${equipPoints.length} 个点位`);

          // 构建分组映射（兼容空 groupName 的情况）
          const groupPointMapping = {}; // groupName -> Set<pointId>
          const pointGroupMapping = {}; // pointId -> Set<groupName>

          for (const gp of groupEquipPoints) {
            if (!gp.pointId) continue;

            // 有 groupName 才构建映射关系
            if (gp.groupName) {
              if (!groupPointMapping[gp.groupName]) {
                groupPointMapping[gp.groupName] = new Set();
              }
              groupPointMapping[gp.groupName].add(gp.pointId);

              if (!pointGroupMapping[gp.pointId]) {
                pointGroupMapping[gp.pointId] = new Set();
              }
              pointGroupMapping[gp.pointId].add(gp.groupName);
            }
          }

          // 构建最终映射结构: pointId -> { groupName: [pointIds] }
          for (const pointId of Object.keys(pointGroupMapping)) {
            const groupNames = Array.from(pointGroupMapping[pointId]);
            const mappingObj = {};
            for (const groupName of groupNames) {
              if (groupPointMapping[groupName]) {
                mappingObj[groupName] = Array.from(groupPointMapping[groupName]);
              }
            }
            groupMapping[pointId] = mappingObj;
          }

          const groupNames = Object.keys(groupPointMapping);
          log(`[rule-energy-manager][${node.id}] 构建分组映射完成, 共 ${groupNames.length} 个分组: [${groupNames}]`);
        } catch (e) {
          log(`[rule-energy-manager][${node.id}] 解析 edgeGroupEquipPointInfos 失败: ${e.message}`);
        }
      }

      // 自动生成缺失的 elData（对齐 Java 端 LiteFlow 链结构）
      let elData = edgeRuleInfo.elData;
      if (!elData) {
        const source = edgeRuleInfo.ruleSource;
        if (source === 'alarm') {
          elData = '<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,alarmCmp))</chain>';
        } else if (source === 'control') {
          elData = '<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>';
        }
        if (elData) {
          log(`[rule-energy-manager][${node.id}] chainName=${chainName} 缺失 elData, 根据 ruleSource=${source} 自动生成`);
        }
      }

      // 构建规则对象
      const rule = {
        chainName: edgeRuleInfo.chainName,
        ruleId: edgeRuleInfo.ruleId,
        ruleType: edgeRuleInfo.ruleType,
        ruleSource: edgeRuleInfo.ruleSource,
        effectTimeName: edgeRuleInfo.effectTimeName,
        effectDateName: edgeRuleInfo.effectDateName,
        elData: elData,
        scripts: edgeRuleInfo.scripts || [],
        rulePointTypes: edgeRuleInfo.rulePointTypes || [],
        equipPoints: equipPoints,
        groupEquipPoints: groupEquipPoints,
        groupMapping: groupMapping,
        alarmLevel: edgeRuleInfo.alarmLevel,
        alarmDesc: edgeRuleInfo.alarmDesc,
        updateTime: Date.now()
      };

      node.ruleCache.set(chainName, rule);
      log(`[rule-energy-manager][${node.id}] 规则已保存, chainName=${chainName}, 当前规则总数=${node.ruleCache.size()}`);

      // 同步刷新 engine 节点的规则缓存和 AST 缓存
      refreshEngineRuleCache(log);
      clearEngineAstCache(chainName, log);

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

      // 同步刷新 engine 节点的规则缓存和 AST 缓存
      refreshEngineRuleCache(log);
      clearEngineAstCache(chainName, log);

      results.push({
        type: 'ruleDeleted',
        chainName: chainName
      });

    } catch (e) {
      log(`[rule-energy-manager][${node.id}] 解析 deleteRule 失败: ${e.message}`);
      results.push({ type: 'error', action: 'deleteRule', error: e.message });
    }
  }

  /**
   * 清理所有 engine 节点的 AST 缓存
   * @param {string} chainName - 规则链名称
   * @param {Function} log - 日志函数
   */
  function clearEngineAstCache(chainName, log) {
    let count = 0;
    RED.nodes.eachNode(function(n) {
      if (n.type === 'rule-energy-engine') {
        const engineNode = RED.nodes.getNode(n.id);
        if (engineNode && engineNode.astCache) {
          engineNode.astCache.delete(chainName);
          count++;
        }
      }
    });
    if (count > 0) {
      log(`[rule-energy-manager] 清理 engine AST 缓存, chainName=${chainName}, 共 ${count} 个节点`);
    }
  }

  /**
   * 刷新所有 engine 节点的规则缓存
   * @param {Function} log - 日志函数
   */
  function refreshEngineRuleCache(log) {
    let count = 0;
    RED.nodes.eachNode(function(n) {
      if (n.type === 'rule-energy-engine') {
        const engineNode = RED.nodes.getNode(n.id);
        if (engineNode && engineNode.ruleCache) {
          engineNode.ruleCache._load();
          count++;
        }
      }
    });
    if (count > 0) {
      log(`[rule-energy-manager] 刷新 engine 规则缓存, 共 ${count} 个节点`);
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
      effectDateName: rule.effectDateName,
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

    // 同步刷新 engine 节点的规则缓存和 AST 缓存
    refreshEngineRuleCache(() => {});
    clearEngineAstCache(req.params.chainName, () => {});

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

  // ==================== 缓存与持久化数据查看 API ====================
  const fs = require('fs');
  const path = require('path');

  RED.httpAdmin.get('/rule-energy-manager/:id/cache-data', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }

    const cacheType = req.query.type || 'all';
    const result = {};

    // 规则缓存
    if (cacheType === 'all' || cacheType === 'rules') {
      result.rules = node.ruleCache ? node.ruleCache.getAll() : {};
    }

    // 时间配置缓存
    if (cacheType === 'all' || cacheType === 'times') {
      result.times = node.timeCache ? node.timeCache.getAll() : {};
    }

    // 映射缓存
    if (cacheType === 'all' || cacheType === 'mappings') {
      result.mappings = node.mappingCache ? node.mappingCache.getAll() : {};
    }

    // 告警状态缓存（从所有 engine 节点获取）
    if (cacheType === 'all' || cacheType === 'alarmStates') {
      result.alarmStates = {};
      // 遍历所有 engine 节点，自动关联（项目独立部署，通常只有一个 engine）
      RED.nodes.eachNode(function(n) {
        if (n.type === 'rule-energy-engine') {
          const engineNode = RED.nodes.getNode(n.id);
          if (engineNode && engineNode.alarmStateCache) {
            result.alarmStates[n.id] = {
              nodeName: n.name || n.id,
              states: engineNode.alarmStateCache.getAll(),
              count: engineNode.alarmStateCache.size()
            };
          }
        }
      });
    }

    res.json({ type: 'cacheData', cacheType, data: result });
  });

  RED.httpAdmin.get('/rule-energy-manager/:id/persist-data', function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      return res.status(404).json({ error: '节点不存在或未就绪' });
    }

    const persistType = req.query.type || 'all';
    const result = {};

    const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');

    const fileMap = {
      rules: 'rules.json',
      times: 'times.json',
      mappings: 'mappings.json',
      alarmStates: 'alarm-states.json'
    };

    for (const [key, filename] of Object.entries(fileMap)) {
      if (persistType === 'all' || persistType === key) {
        const filePath = path.join(CACHE_DIR, filename);
        try {
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            result[key] = {
              filePath,
              size: stat.size,
              lastModified: stat.mtime,
              content: JSON.parse(content)
            };
          } else {
            result[key] = { filePath, exists: false };
          }
        } catch (e) {
          result[key] = { filePath, error: e.message };
        }
      }
    }

    res.json({ type: 'persistData', persistType, data: result });
  });
};
