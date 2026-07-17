import mongoose from 'mongoose';

const { Schema } = mongoose;

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
    brand: { type: String, default: "STACK N' STAK" },
    name: { type: String, required: true, trim: true },
    nameKo: { type: String, trim: true },
    category: { type: String, enum: ['Lighting', 'Tech', 'Clock'], default: 'Lighting' },
    // 카탈로그의 단일 탐색 축(헤더 내비·카테고리 페이지가 이 값으로 필터).
    // Lighting → Table/Pendant/MoonWall, Tech → Tech, Clock → Clock.
    type: {
      type: String,
      enum: ['Table', 'Pendant', 'MoonWall', 'Tech', 'Clock'],
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

productSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Product = mongoose.model('Product', productSchema);

export default Product;
