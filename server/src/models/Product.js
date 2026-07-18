import mongoose from 'mongoose';

const { Schema } = mongoose;

// 타입의 단일 원본. 타입을 추가하면 여기 한 줄만 — enum·컨트롤러 화이트리스트·SKU 코드가 파생된다.
// SKU 코드는 3글자 대문자(SNS-<코드>-001). Order.js의 SALES_STATES가 모델에서 export하는 선례를 따른다.
export const TYPE_CODE = { Table: 'TBL', Pendant: 'PND', MoonWall: 'MWL', Tech: 'TEC', Clock: 'CLK', Shelf: 'SHF' };
export const PRODUCT_TYPES = Object.keys(TYPE_CODE);

const specsSchema = new Schema(
  {
    material: String,
    dimensions: String,
    feature: String,
    leadTime: String,
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    // 순번형 SKU(SNS-TEC-001) — 서버가 생성하는 불변값. 관리자 폼·제작리스트·주문서·CSV에 노출.
    // required 아님: 기존 79종은 backfill이 채우고, 신규는 컨트롤러가 채운다.
    // 발급기는 Counter, 인덱스는 불변식 — 수동 편집·backfill 중복 등 발급기 우회에 대한 최후 방어.
    sku: { type: String, default: undefined },
    brand: { type: String, default: "STACK N' STAK" },
    name: { type: String, required: true, trim: true },
    nameKo: { type: String, trim: true },
    category: { type: String, enum: ['Lighting', 'Tech', 'Clock', 'Shelf'], default: 'Lighting' },
    // 카탈로그의 단일 탐색 축(헤더 내비·카테고리 페이지가 이 값으로 필터).
    // Lighting → Table/Pendant/MoonWall, Tech → Tech, Clock → Clock, Shelf → Shelf.
    type: {
      type: String,
      enum: PRODUCT_TYPES,
      required: true,
    },
    description: String,
    images: { type: [String], default: [] }, // 첫 장이 대표 이미지
    price: { type: Number, required: true, min: 0 }, // KRW 정수
    compareAtPrice: { type: Number, default: null, min: 0 }, // 할인 표시용 정가
    badges: { type: [String], default: [] }, // NEW / BEST / SALE
    specs: { type: specsSchema, default: () => ({}) },
    options: { type: [String], default: [] }, // 컬러/사이즈 옵션명
    status: {
      type: String,
      enum: ['active', 'draft', 'soldout', 'archived'],
      default: 'active',
    },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 }, // BEST 랭킹용
  },
  { timestamps: true },
);

productSchema.index({ type: 1, status: 1 }); // 목록 필터
productSchema.index({ name: 'text', nameKo: 'text' }); // 검색
// SKU 유일성 — partialFilterExpression을 쓴다(sparse 아님). sparse는 sku:null이 명시된 문서를
// 포함해 null끼리 충돌하지만, {$type:'string'}은 실제 문자열 sku만 대상으로 한다(Order의 관용구).
productSchema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: 'string' } } },
);

productSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Product = mongoose.model('Product', productSchema);

export default Product;
