# tangbao-he-rule-energy-helper 重构设计方案

## 一、设计目标

1. **接收云端下发的规则报文**，解析并缓存规则、时间配置、点类型映射
2. **接收边缘端点值上报**，根据点类型映射找到关联规则，执行规则链
3. **输出控制/告警/恢复消息**，通过 `msg` 传递给下游节点
4. **所有关键操作打印详细日志**，便于调试和排查问题

---

## 二、报文格式详解

### 2.1 云端下发报文（输入到 rule-energy-manager）

```json
{
  "iotId": "",
  "messageContent": {
    "timeStamp": 1778743364523,
    "companyId": "longfor",
    "gatewayCode": "",
    "cmdType": 71,
    "count": 1,
    "projectCard": "L-DLLH-DLKDT01",
    "cmd": "set",
    "detail": [
      // 具体业务数据
    ],
    "version": "1.1"
  },
  "messageId": "8e1765ed-2301-467b-a752-e7b900d9ee51",
  "topic": "/cmd/set/request"
}
```

### 2.2 四种 rulePubType 详解

#### ① ruleAndPointInfo — 创建/更新规则

```json
{
  "projectCard": "L-DLLH-DLKDT01",
  "edgeRuleInfo": "{...}",
  "edgeEquipPointInfos": "[...]",
  "pubFlag": true,
  "rulePubType": "ruleAndPointInfo"
}
```

`edgeRuleInfo` 解析后：

```json
{
  "chainName": "chain45",
  "effectTimeName": "营业时间",
  "elData": "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>",
  "ruleId": 64,
  "rulePointTypes": [
    { "dataType": "in", "pointTypeId": 1111101101, "stepId": 556 },
    { "dataType": "control", "pointTypeId": 1111101104, "stepId": 557 }
  ],
  "ruleSource": "control",
  "ruleType": "1",
  "scripts": [
    { "function": "EMPTY", "id": 555, "stepIndex": 1, "stepType": "0" },
    { "delay": 10, "function": "{1111101101}==0", "id": 556, "stepIndex": 2, "stepType": "1" },
    { "function": "1", "id": 557, "stepIndex": 3, "stepType": "3" }
  ]
}
```

`edgeEquipPointInfos` 解析后：

```json
[
  {
    "equipId": "L-DLLH-DLKDT01_DLKDT01-0005",
    "pointId": "TC1ETExILURMS0RUMDFfRExLRFQwMS0wMDA1XzExMTExMDExMDE=",
    "pointTypeId": 1111101101,
    "slotPath": "/Drivers/水泵07/points/On/Off_Status",
    "valueType": "BOOL"
  }
]
```

#### ② edgeRelativeTime — 时间配置

```json
{
  "projectCard": "L-DLLH-DLKDT01",
  "edgeRelativeTimeList": "[{\"begin\":\"09:16:10\",\"end\":\"23:16:10\",\"timeName\":\"营业时间\",\"timeType\":\"2\"}]",
  "rulePubType": "edgeRelativeTime"
}
```

解析后：

```json
{
  "营业时间": {
    "timeName": "营业时间",
    "timeType": "2",
    "begin": "09:16:10",
    "end": "23:16:10"
  }
}
```

#### ③ pointTypeRuleMapping — 点类型规则映射

```json
{
  "projectCard": "L-DLLH-DLKDT01",
  "pointTypeRuleMappingList": "[{\"chainIds\":[\"1\",\"3\",\"30\"],\"pointTypeId\":1010101100}]",
  "rulePubType": "pointTypeRuleMapping"
}
```

解析后：

```json
{
  "1010101100": ["1", "3", "30"]
}
```

#### ④ deleteRule — 删除规则

```json
{
  "projectCard": "L-DLLH-DLKDT01",
  "edgeRuleInfo": "{\"chainName\":\"chain45\"}",
  "rulePubType": "deleteRule"
}
```

---

### 2.3 点值上报报文（输入到 rule-energy-engine）

单条：

```json
{
  "pointId": "LzEyMzQ1Njc4OS9TMS8xMjM0NTY3ODkvMTYwMDA2L3B2MQ==",
  "slotPath": "/123456789/LRY.LJ2.LJ2_LQ_GSF_KG",
  "value": "123"
}
```

