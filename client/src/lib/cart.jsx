import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';

const CartContext = createContext(null);
const STORAGE_KEY = 'sns_cart';

// 라인 식별 = 상품 id(slug) + 옵션 (옵션이 다르면 다른 라인)
const sameLine = (l, id, option) => l.id === id && (l.option || null) === (option || null);

// 수량 상한은 서버(orderController MAX_QTY=99)와 일치시킨다
const MAX_QTY = 99;
const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, n));

function reducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { id, qty = 1, option = null } = action;
      if (state.some((l) => sameLine(l, id, option))) {
        return state.map((l) => (sameLine(l, id, option) ? { ...l, qty: clampQty(l.qty + qty) } : l));
      }
      return [...state, { id, qty: clampQty(qty), option }];
    }
    case 'setQty':
      return state.map((l) =>
        sameLine(l, action.id, action.option) ? { ...l, qty: clampQty(action.qty) } : l,
      );
    case 'remove':
      return state.filter((l) => !sameLine(l, action.id, action.option));
    case 'clear':
      return [];
    default:
      return state;
  }
}

function init() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, undefined, init);

  // 변경 시 localStorage 동기화
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    return {
      lines,
      count,
      add: (id, qty = 1, option = null) => dispatch({ type: 'add', id, qty, option }),
      setQty: (id, option, qty) => dispatch({ type: 'setQty', id, option, qty }),
      remove: (id, option = null) => dispatch({ type: 'remove', id, option }),
      clear: () => dispatch({ type: 'clear' }),
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
