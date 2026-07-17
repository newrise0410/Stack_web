import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';

// 저장해 둔 MakerWorld 모델 페이지(repo/Product/<폴더>/*.htm)에서 카탈로그 원재료를 뽑는다.
// 페이지의 __NEXT_DATA__(Next.js SSR 페이로드)에 모델 메타가 통째로 들어 있으므로 HTML 파싱이 아니라 JSON을 읽는다.
//
//   node src/scripts/ingestMakerworldPages.mjs            # 파싱만 (업로드 없음)
//   node src/scripts/ingestMakerworldPages.mjs --upload   # 커버를 Cloudinary로 업로드
//   node src/scripts/ingestMakerworldPages.mjs --upload --limit 1   # 소량 검증
//
// 출력: server/src/scripts/ingest-output.json — 이후 상품 카피 작성의 입력이 된다.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../../../Product');
const OUT_FILE = path.join(__dirname, 'ingest-output.json');

const argv = process.argv.slice(2);
const DO_UPLOAD = argv.includes('--upload');
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : Infinity;

// 폴더명 → 카탈로그 카테고리. 폴더가 곧 사람이 내린 분류이므로 그대로 신뢰한다.
const FOLDER_CATEGORY = {
  lamp: 'Lighting',
  apple: 'Tech',
  'desk clock': 'Clock',
};

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

// summaryTranslated는 HTML이다 — 카피 작성자가 읽을 평문으로 만든다.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 원본 커버 URL에는 oss 변환 쿼리가 붙어 있을 수 있다. Cloudinary가 원본을 받도록 제거한다.
function cleanCoverUrl(url) {
  return url.split('?')[0];
}

function parseFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(NEXT_DATA_RE);
  if (!m) return { skip: 'no __NEXT_DATA__' };

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    return { skip: `bad JSON: ${e.message}` };
  }

  const pathname = data.props?.pageProps?.pathname || data.page || '';
  const design = data.props?.pageProps?.design;
  // 컬렉션·프로필 등 모델이 아닌 페이지는 상품이 될 수 없다.
  if (!design?.id) return { skip: `not a model page (${pathname})` };

  return {
    modelId: design.id,
    slug: design.slug,
    titleEn: design.title,
    titleKo: design.titleTranslated || design.title,
    summary: htmlToText(design.summaryTranslated || design.summary).slice(0, 1200),
    tags: (design.tagsTranslated?.length ? design.tagsTranslated : design.tags) || [],
    coverUrl: cleanCoverUrl(design.coverUrl || ''),
    creator: design.designCreator?.name || '',
    license: design.license || '',
    mwCategories: (design.categories || []).map((c) => c.name).filter(Boolean),
    sourceUrl: `https://makerworld.com/ko/models/${design.id}-${design.slug}`,
    likeCount: design.likeCount ?? 0,
    printCount: design.printCount ?? 0,
    downloadCount: design.downloadCount ?? 0,
  };
}

if (DO_UPLOAD && !isConfigured()) {
  console.error('Cloudinary 미설정 — CLOUDINARY_URL 또는 3분할 env가 필요합니다.');
  process.exit(1);
}
if (!fs.existsSync(SRC_DIR)) {
  console.error(`소스 폴더가 없습니다: ${SRC_DIR}`);
  process.exit(1);
}

const folders = fs
  .readdirSync(SRC_DIR)
  .filter((d) => fs.statSync(path.join(SRC_DIR, d)).isDirectory());

const records = [];
const skipped = [];
let uploaded = 0;
let uploadFailed = 0;

for (const folder of folders) {
  const category = FOLDER_CATEGORY[folder];
  if (!category) {
    console.warn(`알 수 없는 폴더 → 건너뜀: ${folder}`);
    continue;
  }
  const files = fs
    .readdirSync(path.join(SRC_DIR, folder))
    .filter((f) => f.toLowerCase().endsWith('.htm') || f.toLowerCase().endsWith('.html'));

  for (const f of files) {
    if (records.length >= LIMIT) break;
    const r = parseFile(path.join(SRC_DIR, folder, f));
    if (r.skip) {
      skipped.push({ folder, file: f, reason: r.skip });
      continue;
    }
    r.folder = folder;
    r.category = category;
    // 기존 카탈로그와 같은 규칙: <모델ID>-<슬러그> 가 이미지의 안정적 식별자.
    r.publicId = `${r.modelId}-${r.slug}`;

    if (DO_UPLOAD) {
      try {
        // Cloudinary는 원격 URL을 직접 가져올 수 있어 로컬 다운로드가 필요 없다.
        // public_id 고정 + overwrite로 재실행해도 사본이 늘지 않는다(멱등).
        const up = await cloudinary.uploader.upload(r.coverUrl, {
          folder: UPLOAD_FOLDER,
          public_id: r.publicId,
          overwrite: true,
        });
        r.image = up.secure_url;
        uploaded += 1;
        console.log(`  ✓ ${r.publicId}`);
      } catch (e) {
        uploadFailed += 1;
        console.error(`  ✗ ${r.publicId}: ${e.message}`);
      }
    }
    records.push(r);
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(records, null, 2));

console.log(`\n파싱 ${records.length} / 건너뜀 ${skipped.length}`);
skipped.forEach((s) => console.log(`  - ${s.folder}/${s.file}: ${s.reason}`));
if (DO_UPLOAD) console.log(`업로드 ${uploaded} / 실패 ${uploadFailed}`);
console.log(`→ ${OUT_FILE}`);
