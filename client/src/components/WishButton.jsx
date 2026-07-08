import { useNavigate } from 'react-router-dom';
import { useWishlist } from '../lib/wishlist.jsx';

// 하트 토글 버튼. 비로그인 시 클릭하면 로그인 페이지로 유도.
export default function WishButton({ slug, size = 'text-xl', className = '' }) {
  const { isWished, toggle, loggedIn } = useWishlist();
  const nav = useNavigate();
  const wished = isWished(slug);

  const onClick = (e) => {
    // ProductCard의 Link 안에서도 카드 이동을 막고 토글만 수행
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn) {
      nav('/login');
      return;
    }
    toggle(slug);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={wished ? '찜 해제' : '찜하기'}
      aria-pressed={wished}
      className={`${size} leading-none transition-colors ${
        wished ? 'text-sale' : 'text-mute hover:text-ink'
      } ${className}`}
    >
      {wished ? '♥' : '♡'}
    </button>
  );
}
