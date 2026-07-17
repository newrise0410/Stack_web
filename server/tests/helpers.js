import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';

let seq = 0;

// 필수 필드만 채운 테스트 사용자. User 스키마의 required 검증에 걸리면
// 해당 필드를 여기 한 곳에만 추가한다.
export async function createTestUser(overrides = {}) {
  seq += 1;
  return User.create({
    name: `테스터${seq}`,
    email: `tester${seq}-${Date.now()}@test.local`,
    phone: '010-0000-0000',
    password: 'test-password-hash',
    ...overrides,
  });
}

export function authHeader(user) {
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

export const TEST_ADDRESS = {
  recipient: '홍길동',
  phone: '010-1234-5678',
  zipcode: '06236',
  address1: '서울시 강남구 테헤란로 1',
  address2: '101호',
  deliveryMemo: '',
};
