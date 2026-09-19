import { FieldCondition, normalizeOperatorNames } from '@ucast/core'
import { expect } from './specHelper'
import {
  MongoQueryParser,
  parsingInstructionsRegistry,
  allParsingInstructions,
  $eq,
} from '../src'

describe('mongo parsing instruction registry', () => {
  it('exposes a sealed registry normalized from $-prefixed names', () => {
    expect(parsingInstructionsRegistry.has('$eq')).to.be.true
    const instruction = parsingInstructionsRegistry.resolve('$eq')!
    expect(instruction.name).to.equal('eq')
  })

  it('throws when two instructions normalize to the same condition name', () => {
    expect(() => normalizeOperatorNames(
      { $eq: { type: 'field' }, eq: { type: 'field' } },
      name => name.replace(/^\$/, '')
    )).to.throw(/Operator "eq" is already registered/)
  })

  it('allows adding package-specific instructions without touching the default', () => {
    const $custom: any = { type: 'field' }
    const parser = new MongoQueryParser({ ...allParsingInstructions, $custom })
    const ast = parser.parse({ a: { $custom: 1 } }) as FieldCondition

    expect(ast.operator).to.equal('custom')
    expect(parsingInstructionsRegistry.has('$custom')).to.be.false
  })

  it('still accepts a plain record of instructions (backward compatibility)', () => {
    const parser = new MongoQueryParser({ $eq })
    const ast = parser.parse({ a: 1 }) as FieldCondition
    expect(ast.operator).to.equal('eq')
  })
})
