import { FieldCondition as Field, createOperatorRegistry } from '@ucast/core'
import { expect } from './specHelper'
import { allInterpreters, createJsInterpreter, JsInterpreter } from '../src'

describe('cross-package behavior guards', () => {
  describe('custom operators', () => {
    const even: JsInterpreter<Field<number>> = (node, object, { get }) => {
      return get(object, node.field) % 2 === 0
    }

    it('interprets operators registered through the shared registry', () => {
      const registry = createOperatorRegistry(allInterpreters).register('even', even)
      const interpret = createJsInterpreter(registry)

      expect(interpret(new Field('even', 'n', 2), { n: 4 })).to.be.true
      expect(interpret(new Field('even', 'n', 2), { n: 5 })).to.be.false
    })

    it('rejects registration of an operator under an existing name', () => {
      expect(() => createOperatorRegistry(allInterpreters).register('eq', even))
        .to.throw(/already taken/)
    })

    it('derives independent operator maps via "extend"', () => {
      const base = createOperatorRegistry(allInterpreters)
      const extended = base.extend({ even })

      expect(extended.has('even')).to.be.true
      expect(base.has('even')).to.be.false
    })
  })

  describe('illegal operators', () => {
    it('rejects unknown AST operators at interpretation time', () => {
      const interpret = createJsInterpreter(allInterpreters)

      expect(() => interpret(new Field('unknown', 'a', 1), { a: 1 }))
        .to.throw('Unable to interpret "unknown" condition. Did you forget to register interpreter for it?')
    })
  })
})
