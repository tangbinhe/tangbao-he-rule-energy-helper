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
  "timeStamp": 1778743364523,
  "companyId": "longfor",
  "gatewayCode": "",
  "cmdType": 71,
  "count": 1,
  "cmd": "set",
  "detail": [
    // 具体业务数据
  ],
  "version": "1.1"
}
```

> 注意：`msg.payload` 直接传入原来 `messageContent` 内的内容，`detail` 在 payload 根层级，不再有外层 `messageContent` 包装。

### 2.2 四种 rulePubType 详解

#### ① ruleAndPointInfo — 创建/更新规则

```json
{
  "edgeRuleInfo": "{...}",
  "edgeEquipPointInfos": "[...]",
  "pubFlag": true,
  "rulePubType": "ruleAndPointInfo"
}
```

`edgeRuleInfo` 解析后（`ruleSource` 决定规则类型）：

**① 控制规则（`ruleSource: "control"`）：**

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

**② 告警规则（`ruleSource: "alarm"`）：**

```json
{
  "chainName": "chain46",
  "effectTimeName": "营业时间",
  "effectDateName": "运行日期",
  "elData": "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,alarmCmp))</chain>",
  "ruleId": 65,
  "rulePointTypes": [
    { "dataType": "in", "pointTypeId": 1111101101, "stepId": 558 },
    { "dataType": "in", "pointTypeId": 1111101102, "stepId": 559 }
  ],
  "ruleSource": "alarm",
  "ruleType": "1",
  "priority": "3",
  "alarmDesc": "温度过高",
  "scripts": [
    { "function": "EMPTY", "id": 558, "stepIndex": 1, "stepType": "0" },
    { "delay": 0, "function": "{1111101101}>80", "id": 559, "stepIndex": 2, "stepType": "1" }
  ]
}
```

> 两种规则的区别：
> - **控制规则**：`ruleSource="control"`，`elData` 最终调用 `controlCmp`，`rulePointTypes` 含 `dataType="control"`，`scripts` 含 `stepType="3"`
> - **告警规则**：`ruleSource="alarm"`，`elData` 最终调用 `alarmCmp`，`rulePointTypes` 只有 `dataType="in"`，`scripts` 无 `stepType="3"`，额外含 `priority`/`alarmDesc`

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

`edgeGroupEquipPointInfos`（可选，多设备配对分组）：

```json
[
  {
    "equipId": "L-DLLH-DLKDT01_DLKDT01-0005",
    "pointId": "TC1ETExILURMS0RUMDFfRExLRFQwMS0wMDA1XzExMTExMDExMDE=",
    "pointTypeId": 1111101101,
    "slotPath": "/Drivers/水泵07/points/On/Off_Status",
    "valueType": "BOOL",
    "groupName": "groupA"
  }
]
```

> 分组点位会自动合并到 `equipPoints` 中，同时构建 `groupMapping`：
> ```json
> {
>   "pointId1": { "groupA": ["pointId1", "pointId2"] },
>   "pointId2": { "groupA": ["pointId1", "pointId2"] }
> }
> ```

#### ② edgeRelativeTime — 时间配置

```json
{
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
  name: { value: '' }
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
| 收到报文 | `[rule-energy-manager][${nodeId}] 收到报文, topic=${msg.topic || 'none'}` |
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

**输出：** `msg`（标准 Node-RED message，payload 为 control/alarm。恢复消息 `type` 同样为 `alarm`，仅 `alarmStatus` 为 `"normal"`）

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

**内存结构（控制规则示例）：**

```javascript
{
  "chain45": {
    chainName: "chain45",
    ruleId: 64,
    ruleType: "1",
    ruleSource: "control",
    effectTimeName: "营业时间",
    effectDateName: null,
    elData: "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>",
    scripts: [...],
    rulePointTypes: [
      { dataType: "in", pointTypeId: 1111101101, stepId: 556 },
      { dataType: "control", pointTypeId: 1111101104, stepId: 557 }
    ],
    equipPoints: [...],
    groupEquipPoints: [...],
    groupMapping: {
      "pointId1": { "groupA": ["pointId1", "pointId2"] }
    },
    updateTime: 1778743364523
  },
  "chain46": {
    chainName: "chain46",
    ruleId: 65,
    ruleType: "1",
    ruleSource: "alarm",
    effectTimeName: "营业时间",
    effectDateName: "运行日期",
    elData: "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,alarmCmp))</chain>",
    scripts: [
      { function: "EMPTY", id: 558, stepIndex: 1, stepType: "0" },
      { delay: 0, function: "{1111101101}>80", id: 559, stepIndex: 2, stepType: "1" }
    ],
    rulePointTypes: [
      { dataType: "in", pointTypeId: 1111101101, stepId: 558 },
      { dataType: "in", pointTypeId: 1111101102, stepId: 559 }
    ],
    equipPoints: [...],
    groupEquipPoints: [...],
    groupMapping: {},
    priority: "3",
    alarmDesc: "温度过高",
    updateTime: 1778743364523
  }
}
```

**字段说明：**

| 字段 | 控制规则 | 告警规则 | 说明 |
|------|---------|---------|------|
| `ruleSource` | `"control"` | `"alarm"` | 规则来源，决定执行链终点 |
| `elData` | 含 `controlCmp` | 含 `alarmCmp` | 规则执行链 XML |
| `rulePointTypes` | 含 `dataType="in"` 和 `"control"` | 只有 `dataType="in"` | 告警规则无控制输出点位 |
| `scripts` | 含 `stepType="3"` | 无 `stepType="3"` | 告警规则无执行脚本 |
| `priority` | 无 | 有 | 告警优先级（如 `"1"`~`"5"`） |
| `alarmDesc` | 无 | 有 | 告警描述文本 |
| `effectDateName` | 可选 | 可选 | 生效日期范围配置名称 |

**持久化文件：** `~/.node-red/rule-cache/rules.json`

**方法：**

- `set(chainName, rule)` — 保存规则
- `get(chainName)` — 获取规则
- `remove(chainName)` — 删除规则
- `getAll()` — 获取所有规则
- `findPointTypeIdByPointId(pointId)` — 通过 pointId 反查 pointTypeId
- `findPointTypeIdBySlotPath(slotPath)` — 通过 slotPath 反查 pointTypeId

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

**持久化文件：** `~/.node-red/rule-cache/times.json`

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

**持久化文件：** `~/.node-red/rule-cache/mappings.json`

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

**触发场景：**

延迟由 `device-calculate-cmp.js` 触发。当规则脚本 `stepType="1"` 的条件表达式计算结果为 `true`，且该脚本配置了 `delay > 0` 时，首次满足条件会记录延迟状态并返回 `false`（不继续执行后续组件）；待延迟时间到期后，再次执行规则链时返回 `true`，才会触发 `controlCmp` 或 `alarmCmp`。

**延迟逻辑：**

1. **首次满足**：条件表达式结果为 `true` 且 `delay > 0`，检查缓存中是否已存在该 key（`${chainName}:${stepIndex}`）
   - 不存在：记录 `processTimestamp = Date.now()`，保存 `pointListSnapshot` 和 `ruleSnapshot`，返回 `false`
   - 已存在：计算已过去的时间 `elapsed = (now - processTimestamp) / 1000`
     - `elapsed >= delay`：延迟到期，返回 `true`
     - `elapsed < delay`：延迟未到期，返回 `false`
2. **条件不满足**：表达式结果为 `false`，清除该规则所有延迟状态，触发告警恢复
3. **定时扫描**：`rule-energy-engine` 每 300 秒扫描一次 `getExpiredItems()`，对到期的延迟项自动重新执行规则链（与 Java 端一致）

**内存结构：**

```javascript
{
  "chain45:2": {
    chainName: "chain45",
    stepIndex: 2,
    pointId: "TC1ETExIL...",
    processTimestamp: 1778743364523,
    delay: 10,
    timestamp: 1778743364523,
    pointListSnapshot: [...],
    ruleSnapshot: {
      chainName: "chain45",
      ruleId: 64,
      ruleSource: "control",
      elData: "..."
    }
  }
}
```

**持久化文件：** `~/.node-red/rule-cache/delays.json`

**方法：**

- `set(key, info)` — key = `${chainName}:${stepIndex}`
- `get(key)`
- `remove(key)`
- `clear(chainName)` — 清除某规则的所有延迟
- `isExpired(key, now)` — 检查延迟是否到期
- `getExpiredItems()` — 获取所有到期的延迟项（供定时扫描使用）

**日志：**

- `[delay-manager] 加载本地延迟状态, 共 ${count} 条`
- `[delay-manager] 设置延迟, key=${key}, delay=${delay}s`
- `[delay-manager] 获取延迟, key=${key}, 已过去 ${elapsed}s, 剩余 ${remain}s`
- `[delay-manager] 延迟到期, key=${key}`
- `[delay-manager] 清除延迟, key=${key}`
- `[delay-manager] 扫描到期延迟, 共 ${count} 条`

---

### 4.5 alarm-state-cache.js（告警状态缓存）

**说明：** 告警状态缓存在 `rule-energy-engine` 节点内部，用于记录已触发的告警，防止重复告警，并为告警恢复提供原始告警消息。**已支持文件持久化**，Node-RED 重启后数据不丢失。

**内存结构：**

```javascript
{
  "chain45:TC1ETExIL...": {
    alarmId: "uuid",
    alarmTime: 1778743364523,
    timestamp: 1778743364523,
    alarmMessage: {
      type: "alarm",
      chainName: "chain45",
      ruleId: 64,
      alarmId: "uuid",
      conditionId: "chain45_xxx",
      alarmStatus: "offnormal",
      priority: "3",
      pointId: "TC1ETExIL...",
      slotPath: "/Drivers/水泵07/points/On/Off_Status",
      alarmValue: "123",
      alarmDesc: "温度过高",
      pointTypeId: 1111101101,
      timestamp: 1778743364523
    }
  }
}
```

**Key 格式：** `${chainName}:${pointId}`

**持久化文件：** `~/.node-red/rule-cache/alarm-states.json`

**方法：**

- `set(key, state)` — 保存告警状态
- `get(key)` — 获取告警状态
- `has(key)` — 检查是否存在
- `delete(key)` — 删除告警状态
- `getAll()` — 获取所有告警状态
- `size()` — 获取数量

**生命周期：**
- 告警触发时写入（`alarmCmp` 中）
- 告警恢复时读取并删除（`doAlarmRecovery` 中）
- 节点重启后自动从文件加载

---

### 4.6 astCache（AST 解析缓存，rule-engine 节点内）

**说明：** AST 缓存在 `rule-energy-engine` 节点内部，使用 JavaScript `Map` 实例，用于缓存解析后的规则链 AST，避免每次点值上报都重新解析 `elData`。

**内存结构：**

```javascript
{
  "chain45": {
    type: "function",
    name: "IF",
    args: [
      { type: "function", name: "effectiveTimeCmp", args: [] },
      {
        type: "function",
        name: "IF",
        args: [
          { type: "function", name: "deviceCalculateCmp", args: [] },
          { type: "function", name: "controlCmp", args: [] }
        ]
      }
    ]
  }
}
```

**Key 格式：** `chainName`

**生命周期：**
- 首次执行规则时写入
- 节点重启后清空（不持久化，因规则可能已更新）

---

### 4.7 缓存与持久化数据查看 API

**新增 HTTP 接口（rule-manager.js）：**

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/rule-energy-manager/:id/cache-data` | `?type=all/rules/times/mappings/alarmStates` | 查看内存缓存数据 |
| GET | `/rule-energy-manager/:id/persist-data` | `?type=all/rules/times/mappings/alarmStates` | 查看持久化文件数据 |

**cache-data 返回示例：**

```json
{
  "type": "cacheData",
  "cacheType": "all",
  "data": {
    "rules": {
      "chain45": { "chainName": "chain45", "ruleId": 64, ... }
    },
    "times": {
      "营业时间": { "timeName": "营业时间", "timeType": "2", ... }
    },
    "mappings": {
      "1111101101": ["1", "3", "30"]
    },
    "alarmStates": {
      "engine-node-id": {
        "nodeName": "规则引擎",
        "count": 2,
        "states": {
          "chain45:TC1ETExIL...": {
            "alarmId": "uuid",
            "timestamp": 1778743364523,
            "alarmMessage": { "type": "alarm", "chainName": "chain45", ... }
          }
        }
      }
    }
  }
}
```

**persist-data 返回示例：**

```json
{
  "type": "persistData",
  "persistType": "all",
  "data": {
    "rules": {
      "filePath": "/Users/xxx/.node-red/rule-cache/rules.json",
      "size": 15234,
      "lastModified": "2026-05-18T09:30:00.000Z",
      "content": { "chain45": { ... } }
    },
    "times": {
      "filePath": "/Users/xxx/.node-red/rule-cache/times.json",
      "size": 512,
      "exists": false
    },
    "alarmStates": {
      "filePath": "/Users/xxx/.node-red/rule-cache/alarm-states.json",
      "size": 2048,
      "lastModified": "2026-05-18T09:30:00.000Z",
      "content": {
        "chain45:TC1ETExIL...": {
          "alarmId": "uuid",
          "timestamp": 1778743364523,
          "alarmMessage": { "type": "alarm", ... }
        }
      }
    }
  }
}
```

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

## 七、输出消息格式

### 7.1 control

```json
{
  "type": "control",
  "chainName": "chain45",
  "ruleId": 64,
  "outputs": [
    {
      "pointId": "TC1ETExIL...",
      "slotPath": "/Drivers/水泵07/points/control",
      "value": "1",
      "equipId": "L-DLLH-DLKDT01_DLKDT01-0005",
      "pointTypeId": 1111101104
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
  "alarmId": "uuid",
  "conditionId": "chain45_xxx",
  "alarmStatus": "offnormal",
  "alarmTime": 1778743364523,
  "priority": "3",
  "pointId": "TC1ETExIL...",
  "slotPath": "/Drivers/水泵07/points/On/Off_Status",
  "alarmValue": "123",
  "alarmDesc": "温度过高",
  "pointTypeId": 1111101101,
  "timestamp": 1778743364523
}
```

### 7.3 alarmRecovery

基于原告警消息深拷贝修改状态字段输出，仅处理本次上报且存在告警缓存的点位：

```json
{
  "type": "alarm",
  "chainName": "chain45",
  "ruleId": 64,
  "alarmId": "uuid",
  "conditionId": "chain45_xxx",
  "alarmStatus": "normal",
  "alarmTime": 1778743364523,
  "priority": "3",
  "alarmDesc": "温度过高",
  "recoverDesc": "报警恢复",
  "recoverValue": "80",
  "pointId": "TC1ETExIL...",
  "slotPath": "/Drivers/水泵07/points/On/Off_Status",
  "alarmValue": "100",
  "pointTypeId": 1111101101,
  "recoverTime": 1778743364523,
  "timestamp": 1778743364523
}
```

> 恢复消息 `type` 仍为 `"alarm"`，`alarmStatus` 设为 `"normal"`，并增加 `recoverDesc`、`recoverValue`、`recoverTime`，`alarmTime` 保留报警时的时间戳。

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
│   │   ├── mapping-cache.js
│   │   └── alarm-state-cache.js
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

1. 创建 `lib/cache/` 四个缓存模块（带文件持久化）
2. 创建 `lib/engine/` 五个引擎模块
3. 创建 `lib/utils/expr-eval.js`
4. 创建 `rule-manager.js/html`
5. 创建 `rule-engine.js/html`
6. 更新 `package.json`（删除 `rule-energy-config`，注册新节点）
7. 删除旧文件（`rule-config.js/html`, `lib/rule-cache.js`, `lib/rule-matcher.js`, `lib/rule-executor.js`, `lib/expr-eval.js`）
8. 创建示例 flow
9. 编写测试
