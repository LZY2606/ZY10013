import { createOperatorRegistry } from '@ucast/core';
import { createJsInterpreter } from './interpreter';
import * as interpreters from './interpreters';
import { JsInterpreter } from './types';

const registry = createOperatorRegistry<JsInterpreter<any>>(interpreters)
  .alias('in', 'within');

export const allInterpreters = registry.toRecord() as typeof interpreters & {
  in: typeof interpreters.within
};
export const interpret = createJsInterpreter(allInterpreters);
