export const ok = <D>(data: D) => ({ type: "ok", data } as const);
export type Ok<R> = R extends ReturnType<typeof ok<infer TData>>
  ? ReturnType<typeof ok<TData>>
  : never;
export const isOk = <TError, TData>(
  res: Result<TError, TData>
): res is Ok<Result<TError, TData>> => res.type === "ok";

export const err = <E>(error: E) => ({ type: "err", error } as const);
export type Err<R> = R extends ReturnType<typeof err<infer TError>>
  ? ReturnType<typeof err<TError>>
  : never;
export const isErr = <TError, TData>(
  res: Result<TError, TData>
): res is Err<Result<TError, TData>> => res.type === "err";
export type ErrError<R> = Err<R>["error"];
export type ReturnErr<TFn extends (...args: never) => unknown> = Err<
  Awaited<ReturnType<TFn>>
>;

export type Result<TError, TData> =
  | ReturnType<typeof err<TError>>
  | ReturnType<typeof ok<TData>>;

export const convert = <E, D>(rs: Result<E, D>[]): Result<E[], D[]> => {
  const errs = rs
    .filter((v): v is Err<(typeof rs)[number]> => isErr(v))
    .map(({ error }) => error);
  if (0 < errs.length) return err(errs);
  return ok(
    rs
      .filter((v): v is Ok<(typeof rs)[number]> => isOk(v))
      .map(({ data }) => data)
  );
};
