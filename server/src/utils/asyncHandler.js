// async 컨트롤러의 에러를 Express 에러 핸들러로 넘겨주는 래퍼.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
