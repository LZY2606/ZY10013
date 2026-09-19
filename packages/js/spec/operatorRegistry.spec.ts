import { FieldCondition as Field, ITSELF, CompoundCondition } from '@ucast/core'
import { expect } from './specHelper'
import {
  createJsInterpreter,
  interpreterRegistry,
  allInterpreters,
  eq,
  and,
} from '../src'

describe('JS operator registry', () => {
  const interpret = createJsInterpreter(interpreterRegistry)

  it('resolves the "in" alias to the within implementation', () => {
    const condition = new Field('in', 'age', [1, 2])
    expect(interpret(condition, { age: 2 })).to.be.true
    expect(interpret(condition, { age: 3 })).to.be.false
  })

  it('keeps short-circuit semantics for "and"', () => {
    let evaluated = false
    const custom = createJsInterpreter(interpreterRegistry.extend({
      probe: ((node: Field, object: Record<string, unknown>, { get }) => {
        evaluated = true
        return get(object, node.field) === node.value
      }) as typeof eq,
    }))
    const condition = new CompoundCondition('and', [
      new Field('eq', 'a', 1),
      new Field('probe', 'b', true),
    ])

    expect(custom(condition, { a: 2, b: true })).to.be.false
    expect(evaluated).to.be.false
    expect(custom(condition, { a: 1, b: true })).to.be.true
    expect(evaluated).to.be.true
  })

  it('does not share state between extended and base registries', () => {
    const custom = () => true
    const extended = interpreterRegistry.extend({ custom: custom as typeof eq })
    expect(extended.has('custom')).to.be.true
    expect(interpreterRegistry.has('custom')).to.be.false
  })

  it('throws when extending with an existing name', () => {
    expect(() => interpreterRegistry.extend({ eq })).to.throw(/Operator "eq" is already registered/)
  })

  it('still accepts a plain record of operators', () => {
    const local = createJsInterpreter({ eq, and })
    const condition = new Field('eq', ITSELF, 1)
    expect(local(condition, 1)).to.be.true
  })

  it('does not accumulate state across repeated interpretations', () => {
    const condition = new Field('eq', 'a', 1)
    for (let i = 0; i < 5; i++) {
      expect(interpret(condition, { a: 1 })).to.be.true
    }
    expect(interpreterRegistry.entries().length).to.equal(Object.keys(allInterpreters).length - 1)
  })
})
