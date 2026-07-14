# @zireal/result-kit

Type-safe result and structured error utilities for TypeScript, with optional NestJS adapters.

## Packages

- `@zireal/result-kit`
- `@zireal/result-kit/core`
- `@zireal/result-kit/fp-ts`
- `@zireal/result-kit/nest`

The package root re-exports the framework-agnostic core only. Nest-specific helpers live in `@zireal/result-kit/nest`.

## Installation

```bash
pnpm add @zireal/result-kit
```

If you use the Nest adapter:

```bash
pnpm add @nestjs/common
```

## Core Concepts

### `Result<T, E>`

```ts
type Result<T, E> = Success<T> | Failure<E>;
```

Use `Result` to model success and failure explicitly rather than throwing through your service layer.

### `TypedError`

```ts
interface TypedError<TType extends string = string> {
  type: TType;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}
```

`TypedError` is the package’s structured error convention. You can still use any `E` with `Result<T, E>`, but `TypedError` works well for application and domain failures.

## Core Usage

```ts
import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from "@zireal/result-kit";

type UserError = TypedErrorUnion<"not_found" | "validation_error">;

const findUser = (id: string): Result<{ id: string }, UserError> => {
  if (!id.trim()) {
    return ResultKit.fail({
      type: "validation_error",
      message: "id is required",
    });
  }

  if (id !== "123") {
    return ResultKit.fail({
      type: "not_found",
      message: "User not found",
      details: { id },
    });
  }

  return ResultKit.success({ id });
};
```

Chain result-producing services fluently with pipeline helpers:

```ts
type AuthError = TypedErrorUnion<"missing_token">;

const requireSession = (
  token: string,
): Result<{ userId: string }, AuthError> => {
  if (!token.trim()) {
    return ResultKit.fail({
      type: "missing_token",
      message: "token is required",
    });
  }

  return ResultKit.success({ userId: "123" });
};

const result = ResultKit
  .pipe("session-token")
  .andThen(requireSession)
  .andThen((session) => findUser(session.userId))
  .map((user) => user.name)
  .tap({
    onSuccess: (name) => console.info("loaded user", name),
  })
  .match({
    onSuccess: (name) => name,
    onFailure: (error) => error.message,
  });
```

Async pipelines accept both sync and async callbacks for fluent composition:

```ts
const displayName = await ResultKit
  .pipeAsync(Promise.resolve("session-token"))
  .andThen(requireSession)
  .andThen((session) => Promise.resolve(findUser(session.userId)))
  .map((user) => user.name.toUpperCase())
  .orElse((error) => Promise.resolve(ResultKit.success(error.message)))
  .match({
    onSuccess: (name) => name,
    onFailure: (error) => error.message,
  });
```

## `fp-ts` Interop

Use the optional `@zireal/result-kit/fp-ts` entrypoint when you need to bridge into `Either` or `TaskEither` workflows without changing the main library API:

```ts
import { right } from "fp-ts/Either";
import {
  fromEither,
  toEither,
  toTaskEither,
} from "@zireal/result-kit/fp-ts";

const result = fromEither(right(42));
const either = toEither(ResultKit.success(42));
const taskEither = toTaskEither(Promise.resolve(ResultKit.success(42)));
```

## Nest Usage

```ts
import { Controller, Get, Param } from "@nestjs/common";
import { unwrapOrThrow } from "@zireal/result-kit/nest";

@Controller("users")
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get(":id")
  async getUser(@Param("id") id: string) {
    return unwrapOrThrow(await this.service.findUser(id));
  }
}
```

Use a mapper when your domain error types need custom HTTP status behavior:

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { unwrapOrThrow } from "@zireal/result-kit/nest";
import { ResultKit } from "@zireal/result-kit";

const user = unwrapOrThrow(result, {
  mapError: (error) => {
    if (!ResultKit.isTypedError(error)) return undefined;
    if (error.type === "validation_error") {
      return new BadRequestException(error.message);
    }
    if (error.type === "not_found") {
      return new NotFoundException(error.message);
    }

    return undefined;
  },
});
```

## API Surface

### Core

- `TypedError`, `TypedErrorOf`, `TypedErrorUnion`
- `Success`, `Failure`, `Result`
- `ResultPipeline`, `AsyncResultPipeline`
  with `andThen`, `map`, `mapError`, `tap`, `orElse`, `match`, `done`
- `ResultKit.success`, `failure`, `fail`
- `ResultKit.pipe`, `pipeAsync`
- `ResultKit.isSuccess`, `isFailure`, `isTypedError`
- `ResultKit.map`, `bimap`, `mapAsync`, `mapError`, `mapErrorAsync`
- `ResultKit.andThen`, `andThenAsync`, `orElse`, `orElseAsync`
- `ResultKit.match`, `matchAsync`, `tap`, `tapAsync`
- `ResultKit.unwrap`, `unwrapSuccess`, `unwrapFailure`, `unwrapOr`, `unwrapOrElse`, `unwrapOrElseAsync`
- `ResultKit.combine`, `combineAsync`, `combineWithAllErrors`, `combineWithAllErrorsAsync`
- `ResultKit.fromNullable`, `fromPredicate`, `fromPromise`, `fromThrowable`, `fromThrowableAsync`
- `ResultKit.partition`, `filterSuccesses`, `filterFailures`, `toNullable`, `flatten`

### `fp-ts`

- `toEither`, `fromEither`, `toTaskEither`, `fromTaskEither`

### Nest

- `toHttpException`
- `unwrapOrThrow`
- `unwrapPromise`

## Examples

- [`examples/core.ts`](./examples/core.ts)
- [`examples/nest.ts`](./examples/nest.ts)
