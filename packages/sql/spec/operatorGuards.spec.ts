import { FieldCondition as Field, CompoundCondition, createOperatorRegistry } from '@ucast/core'
import { expect } from './specHelper.ts'
import {
  allInterpreters,
  createSqlInterpreter,
  pg,
  type SqlOperator,
  type SqlQueryOptions,
} from '../src/index.ts'

const options: SqlQueryOptions = {
  ...pg,
}

describe('cross-package behavior guards', () => {
  describe('nested and/or/not', () => {
    const interpret = createSqlInterpreter(allInterpreters)
    const condition = new CompoundCondition('and', [
      new Field('eq', 'name', 'John'),
      new CompoundCondition('or', [
        new Field('gt', 'age', 18),
        new CompoundCondition('not', [
          new Field('eq', 'active', true),
        ]),
      ]),
    ])

    it('preserves nesting and parameter order in generated SQL', () => {
      const [sql, params] = interpret(condition, options)

      expect(sql).to.equal('("name" = $1 and ("age" > $2 or not ("active" = $3)))')
      expect(params).to.deep.equal(['John', 18, true])
    })

    it('produces identical SQL when the same condition is interpreted repeatedly', () => {
      const [sql, params] = interpret(condition, options)

      for (let i = 0; i < 100; i++) {
        expect(interpret(condition, options)).to.deep.equal([sql, params])
      }
    })
  })

  describe('empty collections', () => {
    const interpret = createSqlInterpreter(allInterpreters)

    it('generates "in" without placeholders for an empty array', () => {
      const [sql, params] = interpret(new Field('within', 'age', []), options)

      expect(sql).to.equal('"age" in()')
      expect(params).to.deep.equal([])
    })
  })

  describe('field adapters', () => {
    it('uses "localField" to resolve field names', () => {
      const interpret = createSqlInterpreter(allInterpreters)
      const [sql, params] = interpret(new Field('eq', 'name', 'John'), {
        ...options,
        localField: field => `t_${field}`,
      })

      expect(sql).to.equal('t_name = $1')
      expect(params).to.deep.equal(['John'])
    })
  })

  describe('custom operators', () => {
    const between: SqlOperator<Field<[number, number]>> = (condition, query) => {
      const [min, max] = query.manyParams(condition.value)
      return query.whereRaw(`${query.field(condition.field)} between ${min} and ${max}`)
    }

    it('interprets operators registered through the shared registry', () => {
      const registry = createOperatorRegistry<SqlOperator<any>>(allInterpreters)
        .register('between', between)
      const interpret = createSqlInterpreter(registry)
      const [sql, params] = interpret(new Field('between', 'age', [18, 30]), options)

      expect(sql).to.equal('"age" between $1 and $2')
      expect(params).to.deep.equal([18, 30])
    })

    it('rejects registration of an operator under an existing name', () => {
      expect(() => createOperatorRegistry<SqlOperator<any>>(allInterpreters).register('eq', between))
        .to.throw(/already taken/)
    })

    it('resolves aliased operators without changing parameter order', () => {
      const interpret = createSqlInterpreter(allInterpreters)
      const condition = new CompoundCondition('and', [
        new Field('eq', 'name', 'John'),
        new Field('in', 'age', [1, 2]),
      ])
      const [sql, params] = interpret(condition, options)

      expect(sql).to.equal('("name" = $1 and "age" in($2, $3))')
      expect(params).to.deep.equal(['John', 1, 2])
    })
  })

  describe('illegal operators', () => {
    it('rejects unknown AST operators at interpretation time', () => {
      const interpret = createSqlInterpreter(allInterpreters)

      expect(() => interpret(new Field('unknown', 'a', 1), options))
        .to.throw('Unable to interpret "unknown" condition. Did you forget to register interpreter for it?')
    })
  })
})
