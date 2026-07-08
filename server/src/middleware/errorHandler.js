// 매칭되는 라우트가 없을 때
export function notFound(req, res) {
  res.status(404).json({ message: 'Not Found' });
}

// 중앙 에러 핸들러 — Mongo/Mongoose 에러를 적절한 상태코드로 정규화
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || { email: 1 })[0];
    const msg = field === 'email' ? '이미 사용 중인 이메일입니다.' : '이미 존재하는 값입니다.';
    return res.status(409).json({ message: msg });
  }
  if (err.name === 'ValidationError') {
    const errors = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, v.message]),
    );
    return res.status(400).json({ message: '입력값을 확인해주세요.', errors });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }
  console.error(err);
  return res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
  });
}
