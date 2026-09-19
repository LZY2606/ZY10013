import { expect } from './specHelper'
import {
  Condition,
  CompoundCondition,
  FieldCondition,
  createInterpreter,
  createOperatorRegistry,
} from '../src'

describe('OperatorRegistry', () => {
  it('registers and resolves operators by name', () => {
    const eq = () => true
    const registry = createOperatorRegistry({ eq })

    expect(registry.has('eq')).to.be.true
    expect(registry.get('eq')).to.equal(eq)
    expect(registry.has('ne')).to.be.false
    expect(registry.get('ne')).to.be.undefined
  })

  it('normalizes operator names for registration and lookup', () => {
    const eq = () => true
    const registry = createOperatorRegistry<typeof eq>(undefined, {
      normalizeName: name => name.replace(/^\$/, '')
    })

    registry.register('$eq', eq)

    expect(registry.get('$eq')).to.equal(eq)
    expect(registry.get('eq')).to.equal(eq)
    expect(registry.has('$eq')).to.be.true
  })

  it('resolves aliases to the same operator without copying it', () => {
    const within = () => true
    const registry = createOperatorRegistry({ within }).alias('in', 'within')

    expect(registry.get('in')).to.equal(within)
    expect(registry.get('within')).to.equal(within)
    expect(registry.size).to.equal(1)
  })

  it('rejects registration of an already taken name instead of silently overriding it', () => {
    const registry = createOperatorRegistry<() => boolean>({ eq: () => true })

    expect(() => registry.register('eq', () => false)).to.throw(/already taken/)
    expect(() => registry.alias('eq', 'eq')).to.throw(/already taken/)
    expect(() => registry.alias('ne', 'eq').alias('ne', 'eq')).to.throw(/already taken/)
  })

  it('rejects aliases pointing to unknown operators', () => {
    const registry = createOperatorRegistry({ eq: () => true })

    expect(() => registry.alias('ne', 'neq')).to.throw(/"neq" operator is not registered/)
  })

  it('allows to explicitly override a registered operator', () => {
    const eq = () => true
    const neq = () => false
    const registry = createOperatorRegistry({ eq })

    expect(() => registry.override('ne', neq)).to.throw(/has not been registered/)

    registry.override('eq', neq)
    expect(registry.get('eq')).to.equal(neq)
  })

  it('derives independent registries via "extend" without mutating the source', () => {
    const eq = () => true
    const base = createOperatorRegistry({ eq })
    const extended = base.extend({ ne: () => false }, { neq: 'ne' })

    expect(extended.has('ne')).to.be.true
    expect(extended.has('neq')).to.be.true
    expect(base.has('ne')).to.be.false
    expect(base.has('neq')).to.be.false
    expect(extended.get('eq')).to.equal(eq)
  })

  it('exposes all operators and aliases as a plain record', () => {
    const within = () => true
    const record = createOperatorRegistry({ within })
      .alias('in', 'within')
      .toRecord()

    expect(record).to.deep.equal({ within, in: within })
  })

  describe('interpretation through a shared registry', () => {
    type AnyOp = (condition: Condition, object: any, context: any) => boolean
    const eq: AnyOp = (condition, object) => {
      const fieldCondition = condition as FieldCondition
      return object[fieldCondition.field] === fieldCondition.value
    }
    const and: AnyOp = (
      condition,
      object,
      { interpret }
    ) => {
      const conditions = (condition as CompoundCondition).value
      return conditions.every((child: Condition) => interpret(child, object))
    }

    it('dispatches conditions to operators resolved by the registry', () => {
      const registry = createOperatorRegistry<AnyOp>({ eq, and })
      const interpret = createInterpreter(registry)
      const condition = new CompoundCondition('and', [new FieldCondition('eq', 'a', 1)])

      expect(interpret(condition, { a: 1 })).to.be.true
      expect(interpret(condition, { a: 2 })).to.be.false
    })

    it('does not accumulate state when the same query is interpreted repeatedly', () => {
      const registry = createOperatorRegistry<AnyOp>({ eq, and }).alias('andAlso', 'and')
      const interpret = createInterpreter(registry)
      const condition = new CompoundCondition('and', [new FieldCondition('eq', 'a', 1)])
      const snapshot = registry.toRecord()
      const size = registry.size

      for (let i = 0; i < 1000; i++) {
        interpret(condition, { a: i % 2 })
      }

      expect(registry.size).to.equal(size)
      expect(registry.toRecord()).to.deep.equal(snapshot)
    })

    it('keeps the original error message for unknown operators', () => {
      const interpret = createInterpreter(createOperatorRegistry({ eq }))

      expect(() => interpret(new FieldCondition('lt', 'a', 1), { a: 1 }))
        .to.throw('Unable to interpret "lt" condition. Did you forget to register interpreter for it?')
    })
  })
})
