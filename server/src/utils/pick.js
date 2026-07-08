// 객체에서 허용된 키만 골라 새 객체로 반환 (요청 바디 화이트리스트용).
export const pick = (obj = {}, keys) =>
  keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
