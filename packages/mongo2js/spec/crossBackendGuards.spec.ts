import {
  CompoundCondition,
  FieldCondition,
  MongoQueryParser,
  allParsingInstructions,
  createJsInterpreter,
  allInterpreters,
  interpreterRegistry,
  guard,
} from '../src'
import { expect } from './specHelper'

describe('cross-backend behavior guards (mongo -> js)', () => {
  const parser = new MongoQueryParser(allParsingInstructions)
  const js = createJsInterpreter(allInterpreters)

  function astOf(query: any) {
    return parser.parse(query)
  }

  describe('nested and/or/not', () => {
    const query = {
      $or: [
        { a: 1 },
        {
          $and: [
            { b: { $gt: 2 } },
            { c: { $not: /x/ } },
          ],
        },
      ],
    }

    it('keeps the Mongo AST shape identical across repeated parses', () => {
      const ast1 = astOf(query)
      const ast2 = astOf(query)

      expect(ast1).to.be.instanceOf(CompoundCondition)
      expect(ast1.operator).to.equal('or')
      expect(ast1).to.deep.equal(ast2)

      const secondBranch = (ast1 as CompoundCondition).value[1] as CompoundCondition
      expect(secondBranch).to.be.instanceOf(CompoundCondition)
      expect(secondBranch.operator).to.equal('and')
      expect(secondBranch.value[1]).to.be.instanceOf(CompoundCondition)
      expect((secondBranch.value[1] as CompoundCondition).operator).to.equal('not')
      const notChild = (secondBranch.value[1] as CompoundCondition).value[0] as FieldCondition
      expect(notChild.operator).to.equal('regex')
    })

    it('interprets the same query with JS short-circuit semantics', () => {
      const ast = astOf(query)
      expect(js(ast, { a: 1, b: 9, c: 'nomatch' })).to.be.true
      expect(js(ast, { a: 2, b: 9, c: 'nomatch' })).to.be.true
      expect(js(ast, { a: 2, b: 1, c: 'nomatch' })).to.be.false
    })

    it('short-circuits "and" so a later branch is not evaluated', () => {
      let evaluated = false
      const seen = (node: FieldCondition, object: any, { get }: any) => {
        evaluated = true
        return get(object, node.field) === node.value
      }
      const customJs = createJsInterpreter({
        ...allInterpreters,
        seen: seen as any,
      })
      const parserWithSeen = new MongoQueryParser({
        ...allParsingInstructions,
        $seen: { type: 'field' },
      } as any)
      const ast = parserWithSeen.parse({
        $and: [{ a: { $gt: 10 } }, { b: { $seen: true } }],
      } as any)

      evaluated = false
      expect(customJs(ast, { a: 0, b: false } as any)).to.be.false
      expect(evaluated).to.be.false

      evaluated = false
      expect(customJs(ast, { a: 20, b: true } as any)).to.be.true
      expect(evaluated).to.be.true
    })

    it('does not mutate or accumulate registry state across interpretations', () => {
      const ast = astOf(query)
      const r1 = js(ast, { a: 1 })
      const r2 = js(ast, { a: 1 })
      expect(r1).to.equal(r2)
    })
  })

  describe('empty collections', () => {
    it('rejects empty $and/$or/$nor with the original validation message', () => {
      expect(() => astOf({ $and: [] })).to.throw(/at least one element/)
      expect(() => astOf({ $or: [] })).to.throw(/at least one element/)
      expect(() => astOf({ $nor: [] })).to.throw(/at least one element/)
    })

    it('interprets an empty in-list as false', () => {
      const ast = astOf({ a: { $in: [] } }) as FieldCondition
      expect(ast.operator).to.equal('in')
      expect(js(ast, { a: 1 })).to.be.false
    })
  })

  describe('field adapter', () => {
    const get = (object: any, field: string) => object[`_${field}`]

    it('uses the custom get() adapter for nested paths in JS interpretation', () => {
      const customJs = createJsInterpreter(allInterpreters, { get })
      const ast = astOf({ 'address.city': 'Kyoto' })
      expect(customJs(ast, { _address: { _city: 'Kyoto' } } as any)).to.be.true
      expect(customJs(ast, { _address: { _city: 'Tokyo' } } as any)).to.be.false
    })
  })

  describe('custom operators', () => {
    it('allow package-level extension without touching the base registry', () => {
      const $custom: any = { type: 'field' }
      const customParser = new MongoQueryParser({ ...allParsingInstructions, $custom })
      const customJs = createJsInterpreter({
        ...allInterpreters,
        custom: (node: FieldCondition, value: any) => value === node.value,
      })

      const ast = customParser.parse({ a: { $custom: 7 } }) as FieldCondition
      expect(ast.operator).to.equal('custom')
      expect(customJs(ast, 7 as any)).to.be.true

      const baseAst = parser.parse({ a: { $custom: 7 } } as any) as FieldCondition
      expect(baseAst.operator).to.equal('eq')
      expect(baseAst.value).to.deep.equal({ $custom: 7 })
    })

    it('reject a duplicate operator name instead of silently overriding', () => {
      expect(() => createJsInterpreter({ eq: allInterpreters.eq, ne: allInterpreters.ne }))
        .to.not.throw()
      expect(() => interpreterRegistry.extend({ eq: allInterpreters.eq } as any))
        .to.throw(/Operator "eq" is already registered/)
      expect(interpreterRegistry.resolve('eq'))
        .to.equal(allInterpreters.eq)
    })
  })

  describe('illegal operators', () => {
    it('preserve parser error messages with the operator name', () => {
      expect(() => parser.parse({ a: { $gt: 1, $unknown: 1 } } as any))
        .to.throw('Field query for "a" may contain only operators or a plain object as a value')
    })

    it('preserve interpreter error messages with the operator name', () => {
      const ast = new FieldCondition('totallyUnknown', 'a', 1)
      expect(() => js(ast, {})).to.throw(/Unable to interpret "totallyUnknown" condition/)
    })
  })

  it('guard still produces the same results for the default operator set', () => {
    const test = guard({ a: { $gt: 1 }, b: { $in: [2, 3] } })
    expect(test({ a: 2, b: 3 })).to.be.true
    expect(test({ a: 0, b: 4 })).to.be.false
  })
})
