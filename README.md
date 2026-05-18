# tangbao-he-rule-energy-helper

智能规则引擎 Node-RED 节点集，支持云端规则下发、本地缓存、实时执行与可视化规则管理。

## 功能特性

- **云端规则同步**：通过 MQTT 接收云端下发的规则配置、生效时间、点类型映射，支持热更新
- **规则本地缓存**：规则、时间配置、点类型映射持久化到本地 JSON，Node-RED 重启不丢失
- **点值实时触发**：接收边缘端点值上报，自动匹配关联规则并执行规则链
- **可视化规则管理**：双击 `rule-energy-manager` 节点即可查看、删除当前所有规则、时间配置和映射
- **规则链引擎**：支持生效时间判断、设备条件计算、控制输出、告警输出、告警恢复
- **安全表达式**：基于 AST 解析实现公式计算，拒绝 eval
- **延迟执行支持**：设备条件支持延迟判断，满足延时后才触发后续动作
- **告警状态管理**：告警触发后自动缓存状态，条件恢复时自动输出恢复消息

## 安装

```bash
cd ~/.node-red
npm install tangbao-he-rule-energy-helper
```

或本地安装：

```bash
cd ~/.node-red
npm install /path/to/tangbao-he-rule-energy-helper
```

## 节点说明

### rule-energy-manager（规则管理）

接收云端下发的配置报文，解析并持久化到本地缓存。支持在节点编辑面板中可视化查看和管理规则。

**云端下发报文格式**：

```json
{
  "timeStamp": 1778743364523,
  "companyId": "longfor",
  "projectCard": "L-DLLH-DLKDT01",
  "cmd": "set",
  "detail": [
    {
      "rulePubType": "ruleAndPointInfo",
      "edgeRuleInfo": "{...}",
      "edgeEquipPointInfos": "[...]",
      "edgeGroupEquipPointInfos": "[...]"
    },
    {
      "rulePubType": "edgeRelativeTime",
      "edgeRelativeTimeList": "[...]"
    },
    {
      "rulePubType": "pointTypeRuleMapping",
      "pointTypeRuleMappingList": "[...]"
    }
  ],
  "version": "1.1"
}
```

> `msg.payload` 直接传入报文内容，`detail` 在 payload 根层级。

**支持的 rulePubType**：

| 类型 | 说明 |
|------|------|
| `ruleAndPointInfo` | 创建/更新规则及点位信息 |
| `edgeRelativeTime` | 生效时间配置 |
| `pointTypeRuleMapping` | 点类型与规则映射 |
| `deleteRule` | 删除规则 |

**可视化面板功能**：

- 查看当前规则列表（规则链、ID、类型、来源、生效时间）
- 查看生效时间配置（名称、类型、时间段）
- 查看点类型规则映射（点类型ID → 关联规则链）
- 查看规则/时间配置 JSON 详情
- 删除规则/时间配置/映射（带二次确认）

### rule-energy-engine（规则执行引擎）

接收点值上报，匹配规则，执行规则链，输出控制/告警/恢复消息。

**输入数据格式**：

```json
{
  "pointId": "TC1ETExILURMS0RUMDFfRExLRFQwMS0wMDA1XzExMTExMDExMDE=",
  "slotPath": "/Drivers/水泵07/points/On/Off_Status",
  "value": 0
}
```

**输出数据格式**：

```json
// 控制输出
{
  "type": "control",
  "chainName": "chain45",
  "ruleId": 64,
  "pointTypeId": 1111101104,
  "value": "1"
}

// 告警输出
{
  "type": "alarm",
  "chainName": "chain45",
  "ruleId": 64,
  "alarmId": "uuid",
  "conditionId": "chain45_xxx",
  "priority": "1",
  "alarmDesc": "温度过高",
  "pointId": "...",
  "slotPath": "...",
  "alarmValue": "100",
  "pointTypeId": 1111101101,
  "timestamp": 1778815454123
}

// 告警恢复（结构与告警触发一致，alarmStatus 为 Normal）
{
  "type": "alarm",
  "chainName": "chain45",
  "ruleId": 64,
  "alarmId": "uuid",
  "conditionId": "chain45_xxx",
  "priority": "1",
  "alarmDesc": "温度过高",
  "alarmStatus": "Normal",
  "pointId": "...",
  "slotPath": "...",
  "alarmValue": "100",
  "pointTypeId": 1111101101,
  "normalTime": 1778815454123,
  "timestamp": 1778815454123
}
```