批量：

```json
[
  { "pointId": "...", "slotPath": "...", "value": "123" },
  { "pointId": "...", "slotPath": "...", "value": "0" }
]
```

---

## 三、节点设计

### 3.1 rule-energy-manager（规则管理节点）

**职责：** 接收云端下发的配置报文，解析并持久化到本地缓存

**输入：** `msg.payload` = 完整云端报文或 detail 单项

**输出：** `msg.payload` = 操作结果

**配置项：**

```javascript
defaults: {
  name: { value: '' },
  projectCard: { value: '', required: true }
}
```

**处理流程：**

```
msg 流入 (云端报文)
    │
    ▼
解析报文结构，提取 detail[]
    │
    ▼
遍历 detail
    │
    ├── ruleAndPointInfo ──→ 解析 edgeRuleInfo
    │                        解析 edgeEquipPointInfos
    │                        存入 rule-cache
    │
    ├── edgeRelativeTime ──→ 解析 edgeRelativeTimeList
    │                        存入 time-cache
    │
    ├── pointTypeRuleMapping ──→ 解析 pointTypeRuleMappingList
    │                            存入 mapping-cache
    │
    └── deleteRule ──→ 按 chainName 删除规则
```

**详细日志规范：**

| 场景 | 日志内容 |
|------|---------|
| 收到报文 | `[rule-energy-manager][${nodeId}] 收到报文, messageId=${messageId}, projectCard=${projectCard}` |
| 解析 detail | `[rule-energy-manager][${nodeId}] 解析到 detail 数组, length=${length}` |
| 处理 ruleAndPointInfo | `[rule-energy-manager][${nodeId}] 处理 ruleAndPointInfo, chainName=${chainName}, ruleId=${ruleId}, pubFlag=${pubFlag}` |
| 解析 edgeRuleInfo | `[rule-energy-manager][${nodeId}] 解析 edgeRuleInfo 成功, chainName=${chainName}, scripts=${scripts.length}个` |
| 解析 edgeEquipPointInfos | `[rule-energy-manager][${nodeId}] 解析 edgeEquipPointInfos, 共 ${count} 个点位` |
| 保存规则 | `[rule-energy-manager][${nodeId}] 规则已保存, chainName=${chainName}, 当前规则总数=${total}` |
| 处理 edgeRelativeTime | `[rule-energy-manager][${nodeId}] 处理 edgeRelativeTime, timeName=${timeName}, timeType=${timeType}, ${begin}-${end}` |
| 保存时间配置 | `[rule-energy-manager][${nodeId}] 时间配置已保存, timeName=${timeName}, 当前时间配置总数=${total}` |
| 处理 pointTypeRuleMapping | `[rule-energy-manager][${nodeId}] 处理 pointTypeRuleMapping, pointTypeId=${pointTypeId}, chainIds=[${chainIds}]` |
| 保存映射 | `[rule-energy-manager][${nodeId}] 点类型映射已保存, pointTypeId=${pointTypeId}, 当前映射总数=${total}` |
| 处理 deleteRule | `[rule-energy-manager][${nodeId}] 处理 deleteRule, chainName=${chainName}` |
| 删除成功 | `[rule-energy-manager][${nodeId}] 规则已删除, chainName=${chainName}` |
| 删除失败 | `[rule-energy-manager][${nodeId}] 删除规则失败, chainName=${chainName} 不存在` |
| 未知 rulePubType | `[rule-energy-manager][${nodeId}] 未知 rulePubType: ${rulePubType}, 跳过` |
| 解析失败 | `[rule-energy-manager][${nodeId}] 解析失败: ${error.message}, 原始数据: ${data}` |

---

### 3.2 rule-energy-engine（规则执行节点）

**职责：** 接收点值上报，匹配规则，执行规则链，输出结果

**输入：** `msg.payload` = 单条或批量点值

**输出：** `msg`（标准 Node-RED message，payload 为 control/alarm/alarmRecovery）

**配置项：**

```javascript
defaults: {
  name: { value: '' },
  managerNode: { value: '', type: 'rule-energy-manager', required: true },
  batchTriggerMode: { value: 'once' }  // 'once' = 批量点触发一次, 'each' = 每个点触发一次
}
```

