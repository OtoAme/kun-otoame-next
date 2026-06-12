# 数据库索引审计和优化

## 索引审计流程

为了支持 3000 QPS，需要审计现有索引并通过 EXPLAIN ANALYZE 验证查询性能。

**重要**：不要盲目执行本文档中的 CREATE INDEX 语句。先检查 Prisma schema 和现有索引，避免创建重复索引。

## 第一步：检查现有索引

### 查询当前所有索引
```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### Prisma Schema 中已定义的索引

检查 `prisma/schema.prisma` 文件中的 `@@index` 和 `@@unique` 指令，这些会自动创建索引。

常见已存在的索引：
- 主键 `@id` 自动创建唯一索引
- `@unique` 字段自动创建唯一索引
- `@@index([field])` 创建普通索引

## 第二步：关键查询性能验证

### 1. 首页游戏列表
```sql
EXPLAIN ANALYZE
SELECT * FROM patch 
WHERE content_limit = 'sfw' 
ORDER BY created DESC 
LIMIT 20;
```

**预期**：Index Scan on idx_patch_content_created 或类似索引  
**如果 Seq Scan**：需要复合索引 `(content_limit, created DESC)`

### 2. 标签游戏列表
```sql
EXPLAIN ANALYZE
SELECT p.* FROM patch p
JOIN patch_tag_relation ptr ON p.id = ptr.patch_id
WHERE ptr.tag_id = 1 
  AND p.content_limit = 'sfw'
ORDER BY p.created DESC
LIMIT 24;
```

**预期**：Index Scan on patch_tag_relation + Index Scan on patch  
**如果慢**：检查 `patch_tag_relation(tag_id, patch_id)` 和 `patch(id)` 索引

### 3. 会社游戏列表
```sql
EXPLAIN ANALYZE
SELECT p.* FROM patch p
JOIN patch_company_relation pcr ON p.id = pcr.patch_id
WHERE pcr.company_id = 1 
  AND p.content_limit = 'sfw'
ORDER BY p.created DESC
LIMIT 24;
```

**预期**：Index Scan on patch_company_relation + Index Scan on patch  
**如果慢**：检查 `patch_company_relation(company_id, patch_id)` 索引

### 4. 评分排序
```sql
EXPLAIN ANALYZE
SELECT p.* FROM patch p
JOIN patch_rating_stat prs ON p.id = prs.patch_id
WHERE p.content_limit = 'sfw' 
  AND prs.count >= 5
ORDER BY prs.avg_overall DESC
LIMIT 24;
```

**预期**：Index Scan on patch_rating_stat(count, avg_overall)  
**如果慢**：需要 `patch_rating_stat(count, avg_overall DESC)` 复合索引

### 5. 标签/会社列表（按游戏数量排序）
```sql
EXPLAIN ANALYZE
SELECT * FROM patch_tag
ORDER BY count DESC
LIMIT 100;

EXPLAIN ANALYZE
SELECT * FROM patch_company
ORDER BY count DESC
LIMIT 100;
```

**预期**：Index Scan on idx_patch_tag_count / idx_patch_company_count  
**如果慢**：需要 `count DESC` 索引

## 第三步：必需索引清单

基于审计结果，以下是**可能需要**的索引（前提是不存在）：

### patch 表
```sql
-- 如果没有，创建时间索引
CREATE INDEX IF NOT EXISTS idx_patch_created ON patch(created DESC);

-- 如果没有，创建浏览量索引
CREATE INDEX IF NOT EXISTS idx_patch_view ON patch(view DESC);

-- 如果没有，创建下载量索引
CREATE INDEX IF NOT EXISTS idx_patch_download ON patch(download DESC);

-- 如果没有，创建资源更新时间索引
CREATE INDEX IF NOT EXISTS idx_patch_resource_update_time ON patch(resource_update_time DESC);

-- 如果没有，创建复合索引（NSFW 筛选 + 时间排序）
CREATE INDEX IF NOT EXISTS idx_patch_content_created ON patch(content_limit, created DESC);

