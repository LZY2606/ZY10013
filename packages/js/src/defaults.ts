import { createOperatorRegistry, alias } from '@ucast/core';
import { createJsInterpreter } from './interpreter';
import * as interpreters from './interpreters';

export const allInterpreters = {
  ...interpreters,
  in: alias('within', interpreters.within),
};
export const interpreterRegistry = createOperatorRegistry(allInterpreters);
export const interpret = createJsInterpreter(interpreterRegistry);
