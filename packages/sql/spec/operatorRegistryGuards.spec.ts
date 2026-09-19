import { CompoundCondition, FieldCondition } from '@ucast/core'
import { expect } from './specHelper.ts'
import {
  createSqlInterpreter,
  interpreterRegistry,
  pg,
  eq,
  within,
  and,
  or,
} from '../src/index.ts'

describe('SQL operator registry guards', () => {
  const interpret = createSqlInterpreter(interpreterRegistry)

  describe('nested and/or/not with parameter order', () => {
    const condition = new CompoundCondition('or', [
      new FieldCondition('eq', 'a', 1),
      new CompoundCondition('and', [
        new FieldCondition('gt', 'b', 2),
        new FieldCondition('eq', 'c', 'x'),
      ]),
    ])

    it('emits placeholders in encounter order across nested compounds', () => {
      const [sql, params] = interpret(condition, pg)
      expect(params).to.deep.equal([1, 2, 'x'])
      expect(sql).to.contain('or')
    })

    it('produces identical SQL and params when interpreted repeatedly', () => {
      const [sql1, params1] = interpret(condition, pg)
      const [sql2, params2] = interpret(condition, pg)
      expect(sql1).to.equal(sql2)
      expect(params1).to.deep.equal(params2)
    })
  })

  describe('aliases declared by the package', () => {
    it('resolves "in" to the within implementation', () => {
      const condition = new FieldCondition('in', 'age', [1, 2])
      const [sql, params] = interpret(condition, pg)
      expect(sql).to.equal(`${pg.escapeField('age')} in($1, $2)`)
      expect(params).to.deep.equal([1, 2])
    })

    it('resolves relation aliases (some, none, every, is, isNot)', () => {
      const relation = new FieldCondition('some', 'items', new FieldCondition('eq', 'x', 1))
      expect(() => interpret(relation, pg)).to.throw(/Relation metadata for "items" not found/)
    })
  })

  describe('empty collections', () => {
    it('renders an empty in-list without parameters', () => {
      const condition = new FieldCondition('within', 'age', [])
      const [sql, params] = interpret(condition, pg)
      expect(sql).to.equal(`${pg.escapeField('age')} in()`)
      expect(params).to.deep.equal([])
    })

    it('renders empty compound with the same shape on every call', () => {
      const condition = new CompoundCondition('and', [])
      const [sql1, params1] = interpret(condition, pg)
      const [sql2, params2] = interpret(condition, pg)
      expect(sql1).to.equal('()')
      expect(sql1).to.equal(sql2)
      expect(params1).to.deep.equal([])
      expect(params2).to.deep.equal(params1)
    })
  })

  describe('custom operators', () => {
    it('allow package-level extension without mutating the base registry', () => {
      const custom: typeof eq = (node, query) => query.where(node.field, '<=>', node.value)
      const extended = createSqlInterpreter(interpreterRegistry.extend({ custom }))
      const condition = new FieldCondition('custom', 'a', 1)

      const [sql, params] = extended(condition, pg)
      expect(sql).to.equal(`${pg.escapeField('a')} <=> $1`)
      expect(params).to.deep.equal([1])
      expect(interpreterRegistry.has('custom')).to.be.false
      expect(() => interpret(condition, pg)).to.throw(/Unable to interpret "custom"/)
    })

    it('reject a duplicate operator name instead of silently overriding', () => {
      expect(() => interpreterRegistry.extend({ eq }))
        .to.throw(/Operator "eq" is already registered/)
      expect(interpreterRegistry.resolve('eq')).to.equal(eq)
    })

    it('accept plain records as before (backward compatibility)', () => {
      const local = createSqlInterpreter({ eq, within, and, or })
      const condition = new FieldCondition('eq', 'a', 1)
      const [sql] = local(condition, pg)
      expect(sql).to.equal(`${pg.escapeField('a')} = $1`)
    })
  })

  describe('illegal operators', () => {
    it('keep the operator name in the error message', () => {
      const condition = new FieldCondition('totallyUnknown', 'a', 1)
      expect(() => interpret(condition, pg))
        .to.throw(/Unable to interpret "totallyUnknown" condition/)
    })
  })
})
