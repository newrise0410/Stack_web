import api from './api.js';

// DB 문서 → 컴포넌트가 쓰는 형태로 정규화
export function normalizeProduct(p) {
  return {
    id: p.slug,
    _id: p._id,
    brand: p.brand,
    name: p.name,
    ko: p.nameKo,
    type: p.type,
    category: p.category,
    image: p.images?.[0],
    price: p.price,
    compareAt: p.compareAtPrice,
    badge: p.badges?.[0] || null,
    material: p.specs?.material,
    dims: p.specs?.dimensions,
    feature: p.specs?.feature,
    made: p.specs?.leadTime,
    options: p.options || [],
    blurb: p.description,
  };
}

export async function fetchProducts(params = {}) {
  const { data } = await api.get('/products', { params });
  return data.items.map(normalizeProduct);
}

export async function fetchProductBySlug(slug) {
  const { data } = await api.get(`/products/${slug}`);
  return normalizeProduct(data);
}
