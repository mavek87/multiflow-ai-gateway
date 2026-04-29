import { expect } from "bun:test";
import { Result } from "neverthrow";

declare module "bun:test" {
  interface Matchers<T> {
    toSucceed(): T;
    toSucceedWith(expected: any): T;
    toFail(): T;
    toFailWith(expected: any): T;
  }
}

expect.extend({
  toSucceed(actual: unknown) {
    if (!isResult(actual)) {
      return {
        message: () => `expected ${JSON.stringify(actual)} to be a Result (neverthrow)`,
        pass: false,
      };
    }
    const pass = actual.isOk();
    return {
      message: () => pass 
        ? `expected Result not to succeed` 
        : `expected Result to succeed, but it failed with ${JSON.stringify(actual._unsafeUnwrapErr())}`,
      pass,
    };
  },
  toSucceedWith(actual: unknown, expected: any) {
    if (!isResult(actual)) {
       return { message: () => `expected ${JSON.stringify(actual)} to be a Result (neverthrow)`, pass: false };
    }
    if (actual.isErr()) {
        return { 
          message: () => `expected Result to succeed with ${JSON.stringify(expected)}, but it failed with ${JSON.stringify(actual._unsafeUnwrapErr())}`, 
          pass: false 
        };
    }
    const value = actual._unsafeUnwrap();
    const pass = this.equals(value, expected);
    return {
        message: () => pass 
          ? `expected Result not to succeed with ${JSON.stringify(expected)}` 
          : `expected Result to succeed with ${JSON.stringify(expected)}, but got ${JSON.stringify(value)}`,
        pass,
    };
  },
  toFail(actual: unknown) {
    if (!isResult(actual)) {
        return { message: () => `expected ${JSON.stringify(actual)} to be a Result (neverthrow)`, pass: false };
    }
    const pass = actual.isErr();
    return {
      message: () => pass 
        ? `expected Result not to fail` 
        : `expected Result to fail, but it succeeded with ${JSON.stringify(actual._unsafeUnwrap())}`,
      pass,
    };
  },
  toFailWith(actual: unknown, expected: any) {
    if (!isResult(actual)) {
        return { message: () => `expected ${JSON.stringify(actual)} to be a Result (neverthrow)`, pass: false };
    }
    if (actual.isOk()) {
        return { 
          message: () => `expected Result to fail with ${JSON.stringify(expected)}, but it succeeded with ${JSON.stringify(actual._unsafeUnwrap())}`, 
          pass: false 
        };
    }
    const error = actual._unsafeUnwrapErr();
    const pass = this.equals(error, expected);
    return {
        message: () => pass 
          ? `expected Result not to fail with ${JSON.stringify(expected)}` 
          : `expected Result to fail with ${JSON.stringify(expected)}, but got ${JSON.stringify(error)}`,
        pass,
    };
  }
});

function isResult(val: any): val is Result<any, any> {
  return val !== null && typeof val === 'object' && 'isOk' in val && 'isErr' in val && typeof val.isOk === 'function' && typeof val.isErr === 'function';
}
