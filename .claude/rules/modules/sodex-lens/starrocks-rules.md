# StarRocks SQL Rules

本项目使用 StarRocks 作为 OLAP 存储，以下规则基于实际踩坑总结，**所有涉及 StarRocks 的 SQL 和 Go 代码必须遵守**。

---

## 1. DECIMAL 算术必须使用 DECIMAL(38, 9) 中间类型

StarRocks 推断 `DECIMAL(38, s) ± DECIMAL(38, s)` 的结果类型为 `DECIMAL(39, s)`，超出最大精度 38，运行时报溢出错误。

**规则：** 所有 DECIMAL 列之间的加减乘除，必须先将每个操作数 cast 到 `DECIMAL(38, 9)`，再用外层 `CAST(... AS DECIMAL(38, 18))` 收回存储精度。

**例外：`DECIMAL(38, 0)`（纯整数）不需要此转换。** `DECIMAL(38, 0) + DECIMAL(38, 0)` 推断为 `DECIMAL(39, 0)`，但 scale=0 时 StarRocks 自动截断回 `DECIMAL(38, 0)`，不会报错。而且将 `DECIMAL(38, 0)` 转成 `DECIMAL(38, 9)` 反而会丢失精度（只保留 29 位整数 + 9 位小数），对于 ERC20 token raw balance（最大 38 位整数）会产生截断错误。

```sql
-- ❌ 错误：直接运算溢出
SELECT a.value + b.value FROM t;
SELECT ABS(a.value - b.value) > 0.001 FROM t;

-- ✅ 正确：中间 cast 到 DECIMAL(38, 9)
SELECT CAST(
  CAST(ROUND(a.value, 9) AS DECIMAL(38, 9))
  + CAST(ROUND(b.value, 9) AS DECIMAL(38, 9))
  AS DECIMAL(38, 18)
) FROM t;

-- ✅ 三个操作数相加
SELECT CAST(
  CAST(ROUND(a, 9) AS DECIMAL(38, 9))
  + CAST(ROUND(b, 9) AS DECIMAL(38, 9))
  + CAST(ROUND(c, 9) AS DECIMAL(38, 9))
  AS DECIMAL(38, 18)
) FROM t;

-- ✅ 乘除
SELECT CAST(
  CAST(ROUND(amount, 9) AS DECIMAL(38, 9))
  * CAST(ROUND(price, 9) AS DECIMAL(38, 9))
  / CAST(10000 AS DECIMAL(38, 9))
  AS DECIMAL(38, 18)
) FROM t;
```

**检查方法：** 完成 SQL 后，搜索所有 `+`、`-`、`*`、`/` 运算符，确认每个 DECIMAL 操作数都有 `CAST(ROUND(..., 9) AS DECIMAL(38, 9))` 包裹。

---

## 2. ALTER TABLE ADD COLUMN 的 DEFAULT 值必须加引号

```sql
-- ❌ 报错：Unexpected input '0'
ALTER TABLE t ADD COLUMN bonus_rate_bps INT DEFAULT 0;

-- ✅ 正确
ALTER TABLE t ADD COLUMN bonus_rate_bps INT DEFAULT "0";
ALTER TABLE t ADD COLUMN snapshot_ts BIGINT DEFAULT "0";
ALTER TABLE t ADD COLUMN tx_hash STRING DEFAULT NULL;  -- NULL 不需要引号
```

---

## 3. PRIMARY KEY 列必须是建表语句中的前 N 列，且顺序一致

StarRocks 要求 PRIMARY KEY 中的列在 `CREATE TABLE` 的列定义中排在最前面，且顺序完全一致。

```sql
-- ❌ 报错：day_date 在列定义末尾但出现在 PK 中
CREATE TABLE t (
    epoch_id STRING NOT NULL,
    referrer_account_id BIGINT NOT NULL,
    earned_u DECIMAL(38, 18) NOT NULL,
    day_date DATE NOT NULL                  -- 排在第 4 位
) PRIMARY KEY (epoch_id, referrer_account_id, day_date);

-- ✅ 正确：PK 列排在最前
CREATE TABLE t (
    epoch_id STRING NOT NULL,               -- PK #1
    referrer_account_id BIGINT NOT NULL,     -- PK #2
    day_date DATE NOT NULL,                  -- PK #3
    earned_u DECIMAL(38, 18) NOT NULL        -- 非 PK，排在 PK 列之后
) PRIMARY KEY (epoch_id, referrer_account_id, day_date);
```

---

## 4. PARTITION BY 的列必须包含在 PRIMARY KEY 中

```sql
-- ❌ 报错：day_date 用于分区但不在 PK 中
PRIMARY KEY (epoch_id, referrer_account_id)
PARTITION BY date_trunc('day', day_date)

-- ✅ 正确
PRIMARY KEY (epoch_id, referrer_account_id, day_date)
PARTITION BY date_trunc('day', day_date)
```

---

## 5. 不支持 Prepared Statements (COM_STMT_PREPARE)

StarRocks 的 MySQL 协议不支持 `COM_STMT_PREPARE`。Go 代码中使用 GORM 的 `db.Raw("... WHERE id = ?", val)` 会触发 prepared statement，导致报错：

```
Error: Unsupported command(COM_STMT_PREPARE)
```

**规则：** DSN 中必须包含 `interpolateParams=true`，让 Go MySQL driver 在客户端插值参数。建议在连接函数中自动追加：

```go
func Open(ctx context.Context, dsn string) (*gorm.DB, error) {
    if !strings.Contains(strings.ToLower(dsn), "interpolateparams=") {
        if strings.Contains(dsn, "?") {
            dsn += "&interpolateParams=true"
        } else {
            dsn += "?interpolateParams=true"
        }
    }
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
        PrepareStmt: false,  // 同时关闭 GORM 的 prepare
    })
    // ...
}
```

---

## 6. 表和列的实际名称需要先确认

设计文档或其他数据库的列名可能与 StarRocks 中实际的列名不同。写 SQL 前先 `DESC table_name` 确认。

已知差异示例：

| 预期列名 | 实际列名 | 表 |
|---------|---------|-----|
| `ts_ms` | `minute_ts_ms` | `coin_price_1m` |
| `close` | `price` | `coin_price_1m` |

---

## 7. SQL 文件中使用标记拆分多段查询时，注意残留文本

如果用 `-- MARKER:` 注释作为分隔符在 Go 中拆分 SQL 文件，`SplitN` 后标记同行的尾部文本会残留在下一段开头：

```sql
-- QUERY 2: top 10 referrers    ← 拆分后 "top 10 referrers" 会残留
SELECT ...
```

**规则：** 拆分后定位到第一个 SQL 关键字（如 `SELECT`、`INSERT`、`WITH`）开始截取，或将注释说明放在单独一行。
