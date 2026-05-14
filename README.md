# tangbao-he-rule-energy-helper

智能规则引擎 Node-RED 节点，支持逻辑告警规则与联动控制规则的云端下发、本地缓存与实时执行。

## 功能特性

- **云端规则同步**：通过 MQTT 接收云端下发的规则配置，支持热更新
- **多触发源**：支持 msg 流入、MQTT 订阅、云端下发关联、link in 节点触发、全部
- **多输出方式**：支持 msg 输出、MQTT 发布、云端下发关联、link out 输出、HTTP 请求
- **规则缓存**：本地 JSON 持久化，防止 Node-RED 重启丢失
- **并行执行**：多条规则同时命中时全部并行执行
- **步骤流引擎**：支持数据源、生效时间、判断条件、控制、告警等组件
- **安全表达式**：基于 expr-eval 实现公式计算，拒绝 eval

## 安装

```bash
cd ~/.node-red
npm install /Users/hetangbin/Downloads/tangbao-he-rule-energy-helper
```

或全局安装后链接：

```bash
cd /Users/hetangbin/Downloads/tangbao-he-rule-energy-helper
npm link
cd ~/.node-red
npm link tangbao-he-rule-energy-helper
```

## 节点说明

### rule-energy-config（云端规则配置）

配置 MQTT 连接，接收云端下发的规则、触发源关联和输出配置。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| MQTT Broker | MQTT 服务器地址 | localhost |
| 端口 | MQTT 端口 | 1883 |
| 用户名/密码 | MQTT 认证信息 | - |
| Client ID | MQTT 客户端标识 | 自动生成 |
| 规则下发主题 | 接收规则配置的 MQTT 主题 | cloud/rules/down |
| 触发源下发主题 | 接收触发源关联配置 | cloud/trigger/down |
| 输出配置下发主题 | 接收输出配置 | cloud/output/down |
| 状态上报主题 | 向云端上报状态 | cloud/status/up |

### rule-energy（规则执行引擎）

接收触发数据，匹配规则并执行。支持在节点配置界面中通过可视化编辑器创建和管理本地规则。

| 参数 | 说明 |
|------|------|
| 云端配置 | 关联的 rule-energy-config 节点（触发源或输出方式含 mqtt/cloud 时必填） |
| 触发源 | msg / mqtt / cloud / link / all |
| 触发主题 | MQTT 订阅主题（触发源为 mqtt/cloud/all 时必填） |
| 输出方式 | msg / mqtt / cloud / link / http / all |
| 输出主题 | MQTT 发布主题（输出方式为 mqtt/all 时必填） |
| HTTP 地址 | HTTP 输出目标地址（输出方式为 http/all 时必填） |

## 规则数据结构

规则采用步骤流结构，与前端项目 `qd-ibms-web` 中的逻辑告警/联动控制规则格式保持一致：

```json
{
  "id": 1001,
  "ruleName": "高温告警",
  "ruleStatus": "1",
  "ruleType": "logical",
  "subsystemId": "HVAC",
  "partList": [
    {
      "stepIndex": 1,
      "ruleName": "步骤1",
      "partList": [
        { "type": "4", "ruleName": "A", "subsystemId": "HVAC", "equipTypeId": "chiller", "pointTypeId": "temp" },
        { "type": "5", "effectDateName": "工作日", "effectTimeName": "08:00-18:00" },
        { "type": "6", "functionType": "0", "function": "1", "delay": "5", "delayType": 0 },
        { "type": "8", "equipTypeId": "chiller", "pointTypeId": "alarm", "alarmLevel": "1", "alarmDesc": "温度过高" }
      ]
    }
  ]
}
```

### 组件类型说明

| type | 组件 | 说明 |
|------|------|------|
| 4 | 数据源 | 定义数据来源（子系统/设备类型/点位类型） |
| 5 | 生效时间 | 日期与时间段限制 |
| 6 | 判断条件 | 状态判断或公式计算，支持延时 |
| 7 | 控制 | 联动控制输出（设定值） |
| 8 | 告警 | 告警输出（告警等级/描述） |

## 触发数据格式

流入 msg.payload 或 MQTT 消息中的触发数据需包含：

```json
{
  "subsystemId": "HVAC",
  "equipTypeId": "chiller",
  "pointTypeId": "temp",
  "deviceId": "DEV001",
  "value": 32.5
}
```

## 输出数据格式

```json
{
  "type": "alarm",
  "ruleId": 1001,
  "ruleName": "高温告警",
  "ruleType": "logical",
  "deviceId": "DEV001",
  "alarmLevel": "1",
  "alarmDesc": "温度过高"
}
```

## 云端 MQTT 下发格式

### 批量下发规则

```json
{
  "type": "batch",
  "rules": [
    { "id": 1001, "ruleName": "规则1", ... },
    { "id": 1002, "ruleName": "规则2", ... }
  ]
}
```

### 删除规则

```json
{
  "type": "delete",
  "ruleId": 1001
}
```

### 单条更新

```json
{
  "id": 1001,
  "ruleName": "规则1",
  "ruleStatus": "1",
  "partList": [...]
}
```

## 示例流

见 `examples/` 目录下的示例文件。

## HTTP Admin API

模块运行时提供以下 REST API：

- `GET /rule-energy-config/{nodeId}/rules` — 获取当前缓存的所有规则
- `POST /rule-energy-config/{nodeId}/rules` — 手动添加/更新规则
- `DELETE /rule-energy-config/{nodeId}/rules/{ruleId}` — 删除规则

## 开发

```bash
npm test
```

## 许可证

MIT
