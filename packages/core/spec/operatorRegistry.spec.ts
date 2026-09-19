import { expect } from 'chai'
import {
  createOperatorRegistry,
  alias,
  normalizeOperatorNames,
  FieldCondition,
  createInterpreter,
} from '../src'

describe('OperatorRegistry', () => {
  const eq = () => true
  const ne = () => false

  it('resolves operators by name', () => {
    const registry = createOperatorRegistry({ eq, ne })
    expect(registry.resolve('eq')).to.equal(eq)
    expect(registry.has('ne')).to.be.true
    expect(registry.has('unknown')).to.be.false
  })

  it('resolves declared aliases to the canonical operator', () => {
    const registry = createOperatorRegistry({ eq }, { eq: ['equal'] })
    expect(registry.resolve('equal')).to.equal(eq)
    expect(registry.nameOf('equal')).to.equal('eq')
  })

  it('resolves aliases declared with the alias() wrapper', () => {
    const registry = createOperatorRegistry({ eq, in: alias('eq', eq) })
    expect(registry.resolve('in')).to.equal(eq)
    expect(registry.nameOf('in')).to.equal('eq')
  })

  it('throws when the same operator name is registered twice', () => {
    expect(() => createOperatorRegistry({ eq, eq2: eq })).to.not.throw()
    expect(() => createOperatorRegistry({ eq }, { eq: ['eq'] }))
      .to.throw(/Operator "eq" is already registered/)
  })

  it('throws instead of silently overriding a later registration', () => {
    const first = () => 'first'
    const second = () => 'second'
    expect(() => createOperatorRegistry({ eq: first, ne })).to.not.throw()
    expect(() => createOperatorRegistry({ eq: first, eqAlias: alias('eq', first) })).to.not.throw()
    expect(() => createOperatorRegistry({ eq: first } as any).extend({ eq: second } as any))
      .to.throw(/already registered/)
  })

  it('throws when aliasing an unknown operator', () => {
    expect(() => createOperatorRegistry({ eq }, { unknown: ['x'] }))
      .to.throw(/Unable to create alias for unknown operator "unknown"/)
  })

  it('allows package-level extension with its own operators without mutating the base', () => {
    const base = createOperatorRegistry({ eq })
    const custom = () => true
    const extended = base.extend({ custom })

    expect(base.has('custom')).to.be.false
    expect(extended.has('custom')).to.be.true
    expect(extended.resolve('custom')).to.equal(custom)
    expect(extended.resolve('eq')).to.equal(eq)
  })

  it('keeps aliases when extending', () => {
    const base = createOperatorRegistry({ eq }, { eq: ['equal'] })
    const extended = base.extend({ custom: ne })
    expect(extended.resolve('equal')).to.equal(eq)
  })

  it('does not accumulate state when the same registry is used repeatedly', () => {
    const registry = createOperatorRegistry({ eq })
    const interpret = createInterpreter(registry) as any
    const condition = new FieldCondition('eq', 'a', 1)

    for (let i = 0; i < 5; i++) {
      expect(() => interpret(condition, {})).to.not.throw()
    }

    expect(registry.entries()).to.have.length(1)
  })

  it('rejects replacing an unknown operator', () => {
    const registry = createOperatorRegistry({ eq })
    expect(() => registry.replace('unknown', ne)).to.throw(/Unable to replace unknown operator/)
  })

  it('replaces an existing operator while preserving its aliases', () => {
    const improved = () => true
    const registry = createOperatorRegistry({ eq }, { eq: ['equal'] }).replace('eq', improved)
    expect(registry.resolve('eq')).to.equal(improved)
    expect(registry.resolve('equal')).to.equal(improved)
  })

  describe('normalizeOperatorNames', () => {
    it('derives condition names with the provided function', () => {
      const registry = normalizeOperatorNames({ $eq: { type: 'field' } }, name => name.slice(1))
      const instruction = registry.resolve('$eq')!
      expect(instruction.name).to.equal('eq')
    })

    it('throws when two operators normalize to the same name', () => {
      expect(() => normalizeOperatorNames({ $eq: {}, eq: {} } as any, name => name.replace('$', '')))
        .to.throw(/Operator "eq" is already registered/)
    })
  })
})
