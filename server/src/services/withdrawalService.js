import User from '../models/User.js';
import Order from '../models/Order.js';
import Review from '../models/Review.js';
import UserCoupon from '../models/UserCoupon.js';
import EmailMessage from '../models/EmailMessage.js';
import OrderEvent from '../models/OrderEvent.js';
import { applyPoints } from './pointService.js';
import { withTransaction } from '../utils/withTransaction.js';

// 회원 탈퇴 = 하드 삭제가 아니라 **tombstone 전환**이다.
//
// 왜 문서를 남기나: Order.user는 required이고(Order.js) PointTransaction·Review·UserCoupon도
// 같다. findByIdAndDelete로 지우면 이 참조들이 전부 고아가 되어 관리자 주문 목록·CSV·
// 상태변경 메일이 주문자를 잃는다. 게다가 전자상거래법상 계약·대금결제 기록은 5년 보관
// 의무가 있어 애초에 지울 수 없다. 이 저장소는 이미 같은 원칙을 상품에 적용하고 있다 —
// productController의 cleanupOrphanImages는 주문이 참조 중인 이미지의 삭제를 거부한다.
//
// 법정 보관의 주체는 User가 아니라 **Order**다. Order.shippingAddress가 수취인·연락처·주소를
// 스냅샷으로 이미 갖고 있으므로, User의 PII는 계정 편의를 위한 중복 사본에 불과하다.
// 따라서 User 쪽 PII는 즉시 파기하고 Order는 한 필드도 건드리지 않는다.
//
// ⚠️ 이 파기 목록은 User에 새 필드를 추가할 때마다 재검토할 것.
//    새 PII 필드를 여기 넣지 않으면 '수집했지만 파기하지 않는' 상태가 조용히 생긴다.

// 탈퇴를 막는 주문 상태 — 배송이 끝나지 않았거나 환불이 진행 중이면 연락 수단이 필요하다.
const IN_PROGRESS = ['pending', 'paid', 'preparing', 'shipped'];

export class WithdrawalBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WithdrawalBlockedError';
    this.status = 409;
  }
}

export async function withdrawUser(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  if (user.status === 'withdrawn') return user; // 멱등 — 이미 탈퇴한 계정

  const blocking = await Order.countDocuments({ user: userId, status: { $in: IN_PROGRESS } });
  if (blocking > 0) {
    throw new WithdrawalBlockedError(
      '진행 중인 주문이 있어 탈퇴할 수 없습니다. 배송 완료 후 다시 시도해주세요.',
    );
  }

  return withTransaction(async (session) => {
    // 이 회원의 주문 id — EmailMessage·OrderEvent 파기의 기준이 된다.
    // user ref로만 지우면 안 되는 이유는 아래 (3)·(4) 주석 참조.
    const orderIds = await Order.find({ user: userId }, { _id: 1 })
      .session(session)
      .distinct('_id');

    // (1) 적립금 소멸 — **status를 바꾸기 전에** 해야 한다.
    //     pointService의 execApplyPoints가 { status: { $ne: 'withdrawn' } }로 필터하므로
    //     순서를 뒤집으면 이 소멸 기록 자체가 no-op이 되고 잔액이 tombstone에 남는다.
    //     잔액이 0이면 pointService가 0원 원장을 남기지 않으므로(의도된 동작) withdraw
    //     원장이 없는 것이 정상이다 — '파기가 안 됐나' 하고 찾지 말 것.
    const balance = user.points || 0;
    if (balance > 0) {
      await applyPoints(userId, -balance, 'withdraw', { session, note: '회원 탈퇴로 소멸' });
    }

    // (2) 리뷰 익명화 — 삭제하지 않는다. userName은 이미 작성 시점 표시명 스냅샷이고
    //     공개 목록은 user를 populate하지 않으므로 이 한 필드만 덮으면 익명화가 끝난다.
    //     삭제하면 다른 소비자의 구매 판단 자료가 사라지고 Product 평점 재계산이 필요해진다.
    await Review.updateMany({ user: userId }, { $set: { userName: '탈퇴한 회원' } }, { session });

    // (3) 미사용 쿠폰 소멸. 사용한 쿠폰은 주문에 연결된 대금결제 기록의 일부라 남긴다.
    await UserCoupon.deleteMany({ user: userId, used: false }, { session });

    // (4) 발송 메일 파기 — to에 이메일 원문, body에 실명·주문내역이 평문으로 들어있다.
    //     ⚠️ { user: userId } 만으로 지우면 **한 건도 안 지워진다**. outbox 경로(주문 접수·
    //     취소 메일)는 orderEventService의 loadRecipient가 _id 없는 평범한 객체를 반환해
    //     emailService의 `user: userDoc?._id`가 undefined가 되고, 스키마 default가 null을
    //     박는다. user가 채워지는 건 orderTransitionService의 populate 경로(배송중·배송완료)뿐.
    //     그래서 order 기준을 함께 건다. (근본 원인은 loadRecipient에서 아래 (5)와 함께 수정)
    await EmailMessage.deleteMany(
      { $or: [{ user: userId }, { order: { $in: orderIds } }] },
      { session },
    );

    // (5) outbox 페이로드의 수신자 스냅샷 파기 — payload.user에 실명·이메일이 평문으로 있다.
    //     지우면 loadRecipient가 User를 다시 읽는 폴백으로 내려가는데, 그 폴백은 tombstone을
    //     읽고 '탈퇴한 회원 <withdrawn_...@deleted.local>'로 메일을 보내려 한다.
    //     그래서 loadRecipient에 withdrawn 가드를 함께 넣었다(orderEventService 참조).
    await OrderEvent.updateMany(
      { order: { $in: orderIds } },
      { $unset: { 'payload.user': 1 } },
      { session },
    );

    // (6) User PII 파기 + tombstone 전환.
    //     updateOne을 쓰는 이유: 검증·pre('save') 훅·timestamps를 전부 우회하는 것이 **의도**다.
    //     save()는 쓸 수 없다 — passwordHash가 select:false라 로드되지 않아 $unset이 불투명하고,
    //     (1)의 applyPoints가 이미 findOneAndUpdate로 points를 썼으므로 미리 읽어둔 문서를
    //     save()하면 방금 쓴 잔액을 stale 값으로 덮어쓴다.
    //     name은 required라 ''·null이 불가능하다. tombstone 문자열이면 관리자 주문 목록·CSV에
    //     '탈퇴한 회원'으로 명시 표시되어 공백보다 의미가 분명하다.
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          email: `withdrawn_${userId}@deleted.local`, // unique 해소 + 원문 파기
          name: '탈퇴한 회원',
          nickname: null,
          providerId: null,
          addresses: [],
          wishlist: [],
          birthday: null,
          gender: null,
          lastLoginAt: null,
          points: 0, // (1)의 반영과 무관하게 잔액을 확정한다(원장은 감사, 여기는 잔액)
          'agreements.marketing.email': false,
          'agreements.marketing.sms': false,
          status: 'withdrawn',
          withdrawnAt: new Date(),
        },
        $unset: { passwordHash: 1, phone: 1 },
      },
      { session },
    );

    return User.findById(userId).session(session);
  });
}
