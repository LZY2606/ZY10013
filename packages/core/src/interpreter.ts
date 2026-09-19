import { Condition } from './Condition';
import { OperatorRegistry } from './OperatorRegistry';

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

export type InterpreterRegistry<T extends AnyInterpreter> =
  | Record<string, T>
  | OperatorRegistry<T>;

function getInterpreter<T extends AnyInterpreter>(
  interpreters: InterpreterRegistry<T>,
  operator: string
): T {
  const interpret = interpreters instanceof OperatorRegistry
    ? interpreters.resolve(operator)
    : interpreters[operator];

  if (typeof interpret !== 'function') {
    throw new Error(`Unable to interpret "${operator}" condition. Did you forget to register interpreter for it?`);
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

export function createInterpreter<T extends AnyInterpreter, U extends {} = {}>(
  interpreters: InterpreterRegistry<T>,
  rawOptions?: U
) {
  const options = (rawOptions || {}) as U & InterpreterOptions;
  const getInterpreterName = options.getInterpreterName || defaultInterpreterName;
  const context = { ...options } as InterpretationContext<T> & U;
  let interpret: InterpretationContext<T>['interpret'];

  if (options.numberOfArguments === 1) {
    interpret = ((condition: Condition) => {
      const interpreterName = getInterpreterName(condition, options);
      return getInterpreter(interpreters, interpreterName)(condition, context as any);
    }) as unknown as InterpretationContext<T>['interpret'];
  } else if (options.numberOfArguments === 3) {
    interpret = ((condition: Condition, value: unknown, params: unknown) => {
      const interpreterName = getInterpreterName(condition, options);
      const operator = getInterpreter(interpreters, interpreterName);
      return operator(condition, value, params, context as any);
    }) as unknown as InterpretationContext<T>['interpret'];
  } else {
    interpret = ((condition: Condition, value: unknown) => {
      const interpreterName = getInterpreterName(condition, options);
      return getInterpreter(interpreters, interpreterName)(condition, value, context as any);
    }) as InterpretationContext<T>['interpret'];
  }

  (context as { interpret: typeof interpret }).interpret = interpret;

  return interpret;
}
