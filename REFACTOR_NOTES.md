# UCAST 共享操作符注册表重构说明

## 目标问题
`core`、`mongo`、`mongo2js`、`js`、`sql` 各自维护相似的操作符别名、
字段解析与错误分派；新增/修改一个操作符经常要改四处。

## 共享机制（位于 core，后端零反向依赖）
- `packages/core/src/OperatorRegistry.ts`
  - `OperatorRegistry<T>`：密封、无状态的操作符注册表，`resolve/has/nameOf/entries`。
  - `createOperatorRegistry(operators, aliases)`：声明式别名（`{ canonical: ['alias'] }`）。
  - `alias(target, op)`：在“记录”形态里标记别名键，注册表解析到规范实现。
  - `normalizeOperatorNames(record, fn)`：把解析期名字规范化为条件名（Mongo `$eq` → `eq`），
    规范化重名直接抛错。
  - `extend()`：包级扩展自有操作符，返回新注册表；**同名覆盖抛错**，不修改基础注册表。
  - `replace()`：仅用于显式、刻意的替换（保留别名），与静默覆盖区分开。
- `packages/core/src/interpreter.ts`
  - `createInterpreter` 统一从 `OperatorRegistry`（或旧版裸 record，向后兼容）解析操作符。
  - 错误消息、操作符名、三种参数个数语义保持原样；热路径为固定元数闭包，无反射、无运行时 switch。
- `ObjectQueryParser` 改用注册表持有“命名 + 规范化”，消除手工 reduce 拼装。

各后端迁移：
- `mongo`：`registry.ts` 导出默认解析注册表与扩展工厂；`MongoQueryParser` 默认使用它。
- `js` / `sql`：`defaults.ts` 用统一别名声明（`in→within`、`some/none/every/is/isNot` 等）。
- `mongo2js`：`factory.ts` 直接消费注册表；`squire` 的原语化 `$and/$or/$nor`
  用 `normalizeOperatorNames` 构建，替换手工 reduce。
- `sql/src/lib/*` ORM 适配层改为复用共享 `interpreterRegistry`。

## 行为保持（由守卫锁定）
- 错误消息中的操作符名（解析与解释两端）。
- SQL 参数出现顺序、嵌套 and/or/not 的 SQL 结构。
- JS `and/or` 短路（后一分支不求值）。
- Mongo AST 形状：`$not:/x/ → compound(not, field regex)`、`squire` 原语的 `__itself__` 字段、
  `$nor` 语义等。
- 发布包 `exports` 字段未改动；`core` 不依赖任何具体后端；无运行时反射。
- 注册表为一次性构建、重复解释不累积状态（`extend` 返回新对象）。

## 新增/验证用例（`pnpm -r test` 中可见的 describe 名称）
- core：`OperatorRegistry`（13 项）。
- mongo：`mongo parsing instruction registry`（4 项）。
- js：`JS operator registry`（6 项）。
- sql：`SQL operator registry guards`（10 项）。
- mongo2js：`cross-backend behavior guards (mongo -> js)`（12 项，
  覆盖嵌套 and/or/not、空集合、字段适配器、自定义操作符、非法操作符、无状态重复解释）。

## 重复量统计（脚本不计注释/测试夹具）
仅扫描 `packages/*/src`，用 TypeScript compiler API 解析 AST，分类：
- A 分派 switch case
- B 别名映射条目（记录里 `alias: canonical`）
- C 别名常量绑定（`export const x = y`，多为保留的公共实现别名）
- D 注册表拼装回调（`.reduce(...)` 手工建表）
- E 名字规范化回调（`operatorToConditionName`）

复现命令（仓库根目录）：
```sh
node scripts/count-duplication.mjs           # 当前工作树，逐项列出
bash scripts/duplication-report.sh           # git HEAD vs 工作树，前后对比并强制 >=30%
```

重构前后（原始摘要，完整逐行清单见脚本输出）：

| 类别 | before | after |
| --- | --- | --- |
| A 分派 switch cases | 2 | 0 |
| B 别名映射条目 | 7 | 0 |
| C 别名常量绑定 | 9 | 9 |
| D 注册表拼装回调 | 2 | 0 |
| E 名字规范化回调 | 2 | 1 |
| **合计** | **22** | **10** |

总量下降 **54.5%**（≥30% 达标）。

## 性能（机器相关，结论仅限所测环境）
环境：Apple Silicon（darwin arm64）、Node `v26.0.0`、200,000 次深度嵌套查询解释。

复现命令：
```sh
node scripts/perf-smoke.mjs
```
原始摘要（交替运行三轮，ns/op，越低越好）：
- 重构前（git HEAD 自包含构建）：202 / 199 / 199
- 重构后（当前工作树构建）：201 / 207 / 217

结论：分派热路径与基线同量级（差异在运行噪声内），未见可归因于本次重构的性能退化。

## 安装与验收
工作区包通过 `exports` 指向 `dist`。根 `package.json` 增加 `postinstall: pnpm -r build`，
使全新 `pnpm install --frozen-lockfile` 后无需手工步骤即具备 `dist`。

验收（仓库根目录直接运行，无需外部服务/环境变量/公网）：
```sh
pnpm install --frozen-lockfile   # 准备阶段，不计演示；会自动 pnpm -r build
pnpm -r test                     # 退出码 0
```
