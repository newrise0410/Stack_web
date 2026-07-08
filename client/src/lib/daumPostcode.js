// 다음(카카오) 우편번호 서비스 스크립트 로더 (한 번만 로드).
const SCRIPT_SRC =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

let loadingPromise = null;

export function loadPostcodeScript() {
  if (window.daum && window.daum.Postcode) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadingPromise = null;
      reject(new Error('우편번호 서비스를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return loadingPromise;
}
