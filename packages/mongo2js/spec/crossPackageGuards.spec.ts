import {
  CompoundCondition,
  FieldCondition,
  ParsingInstruction,
  JsInterpreter,
  allInterpreters,
  allParsingInstructions,
  createFactory,
  createJsInterpreter,
  createOperatorRegistry,
  guard,
} from '../src'
import { expect, spy } from './specHelper'

describe('cross-package behavior guards', () => {
  describe('nested and/or/not', () => {
    const query = {
      $or: [
        { $and: [{ a: 1 }, { b: 2 }] },
        { c: { $not: { $gt: 5 } } },
      ]
    }

    it('preserves mongo AST shape', () => {
      const ast = guard(query).ast as CompoundCondition

      expect(ast).to.be.instanceOf(CompoundCondition)
      expect(ast.operator).to.equal('or')
      expect(ast.value).to.have.length(2)

      const [and, not] = ast.value as [CompoundCondition, CompoundCondition]
      expect(and.operator).to.equal('and')
      expect(and.value.map(c => c.operator)).to.deep.equal(['eq', 'eq'])
      expect(not.operator).to.equal('not')
      expect(not.value[0].operator).to.equal('gt')
      expect((not.value[0] as FieldCondition).field).to.equal('c')
    })

    it('evaluates nested operators through the shared dispatch', () => {
      const test = guard(query)

      expect(test({ a: 1, b: 2 })).to.be.true
      expect(test({ a: 1, b: 3, c: 10 })).to.be.false
      expect(test({ c: 3 })).to.be.true
      expect(test({ c: 6 })).to.be.false
    })

    it('keeps JavaScript short-circuit semantics for "or" and "and"', () => {
      const first = spy(() => true)
      const second = spy(() => false)
      const interpret = createJsInterpreter({ or: allInterpreters.or, first, second })
      const condition = new CompoundCondition('or', [
        new FieldCondition('first', 'a', 1),
        new FieldCondition('second', 'a', 1),
      ])

      expect(interpret(condition, {})).to.be.true
      expect(first).to.have.been.called.once
      expect(second).to.not.have.been.called()
    })

    it('keeps JavaScript short-circuit semantics for "and"', () => {
      const first = spy(() => false)
      const second = spy(() => true)
      const interpret = createJsInterpreter({ and: allInterpreters.and, first, second })
      const condition = new CompoundCondition('and', [
        new FieldCondition('first', 'a', 1),
        new FieldCondition('second', 'a', 1),
      ])

      expect(interpret(condition, {})).to.be.false
      expect(first).to.have.been.called.once
      expect(second).to.not.have.been.called()
    })
  })

  describe('empty collections', () => {
    it('matches nothing for "$in" with an empty array', () => {
      const test = guard({ a: { $in: [] as number[] } })

      expect(test({ a: 1 })).to.be.false
      expect(test({ a: [] })).to.be.false
    })

    it('matches everything for an empty query', () => {
      const test = guard({})

      expect(test({})).to.be.true
      expect(test({ a: 1 })).to.be.true
    })

    it('matches nothing for "$and" with an empty array is rejected at parse time', () => {
      expect(() => guard({ $and: [] })).to.throw(/at least one element/)
    })

    it('treats an object without operators as a plain value', () => {
      const value = { b: 1 }
      const test = guard({ a: value as any })

      expect(test({ a: value })).to.be.true
      expect(test({ a: { b: 2 } })).to.be.false
    })
  })

  describe('field adapters', () => {
    it('uses a custom "get" to resolve fields', () => {
      const get = spy((object: Record<string, unknown>, field: string) => {
        return field.split('.').reduce<unknown>((value, key) => {
          return (value as Record<string, unknown>)?.[key]
        }, object)
      })
      const factory = createFactory(allParsingInstructions, allInterpreters, { get })
      const test = factory({ 'a.b': 1 })

      expect(test({ a: { b: 1 } })).to.be.true
      expect(test({ a: { b: 2 } })).to.be.false
      expect(get).to.have.been.called()
    })
  })

  describe('custom operators', () => {
    const $between: ParsingInstruction = {
      type: 'field',
      validate(instruction, value) {
        if (!Array.isArray(value) || value.length !== 2) {
          throw new Error(`"${instruction.name}" expects an array with 2 elements`)
        }
      }
    }
    const between: JsInterpreter<FieldCondition<[number, number]>> = (node, object, { get }) => {
      const value = get(object, node.field)
      return value >= node.value[0] && value <= node.value[1]
    }

    it('extends parsing instructions and interpreters of the same query', () => {
      const instructions = createOperatorRegistry<ParsingInstruction>(allParsingInstructions)
        .register('$between', $between)
        .toRecord()
      const interpreters = createOperatorRegistry(allInterpreters)
        .register('between', between)
        .toRecord()
      const factory = createFactory(instructions, interpreters)
      const test = factory({ age: { $between: [18, 30] } } as any)

      expect(test({ age: 25 })).to.be.true
      expect(test({ age: 40 })).to.be.false
    })

    it('rejects registration of an operator under an existing name', () => {
      expect(() => createOperatorRegistry<ParsingInstruction>(allParsingInstructions).register('$and', $between))
        .to.throw(/already taken/)
      expect(() => createOperatorRegistry(allInterpreters).register('eq', between))
        .to.throw(/already taken/)
    })
  })

  describe('illegal operators', () => {
    it('rejects unknown operators mixed with known ones at parse time', () => {
      expect(() => guard({ a: { $gt: 1, $unknown: 2 } as any }))
        .to.throw('Field query for "a" may contain only operators or a plain object as a value')
    })

    it('rejects unknown AST operators at interpretation time', () => {
      const interpret = createJsInterpreter(allInterpreters)

      expect(() => interpret(new FieldCondition('unknown', 'a', 1), { a: 1 }))
        .to.throw('Unable to interpret "unknown" condition. Did you forget to register interpreter for it?')
    })
  })
})