**处理流程：**

```
msg 流入 (点值上报)
    │
    ▼
规范化点值数据 (统一为数组)
    │
    ▼
遍历每个点值
    │
    ├── 反查 pointTypeId (通过 slotPath 或 pointId 从规则缓存匹配)
    │
    ├── 查 mapping-cache 获取 chainIds
    │
    └── 记录 pointTypeId → value
    │
    ▼
合并去重 chainIds
    │
    ▼
遍历 chainId
    │
    ├── 获取规则
    │
    ├── 构建 pointList (填充当前值)
    │
    ├── 解析 elData 为 AST
    │
    └── 递归执行 AST
            │
            ├── effectiveTimeCmp
            │       ├── 日期判断
            │       ├── 时间判断
            │       └── 不满足 → 触发告警恢复
            │
            ├── deviceCalculateCmp
            │       ├── 替换 {pointTypeId} → value
            │       ├── eval 计算
            │       ├── delay 处理
            │       └── 不满足 → 触发告警恢复
            │
            └── controlCmp / alarmCmp
                    ├── 计算设定值 / 构建告警
                    └── 输出 msg
```

**详细日志规范：**

| 场景 | 日志内容 |
|------|---------|
| 收到点值 | `[rule-energy-engine][${nodeId}] 收到点值上报, 共 ${count} 个点` |
| 点值详情 | `[rule-energy-engine][${nodeId}] 点[${index}] pointId=${pid}, slotPath=${path}, value=${value}` |
| 反查 pointTypeId | `[rule-energy-engine][${nodeId}] 点 ${pointId} 反查 pointTypeId=${ptid}` |
| 无映射 | `[rule-energy-engine][${nodeId}] 点 ${pointId} (pointTypeId=${ptid}) 无关联规则, 跳过` |
| 关联规则 | `[rule-energy-engine][${nodeId}] pointTypeId=${ptid} 关联规则: [${chainIds}]` |
| 触发集合 | `[rule-energy-engine][${nodeId}] 本次触发规则集合: [${chainIds}]` |
| 开始执行 | `[rule-energy-engine][${nodeId}] 开始执行规则[${index}/${total}], chainName=${chainName}, ruleId=${ruleId}, ruleType=${ruleType}` |
| 构建 pointList | `[rule-energy-engine][${nodeId}] 构建 pointList, 共 ${count} 个点, 当前值: ${JSON.stringify(values)}` |
| 解析 AST | `[rule-energy-engine][${nodeId}] 解析执行链: ${elData}` |
| AST 节点 | `[rule-energy-engine][${nodeId}] AST 节点: ${nodeName}, args=${count}` |
| effectiveTimeCmp 开始 | `[effectiveTimeCmp][${chainName}] 开始检查生效时间` |
| effectiveTimeCmp 配置 | `[effectiveTimeCmp][${chainName}] 时间配置: timeName=${timeName}` |
| effectiveTimeCmp 日期 | `[effectiveTimeCmp][${chainName}] 日期范围: ${dateRange \|\| '无限制'}` |
| effectiveTimeCmp 时间 | `[effectiveTimeCmp][${chainName}] 时间范围: ${timeRange \|\| '无限制'}, 当前时间: ${now}` |
| effectiveTimeCmp 结果 | `[effectiveTimeCmp][${chainName}] 检查结果: ${result}` |
| effectiveTimeCmp 恢复 | `[effectiveTimeCmp][${chainName}] 时间不满足, 触发告警恢复` |
| deviceCalculateCmp 开始 | `[deviceCalculateCmp][${chainName}] 开始设备条件计算, stepIndex=${stepIndex}` |
| deviceCalculateCmp 表达式 | `[deviceCalculateCmp][${chainName}] 原始表达式: ${function}` |
| deviceCalculateCmp 替换 | `[deviceCalculateCmp][${chainName}] 替换后表达式: ${replaced}` |
| deviceCalculateCmp 计算 | `[deviceCalculateCmp][${chainName}] 计算结果: ${result}` |
| deviceCalculateCmp 延迟 | `[deviceCalculateCmp][${chainName}] 延迟=${delay}s, 首次=${isFirst}, processTimestamp=${ts}` |
| deviceCalculateCmp 等待 | `[deviceCalculateCmp][${chainName}] 延迟未到期, 还需 ${remain}s` |
| deviceCalculateCmp 到期 | `[deviceCalculateCmp][${chainName}] 延迟已到期, 返回 true` |
| deviceCalculateCmp 恢复 | `[deviceCalculateCmp][${chainName}] 条件不满足, 触发告警恢复` |
| controlCmp 开始 | `[controlCmp][${chainName}] 开始控制输出, stepIndex=${stepIndex}` |
| controlCmp 表达式 | `[controlCmp][${chainName}] 设定值表达式: ${function}` |
| controlCmp 计算 | `[controlCmp][${chainName}] 计算结果: ${value}` |
| controlCmp 输出 | `[controlCmp][${chainName}] 控制输出: pointId=${pid}, value=${value}` |
| alarmCmp 开始 | `[alarmCmp][${chainName}] 开始告警输出` |
| alarmCmp 检查 | `[alarmCmp][${chainName}] 告警去重检查: pointId=${pid}` |
| alarmCmp 已存在 | `[alarmCmp][${chainName}] 告警已存在, 跳过: pointId=${pid}` |
| alarmCmp 新建 | `[alarmCmp][${chainName}] 新建告警: alarmId=${alarmId}` |
| alarmCmp 输出 | `[alarmCmp][${chainName}] 告警输出: alarmId=${alarmId}, priority=${priority}` |
| 告警恢复 | `[alarmRecovery][${chainName}] 触发告警恢复: pointId=${pid}` |
| 规则完成 | `[rule-energy-engine][${nodeId}] 规则执行完成, chainName=${chainName}, 输出 ${count} 条` |
| 无规则 | `[rule-energy-engine][${nodeId}] 无匹配规则, 跳过` |

