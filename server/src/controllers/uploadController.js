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
        { folder: UPLOAD_FOLDER, resource_type: 'image' },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
      stream.end(req.file.buffer);
    });
    return res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  } catch {
    return res.status(502).json({ message: '이미지 업로드에 실패했습니다.' });
  }
}