-- 数组字段索引（PostgreSQL GIN）
CREATE INDEX IF NOT EXISTS idx_patch_type_gin ON patch USING GIN (type);
CREATE INDEX IF NOT EXISTS idx_patch_language_gin ON patch USING GIN (language);
CREATE INDEX IF NOT EXISTS idx_patch_platform_gin ON patch USING GIN (platform);
```

### patch_tag 表
```sql
-- 如果没有，创建游戏数量索引
CREATE INDEX IF NOT EXISTS idx_patch_tag_count ON patch_tag(count DESC);

-- 如果没有，创建别名搜索索引
CREATE INDEX IF NOT EXISTS idx_patch_tag_alias_gin ON patch_tag USING GIN (alias);
```

### patch_company 表
```sql
-- 如果没有，创建游戏数量索引
CREATE INDEX IF NOT EXISTS idx_patch_company_count ON patch_company(count DESC);

-- 如果没有，创建别名搜索索引
CREATE INDEX IF NOT EXISTS idx_patch_company_alias_gin ON patch_company USING GIN (alias);
```

### patch_tag_relation 表
```sql
-- 如果没有，创建外键索引
CREATE INDEX IF NOT EXISTS idx_patch_tag_relation_tag_id ON patch_tag_relation(tag_id);
CREATE INDEX IF NOT EXISTS idx_patch_tag_relation_patch_id ON patch_tag_relation(patch_id);
```

### patch_company_relation 表
```sql
-- 如果没有，创建外键索引
CREATE INDEX IF NOT EXISTS idx_patch_company_relation_company_id ON patch_company_relation(company_id);
CREATE INDEX IF NOT EXISTS idx_patch_company_relation_patch_id ON patch_company_relation(patch_id);
```

### patch_rating_stat 表
```sql
-- 如果没有，创建评分复合索引
CREATE INDEX IF NOT EXISTS idx_patch_rating_stat_count_avg ON patch_rating_stat(count, avg_overall DESC) WHERE count >= 5;
```

### patch_resource 表
```sql
-- 如果没有，创建复合索引（首页最新资源查询）
CREATE INDEX IF NOT EXISTS idx_patch_resource_section_status_created 
  ON patch_resource(section, status, created DESC);
```

## 第四步：监控索引使用率

### 查看未使用的索引
```sql
SELECT 
  schemaname, 
  tablename, 
  indexname, 
  idx_scan as index_scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**定期清理**：未使用的索引浪费空间并减慢写入速度。

### 查看索引膨胀
```sql
SELECT
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;
```

## 第五步：查询执行时间目标

- 简单查询（单表 + 索引）: < 5ms
- 中等查询（JOIN + 排序）: < 20ms
- 复杂查询（多 JOIN + 聚合）: < 50ms

如果查询时间超过目标，检查：
1. 是否使用了正确的索引（EXPLAIN ANALYZE）
2. 索引是否需要 REINDEX（碎片整理）
3. 是否需要 VACUUM ANALYZE 更新统计信息

## 第六步：索引维护

### 定期维护任务
```sql
-- 更新统计信息（每天）
ANALYZE patch;
ANALYZE patch_tag;
ANALYZE patch_company;
ANALYZE patch_rating_stat;

-- 清理死元组和更新统计（每周）
VACUUM ANALYZE;
```

### 重建膨胀的索引
```sql
-- 如果索引膨胀严重
REINDEX INDEX CONCURRENTLY idx_patch_created;
```

## 注意事项

1. **避免重复索引**：先检查 Prisma schema 和现有索引
2. **索引开销**：每个索引会减慢 INSERT/UPDATE/DELETE 操作
3. **部分索引**：对于有 WHERE 条件的查询，考虑使用部分索引（如 `WHERE count >= 5`）
4. **并发创建**：生产环境使用 `CREATE INDEX CONCURRENTLY` 避免锁表
5. **监控性能**：创建索引后用 EXPLAIN ANALYZE 验证是否被使用

## 压测后优化

在实际压测后，使用 PostgreSQL 的慢查询日志找出瓶颈：

```sql
-- 启用慢查询日志
ALTER SYSTEM SET log_min_duration_statement = 100; -- 记录 >100ms 的查询
SELECT pg_reload_conf();

-- 查看最慢的查询
SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;
```