---

## 四、缓存模块设计

### 4.1 rule-cache.js（规则缓存）

**内存结构：**

```javascript
{
  "chain45": {
    chainName: "chain45",
    ruleId: 64,
    ruleType: "1",
    ruleSource: "control",
    effectTimeName: "营业时间",
    elData: "...",
    scripts: [...],
    rulePointTypes: [...],
    equipPoints: [...],
    projectCard: "L-DLLH-DLKDT01",
    updateTime: 1778743364523
  }
}
```

**持久化文件：** `~/.node-red/rule-cache/rules_<managerNodeId>.json`

**方法：**

- `set(chainName, rule)` — 保存规则
- `get(chainName)` — 获取规则
- `remove(chainName)` — 删除规则
- `getAll()` — 获取所有规则
- `findByPointId(pointId)` — 通过 pointId 反查规则
- `findBySlotPath(slotPath)` — 通过 slotPath 反查 pointTypeId

**日志：**

- `[rule-cache] 加载本地规则, 共 ${count} 条, 文件=${file}`
- `[rule-cache] 保存规则, chainName=${chainName}`
- `[rule-cache] 删除规则, chainName=${chainName}`
- `[rule-cache] 反查 pointId=${pointId} → pointTypeId=${ptid}`

---

### 4.2 time-cache.js（时间配置缓存）

**内存结构：**

```javascript
{
  "营业时间": {
    timeName: "营业时间",
    timeType: "2",
    begin: "09:16:10",
    end: "23:16:10"
  }
}
```

**持久化文件：** `~/.node-red/rule-cache/times_<managerNodeId>.json`

**方法：**

- `set(timeName, config)`
- `get(timeName)`
- `remove(timeName)`
- `getAll()`

**日志：**

- `[time-cache] 加载本地时间配置, 共 ${count} 条`
- `[time-cache] 保存时间配置, timeName=${timeName}`
- `[time-cache] 获取时间配置, timeName=${timeName}, 结果=${config \|\| '不存在'}`

---

### 4.3 mapping-cache.js（点类型映射缓存）

**内存结构：**

```javascript
{
  "1111101101": ["1", "3", "30", "4", "38", "39"],
  "1111101104": ["1", "3", "5"]
}
```

**持久化文件：** `~/.node-red/rule-cache/mappings_<managerNodeId>.json`

**方法：**

