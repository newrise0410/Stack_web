// errorHandler가 err.status/err.message를 읽으므로 이 형태만 맞추면 된다.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
