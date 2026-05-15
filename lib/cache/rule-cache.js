/**
 * 规则缓存模块
 * 负责规则的内存缓存和文件持久化
 * 项目独立部署，使用单例模式，无需 projectCard 隔离
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

class RuleCache {
  /**
   * @param {Function} log - 日志函数
   */
  constructor(log) {
    this.log = log || (() => {});
    this.cache = new Map();
    this.filePath = path.join(CACHE_DIR, 'rules.json');
    this._load();
  }

  /**
   * 从文件加载缓存
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.cache = new Map(Object.entries(data));
        this.log(`[rule-cache] 加载本地规则, 共 ${this.cache.size} 条, 文件=${this.filePath}`);
      } else {
        this.log(`[rule-cache] 本地规则文件不存在, 初始化为空`);
      }
    } catch (e) {
      this.log(`[rule-cache] 加载本地规则失败: ${e.message}`);
      this.cache = new Map();
    }
  }

  /**
   * 保存缓存到文件
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
      this.log(`[rule-cache] 保存本地规则失败: ${e.message}`);
    }
  }

  /**
   * 保存规则
   * @param {string} chainName - 规则链名称
   * @param {Object} rule - 规则对象
   */
  set(chainName, rule) {
    this.cache.set(chainName, rule);
    this._save();
    this.log(`[rule-cache] 保存规则, chainName=${chainName}, 当前规则总数=${this.cache.size}`);
  }

  /**
   * 获取规则
   * @param {string} chainName - 规则链名称
   * @returns {Object|null}
   */
  get(chainName) {
    const rule = this.cache.get(chainName);
    this.log(`[rule-cache] 获取规则, chainName=${chainName}, 结果=${rule ? '存在' : '不存在'}`);
    return rule || null;
  }

  /**
   * 删除规则
   * @param {string} chainName - 规则链名称
   */
  remove(chainName) {
    const existed = this.cache.has(chainName);
    this.cache.delete(chainName);
    this._save();
    if (existed) {
      this.log(`[rule-cache] 删除规则, chainName=${chainName}`);
    } else {
      this.log(`[rule-cache] 删除规则失败, chainName=${chainName} 不存在`);
    }
  }

  /**
   * 获取所有规则
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * 通过 pointId 反查 pointTypeId
   * @param {string} pointId
   * @returns {number|null}
   */
  findPointTypeIdByPointId(pointId) {
    for (const [chainName, rule] of this.cache) {
      if (rule.equipPoints && Array.isArray(rule.equipPoints)) {
        for (const ep of rule.equipPoints) {
          if (ep.pointId === pointId) {
            this.log(`[rule-cache] 反查 pointId=${pointId} → pointTypeId=${ep.pointTypeId}, chainName=${chainName}`);
            return ep.pointTypeId;
          }
        }
      }
    }
    this.log(`[rule-cache] 反查 pointId=${pointId} 未找到`);
    return null;
  }

  /**
   * 通过 slotPath 反查 pointTypeId
   * @param {string} slotPath
   * @returns {number|null}
   */
  findPointTypeIdBySlotPath(slotPath) {
    for (const [chainName, rule] of this.cache) {
      if (rule.equipPoints && Array.isArray(rule.equipPoints)) {
        for (const ep of rule.equipPoints) {
          if (ep.slotPath === slotPath) {
            this.log(`[rule-cache] 反查 slotPath=${slotPath} → pointTypeId=${ep.pointTypeId}, chainName=${chainName}`);
            return ep.pointTypeId;
          }
        }
      }
    }
    this.log(`[rule-cache] 反查 slotPath=${slotPath} 未找到`);
    return null;
  }

  /**
   * 获取规则数量
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

module.exports = RuleCache;
