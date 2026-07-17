import Product from '../models/Product.js';

// 판매량(salesCount) 가감. sign=+1 결제 확정, -1 취소. (orderController에서 이동)
export async function adjustSales(items, sign) {
  if (!items?.length) return;
  await Product.bulkWrite(
    items
      .filter((i) => i.product)
      .map((i) => ({
        updateOne: { filter: { _id: i.product }, update: { $inc: { salesCount: sign * i.qty } } },
      })),
  );
}
