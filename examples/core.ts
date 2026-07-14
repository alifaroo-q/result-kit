import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from "@zireal/result-kit";

type AuthError = TypedErrorUnion<"missing_token">;
type UserError = TypedErrorUnion<"not_found" | "validation_error">;

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

const findUser = (
  id: string,
): Result<{ id: string; name: string }, UserError> => {
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

  return ResultKit.success({
    id,
    name: "Ada Lovelace",
  });
};

const result = ResultKit
  .pipe("session-token")
  .andThen(requireSession)
  .andThen((session) => findUser(session.userId))
  .map((user) => user.name.toUpperCase())
  .tap({
    onSuccess: (name) => console.info("loaded user", name),
  })
  .match({
    onSuccess: (name) => name,
    onFailure: (error) => error.message,
  });

console.log(result);