- `set(pointTypeId, chainIds)`
- `get(pointTypeId)`
- `remove(pointTypeId)`
- `getAll()`

**日志：**

- `[mapping-cache] 加载本地映射, 共 ${count} 条`
- `[mapping-cache] 保存映射, pointTypeId=${pointTypeId}, chainIds=[${chainIds}]`
- `[mapping-cache] 获取映射, pointTypeId=${pointTypeId}, 结果=[${result}]`

---

### 4.4 delay-manager.js（延迟状态管理）

**内存结构：**

```javascript
{
  "L-DLLH-DLKDT01:chain45:2": {
    chainName: "chain45",
    stepIndex: 2,
    projectCard: "L-DLLH-DLKDT01",
    pointId: "TC1ETExIL...",
    processTimestamp: 1778743364523,
    delay: 10,
    timestamp: 1778743364523
  }
}
```

**持久化文件：** `~/.node-red/rule-cache/delays_<engineNodeId>.json`

**方法：**

- `set(key, info)` — key = `${projectCard}:${chainName}:${stepIndex}`
- `get(key)`
- `remove(key)`
- `clear(chainName)` — 清除某规则的所有延迟
- `isExpired(key, now)` — 检查延迟是否到期

**日志：**

- `[delay-manager] 加载本地延迟状态, 共 ${count} 条`
- `[delay-manager] 设置延迟, key=${key}, delay=${delay}s`
- `[delay-manager] 检查延迟, key=${key}, 已过去 ${elapsed}s, 剩余 ${remain}s`
- `[delay-manager] 延迟到期, key=${key}`
- `[delay-manager] 清除延迟, key=${key}`

---

## 五、执行引擎模块设计

### 5.1 chain-parser.js（执行链解析器）

**输入：** `elData = "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>"`

**输出：** AST 对象

```javascript
{
  type: 'function',
  name: 'IF',
  args: [
    { type: 'function', name: 'effectiveTimeCmp', args: [] },
    {
      type: 'function',
      name: 'IF',
      args: [
        { type: 'function', name: 'deviceCalculateCmp', args: [] },
        { type: 'function', name: 'controlCmp', args: [] }
      ]
    }
  ]
}
```

**解析算法：**

1. 提取 `<chain>...</chain>` 内容
2. 用栈解析嵌套函数调用
3. 遇到 `(` 压栈，遇到 `)` 出栈构建节点
4. 参数按 `,` 分隔

**日志：**

- `[chain-parser] 解析执行链: ${elData}`
- `[chain-parser] 提取表达式: ${expr}`
- `[chain-parser] 解析完成, AST: ${JSON.stringify(ast)}`

---

### 5.2 effective-time-cmp.js

```javascript
/**
 * 生效时间判断
 * @param {Object} context - { rule, projectCard, chainName }
 * @returns {boolean} true=生效, false=不生效（触发恢复）
 */
function effectiveTimeCmp(context) {
  const { rule, projectCard, chainName } = context;

  // 1. 获取时间配置
  const timeName = rule.effectTimeName;
  if (!timeName) {
    log(`[effectiveTimeCmp][${chainName}] 无生效时间配置, 默认通过`);
    return true;
  }

  const timeConfig = timeCache.get(timeName);
  if (!timeConfig) {
    log(`[effectiveTimeCmp][${chainName}] 时间配置不存在: ${timeName}, 默认通过`);
    return true;
  }

  // 2. 日期判断（timeType="3" 时）
  if (timeConfig.timeType === "3" && timeConfig.begin && timeConfig.end) {
    const now = new Date();
    const startDate = parseDate(timeConfig.begin);
    const endDate = parseDate(timeConfig.end);
    if (now < startDate || now > endDate) {
      log(`[effectiveTimeCmp][${chainName}] 日期不满足: ${timeConfig.begin} ~ ${timeConfig.end}`);
      triggerAlarmRecovery(context);
      return false;
    }
  }

  // 3. 时间判断（timeType="2" 时）
  const nowTime = formatTime(new Date());  // "HH:mm:ss"
  const begin = timeConfig.begin;  // "09:16:10"
  const end = timeConfig.end;      // "23:16:10"

  let result;
  if (begin <= end) {
    // 正常区间 09:00-18:00
    result = (nowTime >= begin && nowTime <= end);
  } else {
    // 跨天区间 21:00-06:00
    result = (nowTime >= begin || nowTime <= end);
  }

  if (!result) {
    log(`[effectiveTimeCmp][${chainName}] 时间不满足: ${begin} ~ ${end}, 当前: ${nowTime}`);
    triggerAlarmRecovery(context);
    return false;
  }

  log(`[effectiveTimeCmp][${chainName}] 时间检查通过: ${begin} ~ ${end}`);
  return true;
}
```

