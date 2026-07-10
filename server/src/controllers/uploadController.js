import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// POST /admin/uploads (requireAuth + requireAdmin, multer single('file'))
export async function uploadImage(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({ message: '이미지 업로드가 설정되지 않았습니다.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: '업로드할 이미지를 선택해주세요.' });
  }
  if (!ALLOWED.includes(req.file.mimetype)) {
    return res.status(400).json({ message: '허용되지 않은 이미지 형식입니다. (jpeg/png/webp/gif)' });
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: UPLOAD_FOLDER,
          resource_type: 'image',
          // 서버측(실제 바이트 기준) 형식 게이트 — 클라 mimetype 검사는 defense-in-depth로 강등
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
          timeout: 60_000, // 업로드 지연 시 핸들러 무기한 대기 + 5MB 버퍼 상주 방지
        },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
      stream.end(req.file.buffer);
    });
    return res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    // 진단 단서를 남긴다(auth 401 / quota 420 / 형식 400 / 타임아웃 구분)
    console.error('[upload]', err?.http_code, err?.message);
    // Cloudinary가 형식을 거부하면 400 — 서버 오류(502)가 아니라 클라 입력 오류로 매핑
    if (err?.http_code === 400) {
      return res.status(400).json({ message: '허용되지 않은 이미지 형식입니다. (jpeg/png/webp/gif)' });
    }
    return res.status(502).json({ message: '이미지 업로드에 실패했습니다.' });
  }
}
