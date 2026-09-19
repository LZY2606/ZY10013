import { Condition } from './Condition';
import { OperatorRegistry } from './registry';

type ArgsExceptLast<F extends (...args: any[]) => any> =
  F extends (a: any, c: any) => any
    ? Parameters<(condition: Condition) => 0>
    : F extends (a: any, b: any, c: any) => any
      ? Parameters<(condition: Condition, value: Parameters<F>[1]) => 0>
      : Parameters<(
        condition: Condition,
        value: Parameters<F>[1],
        options: Parameters<F>[2],
        ...args: unknown[]
      ) => 0>;

export type Interpreter<T extends Condition, R> = (condition: T, ...args: any[]) => R;
export type AnyInterpreter = Interpreter<any, any>;
export interface InterpretationContext<T extends AnyInterpreter> {
  interpret(...args: ArgsExceptLast<T>): ReturnType<T>;
}

function getInterpreter<T>(
  interpreters: OperatorRegistry<T>,
  operator: string
) {
  const interpret = interpreters.get(operator);

  if (typeof interpret !== 'function') {
    throw new Error(`Unable to interpret "${String(operator)}" condition. Did you forget to register interpreter for it?`);
  }

  return interpret;
}

export interface InterpreterOptions {
  numberOfArguments?: 1 | 2 | 3
  getInterpreterName?(condition: Condition, context: this): string
}

function defaultInterpreterName(condition: Condition) {
  return condition.operator;
}

type InvokeOperator = (
  operator: AnyInterpreter,
  condition: Condition,
  value: unknown,
  params: unknown,
  context: {}
) => unknown;

const invokeByArity: Record<number, InvokeOperator> = {
  1: (operator, condition, _value, _params, context) => operator(condition, context),
  2: (operator, condition, value, _params, context) => operator(condition, value, context),
  3: (operator, condition, value, params, context) => operator(condition, value, params, context),
};

export function createInterpreter<T extends AnyInterpreter, U extends {} = {}>(
  interpreters: Record<string, T> | OperatorRegistry<T>,
  rawOptions?: U
) {
  const options = rawOptions as U & InterpreterOptions;
  const getInterpreterName = options && options.getInterpreterName || defaultInterpreterName;
  const registry = interpreters instanceof OperatorRegistry
    ? interpreters
    : new OperatorRegistry(interpreters);
  const invoke = invokeByArity[options && options.numberOfArguments || 2];

  const interpret = ((
    condition: ArgsExceptLast<T>[0],
    value: ArgsExceptLast<T>[1],
    params: ArgsExceptLast<T>[2]
  ) => {
    const interpreterName = getInterpreterName(condition, options);
    const interpretOperator = getInterpreter(registry, interpreterName);
    return invoke(interpretOperator, condition, value, params, defaultContext);
  }) as unknown as InterpretationContext<T>['interpret'];

  const defaultContext = {
    ...options,
    interpret,
  } as InterpretationContext<T> & U;

  return defaultContext.interpret;
}
