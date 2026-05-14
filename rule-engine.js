module.exports = function(RED) {
    "use strict";
    var RuleMatcher = require('./lib/rule-matcher');
    var RuleExecutor = require('./lib/rule-executor');
    var http = require('http');
    var https = require('https');
    var url = require('url');

    function RuleEngineNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.triggerSource = config.triggerSource || 'msg';
        node.triggerTopic = config.triggerTopic || '';
        node.outputMode = config.outputMode || 'msg';
        node.outputTopic = config.outputTopic || '';
        node.httpUrl = config.httpUrl || '';
        node.httpMethod = (config.httpMethod || 'POST').toUpperCase();
        node.httpHeaders = config.httpHeaders || '{}';

        // 判断是否需要 MQTT 配置
        var needMqtt = (node.triggerSource === 'mqtt' || node.triggerSource === 'cloud' ||
                        node.triggerSource === 'all' || node.outputMode === 'mqtt' ||
                        node.outputMode === 'cloud' || node.outputMode === 'all');

        node.ruleConfig = RED.nodes.getNode(config.ruleConfig);
        if (needMqtt && !node.ruleConfig) {
            node.error('未关联 rule-energy-config 配置节点，请先创建并关联');
            node.status({ fill: 'red', shape: 'ring', text: '未关联配置' });
            return;
        }

        // 解析节点本地配置的规则
        node.localRules = [];
        try {
            node.localRules = JSON.parse(config.rules || '[]');
        } catch(e) {
            node.localRules = [];
        }

        node.matcher = null;
        node.executor = new RuleExecutor(node);
        node.mqttHandler = null;

        function initMatcher() {
            var allRules = [];
            // 合并云端规则
            if (node.ruleConfig && node.ruleConfig.cache) {
                allRules = allRules.concat(node.ruleConfig.cache.getAll());
            }
            // 合并本地规则
            if (node.localRules && node.localRules.length > 0) {
                allRules = allRules.concat(node.localRules);
            }
            if (allRules.length > 0) {
                // 创建临时缓存用于匹配
                var tempCache = {
                    getAll: function() { return allRules; }
                };
                node.matcher = new RuleMatcher(tempCache);
                node.status({ fill: 'green', shape: 'dot', text: '就绪 (' + allRules.length + ' 条规则)' });
            } else {
                node.status({ fill: 'yellow', shape: 'ring', text: '无规则' });
            }
        }

        initMatcher();
        if (node.ruleConfig) {
            node.ruleConfig.on('rulesUpdated', function() {
                initMatcher();
                node.log('规则已更新，重新初始化匹配器');
            });
        }

        // MQTT 触发订阅
        if ((node.triggerSource === 'mqtt' || node.triggerSource === 'cloud') && node.triggerTopic) {
            if (node.ruleConfig.client) {
                node.ruleConfig.client.subscribe(node.triggerTopic, function(err) {
                    if (err) {
                        node.error('订阅触发主题失败: ' + err.message);
                    } else {
                        node.log('已订阅触发主题: ' + node.triggerTopic);
                    }
                });

                node.mqttHandler = function(topic, message) {
                    if (topic === node.triggerTopic) {
                        try {
                            var payload = JSON.parse(message.toString());
                            node.handleTrigger(payload);
                        } catch (e) {
                            node.error('MQTT 触发消息解析失败: ' + e.message);
                        }
                    }
                };
                node.ruleConfig.client.on('message', node.mqttHandler);
            }
        }

        // Cloud 触发源关联配置
        if (node.triggerSource === 'cloud') {
            var cloudConfig = node.ruleConfig.getTriggerConfig(node.id);
            if (cloudConfig && cloudConfig.topic) {
                node.triggerTopic = cloudConfig.topic;
                if (node.ruleConfig.client) {
                    node.ruleConfig.client.subscribe(node.triggerTopic);
                    node.mqttHandler = function(topic, message) {
                        if (topic === node.triggerTopic) {
                            try {
                                var payload = JSON.parse(message.toString());
                                node.handleTrigger(payload);
                            } catch (e) {
                                node.error('云端触发消息解析失败: ' + e.message);
                            }
                        }
                    };
                    node.ruleConfig.client.on('message', node.mqttHandler);
                }
            }
        }

        // 输入口处理（msg / link 触发）
        node.on('input', function(msg) {
            if (node.triggerSource === 'msg' || node.triggerSource === 'link' || node.triggerSource === 'all') {
                var triggerData = msg.payload || msg;
                if (typeof triggerData === 'object') {
                    node.handleTrigger(triggerData);
                } else {
                    node.warn('输入消息 payload 必须是对象，当前类型: ' + typeof triggerData);
                }
            }
        });

        // 提供 HTTP Admin API 获取本地规则
        RED.httpAdmin.get('/rule-energy/:id/local-rules', function(req, res) {
            try {
                var n = RED.nodes.getNode(req.params.id);
                if (!n) {
                    res.status(404).json({ error: '节点未找到' });
                    return;
                }
                res.json(n.localRules || []);
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        node.on('close', function(removed, done) {
            if (node.mqttHandler && node.ruleConfig && node.ruleConfig.client) {
                node.ruleConfig.client.removeListener('message', node.mqttHandler);
            }
            if (done) done();
        });
    }

    RuleEngineNode.prototype.handleTrigger = function(triggerData) {
        var node = this;
        if (!node.matcher) {
            node.warn('规则匹配器未初始化，跳过执行');
            return;
        }

        node.log('收到触发数据: ' + JSON.stringify(triggerData).substring(0, 200));

        var matchedRules = node.matcher.match(triggerData);
        node.log('触发数据匹配到 ' + matchedRules.length + ' 条规则');

        if (matchedRules.length === 0) {
            node.status({ fill: 'blue', shape: 'dot', text: '未匹配规则' });
            return;
        }

        node.status({ fill: 'green', shape: 'dot', text: '执行 ' + matchedRules.length + ' 条规则' });

        // 并行执行所有匹配规则
        var promises = [];
        for (var i = 0; i < matchedRules.length; i++) {
            (function(rule) {
                var p = node.executor.execute(rule, triggerData, function(output) {
                    node.sendOutput(output);
                });
                promises.push(p);
            })(matchedRules[i]);
        }

        Promise.all(promises).then(function() {
            node.log('所有匹配规则执行完成');
            var ruleCount = (node.ruleConfig && node.ruleConfig.cache) ? node.ruleConfig.cache.getAll().length : 0;
            node.status({ fill: 'green', shape: 'dot', text: '就绪 (' + ruleCount + ' 条规则)' });
        }).catch(function(err) {
            node.error('规则执行异常: ' + err.message);
            node.status({ fill: 'red', shape: 'ring', text: '执行异常' });
        });
    };

    RuleEngineNode.prototype.sendOutput = function(output) {
        var node = this;
        node.log('规则输出: ' + JSON.stringify(output));

        var msg = {
            payload: output,
            topic: output.type || 'rule-output',
            _ruleId: output.ruleId,
            _ruleName: output.ruleName
        };

        var mode = node.outputMode;

        // msg 输出
        if (mode === 'msg' || mode === 'all') {
            node.send(msg);
        }

        // mqtt 输出
        if ((mode === 'mqtt' || mode === 'all') && node.outputTopic && node.ruleConfig && node.ruleConfig.client) {
            node.ruleConfig.publish(node.outputTopic, output);
        }

        // cloud 输出（从云端配置获取主题）
        if (mode === 'cloud' && node.ruleConfig && node.ruleConfig.client) {
            var cloudOutputConfig = node.ruleConfig.getOutputConfig(node.id);
            if (cloudOutputConfig && cloudOutputConfig.topic) {
                node.ruleConfig.publish(cloudOutputConfig.topic, output);
            } else {
                node.warn('云端输出配置未找到，请等待云端下发 output 配置');
            }
        }

        // http 输出
        if ((mode === 'http' || mode === 'all') && node.httpUrl) {
            node.sendHttp(output);
        }

        // link out 输出（通过 msg 发送，由用户连线到 link out 节点）
        if (mode === 'link' || mode === 'all') {
            node.send(msg);
        }
    };

    RuleEngineNode.prototype.sendHttp = function(output) {
        var node = this;
        try {
            var parsedUrl = url.parse(node.httpUrl);
            var isHttps = parsedUrl.protocol === 'https:';
            var client = isHttps ? https : http;

            var postData = JSON.stringify(output);
            var headers = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            };

            try {
                var customHeaders = JSON.parse(node.httpHeaders);
                Object.assign(headers, customHeaders);
            } catch (e) {}

            var options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.path,
                method: node.httpMethod,
                headers: headers
            };

            var req = client.request(options, function(res) {
                var data = '';
                res.on('data', function(chunk) { data += chunk; });
                res.on('end', function() {
                    node.log('HTTP 输出响应: ' + res.statusCode + ' ' + data.substring(0, 100));
                });
            });

            req.on('error', function(err) {
                node.error('HTTP 输出请求失败: ' + err.message);
            });

            if (node.httpMethod !== 'GET') {
                req.write(postData);
            }
            req.end();
        } catch (err) {
            node.error('HTTP 输出异常: ' + err.message);
        }
    };

    RED.nodes.registerType('rule-energy', RuleEngineNode);
};
