import { identity } from './utils';

export interface OperatorRegistryOptions {
  /**
   * Normalizes an operator name before it is stored or looked up.
   * For example, Mongo instructions use `name => name.slice(1)` to drop the `$` prefix.
   */
  normalizeName?(name: string): string
}

/**
 * A single source of truth for operator selection: registration, name
 * normalization, aliasing and lookup. Instances are used to compose
 * package level operator maps without copying dispatch logic around.
 *
 * Lookup (`get`/`has`) is side effect free, so a registry shared between
 * interpreters never accumulates state no matter how many conditions
 * are interpreted through it.
 */
export class OperatorRegistry<T> {
  private readonly _operators = new Map<string, T>();
  private readonly _aliases = new Map<string, string>();
  private readonly _normalizeName: Exclude<OperatorRegistryOptions['normalizeName'], undefined>;

  constructor(operators?: Record<string, T>, options: OperatorRegistryOptions = {}) {
    this._normalizeName = options.normalizeName || identity;

    if (operators) {
      this.registerAll(operators);
    }
  }

  /** Amount of registered operators, not counting aliases. */
  get size(): number {
    return this._operators.size;
  }

  has(rawName: string): boolean {
    return this._operators.has(this._resolveName(rawName));
  }

  get(rawName: string): T | undefined {
    return this._operators.get(this._resolveName(rawName));
  }

  /**
   * Registers an operator under its (normalized) name.
   * Throws instead of silently overriding an already registered name.
   */
  register(name: string, operator: T): this {
    const normalized = this._normalizeName(name);

    if (this._operators.has(normalized) || this._aliases.has(normalized)) {
      throw new Error(`Cannot register "${name}" operator because this name is already taken`);
    }

    this._operators.set(normalized, operator);
    return this;
  }

  registerAll(operators: Record<string, T>): this {
    const names = Object.keys(operators);

    for (let i = 0, length = names.length; i < length; i++) {
      this.register(names[i], operators[names[i]]);
    }

    return this;
  }

  /**
   * Binds an additional (normalized) name to an already registered operator.
   * Throws if the alias name is taken or the target operator is unknown.
   */
  alias(aliasName: string, targetName: string): this {
    const normalizedAlias = this._normalizeName(aliasName);

    if (this._operators.has(normalizedAlias) || this._aliases.has(normalizedAlias)) {
      throw new Error(`Cannot register "${aliasName}" alias because this name is already taken`);
    }

    const normalizedTarget = this._resolveName(targetName);

    if (!this._operators.has(normalizedTarget)) {
      throw new Error(`Cannot register "${aliasName}" alias because "${targetName}" operator is not registered`);
    }

    this._aliases.set(normalizedAlias, normalizedTarget);
    return this;
  }

  /**
   * Explicitly replaces an already registered operator. Unlike `register`
   * this never creates a new entry, so accidental name reuse is still rejected.
   */
  override(name: string, operator: T): this {
    const normalized = this._normalizeName(name);

    if (!this._operators.has(normalized)) {
      throw new Error(`Cannot override "${name}" operator because it has not been registered`);
    }

    this._operators.set(normalized, operator);
    return this;
  }

  /**
   * Derives a new registry from this one, leaving this instance untouched.
   * Useful when a package extends a shared operator map with its own operators.
   */
  extend(operators?: Record<string, T>, aliases?: Record<string, string>): OperatorRegistry<T> {
    const extended = new OperatorRegistry<T>(undefined, { normalizeName: this._normalizeName });
    this._operators.forEach((operator, name) => extended._operators.set(name, operator));
    this._aliases.forEach((target, name) => extended._aliases.set(name, target));

    if (operators) {
      extended.registerAll(operators);
    }

    if (aliases) {
      const names = Object.keys(aliases);
      for (let i = 0, length = names.length; i < length; i++) {
        extended.alias(names[i], aliases[names[i]]);
      }
    }

    return extended;
  }

  /** A plain object snapshot of all operators, with aliases resolved. */
  toRecord(): Record<string, T> {
    const record: Record<string, T> = {};

    this._operators.forEach((operator, name) => {
      record[name] = operator;
    });
    this._aliases.forEach((target, name) => {
      record[name] = this._operators.get(target) as T;
    });

    return record;
  }

  private _resolveName(rawName: string): string {
    const normalized = this._normalizeName(rawName);
    return this._aliases.get(normalized) || normalized;
  }
}

export function createOperatorRegistry<T>(
  operators?: Record<string, T>,
  options?: OperatorRegistryOptions
): OperatorRegistry<T> {
  return new OperatorRegistry(operators, options);
}
