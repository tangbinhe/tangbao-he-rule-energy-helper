module.exports = function(RED) {
    "use strict";
    var mqtt = require('mqtt');
    var RuleCache = require('./lib/rule-cache');

    function RuleConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.broker = config.broker || 'localhost';
        node.port = parseInt(config.port) || 1883;
        node.clientId = config.clientId || 'rule-client-' + Math.random().toString(16).substr(2, 8);
        node.ruleSubTopic = config.ruleSubTopic || 'cloud/rules/down';
        node.triggerSubTopic = config.triggerSubTopic || 'cloud/trigger/down';
        node.outputSubTopic = config.outputSubTopic || 'cloud/output/down';
        node.statusPubTopic = config.statusPubTopic || 'cloud/status/up';

        node.user = (node.credentials && node.credentials.user) || '';
        node.password = (node.credentials && node.credentials.password) || '';

        node.cache = new RuleCache(node.id);
        node.client = null;
        node.connected = false;
        node.triggerAssociations = {}; // 触发源关联配置
        node.outputConfigurations = {}; // 输出配置

        function connectMqtt() {
            var url = 'mqtt://' + node.broker + ':' + node.port;
            var options = {
                clientId: node.clientId,
                username: node.user || undefined,
                password: node.password || undefined,
                reconnectPeriod: 5000,
                connectTimeout: 30000,
                clean: true
            };

            node.client = mqtt.connect(url, options);

            node.client.on('connect', function() {
                node.connected = true;
                node.log('MQTT 已连接到 ' + node.broker + ':' + node.port);
                node.status({ fill: 'green', shape: 'dot', text: '已连接' });

                // 订阅云端下发主题
                var topics = [node.ruleSubTopic, node.triggerSubTopic, node.outputSubTopic];
                topics.forEach(function(topic) {
                    node.client.subscribe(topic, function(err) {
                        if (err) {
                            node.error('订阅主题失败 [' + topic + ']: ' + err.message);
                        } else {
                            node.log('已订阅主题: ' + topic);
                        }
                    });
                });
            });

            node.client.on('message', function(topic, message) {
                try {
                    var payload = JSON.parse(message.toString());
                    node.log('收到 MQTT 消息 [' + topic + ']: ' + message.toString().substring(0, 200));

                    if (topic === node.ruleSubTopic) {
                        handleRuleMessage(payload);
                    } else if (topic === node.triggerSubTopic) {
                        handleTriggerMessage(payload);
                    } else if (topic === node.outputSubTopic) {
                        handleOutputMessage(payload);
                    }
                } catch (err) {
                    node.error('MQTT 消息解析失败: ' + err.message);
                }
            });

            node.client.on('error', function(err) {
                node.connected = false;
                node.error('MQTT 错误: ' + err.message);
                node.status({ fill: 'red', shape: 'ring', text: '错误' });
            });

            node.client.on('close', function() {
                node.connected = false;
                node.status({ fill: 'red', shape: 'ring', text: '断开' });
            });

            node.client.on('reconnect', function() {
                node.status({ fill: 'yellow', shape: 'ring', text: '重连中...' });
            });
        }

        function handleRuleMessage(payload) {
            if (payload.type === 'batch' && Array.isArray(payload.rules)) {
                node.cache.batchUpdate(payload.rules);
                node.log('批量更新 ' + payload.rules.length + ' 条规则');
            } else if (payload.type === 'delete' && payload.ruleId) {
                node.cache.remove(payload.ruleId);
                node.log('删除规则: ' + payload.ruleId);
            } else if (payload.rule || payload.id) {
                node.cache.addOrUpdate(payload.rule || payload);
                node.log('更新规则: ' + (payload.rule ? payload.rule.id : payload.id));
            }
            node.emit('rulesUpdated');
        }

        function handleTriggerMessage(payload) {
            if (payload.nodeId && payload.config) {
                node.triggerAssociations[payload.nodeId] = payload.config;
                node.log('更新触发源关联: ' + payload.nodeId);
            }
        }

        function handleOutputMessage(payload) {
            if (payload.nodeId && payload.config) {
                node.outputConfigurations[payload.nodeId] = payload.config;
                node.log('更新输出配置: ' + payload.nodeId);
            }
        }

        // 对外提供的方法
        node.getRules = function() {
            return node.cache.getAll();
        };

        node.getCache = function() {
            return node.cache;
        };

        node.publish = function(topic, payload) {
            if (node.client && node.connected) {
                var msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
                node.client.publish(topic, msg);
            }
        };

        node.getTriggerConfig = function(nodeId) {
            return node.triggerAssociations[nodeId] || null;
        };

        node.getOutputConfig = function(nodeId) {
            return node.outputConfigurations[nodeId] || null;
        };

        connectMqtt();

        node.on('close', function(removed, done) {
            if (node.client) {
                node.client.end(true, function() {
                    node.log('MQTT 连接已关闭');
                    if (done) done();
                });
            } else {
                if (done) done();
            }
        });
    }

    // HTTP Admin API - 获取规则列表
    RED.httpAdmin.get('/rule-energy-config/:id/rules', function(req, res) {
        try {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                res.status(404).json({ error: '配置节点未找到' });
                return;
            }
            res.json(node.getRules());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // HTTP Admin API - 手动添加/更新规则
    RED.httpAdmin.post('/rule-energy-config/:id/rules', function(req, res) {
        try {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                res.status(404).json({ error: '配置节点未找到' });
                return;
            }
            var rule = req.body;
            if (!rule || !rule.id) {
                res.status(400).json({ error: '规则缺少 id 字段' });
                return;
            }
            node.cache.addOrUpdate(rule);
            node.emit('rulesUpdated');
            res.json({ success: true, message: '规则已保存' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // HTTP Admin API - 删除规则
    RED.httpAdmin.delete('/rule-energy-config/:id/rules/:ruleId', function(req, res) {
        try {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                res.status(404).json({ error: '配置节点未找到' });
                return;
            }
            node.cache.remove(req.params.ruleId);
            node.emit('rulesUpdated');
            res.json({ success: true, message: '规则已删除' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    RED.nodes.registerType('rule-energy-config', RuleConfigNode, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
};
