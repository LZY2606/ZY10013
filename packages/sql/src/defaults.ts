import { createOperatorRegistry, alias } from '@ucast/core';
import * as interpreters from './interpreters.ts';
import { createSqlInterpreter } from './interpreter.ts';

export const allInterpreters = {
  ...interpreters,
  in: alias('within', interpreters.within),
  some: alias('someRelation', interpreters.someRelation),
  none: alias('noneRelation', interpreters.noneRelation),
  every: alias('everyRelation', interpreters.everyRelation),
  is: alias('isRelation', interpreters.isRelation),
  isNot: alias('isNotRelation', interpreters.isNotRelation),
};

export const interpreterRegistry = createOperatorRegistry(allInterpreters);

export const interpret = createSqlInterpreter(interpreterRegistry);
