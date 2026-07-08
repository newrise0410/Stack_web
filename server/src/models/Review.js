import mongoose from 'mongoose';

const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true }, // 작성 시점 표시명(마스킹) 스냅샷
    rating: { type: Number, required: true, min: 1, max: 5 },
    content: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

reviewSchema.index({ product: 1, createdAt: -1 }); // 상품별 최신순
reviewSchema.index({ product: 1, user: 1 }, { unique: true }); // 상품당 1인 1리뷰

reviewSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Review = mongoose.model('Review', reviewSchema);

export default Review;
