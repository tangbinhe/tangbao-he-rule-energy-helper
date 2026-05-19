/**
 * 延迟状态管理模块
 * 负责 deviceCalculateCmp 延迟信息的内存缓存和文件持久化
 * 项目独立部署，使用单例模式，无需 projectCard 隔离
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

class DelayManager {
  /**
   * @param {Function} log - 日志函数
   */
  constructor(log) {
    this.log = log || (() => {});
    this.cache = new Map();
    this.filePath = path.join(CACHE_DIR, 'delays.json');
    this._load();
  }

  /**
   * 从文件加载延迟状态
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.cache = new Map(Object.entries(data));
        this.log(`[delay-manager] 加载本地延迟状态, 共 ${this.cache.size} 条, 文件=${this.filePath}`);
      } else {
        this.log(`[delay-manager] 本地延迟状态文件不存在, 初始化为空`);
      }
    } catch (e) {
      this.log(`[delay-manager] 加载本地延迟状态失败: ${e.message}`);
      this.cache = new Map();
    }
  }

  /**
   * 保存延迟状态到文件
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
      this.log(`[delay-manager] 保存本地延迟状态失败: ${e.message}`);
    }
  }

  /**
   * 设置延迟信息
   * @param {string} key - 唯一标识，格式: ${chainName}:${stepIndex}
   * @param {Object} info - 延迟信息 { chainName, stepIndex, pointId, processTimestamp, delay }
   */
  set(key, info) {
    this.cache.set(key, info);
    this._save();
    this.log(`[delay-manager] 设置延迟, key=${key}, delay=${info.delay}s`);
  }

  /**
   * 获取延迟信息
   * @param {string} key
   * @returns {Object|null}
   */
  get(key) {
    const info = this.cache.get(key);
    if (info) {
      const elapsed = (Date.now() - info.processTimestamp) / 1000;
      const remain = info.delay - elapsed;
      this.log(`[delay-manager] 获取延迟, key=${key}, 已过去 ${elapsed.toFixed(1)}s, 剩余 ${remain.toFixed(1)}s`);
    } else {
      this.log(`[delay-manager] 获取延迟, key=${key}, 不存在`);
    }
    return info || null;
  }

  /**
   * 检查延迟是否到期
   * @param {string} key
   * @param {number} now - 当前时间戳（可选，默认 Date.now()）
   * @returns {boolean}
   */
  isExpired(key, now) {
    now = now || Date.now();
    const info = this.cache.get(key);
    if (!info) {
      return false;
    }
    const elapsed = (now - info.processTimestamp) / 1000;
    const expired = elapsed >= info.delay;
    if (expired) {
      this.log(`[delay-manager] 延迟到期, key=${key}, 已过去 ${elapsed.toFixed(1)}s >= ${info.delay}s`);
    } else {
      this.log(`[delay-manager] 延迟未到期, key=${key}, 已过去 ${elapsed.toFixed(1)}s < ${info.delay}s`);
    }
    return expired;
  }

  /**
   * 删除延迟信息
   * @param {string} key
   */
  remove(key) {
    const existed = this.cache.has(key);
    this.cache.delete(key);
    this._save();
    if (existed) {
      this.log(`[delay-manager] 清除延迟, key=${key}`);
    }
  }

  /**
   * 清除某规则的所有延迟信息
   * @param {string} chainName - 规则链名称
   */
  clear(chainName) {
    let count = 0;
    for (const [key, info] of this.cache) {
      if (info.chainName === chainName) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this._save();
      this.log(`[delay-manager] 清除规则延迟状态, chainName=${chainName}, 共 ${count} 条`);
    }
  }

  /**
   * 清除某规则从指定步骤开始的所有延迟信息（与 Java 端 refreshDelayInfoWithIndex 对齐）
   * @param {string} chainName - 规则链名称
   * @param {number} fromStepIndex - 起始步骤索引（含）
   * @param {number} total - 脚本总数
   * @param {Array} pointList - 点列表（仅清除这些 pointId 的延迟）
   */
  clearFromStep(chainName, fromStepIndex, total, pointList) {
    let count = 0;
    const pointIds = pointList ? pointList.map(p => p.pointId).filter(Boolean) : [];

    for (const [key, info] of this.cache) {
      const parts = key.split(':');
      if (parts.length >= 2 && parts[0] === chainName) {
        const stepIdx = parseInt(parts[1], 10);
        if (stepIdx >= fromStepIndex) {
          if (total !== undefined && total !== null && stepIdx >= total) {
            continue;
          }
          // 如果 key 包含 pointId，检查是否在 pointList 中
          if (parts.length >= 3) {
            const keyPointId = parts[2];
            if (pointIds.length === 0 || pointIds.includes(keyPointId)) {
              this.cache.delete(key);
              count++;
            }
          } else {
            this.cache.delete(key);
            count++;
          }
        }
      }
    }
    if (count > 0) {
      this._save();
      this.log(`[delay-manager] 清除规则延迟状态, chainName=${chainName}, fromStep=${fromStepIndex}, total=${total}, 共 ${count} 条`);
    }
  }

  /**
   * 获取所有延迟状态
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * 获取所有到期的延迟项
   * @returns {Array} 到期项数组
   */
  getExpiredItems() {
    const now = Date.now();
    const expired = [];
    for (const [key, info] of this.cache) {
      const elapsed = (now - info.processTimestamp) / 1000;
      if (elapsed >= info.delay) {
        expired.push({ key, ...info });
      }
    }
    if (expired.length > 0) {
      this.log(`[delay-manager] 扫描到期延迟, 共 ${expired.length} 条`);
    }
    return expired;
  }

  /**
   * 获取延迟状态数量
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

module.exports = DelayManager;
