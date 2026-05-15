/**
 * 点类型规则映射缓存模块
 * 负责 pointTypeId → chainIds[] 映射的内存缓存和文件持久化
 * 项目独立部署，使用单例模式，无需 projectCard 隔离
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

class MappingCache {
  /**
   * @param {Function} log - 日志函数
   */
  constructor(log) {
    this.log = log || (() => {});
    this.cache = new Map();
    this.filePath = path.join(CACHE_DIR, 'mappings.json');
    this._load();
  }

  /**
   * 从文件加载缓存
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        // 文件中的 key 是字符串，需要转为 Map
        this.cache = new Map(Object.entries(data));
        this.log(`[mapping-cache] 加载本地映射, 共 ${this.cache.size} 条, 文件=${this.filePath}`);
      } else {
        this.log(`[mapping-cache] 本地映射文件不存在, 初始化为空`);
      }
    } catch (e) {
      this.log(`[mapping-cache] 加载本地映射失败: ${e.message}`);
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
      this.log(`[mapping-cache] 保存本地映射失败: ${e.message}`);
    }
  }

  /**
   * 保存点类型映射
   * @param {number|string} pointTypeId - 点类型ID
   * @param {string[]} chainIds - 关联的规则链ID数组
   */
  set(pointTypeId, chainIds) {
    const key = String(pointTypeId);
    this.cache.set(key, chainIds);
    this._save();
    this.log(`[mapping-cache] 保存映射, pointTypeId=${pointTypeId}, chainIds=[${chainIds}], 当前映射总数=${this.cache.size}`);
  }

  /**
   * 获取点类型映射
   * @param {number|string} pointTypeId - 点类型ID
   * @returns {string[]|null}
   */
  get(pointTypeId) {
    const key = String(pointTypeId);
    const chainIds = this.cache.get(key);
    this.log(`[mapping-cache] 获取映射, pointTypeId=${pointTypeId}, 结果=[${chainIds || ''}]`);
    return chainIds || null;
  }

  /**
   * 删除点类型映射
   * @param {number|string} pointTypeId - 点类型ID
   */
  remove(pointTypeId) {
    const key = String(pointTypeId);
    const existed = this.cache.has(key);
    this.cache.delete(key);
    this._save();
    if (existed) {
      this.log(`[mapping-cache] 删除映射, pointTypeId=${pointTypeId}`);
    } else {
      this.log(`[mapping-cache] 删除映射失败, pointTypeId=${pointTypeId} 不存在`);
    }
  }

  /**
   * 获取所有映射
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * 获取映射数量
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

module.exports = MappingCache;