---

### 5.3 device-calculate-cmp.js

```javascript
/**
 * 设备条件计算
 * @param {Object} context - { rule, pointList, projectCard, chainName, stepIndex }
 * @returns {boolean} true=条件满足, false=不满足（触发恢复）
 */
function deviceCalculateCmp(context) {
  const { rule, pointList, chainName, stepIndex } = context;

  // 1. 获取当前步骤的脚本
  const script = rule.scripts.find(s => s.stepIndex === stepIndex);
  if (!script) {
    log(`[deviceCalculateCmp][${chainName}] 未找到 stepIndex=${stepIndex} 的脚本`);
    return false;
  }

  // 2. 替换表达式中的 {pointTypeId}
  let expr = script.function;
  const pointMap = {};
  for (let p of pointList) {
    pointMap[p.pointTypeId] = p.value;
  }

  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    const value = pointMap[ptid];
    log(`[deviceCalculateCmp][${chainName}] 替换 {${ptid}} → ${value}`);
    return value !== undefined ? value : '0';
  });

  log(`[deviceCalculateCmp][${chainName}] 替换后表达式: ${expr}`);

  // 3. 计算表达式
  let result;
  try {
    result = evalExpression(expr);
    log(`[deviceCalculateCmp][${chainName}] 计算结果: ${result}`);
  } catch (e) {
    log(`[deviceCalculateCmp][${chainName}] 表达式计算错误: ${e.message}`);
    return false;
  }

  // 4. 处理延迟
  const delay = script.delay || 0;
  if (delay > 0 && result) {
    const key = `${projectCard}:${chainName}:${stepIndex}`;
    const delayInfo = delayManager.get(key);

    if (!delayInfo) {
      // 首次满足，记录时间戳
      delayManager.set(key, {
        chainName, stepIndex, projectCard,
        pointId: pointList[0]?.pointId,
        processTimestamp: Date.now(),
        delay
      });
      log(`[deviceCalculateCmp][${chainName}] 首次满足, 延迟 ${delay}s, 记录时间戳`);
      return false;  // 首次返回 false，等待延迟
    } else {
      // 非首次，检查延迟是否到期
      const elapsed = (Date.now() - delayInfo.processTimestamp) / 1000;
      if (elapsed >= delay) {
        log(`[deviceCalculateCmp][${chainName}] 延迟已到期 (${elapsed}s >= ${delay}s)`);
        return true;
      } else {
        log(`[deviceCalculateCmp][${chainName}] 延迟未到期, 还需 ${delay - elapsed}s`);
        return false;
      }
    }
  }

  // 5. 不满足条件，触发恢复
  if (!result) {
    log(`[deviceCalculateCmp][${chainName}] 条件不满足`);
    triggerAlarmRecovery(context);
    delayManager.clear(chainName);  // 清除延迟状态
  }

  return result;
}
```

---

### 5.4 control-cmp.js