## 规则链执行流程

```
点值上报 → 反查 pointTypeId → 查映射找到关联规则 → 加载规则链
    → 生效时间判断 (effectiveTimeCmp)
        → 设备条件计算 (deviceCalculateCmp) [支持延迟]
            → 控制输出 (controlCmp) / 告警输出 (alarmCmp)
```

## 规则数据结构

```json
{
  "chainName": "chain45",
  "ruleId": 64,
  "ruleType": "1",
  "ruleSource": "control",
  "effectTimeName": "营业时间",
  "elData": "<chain>IF(effectiveTimeCmp,IF(deviceCalculateCmp,controlCmp))</chain>",
  "scripts": [
    { "stepIndex": 1, "stepType": "0", "function": "EMPTY" },
    { "stepIndex": 2, "stepType": "1", "function": "{1111101101}==0", "delay": 10 },
    { "stepIndex": 3, "stepType": "3", "function": "1" }
  ],
  "rulePointTypes": [
    { "dataType": "in", "pointTypeId": 1111101101 },
    { "dataType": "control", "pointTypeId": 1111101104 }
  ],
  "equipPoints": [
    { "equipId": "...", "pointId": "...", "pointTypeId": 1111101101, "slotPath": "..." }
  ],
  "groupEquipPoints": [
    { "equipId": "...", "pointId": "...", "pointTypeId": 1111101101, "slotPath": "...", "groupName": "groupA" }
  ],
  "groupMapping": {
    "pointId1": { "groupA": ["pointId1", "pointId2"] }
  },
  "alarmLevel": "1",
  "alarmDesc": "温度过高"
}
```

## HTTP Admin API

模块运行时提供以下 REST API（供节点编辑面板使用）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/rule-energy-manager/:id/rules` | 获取所有规则摘要 |
| GET | `/rule-energy-manager/:id/rule/:chainName` | 获取单条规则详情 |
| DELETE | `/rule-energy-manager/:id/rule/:chainName` | 删除规则 |
| GET | `/rule-energy-manager/:id/times` | 获取所有时间配置 |
| GET | `/rule-energy-manager/:id/time/:timeName` | 获取单条时间配置 |
| DELETE | `/rule-energy-manager/:id/time/:timeName` | 删除时间配置 |
| GET | `/rule-energy-manager/:id/mappings` | 获取所有点类型映射 |
| DELETE | `/rule-energy-manager/:id/mapping/:pointTypeId` | 删除映射 |
| GET | `/rule-energy-manager/:id/status` | 获取缓存状态统计 |
| GET | `/rule-energy-manager/:id/cache-data?type=xxx` | 查看内存缓存数据 |
| GET | `/rule-energy-manager/:id/persist-data?type=xxx` | 查看持久化文件数据 |

**cache-data 参数：** `type` 可选值 `all`（默认）、`rules`、`times`、`mappings`、`alarmStates`

**persist-data 参数：** `type` 可选值 `all`（默认）、`rules`、`times`、`mappings`、`alarmStates`

**persist-data 返回字段：**
- `filePath` — 文件绝对路径
- `size` — 文件大小（字节）
- `lastModified` — 最后修改时间
- `content` — 文件解析后的 JSON 内容
- `exists` — 文件是否存在（不存在时返回）

**支持查看的持久化文件：**
- `rules.json` — 规则数据
- `times.json` — 时间配置数据
- `mappings.json` — 点类型映射数据
- `alarm-states.json` — 告警状态数据

## 缓存文件位置

缓存文件存储在 `~/.node-red/rule-cache/` 目录下：

- `rules.json` — 规则缓存
- `times.json` — 时间配置缓存
- `mappings.json` — 点类型映射缓存
- `delays.json` — 延迟状态缓存
- `alarm-states.json` — 告警状态缓存

## 示例流

见 `examples/` 目录下的示例文件。

## 开发

```bash
npm test
```

## 许可证

MIT
