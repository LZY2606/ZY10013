import { createOperatorRegistry } from '@ucast/core';
import * as interpreters from './interpreters.ts';
import { type SqlOperator } from './interpreter.ts';

const registry = createOperatorRegistry<SqlOperator<any>>(interpreters)
  .alias('in', 'within')
  .alias('some', 'someRelation')
  .alias('none', 'noneRelation')
  .alias('every', 'everyRelation')
  .alias('is', 'isRelation')
  .alias('isNot', 'isNotRelation');

export const allInterpreters = registry.toRecord() as typeof interpreters & {
  in: typeof interpreters.within
  some: typeof interpreters.someRelation
  none: typeof interpreters.noneRelation
  every: typeof interpreters.everyRelation
  is: typeof interpreters.isRelation
  isNot: typeof interpreters.isNotRelation
};
