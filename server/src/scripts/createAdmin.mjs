import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

// 어드민 계정 생성/승격 스크립트 (멱등).
//
// 사용법:
//   MONGODB_URI="<접속문자열>" ADMIN_EMAIL=you@ex.com ADMIN_PASSWORD='8자이상' \
//     ADMIN_NAME=관리자 node src/scripts/createAdmin.mjs
//
// 동작:
//   - 해당 이메일 계정이 없으면: local provider 어드민으로 신규 생성.
//   - 이미 있으면: role=admin·status=active 로 승격하고,
//     ADMIN_PASSWORD 가 주어졌으면 비밀번호를 재설정한다.
//
// 안전장치:
//   - 원격(비-로컬) DB엔 ADMIN_CONFIRM=yes 를 요구.
//   - URI·비밀번호 값은 로그에 출력하지 않는다.

const uri = process.env.MONGODB_URI;
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = String(process.env.ADMIN_NAME || '관리자').trim();
const phone = String(process.env.ADMIN_PHONE || '01000000000').trim();

const mask = (u) => u.replace(/\/\/[^@]*@/, '//***:***@');

async function main() {
  if (!uri) {
    console.error('✖ MONGODB_URI 가 필요합니다.');
    process.exit(1);
  }
  if (!email) {
    console.error('✖ ADMIN_EMAIL 이 필요합니다.');
    process.exit(1);
  }

  const isLocal = /(127\.0\.0\.1|localhost)/.test(uri);
  if (!isLocal && process.env.ADMIN_CONFIRM !== 'yes') {
    console.error(
      `⚠️  원격 DB에 어드민을 생성/변경하려 합니다: ${mask(uri)}\n` +
        '   실행하려면 ADMIN_CONFIRM=yes 를 붙이세요.',
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  const existing = await User.findOne({ email }).select('+passwordHash');

  if (!existing) {
    if (password.length < 8) {
      console.error('✖ 신규 어드민 생성에는 8자 이상의 ADMIN_PASSWORD 가 필요합니다.');
      await mongoose.disconnect();
      process.exit(1);
    }
    const user = new User({
      email,
      name,
      phone,
      provider: 'local',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    user.password = password; // virtual → pre-save 해싱
    await user.save();
    console.log(`✔ 어드민 신규 생성 완료: ${email} (role=admin)`);
  } else {
    existing.role = 'admin';
    existing.status = 'active';
    if (password) {
      if (password.length < 8) {
        console.error('✖ ADMIN_PASSWORD 는 8자 이상이어야 합니다.');
        await mongoose.disconnect();
        process.exit(1);
      }
      existing.password = password;
      console.log('  (비밀번호 재설정 적용)');
    }
    await existing.save();
    console.log(`✔ 기존 계정 어드민 승격 완료: ${email} (role=admin, status=active)`);
  }

  await mongoose.disconnect();
  console.log('완료.');
}

main().catch(async (e) => {
  console.error('✖ 실패:', e.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  process.exit(1);
});