```javascript
/**
 * 控制输出
 * @param {Object} context - { rule, pointList, projectCard, chainName, stepIndex }
 * @returns {Object} 输出结果
 */
function controlCmp(context) {
  const { rule, pointList, chainName, stepIndex } = context;

  // 1. 获取当前步骤的脚本
  const script = rule.scripts.find(s => s.stepIndex === stepIndex);
  if (!script) {
    log(`[controlCmp][${chainName}] 未找到 stepIndex=${stepIndex} 的脚本`);
    return null;
  }

  // 2. 计算设定值
  let expr = script.function;
  const pointMap = {};
  for (let p of pointList) {
    pointMap[p.pointTypeId] = p.value;
  }

  expr = expr.replace(/\{(\d+)\}/g, (match, ptid) => {
    return pointMap[ptid] !== undefined ? pointMap[ptid] : '0';
  });

  let value;
  try {
    value = evalExpression(expr);
    log(`[controlCmp][${chainName}] 设定值计算: ${expr} = ${value}`);
  } catch (e) {
    log(`[controlCmp][${chainName}] 设定值计算错误: ${e.message}`);
    return null;
  }

  // 3. 找到控制输出点位
  const controlPointType = rule.rulePointTypes.find(rpt => rpt.dataType === 'control');
  if (!controlPointType) {
    log(`[controlCmp][${chainName}] 未找到控制输出点位`);
    return null;
  }

  const equipPoint = rule.equipPoints.find(ep => ep.pointTypeId === controlPointType.pointTypeId);
  if (!equipPoint) {
    log(`[controlCmp][${chainName}] 未找到控制输出设备点位`);
    return null;
  }

  // 4. 构建输出
  const output = {
    type: 'control',
    chainName,
    ruleId: rule.ruleId,
    projectCard,
    outputs: [{
      pointId: equipPoint.pointId,
      slotPath: equipPoint.slotPath,
      value: String(value),
      equipId: equipPoint.equipId
    }],
    timestamp: Date.now()
  };

  log(`[controlCmp][${chainName}] 控制输出: pointId=${equipPoint.pointId}, value=${value}`);
  return output;
}
```

---

### 5.5 alarm-cmp.js

```javascript
/**
 * 告警输出
 * @param {Object} context - { rule, pointList, projectCard, chainName }
 * @returns {Object} 输出结果
 */
function alarmCmp(context) {
  const { rule, pointList, projectCard, chainName } = context;

  // 1. 获取告警点位（dataType="in" 的第一个点）
  const alarmPointType = rule.rulePointTypes.find(rpt => rpt.dataType === 'in');
  if (!alarmPointType) {
    log(`[alarmCmp][${chainName}] 未找到告警输入点位`);
    return null;
  }

  const point = pointList.find(p => p.pointTypeId === alarmPointType.pointTypeId);
  if (!point) {
    log(`[alarmCmp][${chainName}] 点列表中无告警点位`);
    return null;
  }

  // 2. 告警去重检查
  const alarmKey = `${projectCard}:${chainName}:${point.pointId}`;
  if (alarmStateCache.has(alarmKey)) {
    log(`[alarmCmp][${chainName}] 告警已存在, 跳过: pointId=${point.pointId}`);
    return null;
  }

  // 3. 构建告警
  const alarmId = generateUUID();
  const conditionId = `${chainName}_${md5(chainName)}`;

  const output = {
    type: 'alarm',
    chainName,
    ruleId: rule.ruleId,
    projectCard,
    alarmId,
    conditionId,
    priority: rule.priority || '3',
    pointId: point.pointId,
    slotPath: point.slotPath,
    alarmValue: point.value,
    alarmDesc: rule.alarmDesc || '',
    timestamp: Date.now()
  };

  // 4. 记录告警状态
  alarmStateCache.set(alarmKey, {
    alarmId,
    timestamp: Date.now()
  });

  log(`[alarmCmp][${chainName}] 新建告警: alarmId=${alarmId}, pointId=${point.pointId}`);
  return output;
}
```

---

### 5.6 告警恢复逻辑

```javascript
function triggerAlarmRecovery(context) {
  const { rule, pointList, projectCard, chainName } = context;

  // 1. 清除告警状态
  for (let point of pointList) {
    const alarmKey = `${projectCard}:${chainName}:${point.pointId}`;
    if (alarmStateCache.has(alarmKey)) {
      alarmStateCache.delete(alarmKey);
      log(`[alarmRecovery][${chainName}] 清除告警状态: pointId=${point.pointId}`);
    }
  }

  // 2. 清除延迟状态
  delayManager.clear(chainName);
  log(`[alarmRecovery][${chainName}] 清除延迟状态`);

  // 3. 输出恢复消息
  const outputs = pointList.map(point => ({
    type: 'alarmRecovery',
    chainName,
    ruleId: rule.ruleId,
    projectCard,
    pointId: point.pointId,
    normalTime: Date.now()
  }));

  for (let output of outputs) {
    log(`[alarmRecovery][${chainName}] 输出恢复: pointId=${output.pointId}`);
  }

  return outputs;
}
```

