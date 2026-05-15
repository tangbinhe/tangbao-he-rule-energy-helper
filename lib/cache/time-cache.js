/**
 * 时间配置缓存模块
 * 负责生效时间配置的内存缓存和文件持久化
 * 项目独立部署，使用单例模式，无需 projectCard 隔离
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.node-red', 'rule-cache');
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

class TimeCache {
  /**
   * @param {Function} log - 日志函数
   */
  constructor(log) {
    this.log = log || (() => {});
    this.cache = new Map();
    this.filePath = path.join(CACHE_DIR, 'times.json');
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
        this.log(`[time-cache] 加载本地时间配置, 共 ${this.cache.size} 条, 文件=${this.filePath}`);
      } else {
        this.log(`[time-cache] 本地时间配置文件不存在, 初始化为空`);
      }
    } catch (e) {
      this.log(`[time-cache] 加载本地时间配置失败: ${e.message}`);
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
      this.log(`[time-cache] 保存本地时间配置失败: ${e.message}`);
    }
  }

  /**
   * 保存时间配置
   * @param {string} timeName - 时间配置名称
   * @param {Object} config - 时间配置对象 { timeName, timeType, begin, end }
   */
  set(timeName, config) {
    this.cache.set(timeName, config);
    this._save();
    this.log(`[time-cache] 保存时间配置, timeName=${timeName}, timeType=${config.timeType}, ${config.begin}-${config.end}, 当前时间配置总数=${this.cache.size}`);
  }

  /**
   * 获取时间配置
   * @param {string} timeName - 时间配置名称
   * @returns {Object|null}
   */
  get(timeName) {
    const config = this.cache.get(timeName);
    this.log(`[time-cache] 获取时间配置, timeName=${timeName}, 结果=${config ? '存在' : '不存在'}`);
    return config || null;
  }

  /**
   * 删除时间配置
   * @param {string} timeName - 时间配置名称
   */
  remove(timeName) {
    const existed = this.cache.has(timeName);
    this.cache.delete(timeName);
    this._save();
    if (existed) {
      this.log(`[time-cache] 删除时间配置, timeName=${timeName}`);
    } else {
      this.log(`[time-cache] 删除时间配置失败, timeName=${timeName} 不存在`);
    }
  }

  /**
   * 获取所有时间配置
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * 获取时间配置数量
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

module.exports = TimeCache;
