/**
 * 告警状态缓存模块
 * 负责告警触发状态的内存缓存和文件持久化
 * 用于防止重复告警，并为告警恢复提供原始告警消息
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

class AlarmStateCache {
  /**
   * @param {Function} log - 日志函数
   */
  constructor(log) {
    this.log = log || (() => {});
    this.cache = new Map();
    this.filePath = path.join(CACHE_DIR, 'alarm-states.json');
    this._load();
  }

  /**
   * 从文件加载告警状态
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this.cache = new Map(Object.entries(data));
        const keys = Array.from(this.cache.keys()).join(', ');
        this.log(`[alarm-state-cache] 加载本地告警状态, 共 ${this.cache.size} 条, keys=[${keys}], 文件=${this.filePath}`);
      } else {
        this.log(`[alarm-state-cache] 本地告警状态文件不存在, 初始化为空`);
      }
    } catch (e) {
      this.log(`[alarm-state-cache] 加载本地告警状态失败: ${e.message}`);
      this.cache = new Map();
    }
  }

  /**
   * 保存告警状态到文件
   */
  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      this.log(`[alarm-state-cache] 保存本地告警状态失败: ${e.message}`);
    }
  }

  /**
   * 设置告警状态
   * @param {string} key - 告警键, 格式: ${chainName}:${pointId}
   * @param {Object} state - 告警状态 { alarmId, timestamp, alarmMessage }
   */
  set(key, state) {
    this.cache.set(key, state);
    this._save();
    this.log(`[alarm-state-cache] 保存告警状态, key=${key}, alarmId=${state.alarmId}`);
  }

  /**
   * 获取告警状态
   * @param {string} key
   * @returns {Object|null}
   */
  get(key) {
    const state = this.cache.get(key);
    const allKeys = Array.from(this.cache.keys()).join(', ');
    this.log(`[alarm-state-cache] 获取告警状态, key=${key}, cacheSize=${this.cache.size}, allKeys=[${allKeys}], 结果=${state ? '存在' : '不存在'}`);
    return state || null;
  }

  /**
   * 检查告警状态是否存在
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * 删除告警状态
   * @param {string} key
   */
  delete(key) {
    const existed = this.cache.has(key);
    this.cache.delete(key);
    if (existed) {
      this._save();
      this.log(`[alarm-state-cache] 删除告警状态, key=${key}`);
    }
  }

  /**
   * 获取所有告警状态
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * 获取告警状态数量
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

module.exports = AlarmStateCache;