---

## 六、表达式计算（expr-eval.js）

```javascript
/**
 * 安全表达式计算
 * 支持: + - * / > < >= <= == != && ||
 */
function evalExpression(expr) {
  // 1. 清理表达式
  expr = String(expr).trim();

  // 2. 替换布尔值
  expr = expr.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');

  // 3. 安全检查：只允许数字、运算符、括号、空格
  if (!/^[0-9+\-*/().<>=!&|\s]+$/.test(expr)) {
    throw new Error('表达式包含非法字符');
  }

  // 4. 替换运算符为 JS 风格
  expr = expr.replace(/&&/g, '&&').replace(/\|\|/g, '||').replace(/==/g, '===').replace(/!=/g, '!==');

  // 5. 使用 Function 安全计算
  try {
    const result = new Function('return ' + expr)();
    return result;
  } catch (e) {
    throw new Error('表达式计算失败: ' + e.message);
  }
}
```

---

## 七、输出消息格式

### 7.1 control

```json
{
  "type": "control",
  "chainName": "chain45",
  "ruleId": 64,
  "projectCard": "L-DLLH-DLKDT01",
  "outputs": [
    {
      "pointId": "TC1ETExIL...",
      "slotPath": "/Drivers/水泵07/points/control",
      "value": "1",
      "equipId": "L-DLLH-DLKDT01_DLKDT01-0005"
    }
  ],
  "timestamp": 1778743364523
}
```

### 7.2 alarm

```json
{
  "type": "alarm",
  "chainName": "chain45",
  "ruleId": 64,
  "projectCard": "L-DLLH-DLKDT01",
  "alarmId": "uuid",
  "conditionId": "chain45_xxx",
  "priority": "1",
  "pointId": "TC1ETExIL...",
  "slotPath": "/Drivers/水泵07/points/On/Off_Status",
  "alarmValue": "123",
  "alarmDesc": "温度过高",
  "timestamp": 1778743364523
}
```

### 7.3 alarmRecovery

```json
{
  "type": "alarmRecovery",
  "chainName": "chain45",
  "ruleId": 64,
  "projectCard": "L-DLLH-DLKDT01",
  "pointId": "TC1ETExIL...",
  "normalTime": 1778743364523
}
```

---

## 八、文件结构

```
tangbao-he-rule-energy-helper/
├── package.json
├── README.md
├── LICENSE
├── Design.md
├── icons/
│   └── logo.png
├── locales/
│   └── zh-CN/
│       ├── rule-energy-manager.json
│       └── rule-energy-engine.json
├── lib/
│   ├── cache/
│   │   ├── rule-cache.js
│   │   ├── time-cache.js
│   │   └── mapping-cache.js
│   ├── engine/
│   │   ├── chain-parser.js
│   │   ├── effective-time-cmp.js
│   │   ├── device-calculate-cmp.js
│   │   ├── control-cmp.js
│   │   ├── alarm-cmp.js
│   │   └── delay-manager.js
│   └── utils/
│       └── expr-eval.js
├── rule-manager.js
├── rule-manager.html
├── rule-engine.js
├── rule-engine.html
└── examples/
    └── 边缘规则引擎示例.json
```

---

## 九、package.json 节点注册

```json
{
  "node-red": {
    "nodes": {
      "rule-energy-manager": "rule-manager.js",
      "rule-energy-engine": "rule-engine.js"
    }
  }
}
```

---

## 十、实施步骤

1. 创建 `lib/cache/` 三个缓存模块（带文件持久化）
2. 创建 `lib/engine/` 五个引擎模块
3. 创建 `lib/utils/expr-eval.js`
4. 创建 `rule-manager.js/html`
5. 创建 `rule-engine.js/html`
6. 更新 `package.json`（删除 `rule-energy-config`，注册新节点）
7. 删除旧文件（`rule-config.js/html`, `lib/rule-cache.js`, `lib/rule-matcher.js`, `lib/rule-executor.js`, `lib/expr-eval.js`）
8. 创建示例 flow
9. 编写测试
